# Magpie — Modelling Module

> Status (2026-08-30): **the shell is built, the engine is not.** Landing and auth are
> done; `/workspace` renders the dashboard from `designs/proto-screen-1.jpg` against
> fixtures in `lib/demo/dashboard.ts`. Nothing below §7's M0 exists yet — there is no
> `Model` table, no formula AST, and no evaluator. Phase M in `learning/path.ts` holds the
> live status per task. The original product brief is preserved verbatim in
> `modelling/brief.md`.

Bring live data, AI forecasting, and collaboration into a single modelling workspace so
your team spends less time fixing spreadsheets and more time shaping the plan.

---

## 0. What we are actually building

Strip away the marketing and the modelling module is four things stacked:

1. A **typed variable grid** — rows are variables, columns are periods, cells are numbers.
2. A **calculation engine** — a dependency DAG over those variables, evaluated per scenario.
3. A **command layer** — every mutation (from a human or an agent) is a named, reversible
   command written to an audit log.
4. An **agent surface** — an LLM that emits commands into that same layer, staged as
   reviewable proposals.

Everything in the brief (ARR planning, cash flow, headcount, runway, capacity, expense
management) is the *same* four things with different variable libraries. **Do not build six
features. Build one engine and six templates.**

---

## 1. Core architectural decisions

These are the calls I'd make, with the reasoning, because they're expensive to reverse.

### 1.1 Formulas are stored as ASTs with ID references, never as strings

The grid shows `$ Revenue – Cost of Goods Sold`. That is a *rendering*. What we persist is
a JSON AST whose leaves hold `variableId`s.

*Why:* renaming "Revenue" to "Net Revenue" must not break sixty formulas, and we need the
dependency graph anyway — parsing 200 formula strings on every recalculation is wasted work.
The display string is derived from the AST at render time.

*Cost:* we own a small parser + printer. Worth it. This is the single decision that most
determines whether the product feels solid at month six.

### 1.2 Time aggregation is a property of the variable, not the chart

`Opening ARR` for a quarter is the **first** month's value. `Closing ARR` is the **last**.
`New ARR` is the **sum**. `Churn Rate` is a **weighted average**. Get this wrong and every
quarterly and yearly view in the product is silently incorrect.

So every variable carries `aggregation: SUM | FIRST | LAST | AVG | WEIGHTED_AVG | NONE`,
and the day/month/quarter/year switch in the toolbar is a pure rollup over the monthly
base grain. **Monthly is the storage grain in v1**; daily is a later, expensive change.

### 1.3 One command bus for humans and agents

A user dragging a cell and an agent calling `setFormula` go through the *same* typed
command list:

```
CreateVariable · RenameVariable · SetFormula · SetInputValues · SetAggregation
MoveVariable · GroupVariables · CreateDimension · SetDimensionMapping
CreateScenario · SetScenarioOverride · LinkDataSource · DeleteVariable
```

Each command is `{ type, payload, inverse }`. Undo is replaying `inverse`. The audit log is
the command stream. Version history is a snapshot plus the commands since it.

*Why this matters more than it looks:* it means AI editing, undo, audit logs, real-time
collaboration, and version rollback are **one mechanism**, not five. The brief asks for all
five. Building them separately is how this project dies.

### 1.4 AI changes are proposals, not writes

Prototype screen 3 shows `2/3 · AI Suggestions · Undo all · Compare · Accept All`. That is
the whole interaction model and it should be enforced at the data layer: an agent run
produces a `ChangeSet` of commands with status `PROPOSED`. The grid renders proposed values
as a ghost overlay next to current values. Accepting applies the commands; rejecting drops
them. Nothing an LLM does mutates a model directly.

### 1.5 Storage: normalised inputs, materialised outputs

- **Inputs and overrides** are rows — small, edited constantly, need row-level audit.
- **Computed series** are a cached JSONB array per `(variable, scenario, dimensionKey)`,
  invalidated by dependency.

*Why:* a cell-per-row table for computed values is ~200 variables × 60 periods × 8 dimension
members × 5 scenarios ≈ 480k rows per model, rewritten on every edit. JSONB series turn a
recalculation into a few hundred row updates instead of half a million.

### 1.6 Dimensions are a property of a variable, materialised into child rows

`Closing ARR by Subscription Plan` = one variable, dimensioned by `SubscriptionPlan`,
expanding to one child series per member plus a rolled-up parent. Store the parent
definition once; store child series keyed by `dimensionKey` (a stable member tuple hash).

---

## 2. Data model (Prisma sketch)

```
Organisation ─┬─ User (via Membership, role: OWNER|ADMIN|EDITOR|VIEWER)
              ├─ DataSource        (ERP / CRM / billing / HRIS connection + sync state)
              ├─ Dimension ── DimensionMember
              └─ Model ─┬─ ModelVersion   (snapshot + label + createdBy)
                        ├─ VariableGroup  (the pastel chip rows: "ARR & Summary")
                        ├─ Variable ─┬─ FormulaNode (AST, self-referencing tree)
                        │            ├─ VariableInput   (period → value, for hardcoded rows)
                        │            └─ VariableSeries  (cached JSONB output per scenario)
                        ├─ Scenario ── ScenarioOverride (variableId → formula|values)
                        ├─ ChangeSet ── Command         (typed, with inverse, ordered)
                        ├─ Comment    (anchored to variable + period)
                        └─ AgentRun   (prompt, thinking, tool calls, resulting ChangeSet)
```

Key fields worth fixing now:

- `Variable.kind`: `INPUT | FORMULA | LINKED` — a variable is typed by where its numbers
  come from, and the UI shows a different glyph for each (`$`, `#`, `%` are *format*, not
  kind; the screens conflate them visually but the model must not).
- `Variable.format`: `CURRENCY | COUNT | PERCENT | RATIO | DATE`.
- `Variable.aggregation`: see §1.2.
- `Model.baseGrain`: `MONTH` in v1.
- `Model.horizonStart` / `horizonEnd`: the period window; columns derive from these.
- `Scenario.parentId`: scenarios can branch from scenarios; base case is `parentId: null`.

Postgres specifics: `numeric(20,6)` for money (never float), `jsonb` + GIN for series,
and a `citext`-style unique on `(modelId, lower(name))` so formula name resolution is
unambiguous.

---

## 3. The calculation engine

**Shape:** pure TypeScript, no DB access, in `packages/calc` (or `lib/calc`). Input is a
plain `ModelGraph` object; output is `Record<variableId, number[]>`. Testable without a
database, reusable on the client later.

**Pipeline:**

1. **Resolve** — apply scenario overrides onto the base variable set.
2. **Build DAG** — edges from each formula AST's variable references.
3. **Topologically sort** — cycle detection here. Circular references (interest on a
   revolving balance) are a *v2* problem solved by iterative convergence; v1 rejects cycles
   with a clear error naming the loop.
4. **Evaluate** in order, whole-series at a time (vectorised over periods, not cell by cell
   — time functions like `PRIOR` and `YTD` need the neighbouring periods anyway).
5. **Aggregate** to the requested grain using `Variable.aggregation`.

**Formula language** — deliberately small, matching the "formula-light" promise:

- Operators: `+ - * / ^`, comparison, `IF`.
- References: `[variableId]`, optionally sliced `[v] BY [dimension] = member`.
- Time: `PRIOR(x, n)`, `NEXT(x, n)`, `YTD(x)`, `CUMULATIVE(x)`, `OPENING(x)`, `CLOSING(x)`,
  `GROWTH(x, rate)`, `SPREAD(total, curve)`.
- Aggregators: `SUM`, `AVG`, `MIN`, `MAX`, `COUNT` over a dimension.
- Time context chips (`This Month` in the screens) are a modifier on a reference, not a
  separate concept.

That is roughly 25 primitives. Resist adding more; every one added is one the AI can get
wrong and a user must learn.

**Recalculation:** on a command, walk the DAG forward from the changed variable and
recompute only descendants. Full recompute is the fallback and should stay under ~50ms for
a 200-variable model, which is easily achievable in plain TS.

---

## 4. Scenarios and comparison

A scenario is **an overlay, not a copy.** `ScenarioOverride` rows replace a variable's
formula or input values; everything unoverridden falls through to the base case. Comparison
evaluates two scenarios and diffs the resulting series — the `Compare` control in the
prototype is exactly this, rendered as a delta column or a paired chart.

*Why an overlay:* copying a model per scenario means a fix to the base case has to be
applied five times, and "what actually differs between base and downside?" becomes
impossible to answer. With overlays it's a `SELECT`.

AI forecasting (best / base / worst) is then just: agent generates three scenarios of
overrides on the same base. Monte Carlo (visible in screen 3's output) is a scenario whose
overrides are distributions rather than values — design the override column to hold a
`jsonb` value so this doesn't need a migration later.

---

## 5. The agent surface

**Tools exposed to the model** map 1:1 to §1.3 commands, plus read tools:
`getModelOutline`, `getVariable`, `getSeries`, `searchDataSources`, `runScenario`.

**Run loop:** prompt + model outline (not the full data — outline plus targeted reads keeps
context small) → tool calls → a `ChangeSet` in `PROPOSED` state → rendered as the diff bar.

**Grounding rules:** the agent may only reference variables that exist or that it creates in
the same changeset; formula ASTs are validated and cycle-checked *before* being shown to the
user. An agent proposal that doesn't compile never reaches the UI.

**Streaming:** the "Thought for 8 seconds" disclosure and the task list are streamed run
state, persisted on `AgentRun` so a refresh doesn't lose the transcript.

Use the Claude API here with tool calling; the tool schemas are generated from the same
Zod schemas that validate commands from the UI, so there is exactly one definition of what
a valid mutation is.

---

## 6. Data sources ("always-on sync")

Out of scope for the first implementable slice, but the shape should exist so it isn't
retrofitted:

- `DataSource` (kind, credentials ref, cursor, lastSyncedAt, status).
- `LINKED` variables carry a `sourceQuery` (source + entity + measure + grouping).
- Sync writes to a staging table, then materialises into `VariableSeries`, then invalidates
  dependents. Every sync writes commands to the audit log so a number changing under a
  user's feet is explainable — this is the actual reason finance teams distrust these tools.

CSV upload is the honest v1 "connector" and covers demos.

---

## 7. Build phases

| Phase | Scope | Done when |
|---|---|---|
| **M0** Foundations | Prisma schema, org/model CRUD, seeded demo model | A model with groups + variables renders from the DB |
| **M1** Grid | Virtualised variable grid, groups, formatting, inline edit of INPUT rows, sticky first column | Screen `modelling-1` is reproducible with live data |
| **M2** Engine | AST + parser/printer, DAG, evaluator, time functions, aggregation rollup | Formula rows compute; grain switch is correct for OPENING/CLOSING |
| **M3** Commands | Command bus, inverse/undo, audit log, version snapshots + rollback | Every edit is undoable and appears in history |
| **M4** Scenarios | Overlays, scenario switcher, compare view, sparklines | Screen `proto-screen-3`'s scenario flow works |
| **M5** Agent | Tool schemas, run loop, proposal changesets, diff bar, thinking stream | "What's my forecast at 30% growth?" produces an accepted changeset |
| **M6** Collaboration | Comments, presence, notifications, approvals | Two browsers editing one model stay consistent |
| **M7** Sources & templates | CSV import, six template libraries from the brief | A new user picks "ARR Planning" and gets a working model |

M0–M2 is the real project. M3 onward is comparatively mechanical if §1.3 is respected.

---

## 8. Risks worth naming now

- **Time aggregation correctness** — the highest-probability source of silently wrong
  numbers. Needs a golden-file test suite from day one of M2.
- **Grid performance** — 200 rows × 60 columns × expandable dimensions. Virtualise both
  axes from the start; retrofitting virtualisation into a working grid is a rewrite.
- **Formula scope creep** — every request will be "can it also do X". The answer is a
  template or a new primitive, decided deliberately, never ad hoc.
- **Agent trust** — one wrong accepted changeset costs more trust than ten good ones earn.
  The proposal/diff model in §1.4 is the mitigation and is not optional.
- **Numeric precision** — `numeric` in Postgres, a decimal library in TS if we ever do
  compounding. Floats will produce $0.01 discrepancies that finance users will report as
  bugs, correctly.

---

## 9. M0 in detail — the next thing to build

Everything above is the shape of the whole module. This section is the part that gets
built next, specified tightly enough that it can be started without another decision.

**Goal:** delete `lib/demo/dashboard.ts` and have `/workspace` render the same screen from
Postgres. Nothing computes yet — M0 stores and reads; M2 is what makes formulas mean
anything.

### Tables

Added to the existing `prisma/schema.prisma`, alongside the Better Auth tables:

```prisma
Model            id, organisationId?, name, slug, baseGrain(MONTH), horizonStart,
                 horizonEnd, createdById, createdAt, updatedAt
VariableGroup    id, modelId, name, chip(AMBER|ROSE|GRAPHITE|SKY|BLUE), order
Variable         id, modelId, groupId, name, kind(INPUT|FORMULA|LINKED),
                 format(CURRENCY|COUNT|PERCENT|RATIO|DATE),
                 aggregation(SUM|FIRST|LAST|AVG|WEIGHTED_AVG|NONE), order
FormulaNode      id, variableId, parentId, type, op?, literal?, refVariableId?, order
VariableInput    id, variableId, period(Date), value numeric(20,6)
VariableSeries   id, variableId, scenarioId?, dimensionKey, values jsonb, staleAt?
Scenario         id, modelId, name, parentId?, isBase
```

`organisationId` is nullable **only** until A3 lands the org tables; the moment it exists
it becomes required and every query in M1 goes through `requireMembership`. Writing the
column now costs nothing and avoids a migration that touches every row later.

### Decisions already made, restated so they are not re-litigated

- `numeric(20,6)`, never `float`. Prisma maps it to `Decimal`; the API layer converts once,
  at the edge, and the UI never sees a float.
- Formula rows are a self-referencing `FormulaNode` tree, not a string column — §1.1. M0
  stores the tree; the parser that produces it is M2. Until then the seed writes trees
  directly.
- `VariableSeries.values` is a JSONB array ordered by period, one row per
  `(variable, scenario, dimensionKey)` — §1.5. It is a **cache**: `staleAt` is set by the
  dependency walk, and a stale row is recomputed, never trusted.
- Unique on `(modelId, lower(name))` so a formula referencing "Revenue" can only mean one
  variable.

### Done when

1. `bun run seed` builds the Annual Operating Plan: three groups, the variables from
   `lib/demo/dashboard.ts`, and monthly series across the model horizon.
2. `/workspace` renders that model with the demo import deleted, and the page's shape is
   unchanged — which is the test that the fixture was honest.
3. Running the seed twice leaves the same rows (upsert on the natural key, not `create`).
4. A golden-file test asserts the seeded series round-trips through JSONB with full
   `numeric` precision — the first test in the repo that would catch a float creeping in.
