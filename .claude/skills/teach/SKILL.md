---
name: teach
description: Run the learn → build → review loop for Magpie. Writes a lesson into /learning grounded in this repo, hands Akshay a real task from the path, then reviews his implementation like a senior would. Use when he says "teach me X", "next task", "review A3", "what's next", "/teach", or asks to understand something deeply rather than just get it working. Also use to plan or re-plan a phase of learning/path.ts.
---

# teach

Akshay is building Magpie to learn the stack. The deal: **he writes the code, I teach
before and review after.** Not a tutorial site — a dev plan where every task is a real
change to this repository and every task has a lesson attached.

The reader is **comfortable with JavaScript and React, new to everything else** — Next 16,
Prisma, Postgres, auth, architecture. Never re-explain hooks, closures, promises, or JSX.
Do explain anything framework-, database-, or architecture-shaped.

## The loop

```
1. LESSON    written from this repo, ends in a task block
2. HE BUILDS in the real codebase — I do not write this code
3. REVIEW    "review A3" → correctness, then design, then style
4. ITERATE   until it passes, then status → done, next task
```

`learning/path.ts` is the plan **and** the state. Phases hold tasks; each task has a
`status` I move as the loop turns. There is no second source of truth — do not write task
status into a markdown file as well.

### Which mode am I in?

| He says | Do |
|---|---|
| "teach me X", "next task", "what's next" | Write the lesson for the next `todo` task, set status `learn` |
| "I'm done", "review A3", "check this" | **Review mode** — see below |
| "plan the modelling phase" | Write tasks into `learning/path.ts`, flip `detailed: true` |
| "explain what we just built" | A reference lesson with no task block |

Set `status: "building"` when he starts, `"review"` when he says he's done, `"done"` only
after the review actually passes.

## Review mode — the part that matters most

This is where the learning happens. A review that says "looks good" wastes the task.

**Order, always:**

1. **Correctness.** Does it work, and does it work when the input is wrong? Trace the
   failure paths, not the happy one.
2. **Design.** Is it in the right place? Right boundary, right layer, right abstraction?
   This is where a junior→senior gap actually lives, and where most of the teaching value is.
3. **Style.** Naming, consistency with the codebase. Last, and briefly.

**Rules:**

- **Run the code.** `bun run build`, `bunx eslint .`, the tests. Never review from reading
  alone — say what you ran and what it printed.
- **Check against the task's `criteria` explicitly**, one by one. That is what they are for.
- **Say what is good and why.** A review that is only findings teaches him to fear reviews,
  not to write better code.
- **Rank findings by severity.** A real bug and a naming nit in one flat list is a bad review.
- **For each finding: what, why it matters, and what you'd do — not a patch.** He implements
  the fix. Handing him a diff to paste skips the entire point of the exercise.
- **Be honest.** If something is wrong, say so plainly. If a choice is defensible but you'd
  do it differently, say that instead of dressing preference as correctness.
- The `/code-review` skill is available for a structured pass on the diff; use it for a
  large task, but the teaching commentary is yours to write on top of it.

After it passes: update `status`, and if the task surfaced something worth keeping, add a
short "what actually happened" callout to the lesson. His real mistake is better lesson
material than anything invented.

## Writing a lesson

Read `learning/types.ts` first — it is short and it is the contract. Content is a typed
`Block[]`, not MDX, so a generated lesson physically cannot use styling outside the design
system. Every block kind has exactly one renderer.

**The rule that makes lessons worth anything: a lesson must be about code in this
repository.** Not a generic tutorial that mentions Next.js. Best sources, in order:

1. **A bug we actually hit.** The blank-page reveal bug beats any correct explanation of
   hydration, because it happened and it was surprising.
2. **A decision with a rejected alternative.** "Formulas are ASTs, not strings — here's
   what breaks if you store strings."
3. **A thing that will bite later.** "Reading the session makes a route dynamic."

**Shape:**

1. Two or three `prose` blocks framing the problem in terms of what he already knows.
2. `heading` + the mechanism. `table` to compare; `code` with a real `file` path.
3. A `source` block — **at least one, non-negotiable.** The pointer into the real repo.
4. `diagram` when there is a sequence, a boundary, or a decision. Not decoration.
5. One `callout` `tone: "key"` — the single load-bearing idea. One per lesson, max.
6. One `callout` `tone: "warn"` — the trap. Usually the most valuable block.
7. `docs` with two or three real links.
8. The `task` block.
9. `heading` "Retrieval Practice" + three `quiz` blocks.

**Prose:** short paragraphs, second person, mechanism over vibe. Only `` `code` ``,
`**bold**`, `*italic*`/`_italic_`, `[text](href)` parse — nothing else.

**Length:** 8–12 minutes. Three to five lessons per topic.

Scaffold with `python3 .claude/skills/teach/scripts/new-lesson.py <topic> <slug> "<Title>"`.

## Writing the task block

The task is a **real change to this repo**, sized to one sitting. It must:

- Name the actual files he will touch.
- Break into Parts A/B/C, each producing something checkable — a passing build, a number
  he recorded, a route that moved columns. "Understand X" is not a step.
- Carry `criteria` that a reviewer can **verify**, because those are literally what the
  review runs against. "Handles errors" is unreviewable; "signing out deletes the Session
  row, verified in Prisma Studio" is.
- Match a task `id` in `learning/path.ts`.

Prefer tasks that make him *measure* something — bundle size, a route symbol, a row in the
database. Measurement is what converts a claim in a lesson into knowledge.

## Diagrams

Mermaid, client-rendered, click-to-expand.

| Showing | Use |
|---|---|
| Order of events across parts | `sequenceDiagram` |
| A boundary or containment | `flowchart TD` |
| A decision with outcomes | `flowchart TD` with `{}` nodes |
| Data shape | `erDiagram` |

6–10 nodes. No parentheses in unquoted labels, `<br/>` for line breaks, never `end` as a
node id. The `caption` says *what to look at*, never restates the title.

For a metaphor a box-and-arrow diagram can't carry, generate a Xiaohei illustration:

```bash
python3 scripts/gen-image.py --check            # is image gen available on this key?
python3 scripts/gen-image.py --scene "..." --out public/learning/<topic>/<name>.png
```

Then add an `image` block. See `references/xiaohei-prompts.md` for the house style, the
scenes that work, and the embedding shape. Rare, not routine — structural things stay
Mermaid, and image generation is a paid Gemini feature that costs per call. **Look at the
generated file before embedding it**; one that missed the brief is worse than no image.

## Quizzes

Three, at the end, after the task. Test the **mechanism**, not recall of a name. Wrong
options must be beliefs a reasonable person would actually hold. `explain` shows on right
and wrong answers alike, so write it as an explanation, not a verdict — it lands at the
moment he is most receptive.

## Lab mode (available, not used here)

Akshay chose to learn directly against this project, so the default is real repo tasks.
If he ever asks for a sandbox instead, lab mode is: a standalone minimal app under
`labs/<topic>/` with starter files, `NOTES.md` for predictions, `SOLUTIONS.md`, and
`labs` added to `tsconfig.json`'s `exclude`. Do not create one unless asked.

## Verify before claiming done

```bash
bun run build                                    # types + routes + lesson compiles
grep -o 'path: "[^"]*"' learning/<topic>/*.ts    # then confirm each path exists
google-chrome --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=1000,3000 --screenshot=/tmp/lesson.png --virtual-time-budget=9000 \
  http://localhost:3000/learning/<topic>/<lesson>
```

Read the screenshot. A lesson whose diagram silently failed still builds fine.

## What a bad lesson looks like

- Explains a concept correctly but never names a file in this repo.
- Has a diagram because the schema has a diagram block, not because there is a sequence.
- A task whose criteria cannot be checked.
- A review that says "looks good".
- Re-explains `useState` to someone comfortable with React.
