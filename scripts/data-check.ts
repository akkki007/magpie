/**
 * `bun run data:check` — the database module's pure layer (`docs/database-plan.md` D2).
 *
 * Formatting and search are the two things the grid is, and both are pure functions over
 * data that is already in Postgres, so they can be checked without rendering anything. What
 * this cannot check is whether the grid *looks* right; that is a human's job and this makes
 * no claim about it.
 */
import { db } from "../lib/db";
import { readTable } from "../lib/data/persist";
import { formatCell, formatDate, searchText } from "../lib/data/format";
import { describeRollup, rollupToSeries } from "../lib/data/rollup";
import { readModel } from "../lib/model/persist";

const problems: string[] = [];
let assertions = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  assertions++;
  if (!ok) problems.push(detail ? `${label} — ${detail}` : label);
};

/* ── Formatting, against the reference screen ─────────────────────────────*/

check("currency carries the symbol and grouping", formatCell(123456, "CURRENCY") === "$123,456", formatCell(123456, "CURRENCY"));
check("a zero credit limit is a fact, not a rule", formatCell(0, "CURRENCY") === "$0", formatCell(0, "CURRENCY"));
check("counts group without a symbol", formatCell(1234, "NUMBER") === "1,234", formatCell(1234, "NUMBER"));
check("dates render DD/MM/YYYY", formatDate("2025-03-22") === "22/03/2025", formatDate("2025-03-22"));
check("an empty cell renders empty", formatCell(null, "TEXT") === "", JSON.stringify(formatCell(null, "TEXT")));

/**
 * The timezone trap this formatter exists to avoid: `new Date("2026-01-01")` is UTC
 * midnight, and reading it back through a local getter west of Greenwich gives 31 December.
 */
check("a New Year date does not slip a day", formatDate("2026-01-01") === "01/01/2026", formatDate("2026-01-01"));

/* Search sees the rendered text as well as the stored value. */
check("search finds a date by how it looks", searchText("2025-03-22", "DATE").includes("22/03/2025"));
check("search finds a currency by its digits", searchText(123456, "CURRENCY").includes("123,456"));

/* ── The seeded table ─────────────────────────────────────────────────────*/

const table = await readTable(db, "customers");
if (!table) {
  console.error("\n  ✗ no `customers` table — run `bun run seed:database`\n");
  process.exit(1);
}

check("six fields, as the reference screen shows", table.fields.length === 6, `${table.fields.length}`);

const byName = new Map(table.fields.map((f) => [f.name, f]));
check("Credit Limit is CURRENCY", byName.get("Credit Limit")?.type === "CURRENCY");
check("Onboarding Date is DATE", byName.get("Onboarding Date")?.type === "DATE");
check("Status is SELECT", byName.get("Status")?.type === "SELECT");

/**
 * Every SELECT value maps to a declared option, which is what decides chip or plain text.
 * A value with no option is legal and renders unstyled — this asserts the seed has none,
 * so the reference screen is all chips.
 */
for (const field of table.fields.filter((f) => f.type === "SELECT")) {
  const undeclared = new Set<string>();
  for (const row of table.rows) {
    const value = row.cells[field.id];
    if (typeof value === "string" && value && !field.options?.some((o) => o.value === value)) {
      undeclared.add(value);
    }
  }
  check(
    `every ${field.name} value has a chip`,
    undeclared.size === 0,
    [...undeclared].slice(0, 3).join(", "),
  );
}

/* The first row is the reference screen's first row, rendered. */
const nameField = byName.get("Customer Name")!;
const limitField = byName.get("Credit Limit")!;
const dateField = byName.get("Onboarding Date")!;
const first = table.rows[0];
check("row 1 name", first.cells[nameField.id] === "Liam Thompson", String(first.cells[nameField.id]));
check("row 1 credit limit renders $123,456", formatCell(first.cells[limitField.id], "CURRENCY") === "$123,456");
check("row 1 date renders 22/03/2025", formatCell(first.cells[dateField.id], "DATE") === "22/03/2025");

/* Search over the real table, the way the grid builds it. */
const haystacks = table.rows.map((row) =>
  table.fields.map((f) => searchText(row.cells[f.id] ?? null, f.type)).join(" "),
);
const enterprise = haystacks.filter((h) => h.includes("enterprise")).length;
check("search matches a chip value", enterprise > 0, `${enterprise} rows`);
check("search is case-insensitive", haystacks.filter((h) => h.includes("liam thompson")).length > 0);
check("a nonsense query matches nothing", haystacks.filter((h) => h.includes("zzzznope")).length === 0);

/* ── The rollup (D4) — what the module exists for ─────────────────────────*/

const model = await readModel(db, "revenue-model-2026");
if (!model) {
  console.error("\n  ✗ no `revenue-model-2026` — run `bun run seed`\n");
  process.exit(1);
}

const count = rollupToSeries(table, model, {
  dateFieldId: dateField.id,
  valueFieldId: null,
  aggregation: "COUNT",
});
check("COUNT rolls up", count.ok, count.ok ? "" : count.error);

if (count.ok) {
  check("COUNT covers all 24 periods", count.series.every((n) => n > 0), `${count.series.filter((n) => n > 0).length}/24 non-zero`);

  /* Every in-horizon record is counted exactly once — the sum of the series is the census. */
  const inHorizon = table.rows.filter((row) => {
    const value = row.cells[dateField.id];
    return typeof value === "string" && (value.startsWith("2026") || value.startsWith("2027"));
  }).length;
  const summed = count.series.reduce((a, b) => a + b, 0);
  check("COUNT totals every in-horizon record", summed === inHorizon, `series sums to ${summed}, ${inHorizon} records in horizon`);

  /**
   * Records outside the horizon are *reported*, not silently dropped. A database holds
   * history a model does not span, and "the total looks low" has to have an answer.
   */
  check("out-of-horizon records are reported", count.unmatched.length === table.rows.length - inHorizon, `${count.unmatched.length} reported, ${table.rows.length - inHorizon} expected`);
  check("total counts every dated record", count.total === table.rows.length, `${count.total}`);
}

const sum = rollupToSeries(table, model, {
  dateFieldId: dateField.id,
  valueFieldId: limitField.id,
  aggregation: "SUM",
});
check("SUM rolls up", sum.ok, sum.ok ? "" : sum.error);

if (sum.ok) {
  /* Hand-computed against the rows, independently of the function under test. */
  let expected = 0;
  for (const row of table.rows) {
    const when = row.cells[dateField.id];
    if (typeof when !== "string" || !(when.startsWith("2026") || when.startsWith("2027"))) continue;
    expected += Number(row.cells[limitField.id]) || 0;
  }
  const actual = Math.round(sum.series.reduce((a, b) => a + b, 0));
  check("SUM matches a hand-computed total", actual === Math.round(expected), `${actual} vs ${Math.round(expected)}`);
}

const avg = rollupToSeries(table, model, {
  dateFieldId: dateField.id,
  valueFieldId: limitField.id,
  aggregation: "AVG",
});
check("AVG rolls up", avg.ok, avg.ok ? "" : avg.error);
if (avg.ok && sum.ok && count.ok) {
  /* AVG is SUM/COUNT per period — the arithmetic, not a second implementation of it. */
  const consistent = avg.series.every((value, i) =>
    count.series[i] === 0 ? value === 0 : Math.abs(value - sum.series[i] / count.series[i]) < 1e-6,
  );
  check("AVG is SUM over COUNT, period by period", consistent);
  check("AVG differs from SUM", avg.series.some((v, i) => Math.abs(v - sum.series[i]) > 1), "identical — one of them is wrong");
}

/**
 * A blank number cell must not count as a zero: it would drag an average down by the number
 * of records nobody has filled in yet.
 *
 * Asserted on a synthetic two-row table rather than by blanking half the seed and checking
 * the average "did not move much" — that version was the first thing written here and it is
 * a statistics test wearing a correctness test's clothes: with ~7 records a period, dropping
 * half of them legitimately moves the mean by more than any threshold worth setting, so it
 * would fail on correct code and get muted. Two rows, one blank, one exact answer.
 */
const period = model.periods[0];
const synthetic = {
  ...table,
  rows: [
    { id: "a", cells: { [dateField.id]: `${period.year}-${String(period.month).padStart(2, "0")}-05`, [limitField.id]: 100 } },
    { id: "b", cells: { [dateField.id]: `${period.year}-${String(period.month).padStart(2, "0")}-06`, [limitField.id]: null } },
  ],
};
const blankAvg = rollupToSeries(synthetic, model, {
  dateFieldId: dateField.id,
  valueFieldId: limitField.id,
  aggregation: "AVG",
});
check(
  "a blank cell is excluded from an average, not counted as zero",
  blankAvg.ok && blankAvg.series[0] === 100,
  blankAvg.ok ? `average of [100, blank] came out as ${blankAvg.series[0]}` : blankAvg.error,
);
const blankSum = rollupToSeries(synthetic, model, {
  dateFieldId: dateField.id,
  valueFieldId: limitField.id,
  aggregation: "SUM",
});
check(
  "a blank cell contributes nothing to a sum",
  blankSum.ok && blankSum.series[0] === 100,
  blankSum.ok ? `${blankSum.series[0]}` : blankSum.error,
);

/* Failure paths say what is wrong rather than returning an empty series. */
const noField = rollupToSeries(table, model, { dateFieldId: "nope", valueFieldId: null, aggregation: "COUNT" });
check("a missing date column is an error, not an empty series", !noField.ok);
const noValue = rollupToSeries(table, model, { dateFieldId: dateField.id, valueFieldId: null, aggregation: "SUM" });
check("SUM without a column is an error", !noValue.ok);

/* The derived name and shape (§1.2 — aggregation belongs to the variable). */
const countShape = describeRollup(table, { dateFieldId: dateField.id, valueFieldId: null, aggregation: "COUNT" });
check("a count is formatted as a count", countShape.format === "COUNT" && countShape.aggregation === "SUM", JSON.stringify(countShape));
const sumShape = describeRollup(table, { dateFieldId: dateField.id, valueFieldId: limitField.id, aggregation: "SUM" });
check("a sum of currency is formatted as currency", sumShape.format === "CURRENCY", JSON.stringify(sumShape));
const avgShape = describeRollup(table, { dateFieldId: dateField.id, valueFieldId: limitField.id, aggregation: "AVG" });
check("an average collapses across time as an average", avgShape.aggregation === "AVG", JSON.stringify(avgShape));

/* ── Report ───────────────────────────────────────────────────────────────*/

console.log(`\n  ${assertions} assertions over ${table.rows.length} rows, ${table.fields.length} fields and ${model.periods.length} periods`);

if (problems.length > 0) {
  console.log(`\n${problems.length} failure(s):`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log();
  process.exit(1);
}

console.log("\n  All checks passed.\n");
