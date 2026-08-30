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
    goal: "A real multi-tenant boundary: users, organisations, roles, sessions. Everything in modelling hangs off this, so it is worth getting exactly right.",
    detailed: true,
    tasks: [
      {
        id: "A1",
        title: "Postgres and Prisma, wired up",
        outcome: "A local database, a Prisma client, and one migration applied.",
        status: "todo",
        teaches: "What an ORM actually does, why migrations are files, and why DATABASE_URL never gets committed.",
      },
      {
        id: "A2",
        title: "The tenancy schema",
        outcome: "User, Organisation, Membership, Role in schema.prisma, migrated.",
        status: "todo",
        needs: ["A1"],
        teaches: "Modelling many-to-many with a join table that carries data, and why the role lives on Membership rather than User.",
      },
      {
        id: "A3",
        title: "Seed script and Prisma Studio",
        outcome: "`bun run seed` creates a demo org, owner, and member.",
        status: "todo",
        needs: ["A2"],
        teaches: "Idempotent seeds, upsert vs create, and reading your own data back.",
      },
      {
        id: "A4",
        title: "Auth.js with database sessions",
        outcome: "Credentials sign-in works; a Session row appears in Postgres.",
        status: "todo",
        needs: ["A3"],
        teaches: "Why DB sessions over JWT here, Argon2id hashing, and what the adapter is doing.",
      },
      {
        id: "A5",
        title: "The membership gate",
        outcome: "`requireMembership(orgSlug, minRole)` returns user+org+role or throws.",
        status: "todo",
        needs: ["A4"],
        teaches: "Where authorisation actually belongs — and why a layout does not protect a Server Action. First unit test.",
      },
      {
        id: "A6",
        title: "Org-scoped routes",
        outcome: "`/[orgSlug]` resolves the org, 404s for non-members.",
        status: "todo",
        needs: ["A5"],
        teaches: "URL-scoped tenancy, dynamic params, and 404-not-403 so org existence does not leak.",
      },
      {
        id: "A7",
        title: "Sign-in and sign-up UI",
        outcome: "Both forms, on the design system, with inline field errors.",
        status: "todo",
        needs: ["A4"],
        teaches: "Server Actions, progressive enhancement, and constant-shape error responses.",
      },
      {
        id: "A8",
        title: "Onboarding and org creation",
        outcome: "A user with no memberships lands on onboarding and creates an org.",
        status: "todo",
        needs: ["A6", "A7"],
        teaches: "Transactions — org and owner membership must be created together or not at all.",
      },
      {
        id: "A9",
        title: "Sign out and session revocation",
        outcome: "Signing out deletes the Session row, not just the cookie.",
        status: "todo",
        needs: ["A4"],
        teaches: "Why revocation is the whole reason we chose DB sessions.",
      },
      {
        id: "A10",
        title: "Rate limiting and a security pass",
        outcome: "Sign-in and sign-up are rate limited; §5 of the auth plan is checked off.",
        status: "todo",
        needs: ["A7", "A8"],
        teaches: "Enumeration, timing, token buckets, and reading your own code adversarially.",
      },
    ],
  },
  {
    id: "M",
    title: "Modelling",
    goal: "The variable grid, the calculation engine, and the agent surface. Sketched only — see modelling/main.md for the full plan; tasks get written when we reach it.",
    detailed: false,
    tasks: [
      {
        id: "M0",
        title: "Model schema and a seeded demo model",
        outcome: "A model with groups and variables renders from the database.",
        status: "todo",
        teaches: "Schema design under a real domain, and JSONB vs rows.",
      },
      {
        id: "M1",
        title: "The variable grid",
        outcome: "The grid from the landing page, driven by real data.",
        status: "todo",
        teaches: "Virtualisation, sticky columns, and dense-table performance.",
      },
      {
        id: "M2",
        title: "The calculation engine",
        outcome: "Formula ASTs, a dependency DAG, and correct time aggregation.",
        status: "todo",
        teaches: "Parsers, topological sort, and why this is where tests stop being optional.",
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
