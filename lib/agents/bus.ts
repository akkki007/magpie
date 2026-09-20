import type { Artifact } from "./artifacts";
import type { PendingAction, Step, Todo } from "./run";

/**
 * The live fan-out for a run in progress.
 *
 * `lib/agents/run.ts` already assembles a full snapshot of a run on every meaningful
 * change and writes it to the `AgentRun` row — that write stays exactly as it is, throttled,
 * because it is what makes a run durable across a reload and resumable after a halt. This is
 * the same snapshot, handed to whoever is watching *right now*, with none of that throttling:
 * a chart the agent just drew should reach the canvas the instant `observer.show` fires, not
 * on the next 500ms tick. The row is the record; this is the wire.
 *
 * **Process-local, on purpose.** One `next dev`/`next start` process is what this app runs
 * as today — same assumption `lib/agents/checkpointer.ts` and the Prisma client make with
 * their own `globalThis` guards, and for the same reason this file uses one too: the module
 * is re-evaluated on every save in dev, and a plain module-level `Map` would forget every
 * subscriber on each edit. A run started on one process and watched from another (multiple
 * server instances behind a load balancer) will not see live updates through this bus — it
 * will fall back to whatever the client does when the stream never arrives, which is the
 * existing poll. Fixing that for real is a job for the DB's `LISTEN/NOTIFY` or a message
 * broker, not this file, and not needed until this app actually runs as more than one process.
 */

/**
 * Everything but `id` and `status` is optional: `fail()` in `lib/agents/run.ts` can halt a
 * run before `drive()` ever builds a steps/artifacts list (e.g. "no model is seeded"), and it
 * should still be able to say so. The route handler (`app/(app)/agents/[id]/stream/route.ts`)
 * sends the full DB row first and merges every event onto it, the same way the client already
 * merges a poll response onto its previous state — so a lean event loses nothing a fuller one
 * already established.
 */
export type RunEvent = {
  id: string;
  status: "RUNNING" | "WAITING" | "DONE" | "FAILED";
  activity?: string | null;
  plan?: Todo[];
  steps?: Step[];
  files?: Record<string, unknown>;
  artifacts?: Artifact[];
  pending?: PendingAction[];
  declined?: string[];
  result?: string | null;
  error?: string | null;
};

type Subscriber = (event: RunEvent) => void;

const globalForBus = globalThis as unknown as {
  agentRunBus?: Map<string, Set<Subscriber>>;
};

function subscribers(): Map<string, Set<Subscriber>> {
  if (!globalForBus.agentRunBus) globalForBus.agentRunBus = new Map();
  return globalForBus.agentRunBus;
}

/** Watch one run. Call the returned function to stop — e.g. when the client disconnects. */
export function subscribe(runId: string, fn: Subscriber): () => void {
  const map = subscribers();
  let set = map.get(runId);
  if (!set) {
    set = new Set();
    map.set(runId, set);
  }
  set.add(fn);

  return () => {
    set.delete(fn);
    if (set.size === 0) map.delete(runId);
  };
}

/** Hand a snapshot to whoever is watching this run. A no-op when nobody is. */
export function publish(runId: string, event: RunEvent): void {
  const set = subscribers().get(runId);
  if (!set || set.size === 0) return;
  for (const fn of set) fn(event);
}
