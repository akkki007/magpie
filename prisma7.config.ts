import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration (Prisma 7).
 *
 * **Connection URLs live here, not in `schema.prisma`.** Prisma 7 removed `url` and
 * `directUrl` from the schema's `datasource` block — putting them back gets
 * *"The datasource property `directUrl` is no longer supported in schema files."*
 * `directUrl` is not merely relocated either: the `Datasource` type in this version accepts
 * only `url` and `shadowDatabaseUrl`, so the concept is gone. The schema now declares the
 * provider and nothing else.
 *
 * **This URL is the CLI's, not the application's.** They are genuinely different connections
 * and it matters which is which:
 *
 * - The **app** connects through the driver adapter in `lib/db.ts`, reading `DATABASE_URL`.
 *   On Vercel that should be Supabase's *transaction* pooler — port 6543 — because
 *   serverless functions open many short-lived connections and transaction pooling is what
 *   survives that. (`?pgbouncer=true` is *not* needed here, whatever the older guides say:
 *   it was a flag for Prisma's own query engine, which Prisma 7 no longer has. It appears
 *   nowhere in `@prisma/adapter-pg`, so `pg` receives it as an unknown parameter and ignores
 *   it. Harmless, but it buys nothing — `pg` uses unnamed prepared statements, which
 *   transaction pooling already tolerates.)
 * - The **CLI** — `migrate deploy`, `migrate dev`, `db pull` — needs a *session*: migrations
 *   take advisory locks and run DDL across statements, neither of which exists in transaction
 *   mode. That is port 5432, and it is what `DIRECT_URL` holds.
 *
 * Pointing both at 6543 is the failure this is written to prevent: `migrate deploy` reports
 * `P1001: Can't reach database server` against a host that is demonstrably reachable, because
 * the pooler accepts the TCP connection and then refuses the session the migration needs.
 *
 * Falls back to `DATABASE_URL` so a single-connection setup — a local Postgres, or a
 * server-based deploy where one session-mode URL serves both — needs no second variable.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
