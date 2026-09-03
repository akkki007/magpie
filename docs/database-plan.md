# Magpie — Database Plan

> Status: **planned, not built.** Written 3 Sep 2026 against a 5 Sep hackathon submission,
> with **Boards** and **agent spawning for finance-ops** still to come after it. Every
> decision below is made under that constraint and says so where it matters.

## 0. What this is — and the trap

The reference screenshot is Airtable. **Building Airtable loses the hackathon.** Views,
filters, sorts, cross-table relations, formula fields and permissions are a config system,
and a config system is weeks.

The thing that makes this *Magpie's* database rather than a grid is one panel in the
reference deck: *"Power models, dashboards, and agents — the same trusted databases feed
financial models, reporting boards, and AI agents."* A database earns its place here because

> a column, bucketed by a date field, becomes a `LINKED` variable in a model.

That sentence is the demo. So the table is **the cheapest thing that makes the link
credible**, and the link is the product. Scope everything against that.

## 1. Decisions

### 1.1 The link produces a *command*, not rows

`components/modelling/workbench.tsx:761` already has the exact seam. `importCsv` takes a
name and a text blob, calls `parseCsv` → `{ series, matched, total, unmatched }`, and
dispatches the same `InsertVariable` command that "Add variable" dispatches. A database
rollup returns **that same shape**, so it reuses that whole function with a different
producer in front of it.

This is not a convenience, it is the §6 rule the CSV importer was built to satisfy: a synced
number has to be explainable through the audit log. Going through the command bus means
undo, history, versions and the agent's view of the model all work on day one, and there is
never a second way for a variable's numbers to change.

**Consequence for the plan: D4 is small.** It is a pure function plus a picker.

### 1.2 Cells are `jsonb` on the record, not real columns

Adding a field must not be runtime DDL. One `cells Json` object per record, keyed by field
id — never by field *name*, for the same reason §1.1 of the modelling plan gives for formula
refs: a rename must not orphan the data.

The cost is honest and worth naming: no per-field constraints, and no index on a cell until
someone writes an expression index. At hackathon row counts that is free. At a million rows
it is the thing to revisit first.

### 1.3 Five field types, and every one of them renders

`TEXT · NUMBER · CURRENCY · DATE · SELECT`

That is exactly what the reference screen shows — `Customer Name` is text, `Credit Limit`
currency, `Onboarding Date` date, and `Customer Type` / `Status` / `Channel Owner` are all
the same select chip. There is no `PERSON` type: it would render identically to `SELECT`,
and a type that is a synonym is a type that will drift.

**The rule from `NumberFormat`'s deliberately-absent `DATE` applies here too:** the enum must
not be able to express a state the renderer cannot draw. Add a type on the day it renders.

### 1.4 One table per page. No views.

No saved views, no filters, no sorts, no grouping. The reference screenshot's `Scenario` and
`View` buttons are **not** built. Search is one `input` filtering rows client-side, because
that is ten minutes and reads as complete.

### 1.5 Records are paginated, not virtualised

The model grid earned virtualisation (M1.3) because a model is dense and small. A database
is the opposite shape. 200 rows a page is correct here and costs nothing; the marketing
line about millions of rows is a claim about Postgres, not about the DOM.

## 2. Data model

Three tables. `DataTable` / `DataField` / `DataRecord` are prefixed because bare `Record`
collides with TypeScript's `Record<K, V>` in every file that touches it.

```prisma
enum FieldType { TEXT NUMBER CURRENCY DATE SELECT }

model DataTable {
  id             String   @id @default(uuid())
  organisationId String?          // nullable until A3, like Model and Dimension
  name           String           // "Customers"
  slug           String           // stable URL key, survives a rename
  icon           String?          // the sidebar glyph
  fields         DataField[]
  records        DataRecord[]
  @@unique([slug])
}

model DataField {
  id      String    @id @default(uuid())
  tableId String
  name    String
  type    FieldType
  /// SELECT only: `{ options: [{ value, tone }] }`, tone drawn from ChipTone
  /// so the chips are the design system's, not a second palette.
  options Json?
  order   Int
  @@unique([tableId, name])
}

model DataRecord {
  id      String @id @default(uuid())
  tableId String
  /// Keyed by field **id**, never field name — a rename must not orphan data.
  cells   Json
  order   Int
}
```

## 3. The rollup — the part that is actually the product

```ts
// lib/data/rollup.ts — pure, isomorphic, no DB. Mirrors lib/model/csv-import.ts.
rollupToSeries(records, fields, model, {
  dateFieldId, valueFieldId, aggregation: "SUM" | "COUNT" | "AVG",
}): { ok: true; series: number[]; matched: number; total: number; unmatched: string[] }
 | { ok: false; error: string }
```

Buckets each record into `model.periods` by its date cell — reusing `csv-import.ts`'s
period-matching, which already tolerates `2026-01`, `Jan '26` and `jan-2026`. Returns the
**same result contract as `parseCsv`**, so the existing preview, the existing toast, and the
existing `InsertVariable` dispatch all work unchanged.

`COUNT` needs no value field, and it is the best demo row on the screen: *"how many
customers onboarded per month"* → a real series in the model, from the table you just
looked at, with an audit entry attached.

## 4. Tasks, with a time budget and a cut line

| | Task | Est |
|---|---|---|
| **D1** | Schema, migration, and a seeded `Customers` table matching the reference screen — *built* | 1.5h |
| **D2** | `/databases/[slug]` — grid, typed cell rendering, select chips, search — *built* | 2h |
| **D3** | Inline edit, add row, add field | 2h |
| **D4** | `rollupToSeries` + "Add from database" next to CSV import in the workbench — *built* | 2h |
| **D5** | Sidebar `Database` section listing tables — *built with D2*: `/databases` is the index, and the rail's `Data sources` item points at it instead of being inert | 0.5h |

**≈ 8 hours. The cut line is between D3 and D4.**

*D1 notes.* The fixture is two populations, and the second one is not padding. The reference
screenshot's dates are mostly 2023–2025 while the seeded model's horizon is 2026-01 →
2027-12, so the 19 transcribed rows put **3 records in horizon across 2 of 24 months** —
§3's rollup would have produced a flat line with three spikes and the demo would have died
at D4. `seed:database` asserts ≥50 in-horizon records and all 24 months covered, and both
assertions were mutation-tested against a reference-only table to confirm they discriminate.
Seeded: 6 fields, 173 rows, 157 in horizon, 24/24 months.

*D4 notes.* The rollup runs on the **server** even though `rollupToSeries` is pure and could
run either side: a table is unbounded in a way a pasted CSV is not, and shipping every record
to the browser to compute twenty-four numbers puts the size of the database on the wire. The
function stays isomorphic so it is testable and so a local preview stays possible.

`workbench.tsx` now has a single `insertLinked` that both the paste and the rollup land in.
They were about to be two dispatch sites producing the same command, and §6's requirement is
exactly that a synced number stays explainable — two paths is two answers to "where did this
number come from", and they drift.

`bun run data:check` — 38 assertions. The rollup ones check the series against hand-computed
totals rather than against a second implementation, and the blank-cell assertion was
mutation-tested: treating a null as zero makes the average of `[100, blank]` come back as 50
and the check fails.

If time runs short, **D4 ships and D3 does not.** A read-only table that feeds a model is
the product; an editable table that feeds nothing is a worse Airtable. Seeded data makes a
read-only grid demo identically well.

## 5. Not building — deliberately

Views, filters, sorts, grouping · relations between tables · formula fields · row-level
permissions · real-time collaboration · CSV import *into* a database (CSV already imports
into a model, and a second importer is a second mechanism) · virtualisation · field-type
migrations (changing a field's type is delete-and-recreate).

## 6. What this unlocks for the two modules after it

- **Boards** — a board tile is a `rollupToSeries` call with a chart around it. The board
  module does not need its own data layer, which is most of why it can be built in a day.
- **Agent spawning for finance-ops** — a `queryDatabase` tool beside the existing
  `getSeries` / `getVariable` in `lib/model/agent-tools.ts`. This is what makes "spawn an
  agent for finance-ops" more than a chat window: the agent gets rows it can read and a
  command bus it can already propose against.

Both depend on §1.1 and §3 and on nothing in D3. That is the second reason the cut line
sits where it does.
