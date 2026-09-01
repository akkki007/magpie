"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { Grid, type Editing, type GridApi, type Selection } from "@/components/modelling/grid";
import { flattenRows, isSelectable, type GridRow } from "@/components/modelling/rows";
import { Toolbar, type ViewOptions } from "@/components/modelling/toolbar";
import { toast } from "@/components/ui/toast";
import { persistCommand } from "@/app/(app)/models/actions";
import { applyCommand, type Command } from "@/lib/model/commands";
import { evaluate } from "@/lib/model/engine";
import { dependentsOf } from "@/lib/model/formula";
import { parseValue, toEditable } from "@/lib/model/format";
import { AGGREGATION_LABEL, bucketsFor } from "@/lib/model/grain";
import { TOTAL, type Model, type Variable } from "@/lib/model/types";

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

type HistoryState = {
  model: Model;
  undo: Command[];
  redo: Command[];
};

type HistoryAction =
  | { type: "run"; command: Command }
  | { type: "undo" }
  | { type: "redo" };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "run": {
      const { model, inverse } = applyCommand(state.model, action.command);
      // A new edit invalidates the redo branch — the usual linear history.
      return { model, undo: [inverse, ...state.undo].slice(0, 100), redo: [] };
    }
    case "undo": {
      const [command, ...rest] = state.undo;
      if (!command) return state;
      const { model, inverse } = applyCommand(state.model, command);
      return { model, undo: rest, redo: [inverse, ...state.redo] };
    }
    case "redo": {
      const [command, ...rest] = state.redo;
      if (!command) return state;
      const { model, inverse } = applyCommand(state.model, command);
      return { model, undo: [inverse, ...state.undo], redo: rest };
    }
  }
}

export function Workbench({ initialModel, slug }: { initialModel: Model; slug: string }) {
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
  });
  const [query, setQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const [expandedVariables, setExpandedVariables] = useState<ReadonlySet<string>>(new Set());

  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [trace, setTrace] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  /* ── Derived state ─────────────────────────────────────────────────────
     Three pure functions over the model. Every keystroke in a cell runs all
     three; for a model this size that is well under a millisecond, and the
     alternative — incremental invalidation — is a cache to get wrong. */
  const evaluation = useMemo(() => evaluate(model, scenarioId), [model, scenarioId]);
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

  const run = useCallback(
    (command: Command) => {
      dispatch({ type: "run", command });

      pending.current = pending.current
        .then(() => persistCommand(slug, command))
        .then((result) => {
          if (result.ok) return;
          toast.error("That edit was not saved", {
            description: `${result.error} This screen is now ahead of the database.`,
            duration: Infinity,
            action: { label: "Reload", onClick: () => window.location.reload() },
          });
        })
        .catch((error: unknown) => {
          toast.error("That edit was not saved", {
            description:
              error instanceof Error ? error.message : "The server could not be reached.",
            duration: Infinity,
            action: { label: "Reload", onClick: () => window.location.reload() },
          });
        });
    },
    [slug],
  );

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

  /** Keep the selected cell on screen without yanking the whole page around. */
  useEffect(() => {
    if (!selection) return;
    scrollRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selection]);

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
          run({
            type: "SetInput",
            variableId: target.variable.id,
            member: target.member,
            period: buckets[editing.column]?.from ?? 0,
            value: parsed,
          });
        }
      }

      setEditing(null);
      if (moveAfter === "down") move(1, 0);
      if (moveAfter === "right") move(0, 1);
      scrollRef.current?.focus();
    },
    [buckets, editTargetOf, editing, move, rowOf, run],
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
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
    [addVariable, commitEdit, duplicate, remove, run, startEdit],
  );

  const allCollapsed = collapsedGroups.size === model.groups.length;
  const selectedRow = rowOf(selection?.rowKey);
  const selectedVariable =
    selectedRow && (selectedRow.kind === "variable" || selectedRow.kind === "member")
      ? selectedRow.variable
      : null;

  return (
    <>
      <Toolbar
        query={query}
        onQueryChange={setQuery}
        scenarios={model.scenarios}
        scenarioId={scenarioId}
        onScenarioChange={setScenarioId}
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
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
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
