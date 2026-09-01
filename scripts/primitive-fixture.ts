/**
 * A model built to exercise one primitive per row.
 *
 * The demo model in `prisma/seed-data.ts` is a *plausible* model: it uses eight
 * primitives and says nothing about the other nine. This one is deliberately
 * implausible — fifteen periods of round numbers spanning a year boundary, one
 * variable per function — so that every expected value in
 * `scripts/golden/primitives.json` can be checked by hand, which is the only
 * thing that makes a golden file worth having.
 *
 * Two properties of the periods matter and are easy to lose in an edit:
 * `2026-01 … 2027-03` crosses a calendar year, which is the only way `YTD`,
 * `OPENING` and `CLOSING` differ from `CUMULATIVE` and from the horizon; and
 * `base[t] = 10 × (t + 1)` makes `GROWTH` come out at exactly `1 / t`.
 */
import {
  add,
  call,
  div,
  gte,
  iff,
  lit,
  lt,
  mul,
  ne,
  pow,
  prior,
  ref,
  sub,
} from "../lib/model/formula";
import { TOTAL } from "../lib/model/types";
import type { Model, Variable } from "../lib/model/types";

const PERIOD_COUNT = 15;

const periods = Array.from({ length: PERIOD_COUNT }, (_, t) => {
  const month = (t % 12) + 1;
  const year = 2026 + Math.floor(t / 12);
  return {
    key: `${year}-${String(month).padStart(2, "0")}`,
    label: `${month}/${year}`,
    year,
    month,
  };
});

/** `base[t] = 10, 20, 30 … 150`. */
const base = Array.from({ length: PERIOD_COUNT }, (_, t) => 10 * (t + 1));

const formula = (id: string, name: string, node: Variable["formula"]): Variable => ({
  id,
  groupId: "g",
  name,
  kind: "FORMULA",
  format: "COUNT",
  aggregation: "SUM",
  formula: node,
});

export const PRIMITIVE_MODEL: Model = {
  id: "primitive-fixture",
  name: "Primitive fixture",
  baseGrain: "MONTH",
  periods,
  groups: [{ id: "g", name: "Primitives", chip: "graphite" }],
  dimensions: [
    {
      id: "d_plan",
      name: "Plan",
      members: [
        { key: "small", name: "Small" },
        { key: "mid", name: "Mid" },
        { key: "large", name: "Large" },
      ],
    },
  ],
  scenarios: [{ id: "s_base", name: "Base", isBase: true, overrides: [] }],
  inputs: {
    v_base: { [TOTAL]: base },
    // Constant per member, so a MEMBER_* result is readable at a glance:
    // 1 / 2 / 7 → sum 10, mean 10/3, min 1, max 7, count 3.
    v_plan: {
      small: Array(PERIOD_COUNT).fill(1),
      mid: Array(PERIOD_COUNT).fill(2),
      large: Array(PERIOD_COUNT).fill(7),
    },
  },
  variables: [
    {
      id: "v_base",
      groupId: "g",
      name: "Base",
      kind: "INPUT",
      format: "COUNT",
      aggregation: "SUM",
    },
    {
      id: "v_plan",
      groupId: "g",
      name: "By Plan",
      kind: "INPUT",
      format: "COUNT",
      aggregation: "SUM",
      dimensionId: "d_plan",
      memberRollup: "SUM",
    },

    formula("v_prior", "Prior", prior(ref("v_base"), 1, lit(-1))),
    formula("v_next", "Next", call("NEXT", ref("v_base"), lit(1), lit(-1))),
    formula("v_ytd", "Ytd", call("YTD", ref("v_base"))),
    formula("v_cumulative", "Cumulative", call("CUMULATIVE", ref("v_base"))),
    formula("v_opening", "Opening", call("OPENING", ref("v_base"))),
    formula("v_closing", "Closing", call("CLOSING", ref("v_base"))),
    formula("v_growth", "Growth", call("GROWTH", ref("v_base"))),
    formula("v_growth2", "Growth Two", call("GROWTH", ref("v_base"), lit(2))),
    formula("v_spread", "Spread", call("SPREAD", ref("v_base"), lit(3))),
    formula("v_min", "Min", call("MIN", ref("v_base"), lit(55))),
    formula("v_max", "Max", call("MAX", ref("v_base"), lit(55))),
    formula("v_abs", "Abs", call("ABS", sub(lit(55), ref("v_base")))),

    formula("v_if", "If", iff(gte(ref("v_base"), lit(100)), lit(1), lit(0))),
    formula("v_eq", "Eq", iff(ne(ref("v_base"), lit(50)), lit(0), lit(1))),
    formula("v_lt", "Lt", lt(ref("v_base"), lit(50))),

    formula("v_member_sum", "Member Sum", call("MEMBER_SUM", ref("v_plan"))),
    formula("v_member_avg", "Member Avg", call("MEMBER_AVG", ref("v_plan"))),
    formula("v_member_min", "Member Min", call("MEMBER_MIN", ref("v_plan"))),
    formula("v_member_max", "Member Max", call("MEMBER_MAX", ref("v_plan"))),
    formula("v_member_count", "Member Count", call("MEMBER_COUNT", ref("v_plan"))),

    // Precedence and associativity, evaluated rather than printed: if the
    // parser ever disagrees with the printer about these, the round-trip check
    // catches the string and this catches the number.
    formula("v_precedence", "Precedence", add(lit(2), mul(lit(3), lit(4)))),
    formula("v_power", "Power", pow(lit(2), pow(lit(3), lit(2)))),
    formula("v_nested", "Nested", div(sub(ref("v_base"), lit(10)), lit(2))),
  ],
};

/** The rows a golden file covers — every FORMULA variable, in declaration order. */
export const PRIMITIVE_ROWS = PRIMITIVE_MODEL.variables
  .filter((v) => v.kind === "FORMULA")
  .map((v) => v.id);
