/**
 * `bun run seed` — the Revenue Model 2026, into Postgres (`docs/modelling-plan.md` M0.5).
 *
 * Then it reads the model straight back out and compares it, field by field, against the
 * fixture it was built from. That comparison is the actual deliverable. M0's promise is
 * *delete nothing from the UI and change where the model comes from*, and the only way to
 * know that is safe is to prove the database returns the identical object — same formula
 * trees, same series to the last decimal, same scenario overlays.
 *
 * A seed that merely "ran without error" would leave the swap a matter of hope.
 */
import { db } from "../lib/db";
import { readModel, writeModel } from "../lib/model/persist";
import { buildRevenueModel } from "../prisma/seed-data";
import type { Model } from "../lib/model/types";

const SLUG = "revenue-model-2026";

const fixture = buildRevenueModel();

console.log(`\nSeeding "${fixture.name}" → ${SLUG}\n`);

const modelId = await writeModel(db, fixture, SLUG);
console.log(`  wrote model ${modelId}`);
console.log(
  `  ${fixture.groups.length} groups · ${fixture.variables.length} variables · ${fixture.dimensions.length} dimension(s) · ${fixture.scenarios.length} scenarios`,
);

/* Idempotence: the natural key is the slug, so a second run replaces rather than duplicates. */
await writeModel(db, fixture, SLUG);
const modelCount = await db.model.count({ where: { slug: SLUG } });
console.log(`  ran twice; ${modelCount} model row(s) with this slug`);

const loaded = await readModel(db, SLUG);
if (!loaded) {
  console.error("\n  ✗ the model did not read back at all\n");
  process.exit(1);
}

/* ── The comparison ───────────────────────────────────────────────────────*/

const problems: string[] = [];
const check = (label: string, condition: boolean, detail?: string) => {
  if (!condition) problems.push(detail ? `${label}: ${detail}` : label);
};

/**
 * Key order is not data.
 *
 * The first version compared `JSON.stringify` output directly and reported every variable as
 * different — because the fixture writes `timeContext` before `formula` and the loader writes
 * it after. Identical objects, different byte strings. A comparison that fails on field order
 * is a comparison that will be ignored the third time it cries wolf, so it sorts keys first.
 */
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, sortKeys(inner)]),
    );
  }
  return value;
};

const canonical = (model: Model) =>
  JSON.stringify(sortKeys({
    name: model.name,
    baseGrain: model.baseGrain,
    periods: model.periods,
    groups: [...model.groups].sort((a, b) => a.id.localeCompare(b.id)),
    variables: [...model.variables]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((v) => ({ ...v, formula: v.formula ?? null })),
    dimensions: [...model.dimensions].sort((a, b) => a.id.localeCompare(b.id)),
    scenarios: [...model.scenarios]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => ({ ...s, overrides: [...s.overrides].sort((a, b) => a.variableId.localeCompare(b.variableId)) })),
  }));

check("model round-trips identically", canonical(fixture) === canonical(loaded));

/* Inputs compared separately, cell by cell, so a mismatch names the cell. */
let cells = 0;
for (const [variableId, byMember] of Object.entries(fixture.inputs)) {
  for (const [member, series] of Object.entries(byMember)) {
    const back = loaded.inputs[variableId]?.[member];
    if (!back) {
      problems.push(`inputs ${variableId}[${member || "TOTAL"}] missing`);
      continue;
    }
    series.forEach((value, index) => {
      cells++;
      if (back[index] !== value) {
        problems.push(
          `inputs ${variableId}[${member || "TOTAL"}][${index}]: wrote ${value}, read ${back[index]}`,
        );
      }
    });
  }
}

/**
 * M0.6 — the precision guard.
 *
 * `numeric(20,6)` survives a value that a float would round; the assertion exists so that
 * swapping the column to `double precision` fails here rather than showing up months later
 * as a ₹0.01 discrepancy a finance user reports as a bug, correctly.
 */
const PRECISE = 12345678.901234;
const probe = fixture.variables.find((v) => v.kind === "INPUT")!;
await db.variableInput.update({
  where: {
    variableId_dimensionKey_period: {
      variableId: probe.id,
      dimensionKey: Object.keys(fixture.inputs[probe.id] ?? { "": 0 })[0] ?? "",
      period: new Date(Date.UTC(fixture.periods[0].year, fixture.periods[0].month - 1, 1)),
    },
  },
  data: { value: PRECISE },
});
const reread = await readModel(db, SLUG);
const readBack = reread?.inputs[probe.id]?.[Object.keys(fixture.inputs[probe.id] ?? { "": 0 })[0] ?? ""]?.[0];
check(
  "numeric(20,6) keeps six decimal places",
  readBack === PRECISE,
  `wrote ${PRECISE}, read ${readBack}`,
);

// Put the probe cell back, so the seeded model is the fixture and not the fixture plus a test.
await writeModel(db, fixture, SLUG);

/* ── Report ───────────────────────────────────────────────────────────────*/

console.log(`\n  compared ${cells.toLocaleString("en-IN")} input cells and every formula tree`);

if (problems.length > 0) {
  console.log(`\n${problems.length} difference(s) between the fixture and what came back:`);
  for (const problem of problems.slice(0, 12)) console.log(`  ✗ ${problem}`);
  console.log();
  process.exit(1);
}

console.log(
  [
    "",
    "  The database returns the identical model: same formula trees, same series to the last",
    "  decimal, same scenario overlays. The fixture was honest, so the swap is safe.",
    "",
  ].join("\n"),
);
