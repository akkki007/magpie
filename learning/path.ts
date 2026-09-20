import type { Phase } from "./types";

/**
 * The dev plan for Magpie, written as a learning path.
 *
 * The loop for every task: read the lesson → implement it in this repo →
 * Claude reviews it → status moves to done → next task. Claude updates
 * `status` here as that happens, so this file is the single record of where
 * the project actually is.
 *
 * Only the phase we are in is `detailed`. Later phases stay as an arc on
 * purpose — what we learn in auth will change what the modelling tasks should
 * be, and planning them now just means rewriting them later.
 */
export const path: Phase[] = [
  {
    id: "F",
    title: "Foundations",
    goal: "The landing page and the design system. Already built — these lessons explain what is already in the repo.",
    detailed: true,
    tasks: [
      {
        id: "F1",
        title: "Server Components and the client boundary",
        outcome: "You can say which files in this repo ship JavaScript, and why.",
        status: "learn",
        lesson: ["nextjs-app-router", "server-components"],
        teaches: "Where code runs in the App Router, and how the boundary spreads.",
      },
      {
        id: "F2",
        title: "Hydration and graceful degradation",
        outcome: "You can explain the blank-page bug we shipped and the fix.",
        status: "learn",
        lesson: ["nextjs-app-router", "hydration"],
        needs: ["F1"],
        teaches: "What hydration assumes, and why JS must never gate visibility.",
      },
      {
        id: "F3",
        title: "Reading the build output",
        outcome: "You can read the route table and say what each route costs.",
        status: "learn",
        lesson: ["nextjs-app-router", "static-rendering"],
        needs: ["F1"],
        teaches: "Static vs dynamic rendering, and what silently flips a route.",
      },
    ],
  },
  {
    id: "A",
    title: "Auth and tenancy",
    goal: "A real multi-tenant boundary: users, organisations, roles, sessions. Everything in modelling hangs off this, so it is worth getting exactly right. A1–A6 are what modelling actually blocks on; A7–A12 can land alongside it.",
    detailed: true,
    tasks: [
      {
        id: "A1",
        title: "Postgres and Prisma, wired up",
        outcome: "A `magpie_dev` database, one shared client in `lib/db.ts`, and a migration you can point at in `psql`.",
        // Built by Claude on request rather than by Akshay — the lesson is
        // still worth reading against the code that is now in the repo.
        status: "done",
        lesson: ["postgres-prisma", "the-pipeline-before-the-query"],
        teaches: "What an ORM actually does to your SQL, why migrations are files you commit, and why a dev server needs exactly one client instance.",
      },
      {
        id: "A2",
        title: "Better Auth, and the schema it generates",
        outcome: "`lib/auth.ts`, the catch-all route, and a real `user` + `session` row created by signing up.",
        status: "done",
        needs: ["A1"],
        teaches: "Config-first schema generation, why the session is a row rather than a JWT, and what password hashing costs in milliseconds.",
      },
      {
        id: "A3",
        title: "Organisations, members, and four roles",
        outcome: "`OWNER`/`ADMIN`/`EDITOR`/`VIEWER` defined as access-control statements, migrated, with `member` carrying the role.",
        status: "todo",
        needs: ["A2"],
        teaches: "Modelling permissions as `resource: action` instead of a role enum, and why the role belongs to the membership and not the user.",
      },
      {
        id: "A4",
        title: "Seed script and Prisma Studio",
        outcome: "`bun run seed` builds a demo org with an owner, an editor, and a viewer — and survives being run twice.",
        status: "todo",
        needs: ["A3"],
        teaches: "Idempotent seeds, `upsert` vs `create`, and reading your data back instead of trusting the code that wrote it.",
      },
      {
        id: "A5",
        title: "requireMembership — the real gate",
        outcome: "`lib/authz.ts` returns user+org+role for a slug, or throws. Covered by the first tests in this repo.",
        status: "todo",
        needs: ["A4"],
        teaches: "Why the check belongs next to the data, why we ask for a *permission* and not a minimum role, and how `cache()` stops it running six times per page.",
      },
      {
        id: "A6",
        title: "Org-scoped routes, and three layers of check",
        outcome: "`/[orgSlug]` renders for a member and 404s for everyone else, with `proxy.ts` doing the cheap redirect in front.",
        status: "todo",
        needs: ["A5"],
        teaches: "Why a Next 16 layout does *not* protect the page beneath it, and what a 404-instead-of-403 is hiding.",
      },
      {
        id: "A7",
        title: "Sign-in and sign-up UI",
        outcome: "Both forms on the design system, driven by Server Actions, with errors inline under the field.",
        status: "done",
        needs: ["A2"],
        teaches: "A Server Action is a public POST endpoint, `useActionState`, and constant-shape responses that don't reveal which emails exist.",
      },
      {
        id: "A8",
        title: "Onboarding and org creation",
        outcome: "A user with zero memberships lands on `/onboarding` and comes out owning an org.",
        status: "todo",
        needs: ["A6", "A7"],
        teaches: "Transactions — an organisation with no owner is a row nothing can ever repair.",
      },
      {
        id: "A9",
        title: "Sign out and session revocation",
        outcome: "Signing out deletes the session row; ending someone else's session takes effect on their next request.",
        status: "todo",
        needs: ["A7"],
        teaches: "Why revocation was the entire reason for database sessions — and the one setting that quietly gives it back.",
      },
      {
        id: "A10",
        title: "Invites and member management",
        outcome: "An admin invites by email; the tokenised link turns into a membership on accept.",
        status: "todo",
        needs: ["A8"],
        teaches: "Tokens that are safe to put in an email, and deciding what happens when the same invite is opened twice.",
      },
      {
        id: "A11",
        title: "Google OAuth",
        outcome: "Sign in with Google, landing on the same user row as the password account.",
        status: "todo",
        needs: ["A7"],
        teaches: "The redirect dance, and account linking — where 'sign in with Google' quietly becomes account takeover.",
      },
      {
        id: "A12",
        title: "Rate limiting and a security pass",
        outcome: "Sign-in and sign-up are rate limited, and every line of §5 of the auth plan is signed off in writing.",
        status: "todo",
        needs: ["A9", "A10"],
        teaches: "Enumeration, timing, token buckets, and reading your own code the way someone attacking it would.",
      },
    ],
  },
  {
    id: "M",
    title: "Modelling",
    goal: "One engine and six templates, not six features. The full reasoning is in docs/modelling-plan.md; these are its build phases as tasks. M0–M2 are the real project — everything after is mechanical if the command bus in §1.3 is respected.",
    detailed: true,
    tasks: [
      {
        id: "M0",
        title: "Model schema and a seeded demo model",
        outcome: "`Model`, `VariableGroup`, `Variable`, `VariableInput`, `VariableSeries`, `Scenario` migrated, plus a seed that builds the Annual Operating Plan the dashboard currently fakes.",
        status: "todo",
        teaches: "Modelling a real domain in Postgres: why the computed series is JSONB and the inputs are rows, and why `numeric` and not `float` the moment money is involved.",
      },
      {
        id: "M1",
        title: "The variable grid, on live data",
        outcome: "`components/modelling/*` renders from the database instead of `lib/model/revenue-model.ts`. The grid itself — groups, dimensions, sticky columns, inline editing of INPUT rows — is built; what is missing is the query behind it.",
        status: "todo",
        needs: ["M0"],
        teaches: "Virtualising both axes before the grid is worth virtualising, sticky columns, and why a fixture-shaped component is cheap to switch over and a fixture-shaped API is not.",
      },
      {
        id: "M2",
        title: "The calculation engine",
        outcome: "`lib/model/engine.ts` + `grain.ts`: evaluation, time functions, cycle detection and aggregation rollup exist and are checked by `bun run calc:check`. Still missing: the parser that turns typed text into an AST.",
        status: "todo",
        needs: ["M1"],
        teaches: "Why formulas are stored as trees with ID references and never as strings, cycle detection, and the golden-file tests that stop OPENING/CLOSING being silently wrong at the quarter.",
      },
      {
        id: "M3",
        title: "The command bus",
        outcome: "Every mutation is a typed `{ type, payload, inverse }` command. Undo replays the inverse; the audit log is the command stream; a version is a snapshot plus the commands since.",
        status: "todo",
        needs: ["M2"],
        teaches: "That AI editing, undo, audit, collaboration, and rollback are one mechanism — and that building them as five is how this project dies.",
      },
      {
        id: "M4",
        title: "Scenarios and comparison",
        outcome: "Scenarios as overlays of overrides, a switcher, and a compare view that diffs two evaluated series.",
        status: "todo",
        needs: ["M3"],
        teaches: "Why an overlay beats a copy: a fix to the base case should not have to be applied five times.",
      },
      {
        id: "M5",
        title: "The agent surface",
        outcome: "Claude tool-calling against the same command schemas, producing a `PROPOSED` ChangeSet rendered as the diff bar from `designs/proto-screen-3.jpg`.",
        status: "todo",
        needs: ["M4"],
        teaches: "Generating tool schemas from the validators you already have, and why nothing an LLM emits may write to a model directly.",
      },
      {
        id: "M6",
        title: "Collaboration",
        outcome: "Comments anchored to a variable and period, presence, notifications, approvals.",
        status: "todo",
        needs: ["M3"],
        teaches: "Concurrent editing on top of an ordered command log rather than bolted beside it.",
      },
      {
        id: "M7",
        title: "Sources and templates",
        outcome: "CSV import, `LINKED` variables, and the six template libraries from the brief.",
        status: "todo",
        needs: ["M4"],
        teaches: "That the six use cases in the brief are one engine with six variable libraries — and what a sync that changes a number under someone's feet has to log to stay trustworthy.",
      },
    ],
  },
];

export function allTasks() {
  return path.flatMap((p) => p.tasks);
}

export function getTask(id: string) {
  return allTasks().find((t) => t.id === id);
}

export function progress() {
  const tasks = allTasks();
  return { done: tasks.filter((t) => t.status === "done").length, total: tasks.length };
}
