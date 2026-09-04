# Magpie — Board Plan (Reporting)

> Status: **features 1 and 2 built** — feature 1 on 3 Sep 2026, feature 2 on 4 Sep. Written
> under the same 5 Sep deadline as `docs/database-plan.md`, with the finance-ops agent still
> to come after it.

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

**Re-verified 4 Sep, and it had rotted.** The first question was failing **two live runs in
three**, all three retries exhausted, on `"A database source needs tableSlug, dateFieldId and
aggregation."` The model was answering with a COUNT over `customers` and a null
`dateFieldId` — a fair reading of a question with no date in it — and the rejection told it
neither which of the three fields was missing nor why a KPI needs a date column. It was the
one message in the module that broke §1.3's own rule: name what was wrong, and list what was
available instead. The prompt was contradicting itself too, telling the model to null "the
ones that do not apply" without ever saying that a database source's date field always
applies.

Both fixed — the message now names the missing fields and gives the reason, and the prompt
states the exception. Three runs in three now succeed, and on the *right* tile: a COUNT over
`customers` bucketed by its DATE column. The run that passed before the fix had quietly
answered with `v_opening_accounts`, an opening balance rather than a customer count, which
the assertion missed because it only checks the tile's **kind**. Worth knowing when reading
that assertion: it proves the form was chosen well, not that the figure is the right one.

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
tile removal, `/boards` and `/boards/[slug]`, driver and anomaly callouts on every chart tile
(§4), `bun run board:check` (47 pure assertions, 53 with `--live`).

**Not built:** the KPI strip and prose summary from the mock as *authored* tiles (the tile
kinds exist; nothing arranges them into that layout yet) · tile reordering and resizing ·
per-tile date-range and filter controls · a board naming its own model (one board, one model,
`MODEL_SLUG` in the page).

Driver and anomaly callouts moved from this list to §4 on 4 Sep.

## 4. Feature 2 — Drivers and anomalies

*The second half of feature 1's own description — "surface key drivers, and highlight
anomalies" — which §3 listed as unbuilt. It wants a tile to be able to say **why** a number
moved.*

### 4.0 The governing decision: arithmetic, not generation

An LLM asked why a figure moved will answer fluently whether or not it has the numbers, and a
board is the last place that belongs — the whole point of a tile is that it resolves from the
same data everyone else is looking at. So the AI's job stays exactly what feature 1 made it,
**choosing what to look at**, and every figure in the callout strip is computed from the
resolved series in `lib/board/insight.ts`. Nothing in that file can say a category drove a
change unless that category's numbers say so.

Like `resolveTile`, `insight` is computed **on every read and stored nowhere** (§0). There is
no flag on the spec either, so every tile that already exists gained this without being
rewritten, and a tile with nothing to say renders nothing. Silence is a real answer: a strip
that always says something ends up saying nothing.

### 4.1 Three driver bases, because "what drove it" is three different questions

- **`flows`** — a balance and the flows that moved it, summed across the window. Detected by
  spotting the carry-forward term: `Opening ARR` is `PRIOR(Closing ARR)`.

  This one is the reason the feature is not a one-liner. Decomposed end to end, `Closing ARR`
  reports **"Opening ARR drove 96%"** of two years of growth — arithmetically exact and
  entirely vacuous, since it says the balance was already there. Because
  `Closing(t) − Closing(t−1)` *is* the flows in period `t`, the flows summed over the window
  equal the change in the balance **exactly**. On the seeded model: New ARR +32,948,456 /
  Expansion +8,711,004 / Churn −5,889,099, summing to the change to the last cent. That is
  the ARR bridge a finance team expects.
- **`parts`** — the chart's own series.
- **`formula`** — the additive terms of a variable's formula, end to end.

`linearParts()` accepts only `+`/`−` of references. `Opening × Churn Rate` cannot be split
without choosing where to put the cross term, so it returns `null` and the tile says nothing
about drivers rather than guessing. Of the seeded model, only `v_closing_arr`,
`v_net_new_arr` and `v_closing_accounts` decompose; everything else is a product or a ratio
and correctly says nothing.

### 4.2 Two guards that came from running it on real data

- **Halves, not single periods.** A records breakdown is a count *per period*, so comparing
  Jan '26 with Dec '27 alone compares two samples of about six. The seeded customers table
  gave a total change of 2 against parts of +4/−3/+1. The second half of the window is now
  compared with the first (middle period dropped when the count is odd, so the halves are
  equal length): 67 → 90, +23, with shares that mean something.
- **`SHARE_FLOOR = 0.5`.** A share is printed only where the net movement is at least half
  the gross movement underneath it. Below that the tile shows amounts and says nothing about
  proportions — which is the true statement: the parts moved a great deal and the total
  barely did. It started at `0.2` and **the assertion caught that as too permissive**: a net
  of 2 against a gross of 8 still printed 200%. Checked against the tiles it must keep
  working for — ARR bridge nets 0.72 of gross, accounts bridge 0.77, onboarding breakdown
  1.0 — so the line sits well clear of all three.

### 4.3 Anomalies, and the two bugs found in them

"Which periods moved unlike the months before them", as a modified z-score (Iglewicz &
Hoaglin) on **detrended** period-over-period changes. Detrending matters and is measured, not
assumed: scoring raw changes calls five months of the seeded `New ARR` unusual, and
detrending calls none. MAD rather than standard deviation, because the outlier being looked
for would itself inflate a standard deviation and hide underneath it.

Two defects were found here, both by probing shapes rather than by reasoning about the code,
and both now carry assertions — the first shipped precisely *because* it had none.

**A lone spike in a flat series was silent.** `[10,…,10,60,10,…,10]` returned nothing, which
is the single most obvious thing the feature exists to catch. Not a threshold to tune: the
residuals are `[0,…,0,50,−50,0,…,0]`, so more than half of them are identical, MAD is exactly
zero, and a guard written for "a perfectly regular series, where nothing is unusual" was
swallowing the most irregular series there is. This is the classic MAD degeneracy, and it
bites hardest exactly where the feature is most useful. Fixed with the documented fallback —
where MAD is zero, score against `1.2533 × MeanAD`, which only reaches zero when the
residuals genuinely are identical. (The constant is not the MAD constant; using `0.6745` on a
mean-deviation denominator makes the fallback quietly less sensitive than the statistic it
stands in for.)

**The last period of every growth series was flagged.** Fixing the first bug exposed this
one. The neighbourhood used to look two periods *either side* — which reads better, "unlike
the months around it" — and has no "after" at the end of the window. On a series that curves
upward, the truncated median sits below the final change by construction, so the last
residual is large for a reason that has nothing to do with the business. Mixing those biased
edge residuals with unbiased interior ones put **"Dec '27 was unusual" on four of the seeded
model's headline series** — Closing ARR, Closing Accounts, Revenue and Expansion ARR — and,
once the mean-deviation fallback above was in place to make those residuals scoreable at all,
seven separate callouts on ARPA. Every residual is now built the same way, against a trailing
window of `LOOKBACK = 4` changes, and all of them went quiet.

The price is stated rather than hidden: the **first four changes cannot be scored**, because
a period has to have a past to be unlike. A spike in the opening months of a window is
missed. That is the honest version of what a backward-looking comparison measures, and the
most recent period — the one a reader actually cares about — is still reachable, which the
two-sided window only appeared to manage.

**A known limit, asserted so it stays known.** Detrending against a local *level* handles
linear, quadratic, cubic and 20%-a-month growth without a false positive. It does **not**
handle doubling every month: with each change twice the last, the trailing median is four
times smaller than the change it is judging, so the tail is flagged. No real finance series
sustains that, and the alternative — detrending in log space — would break every series that
legitimately crosses zero. `board:check` asserts the doubling series still flags, so this
stays a documented limit rather than becoming a surprise.

Constants, all in `lib/board/insight.ts`: `MIN_SCORED = 6` · `THRESHOLD = 3.5` ·
`LOOKBACK = 4` · `SHARE_FLOOR = 0.5`. `LOOKBACK` was measured too — 3 behaves identically on
every fixture, 5 and 6 start missing a single spike.

### 4.4 How it is drawn

- Anomalies mark the chart as a **hollow ring above the column plus an emphasised axis
  label**, never a recoloured bar. Colour is already carrying series identity, and a mark
  that exists only as a hue dies in greyscale — the same reasoning behind §2.1's obligation
  to label. The axis-label thinning never thins away a flagged period.
- The callout strip names the period in words, so nothing depends on spotting the ring.
- The strip states **what was compared** — "The second half of Jan '26 – Dec '27 against the
  first" — because "up 23" means one thing against last month and another against last year,
  and a driver strip that does not say which is one you have to take on trust.

### 4.5 Checks

`bun run board:check` is **47 pure assertions**, up from 16. The driver figures are
hand-computed rather than shape-checked: the point of the feature is that the numbers are
arithmetic rather than an opinion, and an assertion that only checks the shape of an opinion
is no assertion at all.

Mutation-tested, per repo convention — each of the three claims above fails the suite when
its implementation is removed:

| Mutation | Caught by |
|---|---|
| `carriedForward()` always false | 3 failures — the ARR bridge collapses back to "Opening drove 96%" |
| Detrending removed (score raw changes) | "ordinary noise around a flat level is not an anomaly" |
| Neighbourhood two-sided again | 5 failures, including all three real Dec '27 series |
| Mean-deviation fallback removed | 8 failures — every spike fixture goes silent |

The detrending mutation is the one worth noting: it was **not** caught by the original `i * i`
fixture, whose changes rise linearly and therefore score the same either way. The
discriminating fixture was found by measuring raw against detrended across a table of shapes,
not by assuming which one would bite.
