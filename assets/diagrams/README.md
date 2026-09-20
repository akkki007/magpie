# Diagrams

The diagrams in the README, the write-up and the pitch deck are generated, not drawn. Each
one is a small Node script that builds an SVG string and renders it through `sharp`, which
is already in `node_modules` as a Next.js dependency.

Generated, rather than exported from a design tool, for one reason: when a number or a
service name changes, the fix is an edit and a re-run. A PNG exported from Figma goes stale
silently, and the version in the README is the one everybody quotes.

| File | Output | What it shows |
|---|---|---|
| `flow.js` | `magpie-flow.png` (1400×780) | The reconciliation pipeline end to end — upload, ingest, the rule matcher, escalation, and every AWS service that touches it |
| `card.js` | `magpie-card.png` (1200×630) | The headline card: the batch size, the four scoreboard numbers, and the request path |

## Regenerating

```bash
node assets/diagrams/flow.js
node assets/diagrams/card.js
```

Each script writes its `.svg` next to itself as an intermediate. Those are gitignored — the
PNG is the artefact, the script is the source.

## Editing

Both scripts keep their geometry in named constants at the top of the layout section
(`b1`–`b4` for column positions, `r1y`/`r2y` for the two rows, `gb[]` for the right-hand
column). Move a box by changing a number there rather than by hunting through the path
strings, because the connectors are computed from those same constants and will follow.

Two conventions worth keeping:

- **The black box is the claim.** In `flow.js` the rule matcher is the only filled box,
  because "no model touches the arithmetic" is the thing the diagram exists to argue. If
  something else becomes the point, move the fill — do not add a second one.
- **Struck-through text is what does not continue.** The `5 malformed rows` label sits above
  the arrow into the matcher with a line through it. Anything rejected mid-pipeline should
  be drawn the same way.

## Numbers

Every figure in these diagrams comes from a real `bun run recon:eval` run, not from an
estimate. If you change a number here, run it first and use what it prints.
