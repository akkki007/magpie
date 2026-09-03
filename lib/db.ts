import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

/**
 * The one Prisma client for the whole app.
 *
 * Why a global: `next dev` hot-reloads modules on every save, and a plain
 * module-level `new PrismaClient()` would build a fresh connection pool each
 * time until Postgres refuses new connections. Stashing it on `globalThis`
 * survives the reload, because that object is not part of the module graph.
 * In production the module is evaluated once, so the guard costs nothing.
 *
 * Prisma 7 has no query engine of its own — every SQL provider talks to the
 * database through a driver adapter, here `pg`.
 */
const globalForDb = globalThis as unknown as { db?: PrismaClient; dbShape?: string };

/**
 * A fingerprint of the *generated* client — the sorted list of models it knows about.
 *
 * The global above survives hot reloads, which is the point; but it also survives
 * `prisma generate`, and that is a trap. Add a table, migrate, and the running dev server
 * keeps handing out the client it built before those models existed — so `db.dataTable` is
 * `undefined` and the page dies with "Cannot read properties of undefined (reading
 * 'findUnique')" on code that is perfectly correct. It cost a confusing bug report while the
 * database module was landing, and it would have cost another on the next migration.
 *
 * `Prisma.ModelName` is regenerated with the client and *is* part of the module graph, so it
 * reloads when the client does. If it disagrees with what the cached instance was built
 * from, the cache is stale and gets rebuilt.
 */
const SHAPE = Object.keys(Prisma.ModelName).sort().join(",");

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    // Queries are worth seeing while learning what the ORM emits; noise in prod.
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function currentClient(): PrismaClient {
  const cached = globalForDb.db;
  if (cached && globalForDb.dbShape === SHAPE) return cached;

  // Hand the old pool back rather than leaking it; nothing is waiting on the result.
  if (cached) void cached.$disconnect().catch(() => {});
  return createClient();
}

export const db = currentClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
  globalForDb.dbShape = SHAPE;
}
