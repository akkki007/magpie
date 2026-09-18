import { EventEncoder } from "@ag-ui/encoder";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";

import * as bus from "./bus";
import type { RunEvent } from "./bus";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * One run, said in AG-UI — shared by every route that can be asked for it
 * (`app/(app)/agents/[id]/agui/route.ts` directly, and `app/api/copilotkit/agent/route.ts`,
 * the static runtime agent CopilotKit's thread-scoped `useAgent` dispatches to by `threadId`).
 * See either route's own doc comment for why two entry points exist.
 *
 * **This is a state channel, not a second approval path.** `components/agents/panel.tsx` and
 * `decideRun` stay the system of record for WAITING/approve/reject — a person acts there, not
 * through anything CopilotKit renders. What this streams is `STATE_SNAPSHOT` (the same
 * `plan`/`steps`/`artifacts`/`pending` `[id]/stream` already sends) so a CopilotKit component
 * can read `agent.state` and draw the same cards `components/agents/canvas.tsx` already draws,
 * and a single `TEXT_MESSAGE_*` triplet carrying the finding once the run is DONE. No tool
 * calls are fabricated and no interrupt/resume protocol is spoken — nothing here can approve
 * a write.
 *
 * **The run is already in progress (or already finished) by the time this is called.**
 * `spawnRun` starts `executeRun` in `after()` before a browser ever connects here, so unlike a
 * typical AG-UI agent this does not start a run from the input — `runId` names an `AgentRun`
 * that already exists, and this only ever attaches to it. `input` is read only for its own
 * `threadId`/`runId`, so events can carry the ids the client is already tracking; nothing in
 * it selects what runs.
 */
export async function streamRunAsAGUI(
  runId: string,
  request: Request,
  input: Partial<RunAgentInput>,
): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) return new Response("Not found", { status: 404 });
  if (run.actorId && run.actorId !== session.user.id) return new Response("Not found", { status: 404 });

  const threadId = input.threadId ?? runId;
  const clientRunId = input.runId ?? crypto.randomUUID();

  const initial: RunEvent = {
    id: run.id,
    status: run.status,
    activity: run.activity,
    plan: (run.plan as RunEvent["plan"]) ?? [],
    steps: (run.steps as RunEvent["steps"]) ?? [],
    files: (run.files as RunEvent["files"]) ?? {},
    artifacts: (run.artifacts as RunEvent["artifacts"]) ?? [],
    pending: (run.pending as RunEvent["pending"]) ?? [],
    declined: (run.declined as RunEvent["declined"]) ?? [],
    result: run.result,
    error: run.error,
  };

  const encoder = new EventEncoder({ accept: request.headers.get("accept") ?? undefined });
  const textEncoder = new TextEncoder();
  const messageId = crypto.randomUUID();
  const terminal = (status: RunEvent["status"]) => status === "DONE" || status === "FAILED";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const write = (event: BaseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(textEncoder.encode(encoder.encodeSSE(event)));
        } catch {
          closed = true;
        }
      };

      /** One state event per bus snapshot — the same shape `[id]/stream` sends. */
      const state = (event: RunEvent) => {
        write({
          type: EventType.STATE_SNAPSHOT,
          snapshot: {
            status: event.status,
            activity: event.activity ?? null,
            plan: event.plan ?? [],
            steps: event.steps ?? [],
            artifacts: event.artifacts ?? [],
            pending: event.pending ?? [],
          },
        } as BaseEvent);
      };

      const finish = (event: RunEvent) => {
        if (event.status === "FAILED") {
          write({ type: EventType.RUN_ERROR, message: event.error ?? "The run failed." } as BaseEvent);
        } else {
          // The finding, as one complete message — this run reports through a schema
          // (`submitFinding`), not token-by-token prose, so there is nothing to stream
          // incrementally here; a single START/CONTENT/END is the honest shape of "here is
          // the whole answer, already written".
          if (event.result) {
            write({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" } as BaseEvent);
            write({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: event.result } as BaseEvent);
            write({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
          }
          write({
            type: EventType.RUN_FINISHED,
            threadId,
            runId: clientRunId,
            result: event.result ?? undefined,
          } as BaseEvent);
        }
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      write({ type: EventType.RUN_STARTED, threadId, runId: clientRunId } as BaseEvent);
      state(initial);

      if (terminal(initial.status)) {
        finish(initial);
        return;
      }

      const unsubscribe = bus.subscribe(runId, (event) => {
        state(event);
        if (terminal(event.status)) {
          unsubscribe();
          finish(event);
        }
      });

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": encoder.getContentType(),
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
