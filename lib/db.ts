import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";

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
const globalForDb = globalThis as unknown as { db?: PrismaClient };

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

export const db = globalForDb.db ?? createClient();

if (process.env.NODE_ENV !== "production") globalForDb.db = db;
