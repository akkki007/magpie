"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";

import { executeRun, resumeRun } from "@/lib/agents/run";
import type { Mode } from "@/lib/agents/modes";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

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
