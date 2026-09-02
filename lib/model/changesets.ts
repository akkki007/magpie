import type { Prisma } from "@/lib/generated/prisma/client";

import type { Command } from "./commands";
import { applyCommandToDb } from "./commands-db";
import { periodsBetween, readModel, rebuildFormula } from "./persist";
import { OverrideSchema } from "./scenario";
import { TOTAL } from "./types";

/**
 * The command stream (`docs/modelling-plan.md` M3.1, §1.3).
 *
 * §1.3's claim is that undo, the audit log, version history and AI proposals are
 * **one mechanism instead of five**. M1 made the *write* one mechanism; this
 * makes the record one. Every mutation now lands as a `ChangeSet` of ordered
 * `Command` rows, each carrying the command that undoes it, and undo is a query
 * over that stream rather than a stack that dies with the tab.
 *
 * ── The log is append-only ───────────────────────────────────────────────
 * Undo does not delete the changeset it undoes; it appends a changeset that
 * says so. That is not fastidiousness — the log *is* the audit trail, and a
 * trail you can delete from cannot answer the one question a finance team
 * actually asks, which is "who changed this and when". It also makes redo
 * fall out for free, because "redo" is just "the thing that was undone is
 * still there".
 *
 * ── The inverse is computed on the server ────────────────────────────────
 * The client already computes one for its optimistic stack, and it would be
 * one field to send. It is deliberately not sent: a stale or buggy client
 * would then be able to write an inverse that does not actually invert, and
 * the corruption would only surface later, when somebody pressed undo. What
 * is read here is small and targeted per command type — one input cell, one
 * name, one formula tree — not a whole model read per keystroke.
 */

type Tx = Prisma.TransactionClient;

export type Actor = { id: string | null; name: string };

export type ChangeKind = "EDIT" | "UNDO" | "REDO" | "ROLLBACK";

/** What the history panel renders. Dates are ISO so this crosses to the client. */
export type HistoryEntry = {
  id: string;
  seq: number;
  kind: ChangeKind;
  origin: "USER" | "AGENT" | "SYNC";
  label: string;
  targetId: string | null;
  actorName: string;
  createdAt: string;
  commandCount: number;
};

/* ── The undo stack, reconstructed ────────────────────────────────────────*/

/**
 * The in-memory reducer in `workbench.tsx`, replayed over the log.
 *
 * That correspondence is the point of M3.2 and worth keeping literal: an
 * `EDIT` pushes and clears the redo branch, an `UNDO` moves one entry across,
 * a `REDO` moves it back. If this ever stops matching the reducer, the two
 * disagree about what the next undo does, and the user finds out by pressing
 * it.
 *
 * A `ROLLBACK` pushes like an edit, because it carries its own commands and
 * their inverses — undoing one is the same operation as undoing anything else.
 */
export function historyStacks(entries: HistoryEntry[]) {
  const ascending = [...entries].sort((a, b) => a.seq - b.seq);
  const undo: string[] = [];
  const redo: string[] = [];

  for (const entry of ascending) {
    switch (entry.kind) {
      case "EDIT":
      case "ROLLBACK":
        undo.push(entry.id);
        redo.length = 0;
        break;
      case "UNDO": {
        if (!entry.targetId) break;
        remove(undo, entry.targetId);
        redo.push(entry.targetId);
        break;
      }
      case "REDO": {
        if (!entry.targetId) break;
        remove(redo, entry.targetId);
        undo.push(entry.targetId);
        break;
      }
    }
  }

  return { undo, redo };
}

function remove(stack: string[], id: string) {
  const index = stack.lastIndexOf(id);
  if (index !== -1) stack.splice(index, 1);
}

/* ── Reading ──────────────────────────────────────────────────────────────*/

export async function readHistory(
  tx: Tx,
  modelId: string,
  limit = 200,
): Promise<HistoryEntry[]> {
  const rows = await tx.changeSet.findMany({
    where: { modelId },
    orderBy: { seq: "desc" },
    take: limit,
    select: {
      id: true,
      seq: true,
      kind: true,
      origin: true,
      label: true,
      targetId: true,
      actorName: true,
      createdAt: true,
      _count: { select: { commands: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    origin: row.origin,
    label: row.label,
    targetId: row.targetId,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
    commandCount: row._count.commands,
  }));
}

/* ── Writing ──────────────────────────────────────────────────────────────*/

/**
 * `seq` is read and written inside the caller's transaction, and
 * `@@unique([modelId, seq])` is what makes that safe: two tabs racing both
 * compute the same next value and one of them fails the insert. The action
 * turns that into "this model changed elsewhere — reload", which is the honest
 * answer. Silently renumbering would let two edits claim the same position in
 * a log whose whole value is its order.
 */
async function nextSeq(tx: Tx, modelId: string) {
  const top = await tx.changeSet.findFirst({
    where: { modelId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return (top?.seq ?? 0) + 1;
}

export async function recordChangeSet(
  tx: Tx,
  args: {
    id: string;
    modelId: string;
    kind: ChangeKind;
    origin?: "USER" | "AGENT" | "SYNC";
    label: string;
    actor: Actor;
    /** Applied in order; each is stored with the command that undoes it. */
    commands: { command: Command; inverse: Command }[];
    /** For UNDO and REDO — the changeset being acted on. */
    targetId?: string;
  },
): Promise<void> {
  for (const { command } of args.commands) {
    // Only an EDIT carries new intent — see the note on `applyCommandToDb`. An UNDO, REDO or
    // ROLLBACK replays commands that were validated when they were first written, and
    // refusing one would mean an undo that sometimes does not work.
    await applyCommandToDb(tx, args.modelId, command, { validate: args.kind === "EDIT" });
  }

  await tx.changeSet.create({
    data: {
      id: args.id,
      modelId: args.modelId,
      seq: await nextSeq(tx, args.modelId),
      kind: args.kind,
      origin: args.origin ?? "USER",
      label: args.label,
      targetId: args.targetId ?? null,
      actorId: args.actor.id,
      actorName: args.actor.name,
      commands: {
        create: args.commands.map(({ command, inverse }, order) => ({
          order,
          type: command.type,
          payload: command as unknown as Prisma.InputJsonValue,
          inverse: inverse as unknown as Prisma.InputJsonValue,
        })),
      },
    },
  });
}

/** The stored commands of one changeset, in order. */
export async function commandsOf(tx: Tx, changeSetId: string) {
  const rows = await tx.command.findMany({
    where: { changeSetId },
    orderBy: { order: "asc" },
    select: { payload: true, inverse: true },
  });
  return rows.map((row) => ({
    command: row.payload as unknown as Command,
    inverse: row.inverse as unknown as Command,
  }));
}

/* ── Versions and rollback (M3.3) ─────────────────────────────────────────*/

export type VersionEntry = {
  id: string;
  seq: number;
  label: string;
  actorName: string;
  createdAt: string;
};

export async function readVersions(tx: Tx, modelId: string): Promise<VersionEntry[]> {
  const rows = await tx.modelVersion.findMany({
    where: { modelId },
    orderBy: { seq: "desc" },
    select: { id: true, seq: true, label: true, actorName: true, createdAt: true },
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

/**
 * Every changeset written after `seq`, newest first, with the commands it
 * applied — which is exactly the list a rollback has to undo.
 *
 * All kinds are included, undos among them. A rollback is not "undo the edits";
 * it is "return the model to the state it was in at that point", and an undo
 * changed the model as surely as an edit did. This is why `UNDO` and `REDO`
 * store the commands they applied rather than only pointing at a target: it
 * makes this loop uniform over every kind.
 */
export async function changesSince(tx: Tx, modelId: string, seq: number) {
  const rows = await tx.changeSet.findMany({
    where: { modelId, seq: { gt: seq } },
    orderBy: { seq: "desc" },
    select: { id: true, seq: true, label: true, commands: { orderBy: { order: "asc" }, select: { payload: true, inverse: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    label: row.label,
    commands: row.commands.map((c) => ({
      command: c.payload as unknown as Command,
      inverse: c.inverse as unknown as Command,
    })),
  }));
}

/**
 * Return a model to the state a version recorded (M3.3).
 *
 * **The snapshot is the check, not the mechanism.** Writing it back over the tables would be
 * two lines and would leave a hole in the log where nobody can see what changed. Instead
 * every changeset written after the version is replayed backwards — its stored inverses, in
 * reverse order — and the result is *then* compared to the snapshot. If the two disagree,
 * some command was not honestly invertible, and the caller's transaction is abandoned rather
 * than landing the model somewhere nobody named. A rollback that quietly half-works is worse
 * than one that refuses.
 *
 * The rollback is itself a changeset, so it appears in history with an actor and can be
 * undone like anything else.
 */
export async function rollback(
  tx: Tx,
  args: {
    modelId: string;
    slug: string;
    changeSetId: string;
    actor: Actor;
    version: { seq: number; label: string; snapshot: unknown };
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const since = await changesSince(tx, args.modelId, args.version.seq);
  if (since.length === 0) {
    return { ok: false, error: `The model is already at "${args.version.label}".` };
  }

  // Newest changeset first, and each one's commands reversed within it: undoing a batch
  // means undoing its last step first.
  await recordChangeSet(tx, {
    id: args.changeSetId,
    modelId: args.modelId,
    kind: "ROLLBACK",
    label: `Roll back to ${args.version.label}`,
    actor: args.actor,
    commands: since.flatMap((change) =>
      [...change.commands].reverse().map(({ command, inverse }) => ({
        command: inverse,
        inverse: command,
      })),
    ),
  });

  const now = await readModel(tx, args.slug);
  if (!now || !identical(now, args.version.snapshot)) {
    return {
      ok: false,
      error: `Rolling back to "${args.version.label}" did not reproduce that version.`,
    };
  }
  return { ok: true };
}

/** Key order is not meaning; `undefined` and an absent key are the same absence. */
function identical(a: unknown, b: unknown) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .filter(([, v]) => v !== undefined)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/* ── The inverse of a command, from what is currently stored ──────────────*/

/**
 * Mirrors the `inverse` each branch of `applyCommand` returns, but reads the
 * "before" state from Postgres instead of from an in-memory `Model`. The two
 * have to agree — `scripts/history-check.ts` asserts they do for every command
 * type, because a wrong inverse is a bug that only appears at undo time, long
 * after the edit that caused it.
 */
export async function inverseFromDb(
  tx: Tx,
  modelId: string,
  command: Command,
): Promise<Command> {
  switch (command.type) {
    case "SetInput": {
      const model = await tx.model.findUniqueOrThrow({
        where: { id: modelId },
        select: { horizonStart: true, horizonEnd: true },
      });
      const period = periodsBetween(model.horizonStart, model.horizonEnd)[command.period];
      if (!period) throw new Error(`period ${command.period} is outside the model's horizon`);

      const at = new Date(Date.UTC(period.year, period.month - 1, 1));
      const rows = await tx.variableInput.findMany({
        where: {
          variableId: command.variableId,
          period: at,
          dimensionKey: { in: [command.member, TOTAL] },
        },
        select: { dimensionKey: true, value: true },
      });

      // The fallback to TOTAL is not a nicety — it is what the engine's
      // `inputAt` does, so it is what the cell was *reading* before the edit,
      // and undo has to restore what was being read rather than what happened
      // to be stored. `history-check` caught this: without it the two inverse
      // implementations disagreed, and an undo would have written a zero over
      // a value the user could see.
      const exact = rows.find((row) => row.dimensionKey === command.member);
      const fallback = rows.find((row) => row.dimensionKey === TOTAL);
      const before = exact ?? fallback;
      return { ...command, value: before ? Number(before.value) : 0 };
    }

    case "RenameVariable": {
      const variable = await tx.variable.findFirstOrThrow({
        where: { id: command.variableId, modelId },
        select: { name: true },
      });
      return { type: "RenameVariable", variableId: command.variableId, name: variable.name };
    }

    case "SetFormula": {
      const variable = await tx.variable.findFirstOrThrow({
        where: { id: command.variableId, modelId },
        select: { kind: true, formula: true },
      });
      return {
        type: "SetFormula",
        variableId: command.variableId,
        formula: rebuildFormula(variable.formula) ?? null,
        kind: variable.kind,
      };
    }

    case "InsertVariable":
      return { type: "RemoveVariable", variableId: command.variable.id };

    case "CreateScenario":
      return { type: "DeleteScenario", scenarioId: command.scenario.id };

    case "RenameScenario": {
      const scenario = await tx.scenario.findFirstOrThrow({
        where: { id: command.scenarioId, modelId },
        select: { name: true },
      });
      return { type: "RenameScenario", scenarioId: command.scenarioId, name: scenario.name };
    }

    case "DeleteScenario": {
      const scenario = await tx.scenario.findFirstOrThrow({
        where: { id: command.scenarioId, modelId },
        include: { overrides: { select: { variableId: true, value: true } } },
      });
      return {
        type: "CreateScenario",
        scenario: {
          id: scenario.id,
          name: scenario.name,
          isBase: scenario.isBase,
          ...(scenario.parentId ? { parentId: scenario.parentId } : {}),
          overrides: scenario.overrides.map((override) => ({
            variableId: override.variableId,
            value: OverrideSchema.parse(override.value),
          })),
        },
      };
    }

    case "SetOverride": {
      const existing = await tx.scenarioOverride.findUnique({
        where: {
          scenarioId_variableId: {
            scenarioId: command.scenarioId,
            variableId: command.variableId,
          },
        },
        select: { value: true },
      });
      return {
        type: "SetOverride",
        scenarioId: command.scenarioId,
        variableId: command.variableId,
        value: existing ? OverrideSchema.parse(existing.value) : null,
      };
    }

    case "RemoveVariable": {
      const variable = await tx.variable.findFirstOrThrow({
        where: { id: command.variableId, modelId },
        include: { formula: true, inputs: true },
      });
      const model = await tx.model.findUniqueOrThrow({
        where: { id: modelId },
        select: { horizonStart: true, horizonEnd: true },
      });
      const periods = periodsBetween(model.horizonStart, model.horizonEnd);
      const index = new Map(periods.map((p, i) => [p.key, i]));

      // The inputs come back whole, keyed exactly as the in-memory table is,
      // so an undone delete restores the row *and* its numbers.
      const inputs: Record<string, number[]> = {};
      for (const input of variable.inputs) {
        const key = `${input.period.getUTCFullYear()}-${String(input.period.getUTCMonth() + 1).padStart(2, "0")}`;
        const at = index.get(key);
        if (at === undefined) continue;
        const series = (inputs[input.dimensionKey] ??= Array(periods.length).fill(0));
        series[at] = Number(input.value);
      }

      const formula = rebuildFormula(variable.formula);
      return {
        type: "InsertVariable",
        index: variable.order,
        variable: {
          id: variable.id,
          groupId: variable.groupId,
          name: variable.name,
          kind: variable.kind,
          format: variable.format,
          aggregation: variable.aggregation,
          ...(formula ? { formula } : {}),
          ...(variable.dimensionId ? { dimensionId: variable.dimensionId } : {}),
          ...(variable.memberRollup ? { memberRollup: variable.memberRollup } : {}),
          ...(variable.timeContext ? { timeContext: variable.timeContext } : {}),
          ...(variable.note ? { note: variable.note } : {}),
        },
        ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
      };
    }
  }
}
