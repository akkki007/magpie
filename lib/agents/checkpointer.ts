import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/**
 * Where a paused run lives (`docs/agents-plan.md` A3).
 *
 * Postgres, not `MemorySaver`. `interruptOn` halts the graph mid-run and the resume happens
 * in a *different request* — possibly minutes later, after the person has gone to look at
 * the proposal. An in-process checkpointer makes that work right up until the dev server
 * reloads, at which point the WAITING run in the database points at a thread that no longer
 * exists anywhere and can never be resumed. A row that promises "resume" and cannot is worse
 * than not offering it.
 *
 * `checkpointer: true` is not an option here: deep agents accept it only for subgraphs, and
 * a root graph is told so at runtime — "checkpointer: true cannot be used for root graphs."
 *
 * The saver owns its own tables and creates them on first use. `setup()` is idempotent but
 * not free, so it runs once per process behind the same `globalThis` guard the Prisma client
 * uses, and for the same reason: `next dev` re-evaluates this module on every save.
 */

const globalForSaver = globalThis as unknown as {
  saver?: PostgresSaver;
  saverReady?: Promise<PostgresSaver>;
};

export function checkpointer(): Promise<PostgresSaver> {
  if (globalForSaver.saverReady) return globalForSaver.saverReady;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return Promise.reject(new Error("DATABASE_URL is not set — copy .env.example to .env"));
  }

  // Its own schema, not `public`.
  //
  // The saver creates four tables of its own (`checkpoints`, `checkpoint_writes`,
  // `checkpoint_blobs`, `checkpoint_migrations`). In `public` those are tables Prisma does
  // not know about, so the next `prisma migrate dev` reads them as drift and offers to
  // **reset the database** — which on a dev box holding the seeded model, tables and boards
  // is a catastrophe one keystroke away. It happened on the very next migration after this
  // was wired up.
  //
  // A separate schema is the standard fix: Prisma introspects `public`, the saver owns
  // `langgraph`, and neither has an opinion about the other.
  const saver = PostgresSaver.fromConnString(connectionString, { schema: "langgraph" });
  globalForSaver.saver = saver;
  globalForSaver.saverReady = saver.setup().then(() => saver);

  // A failed setup must not be cached as a permanent "ready" promise — the next call should
  // be allowed to try again rather than every run failing forever on one bad startup.
  globalForSaver.saverReady.catch(() => {
    globalForSaver.saverReady = undefined;
    globalForSaver.saver = undefined;
  });

  return globalForSaver.saverReady;
}
