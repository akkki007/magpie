"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";

import type { Artifact } from "@/lib/agents/artifacts";
import { executeRun, resumeRun } from "@/lib/agents/run";
import type { Mode } from "@/lib/agents/modes";
import { groundTile } from "@/lib/board/ask";
import { addTile, listBoards, readBoard } from "@/lib/board/persist";
import { listTables, readTable } from "@/lib/data/persist";
import type { Table } from "@/lib/data/types";
import { db } from "@/lib/db";
import { readModel } from "@/lib/model/persist";
import { getSession } from "@/lib/session";

/** Every table, rows included — grounding a pinned chart needs the fields. */
async function allTables(): Promise<Table[]> {
  const summaries = await listTables(db);
  const tables = await Promise.all(summaries.map((s) => readTable(db, s.slug)));
  return tables.filter((t): t is Table => t !== null);
}

/**
 * Spawning and steering a finance-ops run (`docs/agents-plan.md` A5, A6).
 *
 * **The run starts in `after()`, not awaited.** A run takes tens of seconds and the point of
 * this module is that you hand over a task and walk away — so the action returns the run's
 * id as soon as the row exists, and the work continues on the server after the response is
 * sent. The row is what the UI polls; the promise is nobody's business.
 *
 * Auth is checked in each action for the reason `models/actions.ts` gives at length: a
 * server function is an HTTP endpoint that happens to be written as a function.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function actor() {
  const session = await getSession();
  if (!session) return null;
  return { id: session.user.id, name: session.user.name || session.user.email };
}

export async function spawnRun(task: string, mode: Mode = "do"): Promise<Result<{ id: string }>> {
  const who = await actor();
  if (!who) return { ok: false, error: "Your session has expired — sign in again." };

  const trimmed = task.trim();
  if (!trimmed) return { ok: false, error: "Describe the task first." };
  if (trimmed.length > 2000) return { ok: false, error: "That task is too long." };
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "OPENAI_API_KEY is not set, so agents cannot run." };
  }

  const run = await db.agentRun.create({
    data: {
      task: trimmed,
      mode,
      actorId: who.id,
      actorName: who.name,
      status: "RUNNING",
      // The run id *is* the LangGraph thread id. One less thing to keep in step, and it
      // means a checkpoint can always be traced back to the row that owns it.
      threadId: crypto.randomUUID(),
    },
  });

  after(async () => {
    try {
      await executeRun(run.id, trimmed, who, mode);
    } catch (error) {
      // executeRun handles its own failures; this is the last resort, so a run can never
      // be left RUNNING forever with nobody coming back to it.
      await db.agentRun
        .update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : String(error),
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
    }
  });

  revalidatePath("/agents");
  return { ok: true, id: run.id };
}

/** Approve or reject the write a WAITING run is asking for. */
export async function decideRun(
  runId: string,
  decision: "approve" | "reject",
  message?: string,
): Promise<Result> {
  const who = await actor();
  if (!who) return { ok: false, error: "Your session has expired — sign in again." };

  const run = await db.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (!run) return { ok: false, error: "That run no longer exists." };
  if (run.status !== "WAITING") return { ok: false, error: "That run is not waiting for anything." };

  const payload =
    decision === "approve"
      ? ({ type: "approve" } as const)
      : ({
          type: "reject",
          // Phrased as an instruction, not just a reason. Told merely "rejected", the agent
          // re-proposed the identical write on the next turn — verified, and it is the sort
          // of loop that makes an approval gate feel like nagging rather than control.
          message: `${message?.trim() || "A person declined this change."} Do not attempt this again. Report that it was declined and finish.`,
        } as const);

  after(async () => {
    try {
      await resumeRun(runId, payload, who);
    } catch (error) {
      await db.agentRun
        .update({
          where: { id: runId },
          data: {
            status: "FAILED",
            error: error instanceof Error ? error.message : String(error),
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
    }
  });

  revalidatePath(`/agents/${runId}`);
  return { ok: true };
}

/** What the run detail page polls while a run is live. */
export async function readRun(runId: string) {
  const who = await actor();
  if (!who) return null;
  return db.agentRun.findUnique({ where: { id: runId } });
}

/**
 * Pin a chart the agent drew onto a board (`docs/board-plan.md` §0, `docs/agents-plan.md` A5).
 *
 * **What is pinned is the reference, never the numbers.** The canvas card holds resolved
 * values — that is what a chart is — but a board tile that carried those values would be the
 * fourth place a figure can come from, and the one on the wall, so it would be the one people
 * believed the first time it disagreed with the model. So the card's `ref` is turned back
 * into a `TileSpec` and the tile resolves on every render like every other tile.
 *
 * It goes through `groundTile` for the same reason the ask composer does: a card built two
 * hours ago can name a column that has since been deleted, and the honest failure is a
 * message saying which, not a tile that throws when someone opens the board.
 */
export async function pinChart(runId: string, key: string, boardSlug?: string): Promise<Result<{ slug: string }>> {
  const who = await actor();
  if (!who) return { ok: false, error: "Your session has expired — sign in again." };

  const run = await db.agentRun.findUnique({ where: { id: runId }, select: { artifacts: true } });
  if (!run) return { ok: false, error: "That run no longer exists." };

  const artifacts = (run.artifacts as Artifact[] | null) ?? [];
  const card = artifacts.find((a) => a.key === key);
  if (!card || card.kind !== "series") return { ok: false, error: "That chart is no longer on this run." };
  if (!card.ref) {
    // A scenario or single-member series. See `SeriesRef` — a tile carries neither, so there
    // is no honest tile to make, and the card does not offer a pin in the first place.
    return { ok: false, error: "This chart cannot become a tile — it is scoped to a scenario or one member." };
  }

  const [model, tables, boards] = await Promise.all([
    readModel(db, "revenue-model-2026"),
    allTables(),
    listBoards(db),
  ]);
  if (!model) return { ok: false, error: "No model is seeded." };

  const target = boardSlug ?? boards[0]?.slug;
  if (!target) return { ok: false, error: "There is no board to pin to yet — make one first." };
  const board = await readBoard(db, target);
  if (!board) return { ok: false, error: "That board no longer exists." };

  const spec = {
    kind: "chart" as const,
    title: card.title,
    // The canvas draws one series stacked and several grouped; a pinned tile keeps the shape
    // it was read in, so what lands on the board is what the person pinned.
    form: card.series.length > 1 ? ("grouped-bar" as const) : ("stacked-bar" as const),
    source: card.ref,
  };

  const grounded = groundTile(spec, model, tables);
  if (!grounded.ok) return { ok: false, error: grounded.error };

  /* The question a tile keeps is the run's task — where this figure came from. */
  const run2 = await db.agentRun.findUnique({ where: { id: runId }, select: { task: true } });
  await addTile(db, board.id, grounded.spec, run2?.task ?? null);
  revalidatePath(`/boards/${target}`);
  return { ok: true, slug: target };
}
