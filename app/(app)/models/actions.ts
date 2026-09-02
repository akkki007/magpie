"use server";

import { z } from "zod";

import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import {
  acceptProposal,
  commandsOf,
  historyStacks,
  inverseFromDb,
  readHistory,
  readVersions,
  recordChangeSet,
  rejectProposal,
  rollback,
  type HistoryEntry,
  type VersionEntry,
} from "@/lib/model/changesets";
import { CommandSchema } from "@/lib/model/command-schema";
import { labelFor, type Command } from "@/lib/model/commands";
import { applyCommandToDb } from "@/lib/model/commands-db";
import { addComment, listComments, setCommentResolved, type Comment } from "@/lib/model/comments";
import { readModel } from "@/lib/model/persist";
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

/**
 * One changeset, of one command or several.
 *
 * A batch is not a convenience: §1.4's agent proposals are batches by nature, and an
 * "accept" that lands as six separate changesets is an accept the user cannot undo in one
 * move. M4.4's presets are the first caller, which is deliberate — the path is exercised by
 * something deterministic before an agent is pointed at it.
 */
export async function persistCommands(
  slug: string,
  changeSetId: unknown,
  commands: unknown,
  batchLabel?: unknown,
): Promise<Result> {
  const id = Id.safeParse(changeSetId);
  const parsed = z.array(CommandSchema).min(1).max(200).safeParse(commands);
  if (!id.success || !parsed.success) {
    // Deliberately not echoed verbatim: a schema path is useful to a developer and noise to a
    // controller, and it describes the shape of an internal type.
    console.error("[persistCommands] rejected", parsed.error?.issues);
    return { ok: false, error: "That edit was not in a form the server could accept." };
  }
  const label = z.string().trim().min(1).max(120).safeParse(batchLabel);

  return withModel(slug, async (tx, modelId, who) => {
    const typed = parsed.data as Command[];

    // Inverses are read one at a time, *interleaved with* the applies, because a command's
    // "before" state is whatever the previous command in the batch left behind. Computing
    // them all up front would invert the batch to the wrong starting point.
    const applied: { command: Command; inverse: Command }[] = [];
    for (const command of typed) {
      const inverse = await inverseFromDb(tx, modelId, command);
      await applyCommandToDb(tx, modelId, command);
      applied.push({ command, inverse });
    }

    await recordChangeSet(tx, {
      id: id.data,
      modelId,
      kind: "EDIT",
      label: typed.length === 1 ? labelFor(typed[0]) : (label.success ? label.data : "Batch edit"),
      actor: who,
      commands: applied,
      alreadyApplied: true,
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
): Promise<
  Result<{
    entries: HistoryEntry[];
    versions: VersionEntry[];
    canUndo: boolean;
    canRedo: boolean;
  }>
> {
  return withModel(slug, async (tx, modelId) => {
    const entries = await readHistory(tx, modelId);
    const stacks = historyStacks(entries);
    return {
      ok: true,
      entries,
      versions: await readVersions(tx, modelId),
      canUndo: stacks.undo.length > 0,
      canRedo: stacks.redo.length > 0,
    };
  });
}

/**
 * Cut a version (M3.3).
 *
 * §1.3: "a version is a snapshot plus the commands since it". The snapshot is the whole
 * model as the engine sees it, and `seq` is where in the stream it was taken — the two
 * together are what make a rollback checkable rather than merely hopeful.
 */
export async function createVersion(slug: string, rawLabel: unknown): Promise<Result> {
  const label = z.string().trim().min(1).max(120).safeParse(rawLabel);
  if (!label.success) return { ok: false, error: "A version needs a name." };

  return withModel(slug, async (tx, modelId, who) => {
    const model = await readModel(tx, slug);
    if (!model) return { ok: false, error: `No model at ${slug}.` };

    const head = await tx.changeSet.findFirst({
      where: { modelId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });

    await tx.modelVersion.create({
      data: {
        modelId,
        seq: head?.seq ?? 0,
        label: label.data,
        snapshot: model as unknown as Prisma.InputJsonValue,
        actorId: who.id,
        actorName: who.name,
      },
    });
    return { ok: true };
  });
}

/** Thin plumbing over `rollback` — the mechanism, and the reason it verifies, live there. */
export async function rollbackTo(
  slug: string,
  versionId: unknown,
  changeSetId: unknown,
): Promise<Result> {
  const version = z.uuid().safeParse(versionId);
  const id = Id.safeParse(changeSetId);
  if (!version.success || !id.success) {
    return { ok: false, error: "That request was not in a form the server could accept." };
  }

  return withModel(slug, async (tx, modelId, who) => {
    const target = await tx.modelVersion.findFirst({
      where: { id: version.data, modelId },
      select: { seq: true, label: true, snapshot: true },
    });
    if (!target) return { ok: false, error: "That version is not part of this model." };

    const result = await rollback(tx, {
      modelId,
      slug,
      changeSetId: id.data,
      actor: who,
      version: target,
    });
    // Thrown, not returned: `withModel` runs inside a transaction, and only a throw discards
    // the writes the replay already made. Returning would leave a half-rollback applied.
    if (!result.ok) throw new Error(`${result.error} Nothing was changed.`);
    return { ok: true };
  });
}


/**
 * Accept a pending proposal (§1.4, M5.3): apply its commands for real.
 *
 * `rollback`'s error-vs-throw distinction applies here too — `acceptProposal` returns a
 * `{ok:false}` for an ordinary "someone already acted on this" race, which `withModel`
 * would otherwise happily wrap as `{ok:true}` because it never throws. Returned, not
 * thrown, means the transaction still commits nothing, which is correct either way: there
 * is nothing to roll back from a proposal whose commands were never applied.
 */
/**
 * Where a batch of proposals actually stand, right now (§1.4).
 *
 * The chat transcript is not this source of truth — a `tool-proposeChanges` message part
 * says what was proposed and never changes again once the tool has run, so a proposal card
 * rendered straight from message history looks pending forever, even long after it was
 * accepted or rejected in a different tab, a previous session, or a moment ago in this one.
 * This is the reconciliation: read `ChangeSet.status` for the ids actually referenced in the
 * conversation, and let that — not anything remembered client-side — decide whether a card
 * still offers Accept/Reject.
 */
export async function readProposalStatuses(
  slug: string,
  proposalIds: unknown,
): Promise<Result<{ statuses: Record<string, "PROPOSED" | "ACCEPTED" | "REJECTED">; }>> {
  const ids = z.array(z.uuid()).max(200).safeParse(proposalIds);
  if (!ids.success) return { ok: false, error: "Those proposal ids were not valid." };
  if (ids.data.length === 0) return { ok: true, statuses: {} };

  return withModel(slug, async (tx, modelId) => {
    const rows = await tx.changeSet.findMany({
      where: { id: { in: ids.data }, modelId },
      select: { id: true, status: true },
    });
    const statuses: Record<string, "PROPOSED" | "ACCEPTED" | "REJECTED"> = {};
    for (const row of rows) if (row.status) statuses[row.id] = row.status;
    return { ok: true, statuses };
  });
}

export async function acceptModelProposal(slug: string, proposalId: unknown): Promise<Result> {
  const id = z.uuid().safeParse(proposalId);
  if (!id.success) return { ok: false, error: "That proposal id was not valid." };

  return withModel(slug, (tx, modelId) => acceptProposal(tx, { id: id.data, modelId }));
}

export async function rejectModelProposal(slug: string, proposalId: unknown): Promise<Result> {
  const id = z.uuid().safeParse(proposalId);
  if (!id.success) return { ok: false, error: "That proposal id was not valid." };

  return withModel(slug, async (tx, modelId) => {
    await rejectProposal(tx, { id: id.data, modelId });
    return { ok: true };
  });
}


/**
 * The agent's chat history (§5, M5.4), read from the client — a ChatGPT-style sidebar over
 * `AgentChat` rows.
 *
 * The route handler (`app/(app)/models/[slug]/agent/route.ts`) is what actually talks to
 * the model and is what creates and updates a chat row; everything here only reads, plus
 * one delete for tidying up. A chat is scoped to `(modelId, actorId)` — see the schema
 * comment on `AgentChat` for why this list is per person and not shared like Comments or
 * the History panel.
 */
export type AgentChatSummary = { id: string; title: string; updatedAt: string };

export async function listAgentChats(slug: string): Promise<Result<{ chats: AgentChatSummary[] }>> {
  return withModel(slug, async (tx, modelId, who) => {
    const rows = await tx.agentChat.findMany({
      where: { modelId, actorId: who.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true },
    });
    return { ok: true, chats: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) };
  });
}

export async function readAgentChat(slug: string, chatId: unknown): Promise<Result<{ messages: unknown[] }>> {
  const id = z.uuid().safeParse(chatId);
  if (!id.success) return { ok: true, messages: [] };

  return withModel(slug, async (tx, modelId, who) => {
    const row = await tx.agentChat.findFirst({
      where: { id: id.data, modelId, actorId: who.id },
      select: { messages: true },
    });
    return { ok: true, messages: (row?.messages as unknown[] | undefined) ?? [] };
  });
}

export async function deleteAgentChat(slug: string, chatId: unknown): Promise<Result> {
  const id = z.uuid().safeParse(chatId);
  if (!id.success) return { ok: false, error: "That chat id was not valid." };

  return withModel(slug, async (tx, modelId, who) => {
    await tx.agentChat.deleteMany({ where: { id: id.data, modelId, actorId: who.id } });
    return { ok: true };
  });
}


/* ── Comments (§6, M6.1) ─────────────────────────────────────────────────*/

export async function readModelComments(slug: string): Promise<Result<{ comments: Comment[] }>> {
  return withModel(slug, async (tx, modelId) => ({ ok: true, comments: await listComments(tx, modelId) }));
}

export async function addModelComment(
  slug: string,
  variableId: unknown,
  period: unknown,
  body: unknown,
): Promise<Result> {
  const parsed = z
    .object({ variableId: z.string().min(1), period: z.number().int().min(0), body: z.string().trim().min(1).max(2000) })
    .safeParse({ variableId, period, body });
  if (!parsed.success) return { ok: false, error: "That comment was not in a form the server could accept." };

  return withModel(slug, (tx, modelId, who) => addComment(tx, { modelId, ...parsed.data, actor: who }));
}

export async function resolveModelComment(slug: string, commentId: unknown, resolved: unknown): Promise<Result> {
  const parsed = z.object({ commentId: z.string().min(1), resolved: z.boolean() }).safeParse({ commentId, resolved });
  if (!parsed.success) return { ok: false, error: "That request was not in a form the server could accept." };

  return withModel(slug, (tx, modelId) =>
    setCommentResolved(tx, { modelId, commentId: parsed.data.commentId, resolved: parsed.data.resolved }),
  );
}
