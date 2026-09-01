/**
 * Engine sanity checks — `bun run calc:check`.
 *
 * `docs/modelling-plan.md` §8 names time aggregation as the highest-probability
 * source of silently wrong numbers: nothing crashes, the quarter column is
 * just three times too big. These assertions are the cheap version of the
 * golden-file suite M2 wants, and they run in under a second.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { evaluate } from "../lib/model/engine";
import { bucketsFor, rollup } from "../lib/model/grain";
import { div, ref } from "../lib/model/formula";
import { db } from "../lib/db";
import { readModel } from "../lib/model/persist";
import { V } from "../prisma/seed-data";
import { PRIMITIVE_MODEL, PRIMITIVE_ROWS } from "./primitive-fixture";
import { TOTAL } from "../lib/model/types";
import type { Model } from "../lib/model/types";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const near = (a: number, b: number, epsilon = 1e-6) => Math.abs(a - b) < epsilon;

/**
 * The seeded model, not the fixture (M0.5).
 *
 * These assertions are worth far more against what the database actually returns: a rollup
 * that is right in memory and wrong after a round-trip is precisely the bug this suite exists
 * to catch, and it could not have caught it while both sides came from the same function.
 */
const model = await readModel(db, "revenue-model-2026");
if (!model) {
  console.error("\nNo seeded model — run `bun run seed` first.\n");
  process.exit(1);
}
const base = evaluate(model, "s_base");

console.log("\nWaterfall");
{
  const opening = base.series(V.openingArr);
  const closing = base.series(V.closingArr);
  const newArr = base.series(V.newArr);
  const churn = base.series(V.churnArr);
  const expansion = base.series(V.expansionArr);

  check(
    "closing = opening + new – churn + expansion, every period",
    closing.every((c, t) => near(c, opening[t] + newArr[t] - churn[t] + expansion[t], 1e-6)),
  );
  check(
    "opening[t] = closing[t-1]",
    opening.slice(1).every((o, i) => near(o, closing[i])),
  );
  check(
    "opening[0] = starting ARR",
    near(opening[0], model.inputs[V.startingArr][TOTAL][0]),
    `${opening[0]}`,
  );
  check("no errors reported", Object.keys(base.errors).length === 0, JSON.stringify(base.errors));
}

console.log("\nDimensions");
{
  const total = base.series(V.newArr);
  const members = model.dimensions[0].members.map((m) => base.series(V.newArr, m.key));
  check(
    "New ARR total = sum of its plan members",
    total.every((v, t) => near(v, members.reduce((sum, s) => sum + s[t], 0), 1e-6)),
  );
  check(
    "member series follows its own plan's ACV",
    near(
      base.series(V.newArr, "growth")[0],
      base.series(V.newAccounts, "growth")[0] * base.series(V.acv, "growth")[0],
    ),
  );
}

console.log("\nTime rollup (the one that fails silently)");
{
  const quarters = bucketsFor(model.periods, "QUARTER");
  const years = bucketsFor(model.periods, "YEAR");

  const openingMonthly = base.series(V.openingArr);
  const closingMonthly = base.series(V.closingArr);
  const newMonthly = base.series(V.newArr);

  check("24 months → 8 quarters → 2 years", quarters.length === 8 && years.length === 2);
  check(
    "Opening ARR takes the FIRST month of the quarter",
    near(rollup(openingMonthly, quarters, "FIRST")[1], openingMonthly[3]),
  );
  check(
    "Closing ARR takes the LAST month of the quarter",
    near(rollup(closingMonthly, quarters, "LAST")[1], closingMonthly[5]),
  );
  check(
    "New ARR SUMs the quarter",
    near(rollup(newMonthly, quarters, "SUM")[1], newMonthly[3] + newMonthly[4] + newMonthly[5]),
  );
  check(
    "FY26 New ARR = the twelve months of 2026",
    near(
      rollup(newMonthly, years, "SUM")[0],
      newMonthly.slice(0, 12).reduce((a, b) => a + b, 0),
      1e-6,
    ),
  );
  check(
    "a balance is never summed into nonsense",
    rollup(openingMonthly, years, "FIRST")[0] < rollup(openingMonthly, years, "SUM")[0],
  );
}

console.log("\nScenario overlays");
{
  const upside = evaluate(model, "s_upside").series(V.closingArr).at(-1)!;
  const downside = evaluate(model, "s_downside").series(V.closingArr).at(-1)!;
  const baseline = base.series(V.closingArr).at(-1)!;
  check("downside < base < upside at the horizon", downside < baseline && baseline < upside,
    `${Math.round(downside)} / ${Math.round(baseline)} / ${Math.round(upside)}`);
  check(
    "an unoverridden variable falls through to base",
    near(
      evaluate(model, "s_upside").series(V.collected)[0],
      base.series(V.collected)[0],
    ),
  );
}

console.log("\nCycles");
{
  // A real circular reference — not a lag — must be caught and named.
  const cyclic: Model = {
    ...model,
    variables: [
      ...model.variables,
      {
        id: "v_a",
        groupId: "g_arr",
        name: "A",
        kind: "FORMULA",
        format: "COUNT",
        aggregation: "SUM",
        formula: div(ref("v_b"), ref("v_b")),
      },
      {
        id: "v_b",
        groupId: "g_arr",
        name: "B",
        kind: "FORMULA",
        format: "COUNT",
        aggregation: "SUM",
        formula: ref("v_a"),
      },
    ],
  };
  const result = evaluate(cyclic, "s_base");
  result.series("v_a");
  check("circular reference is detected", Object.keys(result.errors).length > 0,
    JSON.stringify(result.errors));
  check("the honest lag in Opening ARR is NOT flagged", !result.errors[V.openingArr]);
}

/**
 * The golden file (M2.4).
 *
 * Every primitive evaluated over `scripts/primitive-fixture.ts` and compared to
 * a committed series, cell by cell. The assertions above test the primitives
 * the demo model happens to use; this one is the reason a change to `SPREAD`
 * cannot pass unnoticed just because nothing in the ARR waterfall calls it.
 *
 * `--write-golden` regenerates the file, and nothing else does. A check that
 * silently rewrites its own expectations when they stop matching has recorded
 * the bug as the new truth — the failure mode this repo has already hit four
 * times in its eval harnesses. A missing file is a hard failure, not a prompt
 * to create one.
 */
const GOLDEN_PATH = "scripts/golden/primitives.json";

console.log("\nPrimitives (golden file)");
{
  const evaluation = evaluate(PRIMITIVE_MODEL, "s_base");
  const round = (n: number) => Number(n.toFixed(9));
  const actual = Object.fromEntries(
    PRIMITIVE_ROWS.map((id) => [id, evaluation.series(id).map(round)]),
  );

  if (process.argv.includes("--write-golden")) {
    mkdirSync("scripts/golden", { recursive: true });
    writeFileSync(GOLDEN_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`  wrote ${GOLDEN_PATH} — read it before committing it`);
  } else if (!existsSync(GOLDEN_PATH)) {
    check(GOLDEN_PATH, false, "missing — regenerate with `bun run calc:check --write-golden`");
  } else {
    const golden: Record<string, number[]> = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
    const missing = PRIMITIVE_ROWS.filter((id) => !golden[id]);
    check("every primitive is covered", missing.length === 0, missing.join(", "));

    for (const id of PRIMITIVE_ROWS) {
      const expected = golden[id];
      if (!expected) continue;
      const got = actual[id];
      const at = expected.findIndex((v, t) => !near(v, got[t], 1e-9));
      check(
        `${id} matches golden`,
        at === -1 && expected.length === got.length,
        at === -1 ? `length ${got.length} vs ${expected.length}` : `period ${at}: ${got[at]} ≠ ${expected[at]}`,
      );
    }

    // The golden file must not outlive the fixture it describes: a row deleted
    // from the fixture would otherwise keep passing as an untested absence.
    const orphans = Object.keys(golden).filter((id) => !PRIMITIVE_ROWS.includes(id));
    check("no golden rows without a fixture row", orphans.length === 0, orphans.join(", "));
  }
  check("no errors in the primitive fixture", Object.keys(evaluation.errors).length === 0,
    JSON.stringify(evaluation.errors));
}

console.log(
  failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
