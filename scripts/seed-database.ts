/**
 * `bun run seed:database` — the `Customers` table (`docs/database-plan.md` D1).
 *
 * Writes the fixture, runs twice to prove idempotence, then reads it back and checks the
 * things a later task actually depends on. The last check is the important one: D4's whole
 * premise is that records bucket into the seeded model's 24-month horizon, and a table that
 * looks full but lands entirely outside it would pass every other assertion here and then
 * produce a flat line of zeros in the demo.
 */
import { db } from "../lib/db";
import { CUSTOMERS_TABLE } from "../prisma/database-data";
import { readTable, writeTable } from "../lib/data/persist";

const fixture = { ...CUSTOMERS_TABLE, records: CUSTOMERS_TABLE.records };

console.log(`\nSeeding "${fixture.name}" → ${fixture.slug}\n`);

await writeTable(db, fixture);
await writeTable(db, fixture);

const tableCount = await db.dataTable.count({ where: { slug: fixture.slug } });
console.log(`  ran twice; ${tableCount} table row(s) with this slug`);

const table = await readTable(db, fixture.slug);
if (!table) {
  console.error("\n  ✗ the table did not read back at all\n");
  process.exit(1);
}

const problems: string[] = [];
const check = (label: string, ok: boolean, detail?: string) => {
  if (!ok) problems.push(detail ? `${label}: ${detail}` : label);
};

check(
  "field count",
  table.fields.length === fixture.fields.length,
  `expected ${fixture.fields.length}, read ${table.fields.length}`,
);
check(
  "row count",
  table.rows.length === fixture.records.length,
  `expected ${fixture.records.length}, read ${table.rows.length}`,
);

/* Cells are keyed by field id, so a row is only readable through the field list. */
const fieldByName = new Map(table.fields.map((f) => [f.name, f]));
const nameField = fieldByName.get("Customer Name");
const dateField = fieldByName.get("Onboarding Date");
const ownerField = fieldByName.get("Channel Owner");

check("Customer Name field exists", Boolean(nameField));
check("Onboarding Date field exists", Boolean(dateField));

if (nameField) {
  const first = table.rows[0]?.cells[nameField.id];
  check("row 1 matches the reference screen", first === "Liam Thompson", `read ${JSON.stringify(first)}`);
}

/* Derived SELECT options — `Channel Owner` declares none and takes them from the data. */
check(
  "Channel Owner options were derived",
  (ownerField?.options?.length ?? 0) > 0,
  `read ${ownerField?.options?.length ?? 0} options`,
);
check(
  "every Channel Owner value has an option",
  ownerField
    ? table.rows.every((row) => {
        const value = row.cells[ownerField.id];
        return typeof value !== "string" || ownerField.options?.some((o) => o.value === value);
      })
    : false,
);

/* The one that protects D4. */
let inHorizon = 0;
const monthsCovered = new Set<string>();
if (dateField) {
  for (const row of table.rows) {
    const value = row.cells[dateField.id];
    if (typeof value !== "string") continue;
    const [year, month] = value.split("-");
    if (year === "2026" || year === "2027") {
      inHorizon++;
      monthsCovered.add(`${year}-${month}`);
    }
  }
}

check(
  "records land inside the model horizon",
  inHorizon >= 50,
  `only ${inHorizon} of ${table.rows.length} fall in 2026-2027`,
);
check(
  "every month of the horizon has at least one record",
  monthsCovered.size === 24,
  `${monthsCovered.size} of 24 months covered`,
);

console.log(
  `  ${table.fields.length} fields · ${table.rows.length} rows · ${inHorizon} inside the model horizon across ${monthsCovered.size}/24 months`,
);

if (problems.length > 0) {
  console.log(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log();
  process.exit(1);
}

console.log(
  [
    "",
    "  The table reads back with its chips and its dates, and the records cover every month",
    "  the model can show — so D4's rollup has a curve to draw, not a flat line.",
    "",
  ].join("\n"),
);
