# Using `/teach`

How to drive the learning system in this repo. This is the guide for **you**;
`.claude/skills/teach/SKILL.md` is the instruction set for **Claude**. If the two ever
disagree, the SKILL.md is what actually runs.

---

## The one-minute version

```bash
bun run dev          # then open http://localhost:3000/learning/path
```

Then, in Claude Code:

| You type | What happens |
|---|---|
| `next task` | Claude writes the lesson for the next task and marks it `learn` |
| *(you read it and build)* | Task moves to `building` |
| `review F1` | Claude reviews your implementation properly, then marks it `done` |

That's the whole loop. Everything below is detail.

---

## The pieces, and how they relate

```
learning/path.ts          the dev plan AND the state — 16 tasks across 3 phases
learning/<topic>/*.ts     the lessons, as typed data
app/learning/             the site that renders them  → /learning
docs/                     design system, auth plan, this guide
scripts/gen-image.py      illustration generation (paid Gemini feature)
.claude/skills/teach/     the skill Claude runs
```

`learning/path.ts` is the important one. It is both the plan and the record of where the
project is — every task has a `status` Claude moves as you go. There is deliberately no
second copy of that state anywhere, so it cannot drift.

**Statuses:** `todo` → `learn` (lesson written, go read it) → `building` (you're on it) →
`review` (waiting on Claude) → `done`.

---

## The loop, properly

### 1. Get the task

Say **`next task`**, or `/teach`, or name something specific: *"teach me the Prisma
schema"*. Claude picks the next `todo` task on the path, writes a lesson for it grounded
in this repo, and flips it to `learn`.

Lessons are 8–12 minutes and always end in a **Your Turn — Build It** section with:

- the real files you'll touch
- Parts A/B/C, each producing something checkable
- **What I'll review it against** — the acceptance criteria

Read the criteria before you start. They are literally what the review runs against, so
they tell you what "done" means.

### 2. Build it

You write the code. Claude does not — that's the point of the arrangement, and if it
writes the task code for you the task was wasted.

If you get stuck, say so. Asking *"why does the Membership unique constraint need both
columns?"* mid-task is fine and expected. Asking *"just write it for me"* gets you the
code but not the skill, so Claude will push back once and then do what you say.

### 3. Get it reviewed

Say **`review F1`** (or *"I'm done"*, or *"check this"*). Claude will:

1. **Run things** — `bun run build`, `bunx eslint .`, the tests — and tell you what they printed
2. Walk the task's criteria one by one
3. Report findings in severity order: **correctness → design → style**
4. Say what's good, and why
5. Describe fixes rather than hand you a patch

Then you fix, and say `review F1` again. When it passes, the task goes `done` and the
progress bar on `/learning/path` moves.

**What to expect from a review.** A real bug gets a failure scenario, not a vague warning.
A design finding explains what it costs you later. A style nit is labelled as a nit. If
Claude says "looks good" and nothing else, the review was lazy — push back and ask what it
actually ran.

---

## Every phrase that does something

| Say this | Get |
|---|---|
| `next task` / `what's next` / `/teach` | The next lesson, task set to `learn` |
| `teach me <topic>` | A lesson on that specifically |
| `explain what we just built` | A reference lesson with no task attached |
| `review <id>` / `I'm done` / `check this` | Full review of your implementation |
| `plan the modelling phase` | Phase M gets written out as real tasks |
| `skip A7` / `move A9 before A8` | The path is reordered |
| `add a task for <thing>` | A new task, slotted into the right phase |

---

## Changing the plan

`learning/path.ts` is a normal TypeScript file — edit it directly if you want. It is your
plan, not Claude's.

Reasonable things to do by hand:

- Reorder tasks, or change `needs` to change what blocks what
- Rewrite an `outcome` if you want a different result from a task
- Delete a task you don't care about
- Flip a status if Claude got it wrong

Phase M (Modelling) is deliberately a **sketch** — three coarse tasks instead of ten real
ones. That's not laziness: what you learn in the auth phase will change what the modelling
tasks should be, and writing them now guarantees rewriting them later. Say
*"plan the modelling phase"* when you get there.

---

## Writing or editing a lesson yourself

Lessons are typed data, not prose files. Read `learning/types.ts` — it's short and it is
the whole contract. Every block kind (`prose`, `code`, `table`, `diagram`, `callout`,
`source`, `docs`, `task`, `quiz`, `image`) has exactly one renderer, which is why a
generated lesson can't drift off the design system.

Scaffold a new one:

```bash
python3 .claude/skills/teach/scripts/new-lesson.py <topic> <slug> "Lesson Title"
```

It auto-numbers and prints the two lines to add to that topic's `meta.ts`.

Prose supports only `` `code` ``, `**bold**`, `*italic*`, and `[text](href)`. Anything else
renders literally — if you paste markdown headings into a `prose` block you'll see the `##`.

A new topic needs a `meta.ts` and one line in `learning/index.ts`. Routes generate
themselves from there.

---

## Illustrations

```bash
python3 scripts/gen-image.py --check              # is generation available?
python3 scripts/gen-image.py --scene "..." --out public/learning/<topic>/<name>.png
python3 scripts/gen-image.py --scene "..." --out x.png --dry-run   # prompt only, free
```

**Currently blocked:** image generation is a paid Gemini feature. Every image model on your
key reports free-tier quota `limit: 0`, which needs billing enabled at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) — not a bigger free quota.
`--check` tells you which state you're in. Text generation on the same key works fine.

Until then, `--dry-run` prints the exact prompt to paste into AI Studio's web UI, which is
free. Save the result under `public/learning/<topic>/` and Claude will embed it.

Use illustrations sparingly — for a **metaphor** a box-and-arrow diagram can't carry.
Anything structural (a sequence, a boundary, a decision tree) should stay Mermaid, because
Mermaid is text, diffable, and correctable.

---

## The other skill

`design-from-references` is unrelated to teaching — it extracts a design system from
reference screenshots. It's what produced `docs/design-system.md` from `designs/`. Use it
if you add new reference images or want to re-derive tokens:

```bash
python3 .claude/skills/design-from-references/scripts/probe.py dominant designs/x.jpg
python3 .claude/skills/design-from-references/scripts/font-audit.py app/fonts/Hinato.woff2
```

---

## Troubleshooting

**A lesson 404s.** The topic isn't registered. Check `learning/index.ts` imports it and has
it in the `topics` array, then `bun run build` to regenerate route types.

**Route types are wrong after adding a page.** `bun run build` regenerates them. `bunx tsc
--noEmit` alone won't — it reads types the build generates.

**A diagram is blank.** Mermaid syntax error, swallowed at render. Check for parentheses in
unquoted node labels, a node id called `end`, or a literal `\n` instead of `<br/>`.

**The serif font vanished.** A custom property resolves where it's *declared*. If
`--font-serif` at `:root` references a font variable that only exists on an inner wrapper,
the whole declaration is invalid and silently falls back to sans. Keep root generic, layer
the real face on under `[data-surface="learning"]`.

**Everything below the hero is invisible.** The `.js` gate in `app/globals.css` — scroll
reveals hide themselves only when JavaScript is confirmed present. If that class isn't
being set, nothing un-hides.
