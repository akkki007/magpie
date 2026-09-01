"use server";

import { z } from "zod";

import { db } from "@/lib/db";
import {
  commandsOf,
  historyStacks,
  inverseFromDb,
  readHistory,
  recordChangeSet,
  type HistoryEntry,
} from "@/lib/model/changesets";
import { CommandSchema } from "@/lib/model/command-schema";
import { labelFor, type Command } from "@/lib/model/commands";
import { getSession } from "@/lib/session";

/**
 * Writing to a model (`docs/modelling-plan.md` M1.1, M3.1, M3.2).
 *
 * **The authorisation check is in here, not in the page.** A server function is reachable by
 * direct POST — it is an HTTP endpoint that happens to be written as a function — so a check
 * upstream in the page protects the page and nothing else. Next's own docs are blunt about
 * this, and it is the same reasoning `docs/auth-plan.md` §4 gives for keeping the session
 * check out of the layout.
 *
 * The client has already applied the command to its own copy (M1.2). An error returned from
 * here is what tells it the screen is ahead of the database, so the failure path matters as
 * much as the success one.
 *
 * ── Why the client supplies the changeset id ─────────────────────────────
 * It knows the id the moment it dispatches, so its optimistic undo stack can name the
 * changeset it expects to undo without waiting for a round trip. Undo then carries that name
 * and the server refuses if it is not what is actually on top — an optimistic-concurrency
 * check rather than a hope that the two stacks agree. A second consequence is that a retried
 * request cannot double-apply: the id is the primary key.
 */

const Id = z.uuid();

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function actor() {
  const session = await getSession();
  if (!session) return null;
  return { id: session.user.id, name: session.user.name || session.user.email };
}

/** Everything below needs the same three things; this is the one place they are fetched. */
async function withModel<T>(
  slug: string,
  run: (
    tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
    modelId: string,
    who: { id: string; name: string },
  ) => Promise<Result<T>>,
): Promise<Result<T>> {
  const who = await actor();
  if (!who) return { ok: false, error: "Your session has expired — sign in again." };

  try {
    return await db.$transaction(async (tx) => {
      const model = await tx.model.findUnique({ where: { slug }, select: { id: true } });
      if (!model) return { ok: false, error: `No model at ${slug}.` };
      return run(tx, model.id, who);
    });
  } catch (error) {
    console.error("[models/actions]", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The edit could not be saved.",
    };
  }
}

export async function persistCommand(
  slug: string,
  changeSetId: unknown,
  command: unknown,
): Promise<Result> {
  const id = Id.safeParse(changeSetId);
  const parsed = CommandSchema.safeParse(command);
  if (!id.success || !parsed.success) {
    // Deliberately not echoed verbatim: a schema path is useful to a developer and noise to a
    // controller, and it describes the shape of an internal type.
    console.error("[persistCommand] rejected", parsed.error?.issues);
    return { ok: false, error: "That edit was not in a form the server could accept." };
  }

  return withModel(slug, async (tx, modelId, who) => {
    const typed = parsed.data as Command;
    // Read the "before" state *before* applying, which is the whole reason this is inside
    // the transaction and not a second call from the client.
    const inverse = await inverseFromDb(tx, modelId, typed);

    await recordChangeSet(tx, {
      id: id.data,
      modelId,
      kind: "EDIT",
      label: labelFor(typed),
      actor: who,
      commands: [{ command: typed, inverse }],
    });
    return { ok: true };
  });
}

/**
 * Undo and redo, as a query over the stream (M3.2).
 *
 * Before this, undo was local state and never reached Postgres — an edit, an undo and a
 * reload brought the edit back. The stack is now derived from the log by replaying it, which
 * is the same walk the client's reducer does, so the two agree by construction rather than by
 * coincidence.
 */
export async function undoModel(
  slug: string,
  targetId: unknown,
  changeSetId: unknown,
): Promise<Result> {
  return move(slug, targetId, changeSetId, "UNDO");
}

export async function redoModel(
  slug: string,
  targetId: unknown,
  changeSetId: unknown,
): Promise<Result> {
  return move(slug, targetId, changeSetId, "REDO");
}

async function move(
  slug: string,
  targetId: unknown,
  changeSetId: unknown,
  kind: "UNDO" | "REDO",
): Promise<Result> {
  const target = Id.safeParse(targetId);
  const id = Id.safeParse(changeSetId);
  if (!target.success || !id.success) {
    return { ok: false, error: "That request was not in a form the server could accept." };
  }

  return withModel(slug, async (tx, modelId, who) => {
    const stacks = historyStacks(await readHistory(tx, modelId));
    const stack = kind === "UNDO" ? stacks.undo : stacks.redo;
    const top = stack.at(-1);

    if (top !== target.data) {
      // The client's stack and the log disagree, which means something else wrote to this
      // model. Refusing is the only safe answer: applying the server's top instead would
      // undo an edit the user cannot see and did not ask about.
      return {
        ok: false,
        error: "This model changed somewhere else, so that could not be undone here.",
      };
    }

    const entry = await tx.changeSet.findUniqueOrThrow({
      where: { id: target.data },
      select: { label: true },
    });
    const commands = await commandsOf(tx, target.data);

    await recordChangeSet(tx, {
      id: id.data,
      modelId,
      kind,
      label: `${kind === "UNDO" ? "Undo" : "Redo"} ${entry.label.toLowerCase()}`,
      actor: who,
      targetId: target.data,
      // An undo replays the inverses backwards; a redo replays the commands forwards. The
      // reversal matters the moment a changeset holds more than one command, which is what
      // §1.4's agent proposals will be.
      commands:
        kind === "UNDO"
          ? [...commands].reverse().map(({ command, inverse }) => ({
              command: inverse,
              inverse: command,
            }))
          : commands,
      // The payloads are stored on this changeset too, not just referenced through
      // `targetId`. It duplicates bytes, and it buys an audit trail where every entry says
      // literally what it did rather than what it points at — which is the difference
      // between reading history and reconstructing it.
    });
    return { ok: true };
  });
}

export async function readModelHistory(
  slug: string,
): Promise<Result<{ entries: HistoryEntry[]; canUndo: boolean; canRedo: boolean }>> {
  return withModel(slug, async (tx, modelId) => {
    const entries = await readHistory(tx, modelId);
    const stacks = historyStacks(entries);
    return {
      ok: true,
      entries,
      canUndo: stacks.undo.length > 0,
      canRedo: stacks.redo.length > 0,
    };
  });
}
