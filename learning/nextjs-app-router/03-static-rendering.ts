import type { Lesson } from "../types";

const lesson: Lesson = {
  slug: "static-rendering",
  n: "03",
  title: "Reading the Build Output: What ○ (Static) Actually Means",
  summary:
    "Next 16 decides at build time whether each route becomes a file or a function. Learning to read that table tells you what your app will cost to run.",
  minutes: 8,
  blocks: [
    {
      kind: "prose",
      text: "Every `bun run build` prints a route table. Most people skim it. It is actually the most useful diagnostic the framework gives you, because it tells you — per route — whether Next generated an HTML file at build time or will run your code on every request.",
    },
    {
      kind: "code",
      lang: "text",
      file: "our landing page build",
      code: `Route (app)
┌ ○ /
└ ○ /_not-found

○  (Static)  prerendered as static content`,
    },
    {
      kind: "prose",
      text: "`○ (Static)` means the entire landing page was rendered once, at build time, into HTML sitting on disk. No server work happens when someone visits it. That is why the whole page — grid, sparklines, charts and all — costs nothing to serve.",
    },
    { kind: "heading", text: "The three symbols", id: "symbols" },
    {
      kind: "table",
      head: ["Symbol", "Means", "When you get it", "Cost per request"],
      rows: [
        ["`○` Static", "Prerendered to HTML at build", "Nothing request-specific is read", "None"],
        ["`ƒ` Dynamic", "Rendered on the server per request", "You read cookies, headers, or searchParams", "One render"],
        ["`●` SSG", "Prerendered from `generateStaticParams`", "Dynamic segment with a known param list", "None"],
      ],
    },
    {
      kind: "prose",
      text: "The learning section you are reading right now is `●` — the routes are `/learning/[topic]/[lesson]`, and `generateStaticParams` enumerates every lesson at build time, so each one becomes a file.",
    },
    {
      kind: "source",
      path: "app/learning/[topic]/[lesson]/page.tsx",
      lines: "11-15",
      note: "The function that turns a dynamic route into a set of static files. Without it, every lesson view would run a server render.",
    },
    {
      kind: "code",
      lang: "tsx",
      file: "app/learning/[topic]/[lesson]/page.tsx",
      code: `export function generateStaticParams() {
  return topics.flatMap((t) =>
    t.lessons.map((l) => ({ topic: t.slug, lesson: l.slug })),
  );
}`,
    },
    { kind: "heading", text: "What silently makes a route dynamic", id: "going-dynamic" },
    {
      kind: "prose",
      text: "You do not choose static or dynamic with a config flag. Next infers it: **if your component reads something that only exists per-request, the route becomes dynamic.** Touching any of these anywhere in the tree flips it:",
    },
    {
      kind: "list",
      items: [
        "`cookies()` — the request's cookies",
        "`headers()` — the request's headers",
        "`searchParams` — the query string",
        "`connection()` — explicitly opting into dynamic rendering",
        "`fetch(..., { cache: \"no-store\" })` — an uncacheable data read",
      ],
    },
    {
      kind: "diagram",
      caption:
        "The decision is per-route and made at build time. One `cookies()` call deep inside a shared component moves the whole route into the dynamic column.",
      mermaid: `flowchart TD
  B["bun run build"] --> Q{"Does the route read<br/>per-request data?"}
  Q -->|"no"| S["Static — HTML on disk"]
  Q -->|"yes"| D["Dynamic — runs per request"]
  Q -->|"dynamic segment +<br/>generateStaticParams"| G["SSG — one file per param"]
  S --> C1["0 server cost"]
  G --> C2["0 server cost"]
  D --> C3["1 render per visit"]`,
    },
    {
      kind: "callout",
      tone: "warn",
      text: "This is the thing that will bite you when we add auth. Reading the session means calling `cookies()`, which makes that route dynamic. That is correct and unavoidable for a signed-in page — but it means you want the *marketing* routes to never touch the session, or you will quietly turn a free static page into a per-request render.",
    },
    { kind: "heading", text: "Why this matters before we add a database", id: "why-now" },
    {
      kind: "prose",
      text: "Right now every route is static, so the build table is boring. It stops being boring the moment we add Prisma and auth in the next phase: routes start reading cookies, hitting Postgres, and moving into the `ƒ` column. Knowing what the table looked like *before* is what lets you notice when something moved that should not have.",
    },
    {
      kind: "callout",
      tone: "key",
      text: "Treat the route table as a regression test you read by eye. A route that was `○` last week and is `ƒ` today means something in its tree started reading request state — find out what, and whether you meant it.",
    },
    {
      kind: "docs",
      links: [
        {
          label: "Next.js — Partial Prerendering and rendering modes",
          href: "https://nextjs.org/docs/app/getting-started/partial-prerendering",
          note: "how static and dynamic can coexist in one route",
        },
        {
          label: "Next.js — generateStaticParams",
          href: "https://nextjs.org/docs/app/api-reference/functions/generate-static-params",
          note: "the API turning dynamic segments into files",
        },
      ],
    },
    {
      kind: "task",
      taskId: "F3",
      goal: "Record this repo's current route table as a baseline, then move a route between columns on purpose so you have seen it happen before auth does it to you accidentally.",
      files: ["docs/route-baseline.md", "app/learning/path/page.tsx"],
      parts: [
        {
          title: "Part A — Capture the baseline",
          steps: [
            "Run `bun run build` and copy the full route table into `docs/route-baseline.md`.",
            "Next to each route write the symbol and one line saying why it has that symbol.",
            "`/learning/[topic]` and `/learning/[topic]/[lesson]` are `●`. Name the function that makes them so.",
          ],
        },
        {
          title: "Part B — Force a route dynamic",
          steps: [
            "In `app/learning/path/page.tsx`, add `const h = await headers()` and render one header value.",
            "Rebuild. Confirm `/learning/path` moved from `○` to `ƒ` and note it in the doc.",
            "Remove it and confirm it moves back.",
          ],
        },
        {
          title: "Part C — Predict the auth phase",
          steps: [
            "Read §4 of `docs/auth-plan.md`, specifically the three enforcement layers.",
            "In `docs/route-baseline.md`, predict which routes will be `ƒ` once auth lands, and which must stay `○`.",
            "Write one sentence on what would go wrong if the landing page ended up in the `ƒ` column.",
          ],
        },
      ],
      criteria: [
        "`docs/route-baseline.md` exists with the real, current table — pasted from a build, not typed from memory.",
        "Every route has a one-line reason for its symbol.",
        "The Part B experiment is recorded with the before and after tables.",
        "Your prediction for the auth phase names specific routes, not categories.",
        "`app/learning/path/page.tsx` is back to its original state and the build is clean.",
      ],
    },
    { kind: "heading", text: "Retrieval Practice", id: "retrieval" },
    {
      kind: "quiz",
      question: "What makes Next.js render a route on every request instead of prerendering it?",
      options: [
        "Setting `dynamic = true` in the route config",
        "Reading per-request data like `cookies()`, `headers()`, or `searchParams`",
        "Having any Client Component in the tree",
      ],
      answer: 1,
      explain:
        "It is inferred from what your code reads, not declared. Client Components have nothing to do with it — our landing page has two and is fully static. The moment anything in the tree reads request state, the route must run per request, because the output would differ per visitor.",
    },
    {
      kind: "quiz",
      question: "A route is `/learning/[topic]/[lesson]` and shows `●` in the build output. Why?",
      options: [
        "Dynamic segments are always prerendered",
        "`generateStaticParams` enumerated the params, so each combination became a file",
        "The page has no Client Components",
      ],
      answer: 1,
      explain:
        "A dynamic segment is dynamic by default — Next cannot know which values exist. `generateStaticParams` supplies the list at build time, so Next renders one file per combination. Remove that function and the same route drops to `ƒ`.",
    },
    {
      kind: "quiz",
      question: "Once auth is added, why should marketing pages avoid reading the session?",
      options: [
        "Sessions are not available in Server Components",
        "It would leak the session token into the static HTML",
        "It makes those routes dynamic, so they render per request instead of being free",
      ],
      answer: 2,
      explain:
        "Reading a session means calling `cookies()`, which forces the route dynamic. A landing page that was a file on disk becomes a server render on every visit — for a personalisation most marketing pages do not need.",
    },
  ],
};

export default lesson;
