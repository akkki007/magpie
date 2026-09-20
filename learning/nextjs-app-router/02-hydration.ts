import type { Lesson } from "../types";

const lesson: Lesson = {
  slug: "hydration",
  n: "02",
  title: "Hydration, and the Blank Page We Shipped for Ten Minutes",
  summary:
    "A real bug from this repo: scroll animations that made the whole page invisible without JavaScript, and the mismatch warning that fixing it caused.",
  minutes: 10,
  blocks: [
    {
      kind: "prose",
      text: "Hydration is the moment the server-rendered HTML in the browser gets wired up to React. The server sends markup; the browser downloads the JavaScript; React walks the existing DOM and attaches state and handlers to it. It does *not* re-render from scratch — it assumes the DOM it finds matches what it would have produced.",
    },
    {
      kind: "prose",
      text: "Two things follow from that assumption, and we hit both while building the landing page.",
    },
    { kind: "heading", text: "Problem one: the page was blank without JS", id: "blank" },
    {
      kind: "prose",
      text: "The scroll-reveal effect starts each section invisible and fades it in when it scrolls into view. The obvious implementation is a CSS class:",
    },
    {
      kind: "code",
      lang: "css",
      file: "app/globals.css — the broken version",
      code: `.reveal {
  opacity: 0;
  transform: translateY(8px);
}
.reveal.is-in {
  opacity: 1;
  transform: none;
}`,
    },
    {
      kind: "prose",
      text: "The `is-in` class is added by an `IntersectionObserver` in a Client Component. Which means: **if the JavaScript never runs, nothing ever becomes visible.** A slow network, a blocked bundle, a JS error earlier on the page — and the visitor gets a hero and then a screen of nothing.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "This is the single most common way a modern site fails silently. The content is in the HTML — search engines and screen readers can see it — but a human sees a blank page. It looks fine in every test where JavaScript works, which is every test you normally run.",
    },
    {
      kind: "prose",
      text: "The fix is to make the hidden state *conditional on JavaScript being present*. An inline script marks the document before the body paints, and the CSS only hides things when that mark exists:",
    },
    {
      kind: "code",
      lang: "css",
      file: "app/globals.css — the fixed version",
      code: `.js .reveal {
  opacity: 0;
  transform: translateY(8px);
}
.js .reveal.is-in {
  opacity: 1;
  transform: none;
}`,
    },
    {
      kind: "code",
      lang: "tsx",
      file: "app/layout.tsx",
      code: `<body>
  <script
    dangerouslySetInnerHTML={{
      __html: "document.documentElement.classList.add('js')",
    }}
  />
  {children}
</body>`,
    },
    {
      kind: "source",
      path: "app/layout.tsx",
      lines: "48-60",
      note: "The real thing in this repo. Note it sits at the top of `<body>`, not in `<head>` — it runs before the rest of the body paints, so there is no flash of visible-then-hidden content.",
    },
    {
      kind: "callout",
      tone: "key",
      text: "The general shape: **never let JavaScript be responsible for making content visible.** Let it be responsible for making visible content *animate*. If the bundle fails, the page should degrade to plain and readable, not to empty.",
    },
    { kind: "heading", text: "Problem two: the fix caused a hydration mismatch", id: "mismatch" },
    {
      kind: "prose",
      text: "That script adds a class to `<html>` in the browser. The server never rendered that class. So when React hydrated, it found a `<html>` element whose attributes did not match what it expected — and logged a hydration mismatch warning.",
    },
    {
      kind: "diagram",
      caption:
        "The mismatch is real and intentional. `suppressHydrationWarning` tells React to accept a difference on *this element's own attributes and text* — it does not disable checking for the subtree.",
      mermaid: `sequenceDiagram
  participant S as Server
  participant B as Browser
  participant R as React
  S->>B: HTML with html class="... antialiased"
  B->>B: inline script adds "js"
  Note over B: DOM now differs from server output
  B->>R: hydrate()
  R->>R: compare html attributes
  alt no suppressHydrationWarning
    R-->>B: warning: attributes did not match
  else suppressHydrationWarning
    R-->>B: accept the difference, continue
  end`,
    },
    {
      kind: "code",
      lang: "tsx",
      file: "app/layout.tsx",
      code: `<html
  lang="en"
  suppressHydrationWarning
  className={\`\${inter.variable} \${hinato.variable} h-full antialiased\`}
>`,
    },
    {
      kind: "prose",
      text: "This is the standard pattern for anything that must run before paint and touch the DOM — theme switchers do exactly the same thing to avoid a flash of the wrong theme.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "`suppressHydrationWarning` is a scalpel, not a mute button. It applies to one element, one level deep. If you find yourself putting it on a component to silence a warning you do not understand, the warning is telling you something real — usually `Date.now()`, `Math.random()`, or `localStorage` being read during render.",
    },
    { kind: "heading", text: "How to actually catch these", id: "catching" },
    {
      kind: "prose",
      text: "Both bugs are invisible in normal development. These are the two checks that find them:",
    },
    {
      kind: "code",
      lang: "bash",
      code: `# 1. Does the page still work with JS disabled?
#    (headless Chrome, JS off — content should still be visible)
google-chrome --headless --disable-javascript --dump-dom http://localhost:3000

# 2. Any hydration warnings in the console?
google-chrome --headless --enable-logging=stderr --v=0 \\
  --virtual-time-budget=8000 --dump-dom http://localhost:3000 \\
  >/dev/null 2>/tmp/c.log
grep -i "hydrat" /tmp/c.log`,
    },
    {
      kind: "docs",
      links: [
        {
          label: "React — hydrateRoot and mismatches",
          href: "https://react.dev/reference/react-dom/client/hydrateRoot#handling-different-client-and-server-content",
          note: "the precise semantics of suppressHydrationWarning",
        },
        {
          label: "Next.js — Hydration error reference",
          href: "https://nextjs.org/docs/messages/react-hydration-error",
          note: "the usual causes, in order of likelihood",
        },
      ],
    },
    {
      kind: "task",
      taskId: "F2",
      goal: "Prove the two failures in this repo are actually fixed, and add the check that would have caught them.",
      files: ["app/layout.tsx", "app/globals.css", "package.json"],
      parts: [
        {
          title: "Part A — Verify the JS-off path",
          steps: [
            "Load `http://localhost:3000` with JavaScript disabled and confirm every section is visible.",
            "Temporarily change `.js .reveal` back to `.reveal` in `app/globals.css`, reload with JS off, and see the failure for yourself.",
            "Put it back. You now know what the bug looked like.",
          ],
        },
        {
          title: "Part B — Cause a mismatch on purpose",
          steps: [
            "In `app/page.tsx`, render `{new Date().toLocaleTimeString()}` somewhere visible.",
            "Load the page and read the browser console. Write down the exact warning.",
            "Remove it. Then explain, in a comment in your notes, why the `js` class needs `suppressHydrationWarning` but the timestamp cannot be fixed that way.",
          ],
        },
        {
          title: "Part C — Add the check to the repo",
          steps: [
            "Add a `check:nojs` script to `package.json` that loads the homepage headless with JavaScript disabled and greps the output for a string that only appears in a below-the-fold section.",
            "Make it exit non-zero when the string is missing.",
            "Run it against the working code (should pass) and against the broken CSS from Part A (should fail).",
          ],
        },
      ],
      criteria: [
        "`bun run check:nojs` exists, passes on the current code, and genuinely fails when the `.js` gate is removed — verified both ways, not assumed.",
        "The script's failure output says what broke, not just a non-zero exit.",
        "No leftover debug code in `app/page.tsx`.",
        "You can explain in one sentence why `suppressHydrationWarning` is the right tool for the `js` class and the wrong tool for a timestamp.",
      ],
    },
    { kind: "heading", text: "Retrieval Practice", id: "retrieval" },
    {
      kind: "quiz",
      question: "Why did the reveal animation make the page blank without JavaScript?",
      options: [
        "The HTML was never sent — Server Components need JS to render",
        "The HTML was sent, but CSS set it to opacity 0 and only JS could undo that",
        "Next.js strips animated elements from the static output",
      ],
      answer: 1,
      explain:
        "The content was in the HTML the whole time — you could see it in view-source. CSS hid it unconditionally, and the only thing that added the `is-in` class was JavaScript. That is why the fix is in CSS (gate the hidden state on a `.js` class), not in the component.",
    },
    {
      kind: "quiz",
      question: "What does `suppressHydrationWarning` actually suppress?",
      options: [
        "All hydration warnings in that component and everything below it",
        "Attribute and text differences on that one element only",
        "All hydration warnings for the whole application",
      ],
      answer: 1,
      explain:
        "It is one element, one level deep — its own attributes and text content. Children are still checked normally. That narrowness is what makes it safe to use for the `js` class on `<html>` while still catching real mismatches inside the page.",
    },
    {
      kind: "quiz",
      question: "Why does the marker script go at the top of `<body>` rather than in an effect?",
      options: [
        "Effects cannot modify `document.documentElement`",
        "It must run before the browser paints, and effects run after hydration",
        "Scripts in `<body>` are the only ones Next.js will execute",
      ],
      answer: 1,
      explain:
        "A `useEffect` runs after React hydrates, which is after first paint. The class would arrive too late and you would see the content flash visible and then hide. An inline script at the top of `<body>` executes synchronously, before the rest of the body renders.",
    },
  ],
};

export default lesson;
