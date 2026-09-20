import type { Lesson } from "../types";

const lesson: Lesson = {
  slug: "the-pipeline-before-the-query",
  n: "01",
  title: "The pipeline before the query",
  summary:
    "What `prisma migrate dev` actually produces, why the migration and not the schema is the record, and why the generated client must be exactly one object.",
  minutes: 11,
  blocks: [
    {
      kind: "prose",
      text: "You already know how to read this repo's build output. Every route in it is a `○` or a `●` — prerendered at build time, doing no work when a request arrives. There is not one `ƒ` in the table. That is what an application with no database looks like, and A1 is the task that ends it.",
    },
    {
      kind: "prose",
      text: "Prisma gets described as \"an ORM\", which is true and completely unhelpful for the next hour. Nothing you do in A1 queries anything. What you are actually installing is a *pipeline* with four separate artifacts, and almost every confusing Prisma error is someone mixing two of them up.",
    },
    { kind: "heading", text: "Four things people call \"the schema\"", id: "four-artifacts" },
    {
      kind: "table",
      head: ["Artifact", "Who writes it", "Committed?", "What it actually is"],
      rows: [
        [
          "`prisma/schema.prisma`",
          "You",
          "Yes",
          "A declaration of what you *want*. Editing it changes nothing, anywhere.",
        ],
        [
          "`prisma/migrations/*/migration.sql`",
          "`prisma migrate dev`",
          "Yes",
          "Plain SQL. Append-only. The actual record of what happened.",
        ],
        [
          "`generated/prisma/`",
          "`prisma generate`",
          "No",
          "TypeScript, rebuilt from the schema on demand. Safe to delete at any moment.",
        ],
        [
          "The `magpie_dev` database",
          "The migrations, when applied",
          "n/a",
          "The only one of the four your application ever reads.",
        ],
      ],
    },
    {
      kind: "prose",
      text: "The row that catches people is the second one. It is tempting to treat `schema.prisma` as the source of truth, because it is the file you edit and the one that looks like a schema. It isn't. Once a migration has been applied — to your machine, to a teammate's, to production — that SQL is a fact about a database somewhere, and no amount of editing `schema.prisma` reaches back and changes it.",
    },
    {
      kind: "callout",
      tone: "key",
      text: "The migration files are the schema of record. `schema.prisma` is a wish; a migration is a promise you already made to every database that ran it. This is why Prisma has no \"edit the last migration\" — it only has \"add another one\". You will use that in Part B by *deleting* a model and watching a second migration appear to do it.",
    },
    { kind: "heading", text: "What `migrate dev` does, in order", id: "migrate-dev" },
    {
      kind: "prose",
      text: "`migrate dev` is four steps wearing one name. It diffs, it writes, it applies, it regenerates — and it can refuse in the middle.",
    },
    {
      kind: "diagram",
      caption:
        "Follow the right-hand branch: drift is detected by comparing the database against the migrations folder, never against schema.prisma.",
      mermaid: `flowchart TD
  A["You edit prisma/schema.prisma"] --> B["migrate dev diffs the schema<br/>against prisma/migrations"]
  B --> C{"Does magpie_dev match<br/>the migration history?"}
  C -->|"yes"| D["Write a new timestamped<br/>migration.sql"]
  C -->|"no — drift"| E["Refuse, and offer to<br/>reset the whole database"]
  D --> F["Apply the SQL to magpie_dev"]
  F --> G["Regenerate the client<br/>into generated/prisma"]`,
    },
    {
      kind: "prose",
      text: "That refusal is worth understanding now rather than at 11pm. If you change the database by hand — a `DROP TABLE` in `psql`, say — the database no longer matches the history, and Prisma cannot safely write the next migration. Its only honest option is to offer you a reset. On a dev database with a seed script that is a shrug. It is also exactly why the seed script in A4 has to be good.",
    },
    {
      kind: "source",
      path: "docs/auth-plan.md",
      lines: "63-89",
      note: "The tables you are building toward. A1 creates none of them — Better Auth generates that schema in A2. A1 only proves the pipe carries SQL.",
    },
    { kind: "heading", text: "Prisma 7 is not the Prisma in your search results", id: "v7" },
    {
      kind: "prose",
      text: "This matters more than usual here. Prisma 7 moved three things that every tutorial, answer, and blog post written before it gets wrong — and the errors they produce look like a broken install rather than a version mismatch.",
    },
    {
      kind: "list",
      items: [
        "**The generated client has no default location.** `output` is now mandatory, and you import from that path — not from `@prisma/client`.",
        "**The connection URL left `schema.prisma`.** There is no `url = env(\"DATABASE_URL\")` in the datasource block any more; it lives in `prisma.config.ts`, which loads `.env` itself via `dotenv`.",
        "**The client needs a driver adapter.** `new PrismaClient()` on its own is no longer enough for Postgres; you pass it a `PrismaPg` adapter over the `pg` driver.",
      ],
    },
    {
      kind: "code",
      lang: "prisma",
      file: "prisma/schema.prisma",
      code: `generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
  // No url here in v7 — see prisma.config.ts
}`,
    },
    {
      kind: "code",
      lang: "ts",
      file: "prisma.config.ts",
      code: `import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env["DATABASE_URL"] },
});`,
    },
    {
      kind: "callout",
      tone: "note",
      text: "Pin the versions. Right now `@prisma/client@latest` resolves to a stable **7.10.0**, but `prisma@latest` resolves to **8.0.0-rc.12** — a release candidate sitting on the `latest` tag. Installing both with `@latest` gives you a v8 CLI driving a v7 client. Ask for `7.10.0` explicitly on both.",
    },
    { kind: "heading", text: "Why the client has to be exactly one object", id: "singleton" },
    {
      kind: "prose",
      text: "A `PrismaClient` is not a lightweight handle. It owns a connection pool. Construct it once, and you hold a small number of Postgres connections for the life of the process — which is what you want.",
    },
    {
      kind: "prose",
      text: "In development that assumption breaks, and it breaks quietly. Every time you save a file, the dev server hot-reloads the modules that changed. Module scope is discarded and re-evaluated, so a `const db = new PrismaClient()` at the top of a file runs *again* — building a second pool. The first one is not closed; nothing knows to close it. Save thirty times over an afternoon and you have thirty pools, until Postgres refuses the next connection and you get an error about `too many clients` that has nothing to do with the code you were editing.",
    },
    {
      kind: "code",
      lang: "ts",
      file: "lib/db.ts",
      code: `import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// globalThis survives hot reload; module scope does not.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db =
  globalForDb.db ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

if (process.env.NODE_ENV !== "production") globalForDb.db = db;`,
    },
    {
      kind: "prose",
      text: "The trick is the whole lesson in three lines: `globalThis` is not part of any module, so hot reload does not clear it. The guard on `NODE_ENV` is there because in production nothing hot-reloads, and leaving a handle on `globalThis` in a long-lived server is just a leak with extra steps.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "You will not notice this bug on the day you write it. It shows up an hour into a session, as a connection error in a file you have not touched, and the fix — restart the dev server — makes it disappear for another hour. That is exactly the shape of a bug that costs a whole afternoon later. Part C has you *measure* it rather than take my word for it.",
    },
    {
      kind: "source",
      path: ".gitignore",
      lines: "33-34",
      note: "`.env*` is already ignored, so your DATABASE_URL is safe by default. Confirm it rather than assume it — Part A has you check.",
    },
    {
      kind: "docs",
      links: [
        {
          label: "Prisma — Upgrading to Prisma 7",
          href: "https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7",
          note: "Read this before any other Prisma page, so the v6 examples elsewhere don't mislead you.",
        },
        {
          label: "Prisma — prisma.config.ts reference",
          href: "https://www.prisma.io/docs/orm/reference/prisma-config-reference",
          note: "Every key you can set, including the seed command you will need in A4.",
        },
        {
          label: "PostgreSQL — monitoring with pg_stat_activity",
          href: "https://www.postgresql.org/docs/current/monitoring-stats.html",
          note: "The view Part C uses to count your own open connections.",
        },
      ],
    },
    {
      kind: "task",
      taskId: "A1",
      goal: "A magpie_dev database, a committed migration history, and one Prisma client that survives hot reload — proven by counting connections, not by assuming.",
      files: [
        "prisma/schema.prisma",
        "prisma.config.ts",
        "lib/db.ts",
        "app/health/route.ts",
        ".env",
        "package.json",
      ],
      parts: [
        {
          title: "Part A — the database and the pipe",
          steps: [
            "`createdb magpie_dev` — your `akshay` role already has createdb rights, so no sudo needed.",
            "Install pinned: `bun add @prisma/client@7.10.0 @prisma/adapter-pg pg` and `bun add -d prisma@7.10.0 dotenv @types/pg`.",
            "`bunx prisma init --datasource-provider postgresql`, then set `DATABASE_URL` in `.env` to `postgresql://akshay@localhost:5432/magpie_dev`. Note it is `.env`, not `.env.local` — Prisma's CLI loads `.env` through dotenv, and Next reads `.env` too, so one file serves both.",
            "Run `git status --porcelain` and confirm `.env` does not appear. If it does, stop and fix `.gitignore` before you continue.",
            "Add `/generated` to `.gitignore`. Look back at the four-artifacts table and be able to say why that one is ignored while `prisma/migrations` is committed.",
            "Add a throwaway model to `schema.prisma` — `model Ping { id Int @id @default(autoincrement()) note String }` — and run `bunx prisma migrate dev --name add_ping`.",
            "Verify from outside Prisma: `psql magpie_dev -c '\\dt'`. You should see `Ping` and `_prisma_migrations`. Record how many rows are in `_prisma_migrations`.",
          ],
        },
        {
          title: "Part B — prove migrations are append-only",
          steps: [
            "Delete the `Ping` model from `schema.prisma` entirely.",
            "Run `bunx prisma migrate dev --name drop_ping`. Read what it prints before pressing anything.",
            "`ls prisma/migrations/` — there are now two directories, not one. Open the second `migration.sql` and confirm it contains a `DROP TABLE`.",
            "`psql magpie_dev -c '\\dt'` — `Ping` is gone, `_prisma_migrations` now has two rows. The table is gone; the history of it is not.",
            "Write one sentence in your own words on why Prisma wrote a second migration instead of deleting the first. You will be asked for it in review.",
          ],
        },
        {
          title: "Part C — one client, measured",
          steps: [
            "Write `lib/db.ts` **without** the `globalThis` guard first — just `export const db = new PrismaClient({ adapter })`. We are going to make the bug before we fix it.",
            "Add `app/health/route.ts`: a `GET` handler that runs `await db.$queryRaw`select 1`` and returns `Response.json({ ok: true })`.",
            "Start `bun run dev`, hit `/health` once, then record your baseline: `psql -tAc \"select count(*) from pg_stat_activity where datname='magpie_dev';\"`",
            "Now edit and save `app/health/route.ts` five times, hitting `/health` after each save. Re-run the count. **Write both numbers down.**",
            "Add the `globalThis` guard from the lesson, restart the dev server, and repeat the same five-save loop. Record the number a third time.",
            "Run `bun run build` and record what symbol `/health` gets in the route table. Compare it to the symbols on every other route in this repo.",
            "Finally: `grep -rn 'new PrismaClient' --include='*.ts' .` should return exactly one line, in `lib/db.ts`.",
          ],
        },
      ],
      criteria: [
        "`psql magpie_dev -c '\\dt'` shows `_prisma_migrations` with 2 rows and **no** `Ping` table.",
        "`prisma/migrations/` contains exactly two directories, both committed, and the second's `migration.sql` contains a `DROP TABLE` statement.",
        "`git status --porcelain` does not list `.env`, and `git log -p` contains no `DATABASE_URL` value.",
        "`git status --porcelain` does not list anything under `generated/`, and you can say why that differs from `prisma/migrations/`.",
        "`grep -rn 'new PrismaClient' --include='*.ts' .` returns exactly one match, in `lib/db.ts`, and it is guarded on `globalThis` behind a `NODE_ENV` check.",
        "`GET /health` returns HTTP 200 with JSON, and you can state which route symbol the build gave it and why that symbol differs from `/learning/path`.",
        "You recorded three connection counts — before the leak, after five saves without the guard, and after five saves with it. Honest numbers: if the count did not climb, say so and say what you think that means. A measurement that contradicts the lesson is a finding, not a failure.",
        "You can answer, without looking: what does editing `schema.prisma` alone change?",
      ],
    },
    { kind: "heading", text: "Retrieval Practice", id: "retrieval" },
    {
      kind: "quiz",
      question:
        "You add a `name` column to a model in `schema.prisma`, save, and reload the running app. What does the application see?",
      options: [
        "The new column — Prisma reads the schema file at runtime.",
        "Nothing has changed: the database has no such column and the generated client has not been rebuilt.",
        "A TypeScript error, because the generated types and the schema no longer agree.",
      ],
      answer: 1,
      explain:
        "`schema.prisma` is an input to two build steps, not something anything reads at runtime. Until `migrate dev` writes and applies SQL, the column does not exist in Postgres; until `generate` runs, the client's types have never heard of it. The app is querying a database and using a client that both predate your edit — so it behaves exactly as it did before you saved.",
    },
    {
      kind: "quiz",
      question:
        "You run `DROP TABLE \"Ping\";` by hand in psql, then run `prisma migrate dev`. What happens?",
      options: [
        "Prisma writes a new migration that recreates the table, bringing the database back in line.",
        "Prisma silently recreates the table, since the migration history says it should exist.",
        "Prisma detects drift and offers to reset the database, refusing to write a migration until it can.",
      ],
      answer: 2,
      explain:
        "Prisma decides what to write by comparing the database against the *migration history*, not against `schema.prisma`. A hand-made change is a state no migration produced, so Prisma cannot compute a trustworthy next step — any SQL it generated might assume a starting point that is not there. Its only safe move is to say so and offer a reset. That is also why 'just fix it in psql' is a habit worth not forming.",
    },
    {
      kind: "quiz",
      question:
        "Why does the client singleton hang off `globalThis` rather than just being a module-level `const`?",
      options: [
        "Because a module-level `const` cannot hold an object with an open connection pool.",
        "Because hot reload re-evaluates the module, discarding module scope — while `globalThis` belongs to the process and survives.",
        "Because Next.js runs each route in a separate process, and `globalThis` is the only shared memory between them.",
      ],
      answer: 1,
      explain:
        "Hot reload works by throwing away a module and running it again. Anything in module scope — including your `const` — is rebuilt every time, so a new pool is constructed while the old one stays open with nothing left holding a reference to close it. `globalThis` is not part of any module, so the reload does not touch it; the guard reads the existing client instead of building a second. It is off in production for the opposite reason: nothing reloads there, so the global is a leak with no benefit.",
    },
  ],
};

export default lesson;
