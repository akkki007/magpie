"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { AgentPanel, type PendingProposal } from "@/components/modelling/agent-panel";
import { CommentsPanel } from "@/components/modelling/comments-panel";
import {
  Grid,
  GRID_GEOMETRY,
  type Editing,
  type GridApi,
  type Selection,
} from "@/components/modelling/grid";
import { HistoryPanel } from "@/components/modelling/history-panel";
import { flattenRows, isSelectable, type GridRow } from "@/components/modelling/rows";
import { Toolbar, type ViewOptions } from "@/components/modelling/toolbar";
import { toast } from "@/components/ui/toast";
import { Topbar } from "@/components/app/topbar";
import { persistCommands, redoModel, undoModel } from "@/app/(app)/models/actions";
import { applyAll, type Command } from "@/lib/model/commands";
import { evaluate } from "@/lib/model/engine";
import { dependentsOf } from "@/lib/model/formula";
import { parseCsv } from "@/lib/model/csv-import";
import { describeRollup, type RollupSpec } from "@/lib/data/rollup";
import { rollupForModel, type RollupSource } from "@/app/(app)/databases/actions";
import { forecastScenarios } from "@/lib/model/presets";
import { withCell } from "@/lib/model/scenario";
import { parseValue, toEditable } from "@/lib/model/format";
import { AGGREGATION_LABEL, bucketsFor } from "@/lib/model/grain";
import { TOTAL, type Aggregation, type Model, type NumberFormat, type Variable } from "@/lib/model/types";

/**
 * The modelling workbench: everything stateful about the grid lives here, and
 * `Grid` stays a function of that state.
 *
 * The important structural choice is that **no handler mutates the model
 * directly** — every one of them builds a `Command` and sends it through the
 * bus (`docs/modelling-plan.md` §1.3). That is why undo is nine lines rather than a
 * feature, and it is the same entry point an agent's proposed changeset will
 * use in M5. A grid that edits its own state is a grid that has to be rewritten
 * when the agent arrives.
 */

/**
 * One step on the local undo stack.
 *
 * A step is a *changeset*, so it holds however many commands that changeset carried — one
 * for a keystroke, several for a preset or an agent proposal. Undo moves them together,
 * which is the only version of undo that makes sense for a batch: accepting six commands
 * and taking back one of them is not an operation anybody asked for.
 *
 * `changeSetId` is the id of the *server* changeset this step corresponds to,
 * generated here so it is known the instant the command is dispatched rather
 * than one round trip later (M3.2). Undo sends it along and the server refuses
 * if that is not what is actually on top of the log — the two stacks are then
 * checked against each other instead of assumed to agree.
 */
type Step = { commands: Command[]; changeSetId: string };

/** How far a best or worst case moves each driver. A round number, and the user's to change
 *  the moment anyone asks — it is a starting point, not a claim about the business. */
const FORECAST_SPREAD = 0.15;

type HistoryState = {
  model: Model;
  undo: Step[];
  redo: Step[];
};

type HistoryAction =
  | { type: "run"; commands: Command[]; changeSetId: string }
  | { type: "undo" }
  | { type: "redo" };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "run": {
      // `applyAll` hands back the inverses already reversed, which is what undoing a batch
      // needs: the last command applied is the first one taken back.
      const { model, inverses } = applyAll(state.model, action.commands);
      // A new edit invalidates the redo branch — the usual linear history, and
      // the same rule `historyStacks` applies when it replays the log.
      return {
        model,
        undo: [{ commands: inverses, changeSetId: action.changeSetId }, ...state.undo].slice(0, 100),
        redo: [],
      };
    }
    case "undo": {
      const [step, ...rest] = state.undo;
      if (!step) return state;
      const { model, inverses } = applyAll(state.model, step.commands);
      // The id travels with the step: it names the EDIT changeset, which is
      // what a later redo has to point back at.
      return { model, undo: rest, redo: [{ ...step, commands: inverses }, ...state.redo] };
    }
    case "redo": {
      const [step, ...rest] = state.redo;
      if (!step) return state;
      const { model, inverses } = applyAll(state.model, step.commands);
      return { model, undo: [{ ...step, commands: inverses }, ...state.undo], redo: rest };
    }
  }
}

export function Workbench({
  initialModel,
  slug,
  modelName,
}: {
  initialModel: Model;
  slug: string;
  modelName: string;
}) {
  const [history, dispatch] = useReducer(historyReducer, {
    model: initialModel,
    undo: [],
    redo: [],
  });
  const model = history.model;

  const [scenarioId, setScenarioId] = useState(
    () => model.scenarios.find((s) => s.isBase)?.id ?? model.scenarios[0]?.id,
  );
  const [view, setView] = useState<ViewOptions>({
    grain: "MONTH",
    trend: true,
    formula: true,
    compact: false,
    compare: null,
  });
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const [expandedVariables, setExpandedVariables] = useState<ReadonlySet<string>>(new Set());

  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [trace, setTrace] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The variable whose formula panel is open (M2.2) — at most one. */
  const [formulaEditing, setFormulaEditing] = useState<string | null>(null);
  /** A pending proposal from the agent (§5, M5.3), previewed through the same
   *  `compare` mechanism M4.3 built — see the note by `compare` below. */
  const [proposal, setProposal] = useState<PendingProposal | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  /* ── Derived state ─────────────────────────────────────────────────────
     Three pure functions over the model. Every keystroke in a cell runs all
     three; for a model this size that is well under a millisecond, and the
     alternative — incremental invalidation — is a cache to get wrong. */
  const evaluation = useMemo(() => evaluate(model, scenarioId), [model, scenarioId]);

  /**
   * The comparison scenario, evaluated (M4.3). A second full pass over the model rather
   * than a diff of the first: §4 says a comparison "evaluates two scenarios and diffs the
   * series", and an overlay can change a formula, not only an input — there is no
   * arithmetic on the base result that gets you there.
   */
  const compare = useMemo(() => {
    // A pending proposal takes over the compare slot while it is being reviewed. §1.4
    // asks for the proposed values rendered "as a ghost overlay beside current ones",
    // and the delta-under-every-number M4.3 already built *is* that overlay — reusing it
    // means the accept/reject decision is made against the same reading the user already
    // knows how to interpret, instead of a second visual language for the same idea.
    if (proposal) {
      const draft = applyAll(model, proposal.commands).model;
      return { name: `Proposed: ${proposal.label}`, evaluation: evaluate(draft, scenarioId) };
    }
    if (!view.compare || view.compare === scenarioId) return null;
    const scenario = model.scenarios.find((s) => s.id === view.compare);
    if (!scenario) return null;
    return { name: scenario.name, evaluation: evaluate(model, scenario.id) };
  }, [model, proposal, scenarioId, view.compare]);
  const buckets = useMemo(() => bucketsFor(model.periods, view.grain), [model.periods, view.grain]);
  const rows = useMemo(
    () => flattenRows(model, { collapsedGroups, expandedVariables, query }),
    [model, collapsedGroups, expandedVariables, query],
  );

  const byId = useMemo(
    () => new Map(model.variables.map((v) => [v.id, v])),
    [model.variables],
  );

  const rowOf = useCallback(
    (key: string | undefined) => rows.find((row) => row.key === key),
    [rows],
  );

  /** The (variable, member) a row edits, or null when it is not an input row. */
  const editTargetOf = useCallback(
    (row: GridRow | undefined) => {
      if (!row) return null;
      if (row.kind === "variable") {
        if (row.variable.kind !== "INPUT" || row.variable.dimensionId) return null;
        return { variable: row.variable, member: TOTAL };
      }
      if (row.kind === "member") {
        if (row.variable.kind !== "INPUT") return null;
        return { variable: row.variable, member: row.member.key };
      }
      return null;
    },
    [],
  );

  /**
   * Apply locally, then persist (M1.1, M1.2).
   *
   * The local apply is not a cache of the server's answer — it *is* the answer, computed by
   * the same `applyCommand` the server runs. That is what keeps typing at keyboard speed
   * across a round trip, and it is only safe because both sides share one implementation.
   *
   * **Writes are serialised**, because commands are not commutative: renaming a variable and
   * then setting one of its inputs must reach Postgres in that order, and two parallel
   * `fetch`es have no such guarantee. One chained promise costs nothing at typing speed.
   *
   * **A failure does not dispatch `undo`,** which was the first version of this and was
   * wrong. `undo` pops the most recent edit, so a slow write failing after the user had
   * already typed into a second cell would silently revert the *wrong* one — and applying the
   * failed command's own inverse is no better, since a later edit may have overwritten the
   * same cell. There is no correct surgical rollback here without conflict resolution the
   * model does not have. So the screen says plainly that it is ahead of the database and
   * offers the one operation that is certainly correct: read it again.
   */
  const pending = useRef<Promise<unknown>>(Promise.resolve());

  /** Every write path reports failure the same way: the screen is ahead, read it again. */
  const behind = useCallback((title: string, detail: string) => {
    toast.error(title, {
      description: `${detail} This screen is now ahead of the database.`,
      duration: Infinity,
      action: { label: "Reload", onClick: () => window.location.reload() },
    });
  }, []);

  const send = useCallback(
    (title: string, write: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
      pending.current = pending.current
        .then(write)
        .then((result) => {
          if (!result.ok) behind(title, result.error);
        })
        .catch((error: unknown) => {
          behind(title, error instanceof Error ? error.message : "The server could not be reached.");
        });
    },
    [behind],
  );

  const runAll = useCallback(
    (commands: Command[], label?: string) => {
      if (commands.length === 0) return;
      // Generated here, not on the server, so the undo stack can name this
      // changeset immediately (M3.2) — and so a retried request cannot apply
      // the same edit twice, because the id is the primary key.
      const changeSetId = crypto.randomUUID();
      dispatch({ type: "run", commands, changeSetId });
      send("That edit was not saved", () => persistCommands(slug, changeSetId, commands, label));
    },
    [send, slug],
  );

  const run = useCallback((command: Command) => runAll([command]), [runAll]);

  /**
   * Undo and redo are writes now (M3.2).
   *
   * They were local-only, which meant an edit, an undo and a reload brought the
   * edit back — the screen and the database quietly disagreeing, with nothing
   * on screen to say so. They go through the same serialised chain as an edit,
   * for the same reason: an undo racing the edit it undoes would reach Postgres
   * in the wrong order.
   */
  const undo = useCallback(() => {
    const step = history.undo[0];
    if (!step) return;
    dispatch({ type: "undo" });
    const changeSetId = crypto.randomUUID();
    send("That undo was not saved", () => undoModel(slug, step.changeSetId, changeSetId));
  }, [history.undo, send, slug]);

  const redo = useCallback(() => {
    const step = history.redo[0];
    if (!step) return;
    dispatch({ type: "redo" });
    const changeSetId = crypto.randomUUID();
    send("That redo was not saved", () => redoModel(slug, step.changeSetId, changeSetId));
  }, [history.redo, send, slug]);

  /* ── Selection movement ────────────────────────────────────────────────*/
  const move = useCallback(
    (rowDelta: number, columnDelta: number) => {
      setSelection((current) => {
        const selectable = rows.filter(isSelectable);
        if (selectable.length === 0) return current;

        if (!current) {
          return { rowKey: selectable[0].key, column: 0 };
        }

        const index = selectable.findIndex((row) => row.key === current.rowKey);
        const nextIndex = Math.min(
          Math.max((index === -1 ? 0 : index) + rowDelta, 0),
          selectable.length - 1,
        );
        const nextColumn = Math.min(
          Math.max(current.column + columnDelta, 0),
          buckets.length - 1,
        );
        return { rowKey: selectable[nextIndex].key, column: nextColumn };
      });
    },
    [rows, buckets.length],
  );

  /**
   * Keep the selected cell on screen without yanking the whole page around.
   *
   * This used to be `querySelector('[data-selected="true"]')` and `scrollIntoView`, which
   * stopped working the moment the grid was virtualised (M1.3): a cell outside the rendered
   * window has no node, so the query found nothing, the view did not follow the selection, and
   * because the view did not follow, the cell was never rendered. Arrow-keying past the fold
   * would have looked like the grid had frozen.
   *
   * So the position is computed rather than measured. That is only possible because both axes
   * are a fixed size — the same property that let the virtualiser be arithmetic instead of a
   * measuring library — and it is strictly better than the DOM version anyway: no dependency
   * on what happens to be mounted, and it accounts for the sticky header and sticky first
   * column occluding the cell, which `block: "nearest"` does not.
   */
  useEffect(() => {
    if (!selection) return;
    const element = scrollRef.current;
    if (!element) return;

    const index = rows.findIndex((row) => row.key === selection.rowKey);
    if (index < 0) return;

    const { nameWidth, trendWidth, formulaWidth, periodWidth } = GRID_GEOMETRY;
    const headerHeight = GRID_GEOMETRY.headerHeight(compare !== null);
    const height = GRID_GEOMETRY.rowHeight(view.compact, compare !== null);
    const lead = nameWidth + (view.trend ? trendWidth : 0) + (view.formula ? formulaWidth : 0);

    const top = headerHeight + index * height;
    if (top < element.scrollTop + headerHeight) element.scrollTop = top - headerHeight;
    else if (top + height > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + height - element.clientHeight;
    }

    const left = lead + selection.column * periodWidth;
    if (left < element.scrollLeft + lead) element.scrollLeft = left - lead;
    else if (left + periodWidth > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = left + periodWidth - element.clientWidth;
    }
  }, [selection, rows, view.compact, view.trend, view.formula, compare]);

  /* ── Editing ───────────────────────────────────────────────────────────*/
  const startEdit = useCallback(
    (rowKey: string, column: number, draft?: string) => {
      const row = rowOf(rowKey);

      // A dimensioned input has no total to type into — the total is a rollup
      // of its members, and letting someone edit it would put the parent and
      // its children into permanent disagreement. Open it instead of doing
      // nothing, which reads as a broken cell.
      if (row?.kind === "variable" && row.variable.kind === "INPUT" && row.variable.dimensionId) {
        const variableId = row.variable.id;
        setExpandedVariables((current) => new Set(current).add(variableId));
        toast(`${row.variable.name} is split by plan`, {
          description: "Edit each member row; the total is their rollup.",
        });
        return;
      }

      const target = editTargetOf(row);
      if (!target) return;
      if (view.grain !== "MONTH") {
        // Writing into a rolled-up cell is ambiguous — does a quarter of 300
        // mean 100 a month, or 300 in March? Refuse rather than guess.
        toast("Switch to the Month view to edit values", {
          description: "Quarter and year columns are rolled up, not stored.",
        });
        return;
      }

      const period = buckets[column]?.from ?? 0;
      const current =
        model.inputs[target.variable.id]?.[target.member]?.[period] ??
        model.inputs[target.variable.id]?.[TOTAL]?.[period] ??
        0;

      setEditing({
        rowKey,
        column,
        draft: draft ?? toEditable(current, target.variable.format),
      });
    },
    [buckets, editTargetOf, model.inputs, rowOf, view.grain],
  );

  const commitEdit = useCallback(
    (moveAfter: "down" | "right" | "none") => {
      // Read `editing` from state rather than from a `setEditing` updater:
      // React double-invokes updaters in development, and a command dispatched
      // inside one would land in the history twice.
      if (!editing) return;

      const target = editTargetOf(rowOf(editing.rowKey));
      if (target) {
        const parsed = parseValue(editing.draft, target.variable.format);
        if (parsed === null) {
          // An unreadable keystroke leaves the previous number alone. A silent
          // zero in a financial model is worse than a rejected edit.
          toast.error("That is not a number", { description: `"${editing.draft}"` });
        } else {
          const period = buckets[editing.column]?.from ?? 0;
          const scenario = model.scenarios.find((s) => s.id === scenarioId);

          if (scenario && !scenario.isBase) {
            // §4, M4.2: inside a scenario an edit is an *overlay*, not a change to the
            // model. Writing SetInput here would edit the base case from a screen that
            // says "Downside" at the top — every other scenario would move, and the
            // question "what differs from base?" would have no answer left.
            const before = scenario.overrides.find((o) => o.variableId === target.variable.id);
            run({
              type: "SetOverride",
              scenarioId: scenario.id,
              variableId: target.variable.id,
              value: withCell(before?.value, model, target.member, period, parsed),
            });
          } else {
            run({
              type: "SetInput",
              variableId: target.variable.id,
              member: target.member,
              period,
              value: parsed,
            });
          }
        }
      }

      setEditing(null);
      if (moveAfter === "down") move(1, 0);
      if (moveAfter === "right") move(0, 1);
      scrollRef.current?.focus();
    },
    [buckets, editTargetOf, editing, model, move, rowOf, run, scenarioId],
  );

  /* ── Row actions ───────────────────────────────────────────────────────*/
  const duplicate = useCallback(
    (variableId: string) => {
      const index = model.variables.findIndex((v) => v.id === variableId);
      const source = model.variables[index];
      if (!source) return;

      const copy: Variable = {
        ...source,
        id: `${source.id}_copy_${Date.now().toString(36)}`,
        name: `${source.name} (copy)`,
      };
      const inputs = model.inputs[variableId];

      run({
        type: "InsertVariable",
        index: index + 1,
        variable: copy,
        inputs: inputs
          ? Object.fromEntries(Object.entries(inputs).map(([key, series]) => [key, [...series]]))
          : undefined,
      });
    },
    [model.inputs, model.variables, run],
  );

  const remove = useCallback(
    (variableId: string) => {
      const variable = byId.get(variableId);
      if (!variable) return;

      const dependents = dependentsOf(model.variables, variableId);
      if (dependents.length > 0) {
        // The DAG is already built, so "what breaks if I delete this" is a
        // question we can answer instead of a mess we can discover later.
        toast.error(`${variable.name} is used by ${dependents.length} formula${dependents.length > 1 ? "s" : ""}`, {
          description: dependents.map((d) => d.name).join(", "),
        });
        return;
      }

      run({ type: "RemoveVariable", variableId });
      setSelection(null);
    },
    [byId, model.variables, run],
  );

  const addVariable = useCallback(
    (groupId: string, rawName: string) => {
      const name = rawName.trim();
      setAdding(null);
      if (!name) return;

      const lastIndex = model.variables.reduce(
        (last, variable, index) => (variable.groupId === groupId ? index : last),
        -1,
      );

      const id = `v_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now().toString(36)}`;
      run({
        type: "InsertVariable",
        index: lastIndex + 1,
        variable: {
          id,
          groupId,
          name,
          // New rows are hardcoded inputs; turning one into a formula is M2's
          // parser, and a half-working formula editor would be worse than none.
          kind: "INPUT",
          format: "CURRENCY",
          aggregation: "SUM",
        },
        inputs: { [TOTAL]: new Array(model.periods.length).fill(0) },
      });
    },
    [model.periods.length, model.variables, run],
  );

  /* ── Keyboard ──────────────────────────────────────────────────────────*/
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (editing) return;

      const key = event.key;
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };

      const NAVIGATION: Record<string, [number, number]> = {
        ArrowDown: [1, 0],
        ArrowUp: [-1, 0],
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
      };

      const step = NAVIGATION[key] ?? (key === "Tab" && selection ? [0, event.shiftKey ? -1 : 1] : null);
      if (step) {
        handled();
        move(step[0], step[1]);
        return;
      }

      if (key === "Escape") {
        if (trace) setTrace(null);
        else setSelection(null);
        return;
      }

      if (!selection) return;
      const row = rowOf(selection.rowKey);

      if (key === "Enter") {
        handled();
        startEdit(selection.rowKey, selection.column);
        return;
      }

      if ((key === "Backspace" || key === "Delete") && editTargetOf(row)) {
        handled();
        startEdit(selection.rowKey, selection.column, "0");
        return;
      }

      // Typing over a cell replaces it, the way every spreadsheet behaves.
      if (key.length === 1 && !event.metaKey && !event.ctrlKey && /[0-9.\-(]/.test(key)) {
        handled();
        startEdit(selection.rowKey, selection.column, key);
      }
    },
    [editTargetOf, editing, move, rowOf, selection, startEdit, trace],
  );

  /** Undo/redo are document-level: they belong to the model, not to the grid. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [redo, undo]);

  /**
   * Best and worst case, as two overlays on the base (M4.4).
   *
   * One changeset, so a preset arrives and leaves in one undo. It is also the first batch
   * anything sends — deliberately something deterministic, so §1.4's agent finds the path
   * already worn in rather than being its first user.
   */
  const forecast = useCallback(
    (targetId: string) => {
      const objective = model.variables.find((v) => v.id === targetId);
      if (!objective) return;

      const taken = new Set(model.scenarios.map((s) => s.name.toLowerCase()));
      const name = (suffix: string) => {
        const stem = `${objective.name} — ${suffix}`;
        if (!taken.has(stem.toLowerCase())) return stem;
        for (let n = 2; ; n++) if (!taken.has(`${stem} ${n}`.toLowerCase())) return `${stem} ${n}`;
      };

      const { upside, downside, drivers } = forecastScenarios(model, targetId, FORECAST_SPREAD, {
        upside: name("best"),
        downside: name("worst"),
      });

      if (drivers.length === 0) {
        // Nothing to move. Creating two empty scenarios would look like it worked and read
        // as identical to base forever after.
        toast.error(`${objective.name} does not respond to any input`, {
          description: "There is nothing for a best and worst case to vary.",
        });
        return;
      }

      runAll(
        [
          { type: "CreateScenario", scenario: upside },
          { type: "CreateScenario", scenario: downside },
        ],
        `Best and worst case for ${objective.name}`,
      );
      setScenarioId(upside.id);
      setView((current) => ({ ...current, compare: downside.id }));
      toast.success(`${drivers.length} drivers moved ${Math.round(FORECAST_SPREAD * 100)}%`, {
        description: `Comparing ${upside.name} against ${downside.name}.`,
      });
    },
    [model, runAll],
  );

  /* ── Grid callbacks ────────────────────────────────────────────────────*/
  const api: GridApi = useMemo(
    () => ({
      onSelect: (next) => {
        setSelection(next);
        scrollRef.current?.focus();
      },
      onStartEdit: startEdit,
      onDraftChange: (draft) => setEditing((current) => (current ? { ...current, draft } : null)),
      onCommitEdit: commitEdit,
      onCancelEdit: () => {
        setEditing(null);
        scrollRef.current?.focus();
      },
      onToggleGroup: (groupId) =>
        setCollapsedGroups((current) => toggled(current, groupId)),
      onToggleVariable: (variableId) =>
        setExpandedVariables((current) => toggled(current, variableId)),
      onTrace: setTrace,
      onForecast: forecast,
      onFormulaStart: (variableId) => {
        setFormulaEditing(variableId);
        setEditing(null);
      },
      onFormulaCancel: () => {
        setFormulaEditing(null);
        scrollRef.current?.focus();
      },
      onFormulaCommit: (variableId, formula) => {
        setFormulaEditing(null);
        scrollRef.current?.focus();
        const before = model.variables.find((v) => v.id === variableId)?.formula ?? null;
        // Closing the panel on an untouched formula is not an edit. Without
        // this every open-and-close would write a row and push an undo step,
        // and the history would fill with changes nobody made.
        if (JSON.stringify(before) === JSON.stringify(formula)) return;
        run({ type: "SetFormula", variableId, formula });
      },
      onRenameStart: setRenaming,
      onRenameCommit: (variableId, name) => {
        setRenaming(null);
        const trimmed = name.trim();
        if (trimmed) run({ type: "RenameVariable", variableId, name: trimmed });
      },
      onRenameCancel: () => setRenaming(null),
      onDuplicate: duplicate,
      onDelete: remove,
      onAddStart: setAdding,
      onAddCommit: addVariable,
    }),
    [addVariable, commitEdit, duplicate, forecast, model.variables, remove, run, startEdit],
  );

  /* ── Scenarios (M4.1) ──────────────────────────────────────────────────*/

  /**
   * Created with a generated name and no overrides, rather than behind a dialog asking for
   * one. `(modelId, name)` is unique in the database, so a name has to be settled before
   * the write either way — and a scenario you can rename in the same menu you made it in
   * is less ceremony than a modal that blocks you until you think of a word.
   */
  const createScenario = useCallback(
    (parentId: string | null) => {
      const taken = new Set(model.scenarios.map((s) => s.name.toLowerCase()));
      let name = "";
      for (let n = model.scenarios.length; !name || taken.has(name.toLowerCase()); n++) {
        name = `Scenario ${n}`;
      }

      const id = crypto.randomUUID();
      run({
        type: "CreateScenario",
        scenario: {
          id,
          name,
          isBase: false,
          ...(parentId ? { parentId } : {}),
          overrides: [],
        },
      });
      // Switching to it immediately is the point: you made it to work in it.
      setScenarioId(id);
    },
    [model.scenarios, run],
  );

  const deleteScenario = useCallback(
    (scenarioId: string) => {
      const scenario = model.scenarios.find((s) => s.id === scenarioId);
      if (!scenario) return;

      const branches = model.scenarios.filter((s) => s.parentId === scenarioId);
      if (branches.length > 0) {
        // The same refusal the server makes, said earlier and in words. Letting the click
        // through so the server can reject it would be a round trip to learn something the
        // screen already knew.
        toast.error(`${scenario.name} has ${branches.length === 1 ? "a branch" : "branches"}`, {
          description: `Delete ${branches.map((b) => b.name).join(", ")} first.`,
        });
        return;
      }

      run({ type: "DeleteScenario", scenarioId });
      setScenarioId(model.scenarios.find((s) => s.isBase)?.id ?? model.scenarios[0]?.id);
    },
    [model.scenarios, run],
  );

  /**
   * One landing path for every imported series (§6, §7 M7.1 and `docs/database-plan.md` §3).
   *
   * A pasted CSV and a database rollup are two *producers* of the same thing, and they
   * deliberately return the same result shape so this is the only place that turns one into
   * a variable. If they each dispatched their own InsertVariable, "where did this number
   * come from" would have two answers that could drift — and §6's requirement is precisely
   * that a synced number stays explainable through the audit log. Going through the command
   * bus is what makes undo, history and the agent's view work on day one for both.
   */
  const insertLinked = useCallback(
    (
      name: string,
      result: { series: number[]; matched: number; total: number },
      shape: { format: NumberFormat; aggregation: Aggregation },
      source: string,
    ) => {
      const groupId = model.groups[0]?.id;
      if (!groupId) return;

      run({
        type: "InsertVariable",
        index: model.variables.length,
        variable: {
          id: crypto.randomUUID(),
          groupId,
          name,
          kind: "LINKED",
          format: shape.format,
          aggregation: shape.aggregation,
        },
        inputs: { [TOTAL]: result.series },
      });

      const skipped = result.total - result.matched;
      toast.success(`Added “${name}” from ${source}`, {
        description:
          skipped > 0
            ? `${result.matched} period${result.matched === 1 ? "" : "s"} filled · ${skipped} row${skipped === 1 ? "" : "s"} fell outside the horizon.`
            : `${result.matched} period${result.matched === 1 ? "" : "s"} filled.`,
      });
    },
    [model.groups, model.variables.length, run],
  );

  const importCsv = useCallback(
    (name: string, csvText: string) => {
      const result = parseCsv(csvText, model);
      if (!result.ok) {
        toast.error("Nothing was imported", { description: result.error });
        return;
      }
      insertLinked(name, result, { format: "COUNT", aggregation: "SUM" }, "CSV");
    },
    [model, insertLinked],
  );

  /**
   * The database rollup (`docs/database-plan.md` D4) — the thing the database module exists
   * for. The arithmetic runs on the server (a table is unbounded in a way a paste is not),
   * and what comes back is the identical result shape a paste produces.
   */
  const importFromDatabase = useCallback(
    async (source: RollupSource, spec: RollupSpec) => {
      const result = await rollupForModel(slug, source.slug, spec);
      if (!result.ok) {
        toast.error("Nothing was added", { description: result.error });
        return;
      }
      const shape = describeRollup({ ...source, id: source.slug, rows: [] }, spec);
      insertLinked(shape.name, result, shape, source.name);
    },
    [slug, insertLinked],
  );

  const allCollapsed = collapsedGroups.size === model.groups.length;
  const selectedRow = rowOf(selection?.rowKey);
  const selectedVariable =
    selectedRow && (selectedRow.kind === "variable" || selectedRow.kind === "member")
      ? selectedRow.variable
      : null;

  return (
    <>
      <Topbar
        workspace="Models"
        object={modelName}
        meta="Saved to Postgres"
        agent={<AgentPanel slug={slug} onProposalChange={setProposal} />}
        history={<HistoryPanel slug={slug} />}
        comments={<CommentsPanel slug={slug} model={model} />}
      />

      <Toolbar
        query={query}
        onQueryChange={setQuery}
        scenarios={model.scenarios}
        scenarioId={scenarioId}
        onScenarioChange={setScenarioId}
        onScenarioCreate={createScenario}
        onScenarioRename={(scenarioId, name) => run({ type: "RenameScenario", scenarioId, name })}
        onScenarioDelete={deleteScenario}
        onImportCsv={importCsv}
        onImportFromDatabase={importFromDatabase}
        view={view}
        onViewChange={setView}
        allCollapsed={allCollapsed}
        onToggleCollapseAll={() =>
          setCollapsedGroups(
            allCollapsed ? new Set() : new Set(model.groups.map((g) => g.id)),
          )
        }
        canUndo={history.undo.length > 0}
        canRedo={history.redo.length > 0}
        onUndo={undo}
        onRedo={redo}
      />

      <div
        ref={scrollRef}
        tabIndex={0}
        aria-label={`${model.name} variables`}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto outline-none focus:shadow-none"
      >
        <Grid
          model={model}
          rows={rows}
          buckets={buckets}
          viewport={scrollRef}
          formulaEditing={formulaEditing}
          compare={compare}
          evaluation={evaluation}
          view={view}
          selection={selection}
          editing={editing}
          trace={trace}
          renaming={renaming}
          adding={adding}
          api={api}
        />

        {rows.length === 0 && (
          <p className="px-4 py-6 text-[13px] text-ink-muted">
            No variable matches <span className="text-ink">{query}</span>.
          </p>
        )}
      </div>

      {/* Status bar: what the grid is currently showing, and what the selected
          row does when the grain changes — the rule from §1.2, in the one place
          a user can act on it. */}
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line px-3 text-[11px] text-ink-muted">
        <span>
          {model.periods.length} periods · {model.variables.length} variables
        </span>
        <span className="text-ink-faint">·</span>
        <span>{model.scenarios.find((s) => s.id === scenarioId)?.name}</span>
        {selectedVariable && (
          <>
            <span className="text-ink-faint">·</span>
            <span className="truncate">
              <span className="text-ink">{selectedVariable.name}</span>{" "}
              {AGGREGATION_LABEL[selectedVariable.aggregation].toLowerCase()}
            </span>
          </>
        )}
        <span className="ml-auto hidden shrink-0 text-ink-faint sm:block">
          {view.grain === "MONTH"
            ? "Double-click or press Enter to edit an input cell"
            : "Rolled up from the monthly grain"}
        </span>
      </div>
    </>
  );
}

function toggled(set: ReadonlySet<string>, key: string) {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
