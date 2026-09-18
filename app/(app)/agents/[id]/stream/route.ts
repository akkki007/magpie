import * as bus from "@/lib/agents/bus";
import type { RunEvent } from "@/lib/agents/bus";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * The live channel for one run (`docs/agents-plan.md` A5) — Server-Sent Events over the
 * pattern this repo already uses for a streaming response, `app/(app)/models/[slug]/agent/
 * route.ts`: a Route Handler, not a server action, because the point is a connection the
 * server can keep pushing to rather than a single RPC result.
 *
 * **Auth here is independent of the page**, for the reason `models/actions.ts` gives at
 * length: this endpoint is reachable by anyone who can send it a GET. Someone else's run is a
 * 404, not a 403 — the same reasoning `app/(app)/agents/[id]/page.tsx` gives for not leaking
 * which runs exist.
 *
 * **The DB row is sent first, always.** A run watched from the start and a browser tab
 * reattaching to one already halfway through are the same code path: the current row is the
 * truth of where things stand, and every event after it (`lib/agents/bus.ts`) is a diff on
 * top, not a replacement for it.
 *
 * Closes itself once the run reaches a terminal status, and on the client going away — an SSE
 * connection nobody is reading is a leaked subscription in `lib/agents/bus.ts` otherwise.
 */
export async function GET(request: Request, { params }: RouteContext<"/agents/[id]/stream">) {
  const { id } = await params;

  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const run = await db.agentRun.findUnique({ where: { id } });
  if (!run) return new Response("Not found", { status: 404 });
  if (run.actorId && run.actorId !== session.user.id) return new Response("Not found", { status: 404 });

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

  const encoder = new TextEncoder();
  const terminal = (status: RunEvent["status"]) => status === "DONE" || status === "FAILED";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: RunEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      write(initial);
      if (terminal(initial.status)) {
        controller.close();
        return;
      }

      const unsubscribe = bus.subscribe(id, (event) => {
        try {
          write(event);
        } catch {
          // The controller is already closed — the client went away between events.
          unsubscribe();
          return;
        }
        if (terminal(event.status)) {
          unsubscribe();
          controller.close();
        }
      });

      request.signal.addEventListener("abort", () => {
        unsubscribe();
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
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy/CDN buffering so chunks actually arrive as they're written —
      // `node_modules/next/dist/docs/01-app/02-guides/streaming.md` §"What can affect
      // streaming".
      "X-Accel-Buffering": "no",
    },
  });
}
