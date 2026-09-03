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

/* ── Report ───────────────────────────────────────────────────────────────*/

console.log(`\n  ${assertions} assertions over ${table.rows.length} rows and ${table.fields.length} fields`);

if (problems.length > 0) {
  console.log(`\n${problems.length} failure(s):`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log();
  process.exit(1);
}

console.log("\n  All checks passed.\n");
