# Magpie — Modelling Plan

> **Status (2026-09-02): M0 through M3 are built.**
>
> The model lives in Postgres, `/models/[slug]` renders it, edits and formulas are
> written back through commands, the formula language is complete, and every change is
> recorded with its inverse, its actor and its time. What exists:
>
> | File | What it is |
> |---|---|
> | `lib/model/types.ts` | The schema below, as TypeScript, field for field |
> | `lib/model/primitives.ts` | Arity, parameter names and help for every function — §3 |
> | `lib/model/formula.ts` | AST builders, precedence- and associativity-aware printer, dependency walk |
> | `lib/model/parse.ts` | Text → AST, defined as the printer's inverse — M2.1 |
> | `lib/model/validate.ts` | The gate before a write: names, arity, members, cycles — M2.3 |
> | `lib/model/engine.ts` | The evaluator — §3 |
> | `lib/model/grain.ts` | Month → quarter → year rollup — §1.2 |
> | `lib/model/commands.ts` | The command bus, in memory — §1.3 |
> | `lib/model/commands-db.ts` | The same commands, applied to Postgres — M1.1 |
> | `lib/model/changesets.ts` | The command stream: the log, the undo stack, rollback — M3 |
> | `lib/model/persist.ts` | `writeModel` / `readModel`; the one place a `Decimal` becomes a number |
> | `prisma/seed-data.ts` | The demo model, in the shape M0's query returns |
> | `components/modelling/*` | Grid, toolbar, menu, row flattening, formula editor |
> | `scripts/calc-check.ts` | `bun run calc:check` — aggregation, parser round-trip, validation, golden file |
> | `scripts/history-check.ts` | `bun run history:check` — inverses, the undo stack, rollback |
>
> **M4 is the next thing to build.** Scenarios exist as overlay rows and as a dropdown, but
> nothing can create, branch or edit one, and there is no comparison view.
>
> This file replaces `modelling/main.md` and `modelling/brief.md`. Phase M in
> `learning/path.ts` tracks which tasks Akshay has built and reviewed.

---

## 0. What we are actually building

Strip away the marketing and the modelling module is four things stacked:

1. A **typed variable grid** — rows are variables, columns are periods, cells are numbers.
2. A **calculation engine** — a dependency graph over those variables, evaluated per scenario.
3. A **command layer** — every mutation (human or agent) is a named, reversible command
   written to an audit log.
4. An **agent surface** — an LLM that emits commands into that same layer, staged as
   reviewable proposals.

The product promise, from the original brief: *bring live data, AI forecasting and
collaboration into one modelling workspace, so a team spends less time fixing spreadsheets
and more time shaping the plan.* Six use cases were named, and every one of them is the
same four things above with a different variable library:

| # | Use case | What the template holds |
|---|---|---|
| 01 | **ARR planning** | Recurring revenue, churn, expansion, growth scenarios |
| 02 | **Cash flow forecasting** | Revenue timing, expenses, collections → true liquidity |
| 03 | **Headcount planning** | Hiring by function, level and location, with cost and start dates |
| 04 | **Capacity planning** | Operational + financial data, utilisation, when to add resource |
| 05 | **Runway forecasting** | Runway under growth and spend cases; the date of the next raise |
| 06 | **Expense management** | Spend by team and vendor, overspend flags, cost-saving what-ifs |

**Do not build six features. Build one engine and six templates.** The first template
(ARR planning) is `lib/model/revenue-model.ts` and already exists.

The six product claims in the brief map onto the phases below, not onto separate systems:
always-on sync → M7 · prebuilt metrics → M7 · multi-dimensional modelling → §1.6, built ·
scenarios and AI forecasting → M4 + M5 · agents that build with you → M5 · comments,
approvals, version history → M3 + M6.

---

## 1. Decisions already made

These are expensive to reverse, so they are not re-litigated per task. Code comments cite
these section numbers.

### 1.1 Formulas are ASTs with ID references, never strings

The grid shows `$ Opening ARR + New ARR – Churn ARR`. That is a *rendering*. What we
persist is a tree whose leaves hold `variableId`s, printed to a string at display time by
`printFormula`.

*Why:* renaming "Revenue" to "Net Revenue" must not break sixty formulas, and we need the
dependency graph anyway — parsing 200 formula strings on every recalculation is wasted
work. *Cost:* we own a parser and a printer. Both are built, and the parser is defined as
the printer's exact inverse — see M2.1 for why that is the whole design and not a detail.

### 1.2 Aggregation belongs to the variable, not the chart

`Opening ARR` for a quarter is the **first** month's value, `Closing ARR` the **last**,
`New ARR` the **sum**, a rate an **average**. Every variable carries
`aggregation: SUM | FIRST | LAST | AVG | NONE`, and the grain switch is a pure rollup that
reads it (`lib/model/grain.ts`).

Get this wrong and every quarterly and yearly view is silently, plausibly incorrect —
nothing crashes, the number is just three times too big. It is the single highest-risk
piece of correctness in the module, which is why `bun run calc:check` asserts it.

**Monthly is the storage grain in v1.** Daily is a later, expensive change.

### 1.3 One command bus for humans and agents

A user typing in a cell and an agent calling `setFormula` go through the same typed list:

```
CreateVariable · RenameVariable · SetFormula · SetInputValues · SetAggregation
MoveVariable · GroupVariables · CreateDimension · SetDimensionMapping
CreateScenario · SetScenarioOverride · LinkDataSource · DeleteVariable
```

Each command returns its own inverse. Undo is replaying the inverse; the audit log *is*
the command stream; a version is a snapshot plus the commands since it.

*Why this matters more than it looks:* AI editing, undo, audit, real-time collaboration
and rollback become **one mechanism instead of five**. The brief asks for all five.
Building them separately is how this project dies.

### 1.4 AI changes are proposals, not writes

An agent run produces a `ChangeSet` of commands with status `PROPOSED`. The grid renders
proposed values as a ghost overlay beside current ones; accepting applies the commands,
rejecting drops them. Nothing an LLM does mutates a model directly. One wrong accepted
changeset costs more trust than ten good ones earn.

### 1.5 Normalised inputs, materialised outputs

- **Inputs and overrides** are rows — small, edited constantly, need row-level audit.
- **Computed series** are a cached JSONB array per `(variable, scenario, dimensionKey)`,
  invalidated by dependency, never trusted while `staleAt` is set.

*Why:* a cell-per-row table for computed values is ~200 variables × 60 periods × 8
dimension members × 5 scenarios ≈ 480k rows per model, rewritten on every edit. JSONB
series turn a recalculation into a few hundred row updates instead of half a million.

### 1.6 Dimensions are a property of a variable

`New ARR by Subscription Plan` is one variable, dimensioned, expanding to one child series
per member plus a rolled-up parent. Two separate questions, two separate fields:
`aggregation` collapses across **time**, `memberRollup` collapses across **members**. ACV
averages across plans but holds its level across time; inferring one from the other is how
a rate gets summed into nonsense.

Inside a member context, a reference to a dimensioned variable follows the member and a
reference to an undimensioned one reads the total. That single rule is what makes
`New ARR · Growth = New Accounts · Growth × ACV · Growth` while `Churn ARR · Growth` still
reads the one churn rate.

---

## 2. Data model

```
Organisation ─┬─ User (via Membership, role: OWNER|ADMIN|EDITOR|VIEWER)
              ├─ DataSource        (ERP / CRM / billing / HRIS connection + sync state)
              ├─ Dimension ── DimensionMember
              └─ Model ─┬─ ModelVersion   (snapshot + label + createdBy)
                        ├─ VariableGroup  (the pastel chip rows: "ARR & Summary")
                        ├─ Variable ─┬─ FormulaNode (AST, self-referencing tree)
                        │            ├─ VariableInput   (period → value, per member)
                        │            └─ VariableSeries  (cached JSONB output per scenario)
                        ├─ Scenario ── ScenarioOverride (variableId → formula|values)
                        ├─ ChangeSet ── Command         (typed, with inverse, ordered)
                        ├─ Comment    (anchored to variable + period)
                        └─ AgentRun   (prompt, thinking, tool calls, resulting ChangeSet)
```

Fields worth fixing now, because they are cheap today and a migration over every row
later:

- `Variable.kind`: `INPUT | FORMULA | LINKED` — where the numbers come from. Not the same
  axis as format: `$ # %` in the grid are *format*. The screens conflate them; the model
  must not.
- `Variable.format`: `CURRENCY | COUNT | PERCENT | RATIO | DATE`.
- `Variable.aggregation` — §1.2. `Variable.memberRollup` — §1.6.
- `Variable.timeContext` — the violet chip ("Monthly") on a reference.
- `Model.baseGrain`: `MONTH` in v1. `Model.horizonStart` / `horizonEnd` derive the columns.
- `Scenario.parentId`: scenarios branch from scenarios; the base case is `parentId: null`.
- `ScenarioOverride.value` is `jsonb`, so an override can later hold a distribution
  (Monte Carlo) instead of values without a migration.

Postgres specifics: `numeric(20,6)` for money — **never float**; `jsonb` + GIN for series;
unique on `(modelId, lower(name))` so a formula referencing "Revenue" can only mean one
variable.

---

## 3. The calculation engine

**Shape:** pure TypeScript, no DB access, in `lib/model`. Input is a plain `Model`; output
is a series lookup. Testable without a database, and it runs on the client today.

**Pipeline:** resolve scenario overrides onto the base variables → evaluate → aggregate to
the requested grain via §1.2.

**Evaluation is cell-level and memoised**, which is a deliberate deviation from the
obvious design of "topologically sort the variables and evaluate whole series". At the
variable level an ARR waterfall is a cycle:

```
Opening ARR[t] = Closing ARR[t-1]
Closing ARR[t] = Opening ARR[t] + New – Churn + Expansion
```

A topological sort rejects that. At the cell level it is not a cycle at all —
`Opening ARR[3]` depends on `Closing ARR[2]`, never on itself — so memoising
`(variable, member, period)` makes the lag fall out for free, and re-entering the same key
is then an honest circular reference, reported by name. The cost is a call per cell
(~2,400 for the demo model, sub-millisecond). When models outgrow that, vectorise the
acyclic majority and keep this path for lagged cycles.

**Formula language**, deliberately small — roughly 25 primitives, and every one added is
one an agent can get wrong and a user must learn:

- Operators `+ - * / ^`, comparison, `IF`.
- References `[variableId]`, optionally sliced `[v] BY [dimension] = member`.
- Time: `PRIOR(x, n, fallback)`, `NEXT`, `YTD`, `CUMULATIVE`, `OPENING`, `CLOSING`,
  `GROWTH`, `SPREAD`.
- Aggregators over a dimension, spelled `MEMBER_SUM MEMBER_AVG MEMBER_MIN MEMBER_MAX
  MEMBER_COUNT` — not a reuse of `MIN`/`MAX`, which collapse several values in one cell
  rather than several members. §1.6 keeps those two axes apart everywhere else. They take
  no dimension argument: a variable has exactly one, so naming it again would only create
  a way to name the wrong one.

All of it is built. `lib/model/primitives.ts` is the one table the tokeniser, the
validator, the editor's autocomplete and the agent's tool schema all read, so adding a
primitive is one entry plus one `case` in the evaluator — and not adding one is visibly a
decision rather than an omission.

---

## 4. Scenarios and comparison

A scenario is **an overlay, not a copy.** `ScenarioOverride` rows replace a variable's
formula or values; everything unoverridden falls through to the base case.

*Why:* copying a model per scenario means a fix to the base case has to be applied five
times, and "what actually differs between base and downside?" stops being answerable. With
overlays it is a `SELECT`. Comparison evaluates two scenarios and diffs the series.

AI forecasting (best / base / worst) is then just an agent generating three overlays.

---

## 5. The agent surface

Tools map 1:1 onto §1.3's commands, plus reads: `getModelOutline`, `getVariable`,
`getSeries`, `searchDataSources`, `runScenario`.

Run loop: prompt + model outline (outline plus targeted reads, never the full data — it
keeps context small) → tool calls → a `ChangeSet` in `PROPOSED` → rendered as the diff bar.

Grounding: the agent may only reference variables that exist or that it creates in the
same changeset, and every formula AST is validated and cycle-checked *before* the user
sees it. A proposal that does not compile never reaches the UI.

Tool schemas are generated from the same Zod schemas that validate commands from the UI,
so there is exactly one definition of a valid mutation.

---

## 6. Data sources

- `DataSource` (kind, credentials ref, cursor, lastSyncedAt, status).
- `LINKED` variables carry a `sourceQuery` (source + entity + measure + grouping).
- Sync writes to staging, materialises into `VariableSeries`, invalidates dependents, and
  **writes commands to the audit log** — a number changing under a user's feet has to be
  explainable. That is the actual reason finance teams distrust these tools.

CSV upload is the honest v1 connector and covers demos.

---

## 7. Tasks

Sub-tasks are sized to be finished in one sitting. Each names what to do, what proves it
is done, and the decision it must not break.

### M0 — Persistence

*Goal: delete nothing from the UI and change where the model comes from.*

*Built.* `bun run seed` writes the model to Postgres, `/workspace` queries it, and
`lib/model/revenue-model.ts` is gone — it now lives at `prisma/seed-data.ts`, where nothing in
`app/` or `lib/` can import it. `bun run calc:check` runs against the seeded model, so the
golden assertions validate round-tripped data rather than the function that produced it.

**The seed proves the swap before making it.** It writes, reads back, and compares field for
field — every formula tree, all 264 input cells, every scenario overlay. M0's promise is
*change where the model comes from and nothing else*, and the only way to know that is to show
the database returns the identical object. It found two real problems on its first two runs:

- **The fixture was not storable.** Its shaping functions authored a churn rate of
  `0.010145423274166877` — spurious precision twice over, since nobody types eighteen decimal
  places and `numeric(20,6)` cannot hold them. A fixture the database cannot represent is a
  fixture that was lying about what the product does. Rounded at the authoring end, not at the
  write end: rounding on write would have hidden it.
- **The comparison itself was wrong.** It compared `JSON.stringify` output, so identical
  objects with different key order reported as different. A check that cries wolf gets
  ignored; it sorts keys now.

**`DATE` is deliberately not in the `NumberFormat` enum**, though §2 lists it. Nothing renders
one and `formatValue`'s switch is exhaustive, so a `DATE` row would load fine and render as
nothing. The database must not be able to express a state the engine cannot honour — that
correspondence *is* M0. It goes in the day the renderer handles it.

**Two conversions happen at one edge.** `lib/model/persist.ts` turns `Decimal` into `number`
on the way out and holds `numeric(20,6)` on the way in, so no component ever meets a Decimal
and no float ever reaches a column — the two failure modes §2 guards against, pointing in
opposite directions.

*Not built:* `ModelVersion` snapshots and the `ChangeSet`/`Command` tables, which belong to
M3 where there is something to write to them.

**M0.1 — Model, group and variable tables**
- Add `Model`, `VariableGroup`, `Variable` to `prisma/schema.prisma`, with the fields in
  §2 — including `dimensionId`, `memberRollup` and `timeContext`, which the built UI
  already uses.
- `organisationId` is nullable **only** until A3 lands the org tables; the column costs
  nothing now and avoids a migration touching every row later.
- *Done when:* `bun run db:migrate` applies and `prisma studio` shows the tables.
- *Respect:* §2's `numeric(20,6)`, and unique on `(modelId, lower(name))`.

**M0.2 — Dimension and DimensionMember tables**
- `Dimension(id, organisationId?, name)` and `DimensionMember(id, dimensionId, key, name,
  order)`; `Variable.dimensionId` points at one.
- *Done when:* Subscription Plan with Starter / Growth / Enterprise exists in the DB.
- *Respect:* §1.6 — the parent is a rollup, never a stored total.

**M0.3 — FormulaNode tree**
- Self-referencing `FormulaNode(id, variableId, parentId, type, op?, literal?,
  refVariableId?, refMember?, fn?, order)`. M0 stores trees; the parser that produces them
  from text is M2.
- *Done when:* `Closing ARR`'s formula round-trips DB → `FormulaNode` → `printFormula`
  and prints the same string the grid shows today.
- *Respect:* §1.1 — no string column, not even "for debugging".

**M0.4 — Inputs, series and scenarios**
- `VariableInput(id, variableId, dimensionKey, period Date, value numeric(20,6))` — note
  `dimensionKey`: the sketch in the old plan had no member column, and without it a
  dimensioned input like `New Accounts by plan` cannot be stored at all.
- `VariableSeries(id, variableId, scenarioId?, dimensionKey, values jsonb, staleAt?)` and
  `Scenario(id, modelId, name, parentId?, isBase)` + `ScenarioOverride(id, scenarioId,
  variableId, value jsonb)`.
- *Done when:* the three scenarios in `revenue-model.ts` exist as overlay rows.
- *Respect:* §1.5 — series are a cache; a stale row is recomputed, never trusted.

**M0.5 — Seed and swap**
- `bun run seed` upserts the Revenue Model 2026 on its natural key (running it twice
  leaves the same rows, not duplicates), then `app/(app)/workspace/page.tsx` loads the
  model with a query and `lib/model/revenue-model.ts` is deleted.
- *Done when:* the page renders identically with the fixture gone — which is the test that
  the fixture was honest — and `bun run calc:check` runs against the seeded model.
- *Respect:* the API converts `Decimal` to number **once, at the edge**; the UI never sees
  a float creeping in.

**M0.6 — A golden-file test for precision**
- Assert a seeded series round-trips through JSONB with full `numeric` precision.
- *Done when:* the test fails if anyone swaps a column to `float`.
- *Built:* the seed writes `12345678.901234` into an input, reads it back, and fails unless it
  survives exactly.

### M1 — The grid on live data

*The grid itself is built. This phase is what the DB makes newly possible.*

*M1 is built.* An edited cell survives a reload. The grid
applies the command locally and a server action persists it, so typing stays at keyboard speed
across the round trip — and the local apply is not a cache of the server's answer, it is the
same `applyCommand` the server runs.

**The authorisation check is in the action, not only in the page.** A server function is an
HTTP endpoint that happens to be written as a function, so a check upstream protects the page
and nothing else. Every command additionally verifies the variable belongs to the model in the
URL: a well-formed command naming someone else's variable is legal by schema and wrong by
authorisation, and validation cannot tell them apart.

**Writes are serialised**, because commands do not commute — renaming a variable and then
setting one of its inputs must reach Postgres in that order.

**A failure does not dispatch `undo`,** which was the first version and was wrong. `undo` pops
the most recent edit, so a slow write failing after the user had typed into a second cell would
revert the wrong one; applying the failed command's own inverse is no better, since a later
edit may have overwritten the same cell. There is no correct surgical rollback without conflict
resolution the model does not have, so the screen says it is ahead of the database and offers
the operation that is certainly correct: read it again.

**M1.3 — both axes are virtualised**, done at 22 rows and 24 columns precisely because nothing
was slow yet. At the plan's target of 200 × 60 the grid now renders **36 rows by 18 columns**,
about 5% of the cells.

Hand-rolled rather than a library, for one reason: both axes are a *fixed* size — `rowHeight`
is 26 or 30, a period column is 108 — so the first and last visible index are arithmetic, not
measurement. A virtualiser that measures elements would solve a problem this grid does not
have and fight the sticky header and first column while doing it. Skipped rows and columns
become spacers of exactly the right size, so scroll position, scrollbar length and the sticky
offsets are unchanged, and nothing outside the grid knows it is windowed.

Two things it broke, both fixed:

- **The cell index.** Slicing the bucket array makes the map index local, and selection,
  editing and keyboard movement all address columns absolutely. Without re-adding the offset
  every one of them would silently point at the wrong period the moment the grid scrolled.
- **Scrolling the selection into view.** That was `querySelector('[data-selected="true"]')`,
  which works only while every cell is in the DOM. A cell outside the window has no node, so
  the view would not follow the selection — and because it did not follow, the cell was never
  rendered. Arrow-keying past the fold would have looked like a frozen grid. The position is
  computed now, which is better anyway: it accounts for the sticky header and first column
  occluding the cell, which `block: "nearest"` does not.

Checked over all 12,000 cells of a 200 × 60 grid: every selection lands inside the rendered
window from any starting scroll position, the spacers reconstruct the full height at every
offset, and the window stays bounded.

**M1.1 — Server actions for edits** — an edited cell writes through a command (§1.3) in a
server action, not client state. *Done when:* a reload keeps the edit.
**M1.2 — Optimistic updates** — the grid applies locally and reconciles, so typing stays
at keyboard speed over a network round trip.
**M1.3 — Virtualise both axes** — 200 rows × 60 columns. `flattenRows` already produces
exactly the list a virtualiser needs. *Do it before the grid is worth virtualising*;
retrofitting it into a working grid is a rewrite.
**M1.4 — Multi-model routing** — `/models/[slug]`, a model list, and `requireMembership`
on every query the moment A3's org tables exist.

### M2 — The formula parser

*M2 is built.* Clicking a formula pill opens it as text; Enter parses it and saves the tree.

**The parser's grammar is not "a formula syntax" — it is defined as the exact inverse of
`printFormula`.** That constraint is the design, not a detail. The editor hands the user a
printed string and saves what comes back, so a formula opened and closed untouched has to
return the identical tree; anything less and the editor silently rewrites models nobody
edited. It therefore accepts every glyph the printer emits (`× – ÷ ≥ ·`) alongside the ASCII
a keyboard can produce, and nothing else — §3 sketches a `BY` clause, the printer has never
emitted one, and a second spelling is a second thing to keep in sync. `calc:check`
round-trips all 38 formulas in the seeded model and the primitive fixture through
print → parse → tree comparison.

That constraint found a real bug before the editor existed. `printFormula` rendered any
literal below 1 as a percentage to two decimal places, so a churn rate of
`0.010145423274166877` printed as `1.01%`. Harmless while the string was only ever
displayed; the moment it became editable, saving a formula nobody had touched would have
rewritten the rate. Percent notation is now used only where it is exactly reversible.

**Names, not identifiers.** `Opening ARR + New ARR` has spaces inside its operands, so no
lexical rule finds the boundary — the tokeniser knows the model and takes the longest
matching name. Which is also why names are matched *before* brackets, digits and operators:
a user may call a variable `Q1 (plan)` or `2026 Target`, and a tokeniser that lexes
punctuation first can never see those. A word-boundary guard is what stops that eating the
`MA` of `MAX(`.

**The cycle check had to be taught what the engine already knows.** The engine memoises
`(variable, member, period)` and calls only a repeat visit to the same key circular, which
is what makes `Opening ARR = PRIOR(Closing ARR)` legal — the central formula of every
waterfall in finance. A validator walking the variable graph rejects it. So an edge counts
only when it can read the *current* period: `PRIOR` and `NEXT` with a non-zero literal shift
are lagged; `YTD`, `CUMULATIVE`, `GROWTH`, `SPREAD`, `OPENING` and `CLOSING` are not, because
every one of those includes period `t` in its range. A computed shift counts as immediate —
rejecting a formula that might be circular is recoverable, accepting one that is means a
page of zeroes.

**M2.1 — Tokeniser and parser** — text → `FormulaNode`, precedence and associativity
matching the printer, names resolved to ids against the model. *Built.* There is no unary
node: `-5` folds to a literal and `-x` becomes `0 – x`, because the AST has four shapes and
a fifth costs a column in `formula_node` for a case that evaluates identically.
**M2.2 — The formula editor** — *built.* Autocomplete over variables and functions, the
function help coming from the same `primitives.ts` the parser reads, so the menu cannot
describe a language the parser does not accept. Inline errors on every keystroke, Save
unavailable until they clear, and an unchanged tree dispatches no command at all — otherwise
every open-and-close would write a row and push an undo step nobody asked for.
**M2.3 — Validation before write** — *built*, at the write path in `commands-db.ts` rather
than in the editor, because §5's agent posts a tree and never parses anything. The editor
runs the same function as a courtesy; the server runs it as the rule.
**M2.4 — The remaining primitives** — *built*: `IF`, the six comparison operators,
`OPENING`, `CLOSING`, `GROWTH`, `SPREAD`, and the five `MEMBER_*` aggregators. Pinned by
`scripts/golden/primitives.json` — a fifteen-period fixture spanning a year boundary with
one row per primitive, every value hand-checked. It regenerates only under
`--write-golden`: a harness that rewrites its own expectations on failure has recorded the
bug as the truth.

Two smaller decisions inside M2.4. Comparison yields 1 or 0 rather than a boolean, so a
cell is always a number and the grid never has to format a third kind of thing. And it
compares with an epsilon of half the last digit `numeric(20,6)` can store: exact `===` on
doubles lets a value be neither equal to, greater than, nor less than another, and an `IF`
built on that is unfixable from the user's side.

### M3 — The command bus, persisted

*M3 is built.* Every mutation lands as a `ChangeSet` of ordered `Command` rows, each stored
with the command that undoes it, an actor and a time.

**Undo was a bug before this, not a gap.** It only ever touched local state — an edit, an
undo and a reload brought the edit back, the screen and the database quietly disagreeing
with nothing to say so. Undo and redo are writes now, on the same serialised chain as an
edit, because an undo racing the edit it undoes would reach Postgres in the wrong order.

**The log is append-only.** Undo does not delete the changeset it undoes, it appends one
that says so. The log *is* the audit trail, and a trail you can delete from cannot answer
the question a finance team actually asks. Redo then falls out for free: the thing that was
undone is still there.

**The undo stack is reconstructed by replaying the log**, deliberately by the same walk the
client's reducer does — an `EDIT` pushes and clears the redo branch, an `UNDO` moves one
entry across, a `REDO` moves it back. Two implementations of one rule, so `history:check`
asserts they agree rather than trusting the comment saying they do.

**Validation guards intent, not state transitions.** M2.3's gate applies to a person typing
and to an agent proposing; it does *not* apply to a replay. `history:check` found the
conflict: deleting `Price` and then deleting `Sales`, whose formula reads `Price`, is
allowed — the engine reads a missing reference as zero and the client only warns — but
undoing the second delete restores a formula pointing at a variable that is currently gone,
and the gate refused it. An undo that can be refused is not an undo, and the state it was
refusing to restore was one the product had already permitted.

**M3.1 — Command table** — *built.* `ChangeSet` groups ordered `Command` rows; payloads are
`jsonb`, which is not a breach of §1.1. §1.1 governs the live model, where a rename must not
break sixty formulas; this is an immutable record of something that already happened, and it
must say what was done rather than follow a later rename.
The inverse is **computed on the server**, from small targeted reads, not sent by the client.
The client has one for its optimistic stack and it would be one field to send — but a stale
client could then write an inverse that does not invert, and the corruption surfaces only
when somebody presses undo. `history:check` failed on its first run and found the two
implementations already disagreeing about a missing member row: the in-memory one falls back
to the `TOTAL` series exactly as the engine's `inputAt` does, and the database one did not,
so an undo would have written a zero over a value the user could see.
**M3.2 — Server-side undo/redo** — *built.* The client generates the changeset id, so its
stack can name what it expects to undo without a round trip, and the server refuses if that
is not what is on top — optimistic concurrency rather than hoping the two stacks agree. It
also makes a retried request idempotent, since the id is the primary key.
**M3.3 — Version snapshots and rollback** — *built.* **The snapshot is the check, not the
mechanism.** Writing it back over the tables would be two lines and would leave a hole in
the log where nobody can see what changed. Rollback replays every changeset since the
version backwards and *then* compares against the snapshot; a disagreement means some
command was not honestly invertible, and the transaction is abandoned rather than landing
somewhere nobody named. This is where storing payloads on `UNDO` and `REDO` rows earns
itself — the replay is uniform over every kind. A rollback is not "undo the edits": an undo
changed the model as surely as an edit did.
**M3.4 — The history panel** — *built.* It reads the command stream itself, not a second log
written alongside the writes, which is the arrangement that eventually disagrees with them.
Restoring a version reloads the page rather than patching state: the grid's reducer and its
undo stack are both describing a model that no longer exists.

*Not built:* `ChangeSet.status`. §1.4's `PROPOSED` lifecycle needs the ghost overlay and the
accept/reject bar as much as it needs a column, and a status nothing maintains is worse than
no status. `origin` **is** there, because who caused a change cannot be reconstructed later.

### M4 — Scenarios and comparison

**M4.1 — Scenario CRUD** — create, branch from a scenario, rename, delete.
**M4.2 — Editing inside a scenario** — an edit writes a `ScenarioOverride`, and the grid
marks overridden cells so "what differs from base" is visible without a diff view.
**M4.3 — The compare view** — two scenarios side by side, or a delta column.
**M4.4 — AI forecast presets** — best / base / worst as three generated overlays.

### M5 — The agent

**M5.1 — Zod command schemas** → tool definitions, generated, one source of truth.
**M5.2 — The run loop** — Claude with tool calling, outline + targeted reads, streamed.
**M5.3 — Proposals** — a `ChangeSet` in `PROPOSED`, ghost values in the grid, the
`Accept all / Undo all / Compare` bar from `designs/proto-screen-3.jpg`.
**M5.4 — Persisted transcripts** — `AgentRun` holds prompt, thinking and tool calls, so a
refresh does not lose the run.
*Done when:* "what's my forecast at 30% growth?" produces a changeset a human accepts.
*Respect:* §1.4 — the agent never writes directly, and a proposal that does not compile is
never shown.

### M6 — Collaboration

**M6.1 — Comments** anchored to `(variable, period)` — the `MessageSquare` icon.
**M6.2 — Presence and live updates** — two browsers on one model stay consistent.
**M6.3 — Notifications and approvals** — a change can require a reviewer.
*Respect:* §1.3 — this is the command stream with a transport, not a second system.

### M7 — Sources and templates

**M7.1 — CSV import** into `LINKED` variables, the honest v1 connector.
**M7.2 — A real connector** (billing first — it is where ARR actually lives).
**M7.3 — Sync writes commands**, so a number that changes on its own is explainable.
**M7.4 — The six templates** from §0, as seedable variable libraries.
*Done when:* a new user picks "ARR Planning" and gets a working model.

---

## 8. Risks

- **Time aggregation** — the highest-probability source of silently wrong numbers. Golden
  files from day one; `calc:check` is the seed of that suite.
- **Grid performance** — virtualise both axes before it hurts (M1.3).
- **Formula scope creep** — every request will be "can it also do X". The answer is a
  template or a deliberate new primitive, never an ad-hoc one.
- **Agent trust** — §1.4's proposal model is the mitigation and is not optional.
- **Numeric precision** — `numeric` in Postgres, a decimal library in TS if we ever
  compound. Floats produce $0.01 discrepancies that finance users report as bugs,
  correctly.
