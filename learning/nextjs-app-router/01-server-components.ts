import type { Lesson } from "../types";

const lesson: Lesson = {
  slug: "server-components",
  n: "01",
  title: "Server Components, and Why Only Two Files Say \"use client\"",
  summary:
    "Every component in the App Router is a Server Component until you opt out — and the landing page needed to opt out exactly twice.",
  minutes: 9,
  blocks: [
    {
      kind: "prose",
      text: "You already know React components. The thing that is new in the App Router is *where they run*. In a normal React app every component runs in the browser. Here, the default flipped: a component runs on the server, renders to HTML, and its JavaScript is never sent to the browser at all — unless you explicitly ask for it.",
    },
    {
      kind: "prose",
      text: "The landing page we built has around a dozen components. Exactly two of them ship JavaScript to the browser. That is not an optimisation we did afterwards; it is what you get by default when you only opt out where you must.",
    },
    { kind: "heading", text: "The rule, and the one directive", id: "the-rule" },
    {
      kind: "prose",
      text: "`\"use client\"` at the top of a file marks the boundary. That file, **and everything it imports**, gets bundled and sent to the browser. Files above the boundary stay on the server.",
    },
    {
      kind: "callout",
      tone: "key",
      text: "`\"use client\"` does not mean \"this runs on the client instead of the server\". It means \"this *also* runs on the client\". The component is still server-rendered for the initial HTML, then hydrated in the browser. It is an opt-in to interactivity, not an opt-out of SSR.",
    },
    {
      kind: "prose",
      text: "So the question for every component is narrow: **does this need browser state or browser APIs?** If it needs `useState`, `useEffect`, an event handler, `window`, or `localStorage` — it must be a Client Component. If it just turns data into markup, it should not be.",
    },
    {
      kind: "table",
      head: ["Needs", "Which kind", "Why"],
      rows: [
        ["`useState`, `useReducer`", "Client", "State lives in the browser"],
        ["`useEffect`, `useLayoutEffect`", "Client", "Effects only run after hydration"],
        ["`onClick`, `onChange`", "Client", "Handlers must be attached in the browser"],
        ["`window`, `document`, `localStorage`", "Client", "No such thing on the server"],
        ["Reading a file, querying a DB, a secret key", "Server", "Never send that to a browser"],
        ["Just rendering props into markup", "Server", "Free — costs the client nothing"],
      ],
    },
    { kind: "heading", text: "What that looked like in our landing page", id: "in-our-page" },
    {
      kind: "source",
      path: "components/landing/nav.tsx",
      lines: "1",
      note: "A Client Component. It tracks scroll position to fade in the header border and holds open/closed state for the mobile menu — both browser-only concerns.",
    },
    {
      kind: "code",
      lang: "tsx",
      file: "components/landing/nav.tsx",
      code: `"use client";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // ...`,
    },
    {
      kind: "source",
      path: "components/ui/reveal.tsx",
      lines: "1",
      note: "The other one. It uses an IntersectionObserver to fade sections in as they scroll into view — again, a browser API, so there is no way for it to be a Server Component.",
    },
    {
      kind: "prose",
      text: "Everything else — `hero.tsx`, `sections.tsx`, `footer.tsx`, the whole `model-grid.tsx` with its dozens of rows and sparklines — is a Server Component. The grid renders a few hundred DOM nodes and ships **zero** bytes of component JavaScript. That is why the page is fast without us doing anything clever.",
    },
    {
      kind: "diagram",
      caption:
        "The boundary is a property of the import graph, not of the folder. `page.tsx` stays on the server even though it renders `Nav`, because *it* never said `\"use client\"`.",
      mermaid: `flowchart TD
  L["app/layout.tsx<br/>Server"] --> P["app/page.tsx<br/>Server"]
  P --> H["hero.tsx<br/>Server"]
  P --> S["sections.tsx<br/>Server"]
  P --> N["nav.tsx<br/>use client"]
  H --> G["model-grid.tsx<br/>Server"]
  H --> R["reveal.tsx<br/>use client"]
  N --> B1["ships JS"]
  R --> B2["ships JS"]
  G --> B3["ships no JS"]`,
    },
    { kind: "heading", text: "The trap: the boundary is contagious", id: "contagious" },
    {
      kind: "prose",
      text: "This is the part that bites people. Once a file is a Client Component, **everything it imports becomes client code too** — even if those files never say `\"use client\"` themselves. Import one heavy library into a leaf Client Component and it lands in the browser bundle.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "The fix is usually to push the boundary *down*, not up. Rather than marking a whole section as a client file because one button inside it is interactive, extract the button into its own client file and leave the section on the server. Our `Reveal` component is exactly this: a tiny client wrapper around server-rendered children.",
    },
    {
      kind: "prose",
      text: "That works because a Client Component can still *render* server-rendered children — they get passed through as already-rendered content. `<Reveal><ServerThing /></Reveal>` keeps `ServerThing` on the server.",
    },
    {
      kind: "docs",
      links: [
        {
          label: "Next.js — Server Components",
          href: "https://nextjs.org/docs/app/getting-started/server-and-client-components",
          note: "the official framing of the boundary",
        },
        {
          label: "React — 'use client' directive",
          href: "https://react.dev/reference/rsc/use-client",
          note: "what the directive actually does to the module graph",
        },
      ],
    },
    {
      kind: "task",
      taskId: "F1",
      goal: "Audit this repo's own client boundary. The learning site was built fast — find out whether every `\"use client\"` in it is earning its place, and remove the ones that aren't.",
      files: [
        "components/learning/*.tsx",
        "components/landing/*.tsx",
        "app/learning/**/page.tsx",
      ],
      parts: [
        {
          title: "Part A — Establish the baseline",
          steps: [
            "Run `bun run build` and write down the First Load JS for `/learning/nextjs-app-router/server-components`.",
            "Run `grep -rln '\"use client\"' components/ app/` and list every file that has the directive.",
            "For each one, write a single sentence naming the browser API or state that forces it. If you can't, flag it.",
          ],
        },
        {
          title: "Part B — Check the boundary is where it should be",
          steps: [
            "`components/learning/chrome.tsx` is one client file holding both the header and the search palette. Only one of those needs state.",
            "Decide whether splitting it would reduce what the browser downloads on a page where the palette is never opened.",
            "If it would, split it: keep the interactive part client, push the rest to the server.",
            "Rebuild and compare First Load JS against your baseline.",
          ],
        },
        {
          title: "Part C — Prove the contagion in our own code",
          steps: [
            "`components/learning/mermaid.tsx` dynamically imports `mermaid` inside an effect rather than at the top of the file.",
            "Change it to a static top-level import, rebuild, and record what happens to the bundle.",
            "Change it back. Explain in a comment why the dynamic import is load-bearing here.",
          ],
        },
      ],
      criteria: [
        "Every remaining `\"use client\"` has a one-line justification naming the specific browser API or state it needs.",
        "Any file that failed that test is either split or has a written reason for staying as it is.",
        "First Load JS is measured before and after, with the numbers recorded — not estimated.",
        "The mermaid import is back to dynamic, with a comment explaining why.",
        "`bun run build` and `bunx eslint .` both pass.",
      ],
    },
    { kind: "heading", text: "Retrieval Practice", id: "retrieval" },
    {
      kind: "quiz",
      question: "A Server Component imports a Client Component. Where does the Server Component run?",
      options: [
        "On the client — the boundary spreads upward to its importers",
        "On the server only — the boundary only spreads downward, to imports",
        "Both — anything touching a client file gets hydrated",
      ],
      answer: 1,
      explain:
        "The boundary spreads *down* the import graph, never up. `app/page.tsx` renders `Nav`, which is a Client Component, and `page.tsx` still runs only on the server. This is what lets you keep a mostly-server page that has a few interactive islands in it.",
    },
    {
      kind: "quiz",
      question: "Which of these forces a component to be a Client Component?",
      options: [
        "Rendering an array of data into a table",
        "Reading `process.env.DATABASE_URL`",
        "Attaching an `onClick` handler",
      ],
      answer: 2,
      explain:
        "Event handlers have to be attached in the browser, so they require hydration. Rendering data is the ideal Server Component job, and reading a secret env var is something you must do *only* on the server — putting that in a Client Component would ship the secret to the browser.",
    },
    {
      kind: "quiz",
      question: "What does adding `\"use client\"` to a file actually change?",
      options: [
        "The component stops server-rendering and renders only in the browser",
        "That file and everything it imports get bundled and sent to the browser",
        "Only that single file is sent to the browser",
      ],
      answer: 1,
      explain:
        "It marks a boundary in the module graph: the file *and its whole import subtree* become client code. The component still server-renders for the initial HTML — it just also hydrates. This is why importing a large library into a small client file is expensive.",
    },
  ],
};

export default lesson;
