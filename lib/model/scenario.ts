import { z } from "zod";

import type { FormulaNode, Model, Scenario } from "./types";

/**
 * What a scenario overrides (`docs/modelling-plan.md` §4, M4).
 *
 * §4's rule is that a scenario is **an overlay, not a copy**: override rows replace a
 * variable's formula or values, and everything unoverridden falls through to the base case.
 * Copying a model per scenario means a fix to the base has to be applied five times, and
 * "what actually differs between base and downside?" stops being answerable.
 *
 * Until M4 an override was a bare multiplier, which is enough to *seed* an upside and not
 * enough to *edit* one: typing 450 into a downside cell is not a factor, it is a number.
 * The three shapes below are the ones §4 asks for, and `value` was already `jsonb` for
 * exactly this reason — the widening is a change to what the column holds, not a migration.
 *
 * `OverrideSchema` parses on the way out of Postgres. A `jsonb` column has no shape the
 * database will enforce, so an old or hand-edited row would otherwise be read as
 * `undefined` somewhere deep in the evaluator and quietly become a zero. Parsing at the
 * edge turns that into a failure at the read, which is where it can still be explained.
 */

const FormulaNodeSchema: z.ZodType<FormulaNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("literal"), value: z.number() }),
    z.object({
      type: z.literal("ref"),
      variableId: z.string().min(1),
      member: z.string().optional(),
    }),
    z.object({
      type: z.literal("binary"),
      op: z.enum(["+", "-", "*", "/", "^", "=", "<>", "<", "<=", ">", ">="]),
      left: FormulaNodeSchema,
      right: FormulaNodeSchema,
    }),
    z.object({ type: z.literal("call"), fn: z.string(), args: z.array(FormulaNodeSchema) }),
  ]),
) as z.ZodType<FormulaNode>;

export const OverrideSchema = z.discriminatedUnion("kind", [
  /**
   * Multiply the base input. How an upside and a downside are actually authored — "growth
   * 28% better" is one number, not sixty — and the shape every seeded scenario uses.
   * It applies to INPUT values only: a formula variable has nothing to scale, and scaling
   * its *result* would break the arithmetic that produced it.
   */
  z.object({ kind: z.literal("SCALE"), factor: z.number().finite() }),
  /**
   * Replace individual cells, keyed by member. `null` in a series means "this period is not
   * overridden" and falls through — which is what lets someone change March in the downside
   * without pinning every other month to whatever it happened to be that day.
   */
  z.object({
    kind: z.literal("VALUES"),
    cells: z.record(z.string(), z.array(z.number().finite().nullable())),
  }),
  /** Replace the variable's formula outright (§4). */
  z.object({ kind: z.literal("FORMULA"), formula: FormulaNodeSchema }),
]);

export type Override = z.infer<typeof OverrideSchema>;

/**
 * The overrides in force for a scenario, nearest first.
 *
 * §2: `Scenario.parentId` — scenarios branch from scenarios, and the base case is the one
 * with no parent. A branch inherits what it does not restate, so resolution walks up the
 * chain and the nearest override wins outright. It does not *compose* with its ancestors:
 * a child that says "450" means 450, not 450 scaled by whatever its parent was doing.
 * Composition would make a scenario's numbers depend on edits made somewhere the user is
 * not looking.
 */
export function resolveOverrides(model: Model, scenarioId?: string): Map<string, Override> {
  const byId = new Map(model.scenarios.map((s) => [s.id, s]));
  const start =
    (scenarioId ? byId.get(scenarioId) : undefined) ?? model.scenarios.find((s) => s.isBase);

  const resolved = new Map<string, Override>();
  const seen = new Set<string>();

  let current: Scenario | undefined = start;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    for (const override of current.overrides) {
      // Nearest wins: the first time a variable is seen walking up is the answer.
      if (!resolved.has(override.variableId)) resolved.set(override.variableId, override.value);
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return resolved;
}

/** Scenarios from the base outwards, each with its depth — the picker's ordering. */
export function scenarioTree(scenarios: Scenario[]) {
  const children = new Map<string | undefined, Scenario[]>();
  for (const scenario of scenarios) {
    const key = scenario.parentId ?? undefined;
    children.set(key, [...(children.get(key) ?? []), scenario]);
  }

  const out: { scenario: Scenario; depth: number }[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const scenario of children.get(parent) ?? []) {
      out.push({ scenario, depth });
      walk(scenario.id, depth + 1);
    }
  };
  walk(undefined, 0);

  // Anything whose parent is missing would otherwise vanish from the picker entirely.
  for (const scenario of scenarios) {
    if (!out.some((entry) => entry.scenario.id === scenario.id)) out.push({ scenario, depth: 0 });
  }
  return out;
}

/** `cells` with one period set, leaving the rest falling through. */
export function withCell(
  override: Override | undefined,
  model: Model,
  member: string,
  period: number,
  value: number,
): Override {
  const cells =
    override?.kind === "VALUES" ? { ...override.cells } : {};
  const series = [...(cells[member] ?? Array(model.periods.length).fill(null))];
  while (series.length < model.periods.length) series.push(null);
  series[period] = value;
  cells[member] = series;
  return { kind: "VALUES", cells };
}
