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
import { div, printFormula, ref } from "../lib/model/formula";
import { parseFormula } from "../lib/model/parse";
import { validateFormula } from "../lib/model/validate";
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
 * The parser (M2.1).
 *
 * The claim is not "it parses formulas" but the narrower, testable one: it is
 * the printer's inverse. Every formula in the seeded model and in the
 * primitive fixture is printed, re-parsed and compared as a tree — which
 * covers the grammar with real data rather than with the handful of strings
 * whoever wrote the parser happened to think of.
 *
 * The direction matters. `print → parse → same tree` is what M2.2 relies on:
 * open a formula, change nothing, save, and the model is untouched. The other
 * direction (`parse → print`) is deliberately not character-exact, because a
 * user may type `-x`, `a*b` or redundant brackets and get back `0 – x`,
 * `a × b` and no brackets — normalisation, not corruption.
 */
console.log("\nParser round-trip");
{
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

  for (const source of [model, PRIMITIVE_MODEL]) {
    const nameOf = (id: string) =>
      source.variables.find((v) => v.id === id)?.name ?? id;
    const formulas = source.variables.filter((v) => v.formula);
    let mismatches = 0;
    let firstFailure = "";

    for (const variable of formulas) {
      const text = printFormula(variable.formula!, nameOf);
      const parsed = parseFormula(text, source);
      const ok = parsed.ok && same(parsed.node, variable.formula);
      if (!ok) {
        mismatches++;
        if (!firstFailure) {
          firstFailure = parsed.ok
            ? `${variable.name}: "${text}" → ${JSON.stringify(parsed.node)}`
            : `${variable.name}: "${text}" → ${parsed.error.message}`;
        }
      }
    }

    check(
      `${formulas.length} formulas in ${source.name} survive print → parse`,
      mismatches === 0,
      firstFailure,
    );
  }

  const nameOf = (id: string) => model.variables.find((v) => v.id === id)?.name ?? id;
  const parse = (text: string) => parseFormula(text, model);
  const shows = (text: string) => {
    const result = parse(text);
    return result.ok ? printFormula(result.node, nameOf) : `!${result.error.message}`;
  };
  const rejects = (text: string) => !parse(text).ok;

  check("× and * are the same operator", shows("2 * 3") === shows("2 × 3"), shows("2 * 3"));
  check("– and - are the same operator", shows("5 - 2") === shows("5 – 2"), shows("5 - 2"));
  check(">= and ≥ are the same operator", shows("5 >= 2") === shows("5 ≥ 2"), shows("5 >= 2"));
  check("× binds tighter than +", shows("2 + 3 * 4") === "2 + 3 × 4", shows("2 + 3 * 4"));
  check("brackets survive when they matter", shows("(2 + 3) * 4") === "(2 + 3) × 4", shows("(2 + 3) * 4"));
  check("redundant brackets are dropped", shows("(2 * 3) + 4") === "2 × 3 + 4", shows("(2 * 3) + 4"));
  check("^ is right-associative", shows("2 ^ 3 ^ 2") === "2 ^ 3 ^ 2", shows("2 ^ 3 ^ 2"));
  check("^ left operand keeps its bracket", shows("(2 ^ 3) ^ 2") === "(2 ^ 3) ^ 2", shows("(2 ^ 3) ^ 2"));
  check("a percentage is a decimal", shows("7.5%") === "7.5%", shows("7.5%"));
  check("collapsed whitespace still finds a name", shows("Opening  ARR") === "Opening ARR", shows("Opening  ARR"));
  check("names are case-insensitive", shows("opening arr") === "Opening ARR", shows("opening arr"));
  check("a member slice parses", shows("ACV · growth") === "ACV · growth", shows("ACV · growth"));
  check("a member name resolves to its key", shows("ACV · Growth") === "ACV · growth", shows("ACV · Growth"));
  check("unary minus folds into a literal", shows("-5") === "-5", shows("-5"));
  check("unary minus on a name becomes 0 – x", shows("-Opening ARR") === "0 – Opening ARR", shows("-Opening ARR"));

  check("an unknown name is rejected", rejects("Revenue + Nonsense Variable"));
  check("an unclosed bracket is rejected", rejects("(2 + 3"));
  check("a trailing operator is rejected", rejects("2 +"));
  check("a chained comparison is rejected", rejects("1 < 2 < 3"));
  check("a member on an undimensioned variable is rejected", rejects("Opening ARR · growth"));
  check("an unknown member is rejected", rejects("ACV · platinum"));
  check("an empty formula is rejected", rejects("   "));

  const unknown = parse("Opening ARR + Mystery");
  check(
    "the error points at the offending characters",
    !unknown.ok && "Opening ARR + ".length === unknown.error.start,
    unknown.ok ? "parsed" : `${unknown.error.start}–${unknown.error.end}`,
  );
}

/**
 * Validation (M2.3).
 *
 * The check that matters is the negative one. A cycle detector that walks the
 * variable graph rejects `Opening ARR = PRIOR(Closing ARR)`, which is the
 * central formula of every waterfall in finance — so the static rule here has
 * to agree with the engine's runtime rule exactly: a loop is only a loop if it
 * closes within one period. Every formula already in the seeded model passing
 * is therefore the primary assertion, not a formality.
 */
console.log("\nValidation");
{
  const context = model;
  const invalid = (formula: Parameters<typeof validateFormula>[0], target: string) =>
    validateFormula(formula, context, target);

  const rejected = model.variables.filter((v) => v.formula && invalid(v.formula, v.id));
  check(
    "every formula in the seeded model validates",
    rejected.length === 0,
    rejected.map((v) => `${v.name}: ${invalid(v.formula!, v.id)?.message}`).join("; "),
  );

  const parsed = (text: string) => {
    const result = parseFormula(text, model);
    if (!result.ok) throw new Error(`fixture does not parse: ${text} — ${result.error.message}`);
    return result.node;
  };

  check(
    "a lagged self-reference is allowed",
    !invalid(parsed("PRIOR(Opening ARR, 1, 0)"), V.openingArr),
  );
  check(
    "an immediate self-reference is a cycle",
    !!invalid(parsed("Opening ARR + 1"), V.openingArr),
  );
  check(
    "a two-step immediate loop is a cycle",
    !!invalid(parsed("Closing ARR"), V.openingArr),
    invalid(parsed("Closing ARR"), V.openingArr)?.message,
  );
  check(
    "YTD of itself is a cycle — YTD includes this period",
    !!invalid(parsed("YTD(Opening ARR)"), V.openingArr),
  );
  check(
    "PRIOR with a zero shift is not treated as a lag",
    !!invalid(parsed("PRIOR(Opening ARR, 0)"), V.openingArr),
  );

  const loop = invalid(parsed("Closing ARR"), V.openingArr);
  check(
    "the message names the loop",
    !!loop?.message.includes("Opening ARR → Closing ARR → Opening ARR"),
    loop?.message,
  );

  check(
    "too few arguments is rejected",
    !!invalid({ type: "call", fn: "SPREAD", args: [ref(V.openingArr)] }, V.revenue),
    invalid({ type: "call", fn: "SPREAD", args: [ref(V.openingArr)] }, V.revenue)?.message,
  );
  check(
    "too many arguments is rejected",
    !!invalid({ type: "call", fn: "ABS", args: [ref(V.openingArr), ref(V.newArr)] }, V.revenue),
  );
  check(
    "the arity message names the signature",
    invalid({ type: "call", fn: "ABS", args: [] }, V.revenue)?.message.includes("ABS(value)") === true,
    invalid({ type: "call", fn: "ABS", args: [] }, V.revenue)?.message,
  );
  check(
    "a variadic function accepts any count above its minimum",
    !invalid({ type: "call", fn: "MAX", args: [ref(V.openingArr), ref(V.newArr), ref(V.churnArr)] }, V.revenue),
  );
  check(
    "a member aggregator over an undimensioned variable is rejected",
    !!invalid({ type: "call", fn: "MEMBER_SUM", args: [ref(V.openingArr)] }, V.revenue),
  );
  check(
    "a member aggregator over a dimensioned variable is accepted",
    !invalid({ type: "call", fn: "MEMBER_SUM", args: [ref(V.newAccounts)] }, V.revenue),
  );
  check(
    "a member aggregator over an expression is rejected",
    !!invalid(
      { type: "call", fn: "MEMBER_AVG", args: [{ type: "binary", op: "*", left: ref(V.newAccounts), right: { type: "literal", value: 2 } }] },
      V.revenue,
    ),
  );
  check(
    "a reference to a variable outside the model is rejected",
    !!invalid(ref("v_not_here"), V.revenue),
  );
  check(
    "a member that the dimension does not have is rejected",
    !!invalid({ type: "ref", variableId: V.acv, member: "platinum" }, V.revenue),
  );
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
