# Contributing to Magpie

## Getting it running

Requires [Bun](https://bun.sh) and a local PostgreSQL 16. The full first-run sequence is in
`README.md` — `bun install`, a `magpie_dev` database, `.env` from `.env.example`, then
`bun run db:migrate && bun run db:generate && bun run dev`.

Seed before you open anything. An empty database does not error, it renders blank screens,
and a blank screen is a much harder thing to debug than a stack trace:

```bash
bun run seed            # the model
bun run seed:database   # the Customers table
bun run seed:board      # the reporting board
```

## Before you push

Run these. They are fast, and each one catches a class of failure that is expensive to find
later:

```bash
bun run typecheck    # tsc --noEmit
bun run lint         # ESLint
bun run calc:check   # the modelling engine's rollup is correct
bun run data:check   # the database layer
bun run board:check  # the reporting boards
bun run recon:eval   # precision, recall and false-match rate against the answer key
```

`recon:eval` is the one to care about. It scores the matcher against `truth.json`, which the
matcher has never seen. **If a change moves the false-match rate off zero, that change is
wrong**, however good the match rate looks — a wrong match silently corrupts the books, and
an unmatched item costs a controller a minute. Those two failures are not commensurable and
the scoreboard never nets them against each other.

## Conventions worth knowing before you write code

Read `AGENTS.md` first. This is Next.js 16 and the App Router has breaking changes from what
most references assume; the guides in `node_modules/next/dist/docs/` are the current source.

Beyond that, four rules shape most of the codebase:

- **Nothing mutates the model directly.** Every change is a typed command that carries its
  own inverse, which is why undo and the audit trail are one mechanism rather than two
  features. If you find yourself writing an UPDATE, you are in the wrong layer.
- **Formulas reference variable IDs, never cell coordinates or names.** Renaming a variable
  must not break sixty formulas.
- **AI output is a proposal, not a write.** An agent run produces a `PROPOSED` ChangeSet that
  a human accepts. In the deep-agent path the graph halts before the write tool runs at all.
- **No model touches arithmetic that code can check.** The reconciliation matcher is
  deterministic by design. Where a model does make a judgement call, a plain TypeScript gate
  recomputes its stated arithmetic against the real records before anything is trusted.

## Dependencies

Adding one is a decision, not a convenience. There is no component library and no chart
library here — `components/ui` owns its own primitives and every chart is hand-drawn SVG,
because every dependency added is one more thing that has to agree with the design. If a new
package is genuinely the right call, say why in the commit message.

## Commits

One coherent change per commit, and a subject line that says what changed rather than which
files moved. The existing history is a reasonable guide — `git log --oneline` reads as a
list of things that happened, not a list of file names.

If you are committing work that someone else wrote, set them as the author rather than
crediting them in the body. `COMMIT-AUTHORS.md` (local, untracked) has the exact commands.

## Diagrams

The architecture diagrams are generated from scripts in `assets/diagrams/`, not exported
from a design tool. If you change a service or a number, edit the script and re-run it —
see that folder's README.
