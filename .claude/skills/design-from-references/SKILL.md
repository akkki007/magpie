---
name: design-from-references
description: Extract an exact, reusable design system from reference screenshots or mockups, then build against it. Use when the user supplies design images ("match this design", "here are the screens", "use this design taste", "build from these mockups", "learn this design system") or when a project has a designs/ folder that new UI must conform to. Covers pixel-accurate token extraction, the taste rules that tokens alone cannot carry, translating a product UI into marketing surfaces, trialling a new typeface, and verifying the result against the source.
---

# design-from-references

Turning reference images into a design system that survives contact with a real codebase.

The failure mode this skill exists to prevent: you look at a screenshot, think "clean SaaS,
white with a purple accent", write `bg-purple-600`, and ship something that is *tonally*
similar and *specifically* wrong. Every value is off by a little, the density is off by a
lot, and six screens later nobody can say what the system actually is.

Two ideas do most of the work:

1. **Measure, don't eyeball.** Colour, spacing, and density come out of the pixels with a
   script. Your eye is good at relationships and bad at values.
2. **Tokens are the easy half. Ship the rules.** A palette without rules gets misapplied by
   the next person — including you, next week. The durable artifact is a short list of
   sentences like "violet means a machine did this" that tell someone where a colour is
   *allowed to go*.

---

## Step 1 — Actually look at the images

Read every reference at full resolution before running anything. You are looking for
**structure**, which no script will give you:

- What is the app shell? (rail width, panel split, floating canvas vs. full bleed)
- What is the densest surface, and how dense? (row heights, type sizes in tables)
- Where does the design spend contrast, and where does it deliberately refuse to?
- What is the one thing that is saturated, and what does it mean when it appears?
- Elevation: real shadows, or hairline borders doing the work?

Write these down before sampling. The numbers you extract later have to attach to
something.

If the references are `.avif` or another format the Read tool won't render, convert first:

```bash
python3 -c "from PIL import Image; Image.open('designs/x.avif').convert('RGB').save('designs/x.jpg', quality=95)"
```

## Step 2 — Sample the pixels

Use `scripts/probe.py`. Three passes, in this order:

```bash
# 1. What is the page actually made of? (surfaces, backgrounds, borders)
python3 scripts/probe.py dominant designs/screen-1.jpg

# 2. Accents: skip near-white, look inside the elements you identified in step 1
python3 scripts/probe.py region designs/screen-1.jpg 285,262,340,288 --label "delta badge"

# 3. Chart series: pull only saturated pixels out of a plot area
python3 scripts/probe.py saturated designs/screen-1.jpg 1430,530,1990,900
```

Notes that matter:

- **Dominant-colour counts are ~80% white on a good UI.** That is a finding, not a
  failure — it tells you the system is white-on-off-white, and it tells you the real
  accents are rare and must be hunted by region.
- **Filter near-white when hunting accents** (`--max-sum`), otherwise anti-aliasing drowns
  the signal.
- **Filter by saturation for chart colours.** Chart series are the only saturated pixels in
  a plot rectangle; text and gridlines are not.
- **Sample the element, not the neighbourhood.** Get bounding boxes from your step-1 read.
  A 40px-wide badge sampled with a 200px box returns the card behind it.
- **JPEG artifacts spread values.** Take the most frequent colour in a region, not the mean.
  If a region returns `#542cb1` 24 times and `#522cb5` 24 times, the answer is a round
  number near both — trust the design, not the compression.

## Step 3 — Measure density and shape, not just colour

This is the step people skip, and it is the one that makes a rebuild look *unlike* the
reference even when every hex matches.

- Row heights, header heights, rail width — count pixels in the image.
- Type sizes at each role, and **tracking**: display type in modern product UI is usually
  set tight (−0.02 to −0.035em). Getting this wrong reads as "generic" more than any
  colour error.
- Radii per role — panels, cards, controls, buttons, chips usually differ.
- Whether numbers are tabular. In anything financial they always are.

## Step 4 — Write the rules, then the tokens

Produce `docs/design-system.md` with, in this order:

1. **The taste in one paragraph.** What the thing *is*. "Quiet, dense, white. A finance
   instrument, not a marketing site."
2. **Five or six rules that must survive every screen.** Each one a sentence a reviewer
   could hold a PR against. Good rules are *prohibitions with reasons*:
   - "Violet means machine intelligence — formula pills, sparklines, agent actions, the
     primary CTA. Never a chart series."
   - "Hairlines, not shadows. Elevation is a border-weight change, not a blur."
   - "Dense inside data, generous around it. 30px rows; 128px between sections."
3. **Token tables** — colour, type, radius, spacing, elevation, motion.
4. **Components** as observed, with their real measurements.

Then mirror the tokens into code as the single source of truth. In Tailwind v4 that is
`@theme` in `globals.css`, and the rule to state in a comment is: **this file is the only
place a hex value may appear.**

Record the *non-obvious* rules in project memory too — the ones not derivable by reading
the token values later.

## Step 5 — Translate, if the target differs from the references

References are usually product UI; the ask is often a landing page. Do not paste product
density into a marketing layout. Add a "translation" section to the doc:

- Same surfaces and hairlines, sized up: 1200px max width, 96–128px section rhythm.
- **Proof points are real product surfaces, built as DOM, not screenshots.** This is the
  highest-leverage move in the whole skill: rebuilding the reference UI as components
  proves the token set actually reproduces the design, and those components are the start
  of the real app. A screenshot proves nothing and is dead weight.
- One saturated CTA per viewport; everything else ghost or secondary.
- Motion: opacity + a small rise, once. Product tools do not bounce.

## Step 6 — Verify against the source

Never claim a match you have not looked at.

```bash
# full-page capture; --force-prefers-reduced-motion defeats scroll-reveal animations
google-chrome --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --force-prefers-reduced-motion --window-size=1440,5200 \
  --screenshot=/tmp/page.png --virtual-time-budget=9000 http://localhost:3000

# console errors (hydration mismatches hide here)
google-chrome --headless --disable-gpu --no-sandbox --enable-logging=stderr --v=0 \
  --virtual-time-budget=8000 --dump-dom http://localhost:3000 >/dev/null 2>/tmp/c.log
grep "INFO:CONSOLE" /tmp/c.log
```

Then crop and read the slices, and check mobile at 390px. Build an A/B image when comparing
two options — a stacked before/after is worth more than any description you can write.

**Byte-identical screenshots mean your change did nothing.** Hash them. It is how you catch
a class that has no effect (see the `text-wrap: balance` trap in Gotchas).

---

## Rebrands: the rules are coupled to the palette

When the brand colour changes, **the rules change too** — this is not a find-and-replace.

Worked example: a system built on "violet = AI, blue/teal = data" was rebranded to blue.
Renaming the tokens left two rules that now contradicted each other, because brand and
charts had become the same hue. The fix was a new rule — *one accent hue; charts are a ramp
of it, separated by value rather than hue* — plus a re-derived chart palette. Search the
design doc for every sentence naming the old colour and rewrite it, then re-check contrast
on anything that carries text.

Also re-check **contrast after a palette swap.** A 400-level brand colour is usually a
signature hue, not a button fill: `#60a5fa` under white text is ~2.3:1 and fails AA. The
pattern that keeps both is *the 400 is the identity, a 600 is the contrast* — decorative,
non-text accents stay on the signature step; anything carrying white text steps down.

## Trialling a typeface from a reference or a zip

1. **Inspect before installing.** Weights, glyph count, coverage, tabular figures:
   `python3 scripts/font-audit.py Font.otf`
2. **Convert to woff2** (`fontTools`, roughly halves the file) and load with
   `next/font/local` so it is self-hosted, preloaded, and hashed.
3. **Check coverage against the actual strings** you intend to set in it. Display faces
   routinely drop punctuation a text family would have — en-dash and em-dash are the most
   common casualties, and both are easy to reach for in a headline. A heading that hits a
   missing glyph falls back mid-string and looks broken. Check the specific characters
   rather than assuming which ones are gone.
4. **A single-weight face must never be given a bold.** The browser synthesises one and
   display faces blob when it does.
5. **Re-tune tracking and size.** Tracking tuned for one family is wrong for another;
   a face with generous sidebearings needs tracking near 0, not −0.03em. Expect to size
   down 5–10% when swapping to a face that runs visually larger.
6. **Never for aligned numbers** unless it has tabular figures.
7. **Render a specimen and an A/B before wiring it in.** Show sizes, weights, tracking
   options, numerals, and the full alphabet on one page.
8. **Check the licence** — an embedded name table with no licence entry is a flag worth
   raising before launch, since shipping a webfont is distribution.

Draw the line at **marketing vs. product**: a display face belongs on marketing headings;
product surfaces, wordmarks, and anything numeric stay on the UI family. That is what keeps
embedded product mocks reading as a real application.

## Gotchas that cost real time

- **Scroll-reveal that hides content without JS.** `.reveal { opacity: 0 }` renders a blank
  page if the bundle fails. Gate it on a `js` class set by an inline script before paint,
  and add `suppressHydrationWarning` to `<html>` — the server never renders that class, so
  React will otherwise report a hydration mismatch.
- **`text-wrap: balance` is inert on a block containing a forced `<br>`.** Chrome skips it.
  Remove the class rather than leaving a no-op that implies behaviour.
- **Fixed-width flex children overflow their `min-w-0 flex-1` parent.** A wide table will
  bleed under an adjacent panel until the parent also gets `overflow-hidden`.
- **React Compiler lint rejects accumulator mutation inside `.map`.** Precompute cumulative
  values (pie/donut arc angles) with `reduce` so render stays pure.
- **A custom property is resolved where it is DECLARED, not where it is used.** Defining
  `--font-serif: var(--font-x), Georgia, serif` in Tailwind's `@theme` (which lands on
  `:root`) while `--font-x` only exists on an inner wrapper makes the whole declaration
  invalid at computed-value time — every `.font-serif` silently falls back to sans, with no
  error anywhere. Keep the root definition generic and layer the real face on in a scoped
  block (`[data-surface="x"] { --font-serif: var(--font-x), ... }`). This bites any time a
  `next/font` variable is scoped to a subtree instead of `<html>`.
- **Scaffolders refuse non-empty directories.** Scaffold into a temp subdir and move the
  files in, so a `designs/` folder does not block `create-next-app`.

## What "done" looks like

- `docs/design-system.md` — rules first, then tokens, then components.
- Tokens live in exactly one file; a hex anywhere else is a bug.
- The non-obvious rules are in project memory, not just the repo.
- The reference UI is rebuilt as components and screenshot-verified at desktop and mobile.
- Build, typecheck, and lint pass, and the browser console is clean.
