/**
 * Engine sanity checks — `bun run calc:check`.
 *
 * `docs/modelling-plan.md` §8 names time aggregation as the highest-probability
 * source of silently wrong numbers: nothing crashes, the quarter column is
 * just three times too big. These assertions are the cheap version of the
 * golden-file suite M2 wants, and they run in under a second.
 */
import { evaluate } from "../lib/model/engine";
import { bucketsFor, rollup } from "../lib/model/grain";
import { div, ref } from "../lib/model/formula";
import { buildRevenueModel, V } from "../lib/model/revenue-model";
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

const model = buildRevenueModel();
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

console.log(
  failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
