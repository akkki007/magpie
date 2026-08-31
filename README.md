# Magpie

An AI-native finance workspace. Live data, forecasting, and collaboration in one modelling
surface, so a finance team spends less time repairing spreadsheets and more time shaping
the plan.

Black, white, and one flash of blue — a finance instrument, not a marketing site.

---

## What is actually built

Honest status, because a README that overstates is worse than no README.

| Area | State |
|---|---|
| Landing page | **Built.** `/` — the full marketing surface. |
| Design system | **Built.** Tokens in `app/globals.css`, taste in `docs/design-system.md`. |
| Auth | **Built.** Email + password, magic link, email verification, database sessions. |
| Modelling grid | **Built.** `/workspace` reproduces `designs/modelling-1.jpg` — groups, dimensions, sticky columns, inline editing, undo, scenarios, grain switching. |
| Modelling engine | **Built, in memory.** AST formulas, cell-level evaluation, aggregation rollup and a command bus in `lib/model`. `bun run calc:check` asserts the rollup. |
| Modelling persistence | **Planned, not built.** No `Model` table — the module resets on reload. `docs/modelling-plan.md` M0 is the next slice. |
| Reconciliation | **Built through R3.** A 6,172-record synthetic batch with a labelled answer key, ingestion, a deterministic matcher and a scoreboard: 100% auto-apply precision, 0% false-match rate, 68.7% match rate, no model involved. `bun run recon:eval`. `docs/recon-plan.md`. |
| Organisations / roles | **Planned.** `docs/auth-plan.md` §3; tasks A3–A6. |
| Learning site | **Built.** `/learning` — the lessons written alongside the code. |

`learning/path.ts` is the live task list and the single record of where the project is.

## Running it

Requires [Bun](https://bun.sh) and a local PostgreSQL 16.

```bash
bun install

# 1. A database the app owns, and a role that owns only that database.
createdb magpie_dev
psql -d postgres -c "CREATE ROLE magpie LOGIN PASSWORD 'choose-one' CREATEDB;"
psql -d magpie_dev -c "ALTER SCHEMA public OWNER TO magpie;"

# 2. Environment. Fill in DATABASE_URL and BETTER_AUTH_SECRET at minimum.
cp .env.example .env

# 3. Schema and client.
bun run db:migrate
bun run db:generate

bun run dev
```

Then sign up at `http://localhost:3000/sign-up`.

Mail (magic links, email verification) needs a Gmail app password in `GMAIL_USER` /
`GMAIL_APP_PASSWORD`. **Leave them unset and every email is printed to the server log
instead of sent**, so the whole flow is walkable on a fresh clone. `bun run mail:check`
authenticates against Gmail without sending anything.

### Scripts

| Command | Does |
|---|---|
| `bun run dev` / `build` / `start` | Next.js |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | ESLint |
| `bun run db:migrate` / `db:generate` / `db:studio` | Prisma |
| `bun run auth:tables` | Prints the tables Better Auth expects, read from the installed library |
| `bun run mail:check` | Verifies SMTP credentials without sending |

## Stack

TypeScript · Next.js 16 (App Router) · React 19 · Tailwind v4 · Prisma 7 on local
PostgreSQL · Better Auth · Bun.

No component library and no chart library: the design system is small enough that
`components/ui` owns its own primitives, and the charts are hand-drawn SVG. Every
dependency added is one more thing that has to agree with the design.

## Layout

```
app/
  (marketing)  page.tsx        the landing page
  (auth)       sign-in · sign-in/link · sign-up · actions.ts
  (app)        workspace       the dashboard
  api/auth     [...all]        every Better Auth endpoint
  learning     the lessons
components/
  app/         the product: rail, topbar, KPI band, variable grid, agent panel
  landing/     marketing surfaces
  ui/          charts, logo, toasts — shared primitives
  auth/        the two forms and their controls
lib/
  auth.ts      the auth config; source of truth for the auth tables
  authz        (planned) requireMembership — the tenancy gate
  calc/        (planned) the calculation engine
  demo/        fixtures, deleted at M0
docs/          design-system.md · auth-plan.md
modelling/     brief.md (verbatim product brief) · main.md (the architecture)
designs/       the prototype screens everything is measured against
learning/      lessons + path.ts, the live task list
prisma/        schema + migrations
proxy.ts       Next 16 middleware: coarse redirects only, never the security check
```

## Decisions worth knowing before reading the code

- **The auth check lives next to the data, never in a layout.** On Next 16 a layout does
  not stop the page beneath it from running or from shipping its data in the RSC payload.
  `docs/auth-plan.md` §4.
- **Database sessions, not JWTs.** A finance workspace needs instant revocation and role
  changes that take effect now. `session.cookieCache` stays off for the same reason.
- **Formulas are stored as ASTs with ID references, never strings.** Renaming a variable
  must not break sixty formulas. `docs/modelling-plan.md` §1.1.
- **One command bus for humans and agents.** Undo, audit, version history, collaboration
  and AI editing are one mechanism, not five. §1.3.
- **AI output is a proposal, not a write.** An agent run produces a `PROPOSED` ChangeSet a
  human accepts. §1.4.
- **Blue is interactive, violet is machine-authored.** Buttons and links are blue; formula
  pills, sparklines and the assistant are violet. `docs/design-system.md` §2.
