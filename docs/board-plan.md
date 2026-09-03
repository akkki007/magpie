# Magpie — Board Plan (Reporting)

> Status: **feature 1 built**, 3 Sep 2026. Written under the same 5 Sep deadline as
> `docs/database-plan.md`, with the finance-ops agent still to come after it.

**Intended work:** align executives, finance and teams around shared dashboards powered by
the same integrated data, plans and databases.

## 0. The one rule

**A board owns no numbers.** Every tile is a *reference plus a form* — a model variable or a
database rollup, plus how to draw it — and the figures resolve on every render.

This is the whole of "the same integrated data". A board that cached its own numbers would
become a fourth place a figure can come from, it would start disagreeing with the model the
first time someone edited a cell, and it would be the one people believed, because it is the
one on the wall. So `resolveTile` runs at read time and there is no column anywhere holding a
rendered value.

The corollary is that a board is cheap: it needed no data layer of its own, because
`docs/database-plan.md` §3 and the model engine already are one.

## 1. Feature 1 — Ask questions, get instant insight

*Use AI to query your boards in plain language, surface key drivers, and highlight anomalies
without building complex reports by hand.*

One input. The answer lands on the board **as a tile**, not in a transcript — that is the
whole distinction from a chat window, and the tile keeps the question that produced it, for
the same reason the change log keeps an actor: a figure on an executive board has to be able
to say where it came from.

### 1.1 `generateObject`, not a tool-calling loop

The modelling agent loops because it reads, reads again, then proposes. This reads nothing —
the entire catalogue of variables and table columns fits in one prompt — and produces exactly
one artefact. A loop would be machinery around a single structured answer.

### 1.2 The vendor's constraint does not get to reshape the type

`TileSpec` is a discriminated union, which is right for storage and for the grounding gate: a
chart cannot accidentally carry a `body`. But a union compiles to `oneOf`, and OpenAI's
structured outputs reject that at the root —

> Invalid schema for response_format 'response': In context=(), 'oneOf' is not permitted.

So the model fills a **flat draft** with every field nullable, and `fold` turns it back into
the union before anything else sees it. The accommodation is confined to `openai-board.ts`.

**This was found by the live half of `board:check`, not by a type.** A pure test cannot see
it, because the schema is perfectly valid — the provider just will not take it.

### 1.3 Grounding, with errors written to be corrected from

`lib/board/ask.ts` has no SDK import, the same boundary `agent-tools.ts` and
`recon/adjudicate.ts` draw. It rejects a tile that references a variable, table or column
that does not exist; a TEXT column used as a date axis; a SUM of something non-numeric; a KPI
carrying a breakdown (one card, one number — a breakdown would silently show the first
series); and **two different units on one axis**, which is the dual-axis chart under another
name. Every message names the thing that was wrong and lists what was available instead —
the lesson from the modelling agent's six identical failures against a generic rejection.

The last gate is that it has to actually resolve, and not to all zeroes.

### 1.4 The model picks the form, including "not a chart"

A question with a single-number answer gets a KPI tile, not a bar chart with one bar.
Verified live: *"How many customers do we have?"* → `kpi`; *"customers onboarded each month,
broken down by status"* → `chart`.

## 2. Charts

Drawn to the `dataviz` mark specs rather than to whatever looked fine: bars cap at 24px with
the band's leftover left as air; a 4px rounded data-end and a square baseline (in a stack,
only the topmost segment); a 2px **surface-colour gap** separating touching marks, never a
stroke; solid hairline gridlines; a legend whenever there are two or more series; a hover
tooltip reading the whole column; and a **table view** on every chart.

Two deliberate departures from `designs/board-1.jpg`, both stated rather than smuggled:

- **Gridlines are solid, not dashed.** Dashes are more ink for the same information.
- **No dual-axis chart.** The mock's "Enterprise Expansion ARR by Source" carries two
  y-scales. It is the most common charting mistake there is: the two scales are chosen by
  the author, so any relationship the reader sees was authored too. Two measures of
  different scale get two tiles.

### 2.1 The palette finding

The repo's viz ramp was run through the method's validator
(`node scripts/validate_palette.js` in the `dataviz` skill) against a white surface:

```
[PASS] CVD separation      worst adjacent ΔE 16.3 (protan) · tritan 12.3
[PASS] Normal-vision floor worst adjacent ΔE 16.3
[FAIL] Lightness band      #cce5cf (0.897), #76d8bf (0.815) sit outside the band
[FAIL] Chroma floor        #cce5cf, #396799, #4aa1a8 read gray
[WARN] Contrast vs surface #3db6ad 2.4:1 · #cce5cf 1.3:1 · #76d8bf 1.7:1 · #4aa1a8 2.9:1
```

**The two accessibility gates pass** — colourblind readers can separate adjacent series, and
so can everyone else. The failures are the ramp being a *ramp*: `docs/design-system.md`
says outright that series "separate by value as much as by hue", which is what puts two steps
outside the lightness band. That is the design's identity, sampled from the prototypes, and
not something to change unilaterally.

The contrast WARN is the one that is **not dismissable** — it obliges visible labels or a
table view. Both shipped: a legend at every multi-series chart, values in the tooltip, and a
table toggle on every chart. Worth revisiting deliberately if the ramp is ever reopened.

## 3. Built / not built

**Built:** `Board` + `BoardTile`, tile specs parsed on read (a tile from an older build is
reported, not crashed on), chart / KPI / text tiles, the ask composer with starter chips,
tile removal, `/boards` and `/boards/[slug]`, `bun run board:check` (16 pure assertions,
22 with `--live`).

**Not built:** the KPI strip and prose summary from the mock as *authored* tiles (the tile
kinds exist; nothing arranges them into that layout yet) · tile reordering and resizing ·
per-tile date-range and filter controls · a board naming its own model (one board, one model,
`MODEL_SLUG` in the page) · anomaly and driver callouts, which is the second half of feature
1's description and wants the tile to be able to say *why* a number moved.
