import { TOTAL } from "./types";
import type { Model, Scenario, Variable } from "./types";
import type { FormulaNode } from "./types";

/**
 * The calculation engine.
 *
 * Pure TypeScript, no database, no React: input is a plain `Model`, output is
 * a lookup of series (`docs/modelling-plan.md` §3). That is what makes it testable
 * from `scripts/calc-check.ts` and reusable on the client, which is where it
 * runs today — every keystroke in the grid re-evaluates the whole model.
 *
 * ── One deliberate deviation from §3, and why ────────────────────────────
 * The plan describes whole-series (vectorised) evaluation over a topologically
 * sorted DAG. This implementation evaluates **one cell at a time, memoised**,
 * because of the shape of an ARR waterfall:
 *
 *     Opening ARR[t] = Closing ARR[t-1]
 *     Closing ARR[t] = Opening ARR[t] + New – Churn + Expansion
 *
 * At the *variable* level that is a cycle, and a topological sort rejects it.
 * At the *cell* level it is not: `Opening ARR[3]` depends on `Closing ARR[2]`,
 * never on itself. Memoising `(variable, member, period)` makes the lag fall
 * out for free, and re-entering the same key is then an honest circular
 * reference, reported by name.
 *
 * The cost is a function call per cell instead of per series: ~25 variables ×
 * 24 periods × 4 member slices ≈ 2,400 evaluations, which is sub-millisecond.
 * When the model reaches the sizes §8 worries about, the fix is to vectorise
 * the acyclic majority and keep this path for lagged cycles — not to give up
 * the waterfall.
 */

export type Series = number[];

/**
 * Half of the last digit `numeric(20,6)` can store (§2). Two values the
 * database cannot tell apart compare as equal, which keeps the six comparison
 * operators mutually consistent: exactly one of `<`, `=`, `>` holds for any
 * pair. Exact `===` on doubles would let a cell be neither equal to nor
 * greater than nor less than another, and an `IF` built on that is unfixable
 * from the user's side.
 */
const EPSILON = 5e-7;

const compare = (l: number, r: number) => (Math.abs(l - r) < EPSILON ? 0 : l < r ? -1 : 1);

export type Evaluation = {
  /** Series for a variable, optionally sliced to a dimension member. */
  series: (variableId: string, member?: string) => Series;
  /** Single cell, for cheap reads (the sparkline uses `series`). */
  valueAt: (variableId: string, member: string, period: number) => number;
  /** `variableId → message`. A cell in an errored row renders as `—`. */
  errors: Record<string, string>;
};

export function evaluate(model: Model, scenarioId?: string): Evaluation {
  const scenario: Scenario | undefined =
    model.scenarios.find((s) => s.id === scenarioId) ??
    model.scenarios.find((s) => s.isBase);

  /** Scenario overlay, resolved once: `variableId → multiplier` (§4). */
  const scale = new Map<string, number>(
    (scenario?.overrides ?? []).map((o) => [o.variableId, o.scale]),
  );

  const byId = new Map(model.variables.map((v) => [v.id, v]));
  const dimensions = new Map(model.dimensions.map((d) => [d.id, d]));
  const periodCount = model.periods.length;

  const memo = new Map<string, number>();
  const stack = new Set<string>();
  const errors: Record<string, string> = {};

  const key = (id: string, member: string, t: number) => `${id}|${member}|${t}`;

  function inputAt(variable: Variable, member: string, t: number): number {
    const table = model.inputs[variable.id];
    // Falling back to the TOTAL row lets an undimensioned assumption be read
    // from inside a member context without duplicating it per member.
    const row = table?.[member] ?? table?.[TOTAL];
    const raw = row?.[t] ?? 0;
    return raw * (scale.get(variable.id) ?? 1);
  }

  function rollupMembers(variable: Variable, t: number): number {
    const dimension = dimensions.get(variable.dimensionId ?? "");
    if (!dimension) return 0;
    const values = dimension.members.map((m) => valueAt(variable.id, m.key, t));
    if (variable.memberRollup === "AVG") {
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    }
    return values.reduce((a, b) => a + b, 0);
  }

  function valueAt(variableId: string, member: string, t: number): number {
    if (t < 0 || t >= periodCount) return 0;

    const variable = byId.get(variableId);
    if (!variable) return 0;

    const cell = key(variableId, member, t);
    const cached = memo.get(cell);
    if (cached !== undefined) return cached;

    if (stack.has(cell)) {
      errors[variableId] = `Circular reference at ${variable.name}`;
      return 0;
    }

    stack.add(cell);
    let out: number;
    try {
      if (variable.dimensionId && member === TOTAL) {
        out = rollupMembers(variable, t);
      } else if (variable.kind === "FORMULA" && variable.formula) {
        out = evalNode(variable.formula, member, t);
      } else {
        out = inputAt(variable, member, t);
      }
    } finally {
      stack.delete(cell);
    }

    // A division by zero in period 0 is normal in a waterfall (no opening
    // balance yet). Zero is the honest answer; NaN would poison every
    // downstream cell and show up as a blank column nobody can explain.
    if (!Number.isFinite(out)) out = 0;

    memo.set(cell, out);
    return out;
  }

  function evalNode(node: FormulaNode, member: string, t: number): number {
    switch (node.type) {
      case "literal":
        return node.value;

      case "ref": {
        const target = byId.get(node.variableId);
        if (!target) return 0;
        // Context propagation, the one subtle rule in §1.6: inside a member
        // context, a reference to a dimensioned variable follows the member;
        // a reference to an undimensioned one reads the total. That is what
        // makes `New ARR · Growth = New Accounts · Growth × ACV · Growth`
        // while `Churn ARR · Growth` still reads the single churn rate.
        const slice = node.member ?? (target.dimensionId ? member : TOTAL);
        return valueAt(node.variableId, slice, t);
      }

      case "binary": {
        const l = evalNode(node.left, member, t);
        const r = evalNode(node.right, member, t);
        switch (node.op) {
          case "+":
            return l + r;
          case "-":
            return l - r;
          case "*":
            return l * r;
          case "/":
            return r === 0 ? 0 : l / r;
          case "^":
            return l ** r;
          // Comparison yields 1 or 0, so a condition is just a number and the
          // grid never has to render a boolean.
          case "=":
            return compare(l, r) === 0 ? 1 : 0;
          case "<>":
            return compare(l, r) === 0 ? 0 : 1;
          case "<":
            return compare(l, r) < 0 ? 1 : 0;
          case "<=":
            return compare(l, r) <= 0 ? 1 : 0;
          case ">":
            return compare(l, r) > 0 ? 1 : 0;
          case ">=":
            return compare(l, r) >= 0 ? 1 : 0;
        }
      }

      case "call":
        return evalCall(node, member, t);
    }
  }

  /**
   * Every member series of the variable a `MEMBER_*` argument points at.
   *
   * The argument must be a bare reference — `MEMBER_AVG(ACV × 2)` has no
   * meaning, because "the members" is a property of a stored variable, not of
   * an expression. `validateFormula` rejects anything else before it can be
   * saved; this returns an empty list so a row that somehow got past it reads
   * as zero rather than throwing inside a render.
   */
  function memberValues(arg: FormulaNode | undefined, t: number): number[] | null {
    if (arg?.type !== "ref") return null;
    const target = byId.get(arg.variableId);
    const dimension = dimensions.get(target?.dimensionId ?? "");
    if (!dimension) return null;
    return dimension.members.map((m) => valueAt(arg.variableId, m.key, t));
  }

  /** First and last period index of the calendar year containing `t`. */
  function yearBounds(t: number): [number, number] {
    const { year } = model.periods[t];
    let first = t;
    while (first > 0 && model.periods[first - 1].year === year) first--;
    let last = t;
    while (last < periodCount - 1 && model.periods[last + 1].year === year) last++;
    return [first, last];
  }

  function evalCall(
    node: Extract<FormulaNode, { type: "call" }>,
    member: string,
    t: number,
  ): number {
    const [first, ...rest] = node.args;

    switch (node.fn) {
      /** PRIOR(x, n = 1, fallback = 0) — the lag that makes waterfalls work. */
      case "PRIOR": {
        const n = rest[0] ? evalNode(rest[0], member, t) : 1;
        const at = t - n;
        if (at < 0) return rest[1] ? evalNode(rest[1], member, t) : 0;
        return evalNode(first, member, at);
      }

      case "NEXT": {
        const n = rest[0] ? evalNode(rest[0], member, t) : 1;
        const at = t + n;
        if (at >= periodCount) return rest[1] ? evalNode(rest[1], member, t) : 0;
        return evalNode(first, member, at);
      }

      /** Calendar-year to date, inclusive of the current period. */
      case "YTD": {
        const year = model.periods[t].year;
        let sum = 0;
        for (let i = t; i >= 0 && model.periods[i].year === year; i--) {
          sum += evalNode(first, member, i);
        }
        return sum;
      }

      case "CUMULATIVE": {
        let sum = 0;
        for (let i = 0; i <= t; i++) sum += evalNode(first, member, i);
        return sum;
      }

      case "MIN":
        return Math.min(...node.args.map((a) => evalNode(a, member, t)));

      case "MAX":
        return Math.max(...node.args.map((a) => evalNode(a, member, t)));

      case "ABS":
        return Math.abs(evalNode(first, member, t));

      /** The value in January of this year — the base a year's growth is measured from. */
      case "OPENING":
        return evalNode(first, member, yearBounds(t)[0]);

      /** The value in December of this year. Forward-looking on purpose: it is
       *  what a year-end target is compared against, and the horizon is known. */
      case "CLOSING":
        return evalNode(first, member, yearBounds(t)[1]);

      /** GROWTH(x, n = 1) — the rate, not the delta. No base period, no growth. */
      case "GROWTH": {
        const n = rest[0] ? evalNode(rest[0], member, t) : 1;
        const at = t - n;
        if (at < 0) return 0;
        const before = evalNode(first, member, at);
        if (before === 0) return 0;
        return (evalNode(first, member, t) - before) / before;
      }

      /**
       * SPREAD(x, n) — recognise each period's amount evenly over the following
       * n periods. An annual contract booked in March shows as one twelfth in
       * each of March to February, which is how deferred revenue actually
       * behaves. Periods before the model starts contribute nothing but still
       * divide by n, so the ramp-in is visible rather than hidden.
       */
      case "SPREAD": {
        const span = Math.floor(evalNode(rest[0], member, t));
        if (span < 1) return 0;
        let sum = 0;
        for (let i = Math.max(0, t - span + 1); i <= t; i++) sum += evalNode(first, member, i);
        return sum / span;
      }

      case "IF":
        return evalNode(first, member, t) !== 0
          ? evalNode(rest[0], member, t)
          : evalNode(rest[1], member, t);

      /* Across the members of a dimension (§1.6) — a different axis from the
         scalar MIN/MAX above, which collapse several values in one cell. */
      case "MEMBER_SUM": {
        const values = memberValues(first, t);
        return values ? values.reduce((a, b) => a + b, 0) : 0;
      }

      case "MEMBER_AVG": {
        const values = memberValues(first, t);
        return values?.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      }

      case "MEMBER_MIN": {
        const values = memberValues(first, t);
        return values?.length ? Math.min(...values) : 0;
      }

      case "MEMBER_MAX": {
        const values = memberValues(first, t);
        return values?.length ? Math.max(...values) : 0;
      }

      case "MEMBER_COUNT":
        return memberValues(first, t)?.length ?? 0;
    }
  }

  const seriesCache = new Map<string, Series>();

  function series(variableId: string, member: string = TOTAL): Series {
    const cacheKey = `${variableId}|${member}`;
    const hit = seriesCache.get(cacheKey);
    if (hit) return hit;
    const out = model.periods.map((_, t) => valueAt(variableId, member, t));
    seriesCache.set(cacheKey, out);
    return out;
  }

  return { series, valueAt, errors };
}
