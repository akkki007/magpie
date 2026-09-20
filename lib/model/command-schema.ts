import { z } from "zod";

import { FUNCTION_NAMES, OPERATORS } from "./primitives";
import { OverrideSchema } from "./scenario";
import type { BinaryOp, FormulaFn } from "./types";

/**
 * The wire schema for a command (`docs/modelling-plan.md` M1.1).
 *
 * A server function is reachable by direct POST, not only through the UI, so everything it
 * receives is untrusted input — the same rule the reconciliation module applies to a model's
 * output (`docs/recon-plan.md` §A3). A `Command` that arrived over the network has to be
 * parsed before it is applied, and this is the one definition of what a legal one looks like.
 *
 * It mirrors the union in `commands.ts` deliberately: TypeScript's types are gone at runtime,
 * so the type there and the schema here are the compile-time and run-time halves of the same
 * statement. `satisfies` in the action keeps them from drifting apart silently.
 */

/**
 * Derived, not retyped. A hand-written list here would be a fourth place the
 * primitive set is written down (`types.ts`, `primitives.ts`, the Prisma enum)
 * and the only one nothing checks — so the first formula using a new function
 * would be rejected at the network boundary with a validation error nobody
 * could explain. `primitives.ts` is already pinned to the union by `satisfies`.
 */
const FN_NAMES = FUNCTION_NAMES as [FormulaFn, ...FormulaFn[]];
const OP_NAMES = Object.keys(OPERATORS) as [BinaryOp, ...BinaryOp[]];

const FormulaNodeSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("literal"), value: z.number() }),
    z.object({
      type: z.literal("ref"),
      variableId: z.string().min(1),
      member: z.string().optional(),
    }),
    z.object({
      type: z.literal("binary"),
      op: z.enum(OP_NAMES),
      left: FormulaNodeSchema,
      right: FormulaNodeSchema,
    }),
    z.object({
      type: z.literal("call"),
      fn: z.enum(FN_NAMES),
      args: z.array(FormulaNodeSchema),
    }),
  ]),
);

const VariableSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["INPUT", "FORMULA", "LINKED"]),
  format: z.enum(["CURRENCY", "COUNT", "PERCENT", "RATIO"]),
  aggregation: z.enum(["SUM", "FIRST", "LAST", "AVG", "NONE"]),
  formula: FormulaNodeSchema.optional(),
  dimensionId: z.string().optional(),
  memberRollup: z.enum(["SUM", "AVG"]).optional(),
  timeContext: z.string().optional(),
  note: z.string().optional(),
});

const ScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  isBase: z.boolean(),
  parentId: z.string().optional(),
  overrides: z.array(
    z.object({ variableId: z.string().min(1), value: OverrideSchema }),
  ),
});

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SetInput"),
    variableId: z.string().min(1),
    member: z.string(),
    period: z.number().int().min(0),
    /** Finite: `Infinity` and `NaN` serialise through JSON as `null`, but belt and braces. */
    value: z.number().finite(),
  }),
  z.object({
    type: z.literal("RenameVariable"),
    variableId: z.string().min(1),
    name: z.string().min(1).max(120),
  }),
  z.object({
    type: z.literal("SetFormula"),
    variableId: z.string().min(1),
    formula: FormulaNodeSchema.nullable(),
    kind: z.enum(["INPUT", "FORMULA", "LINKED"]).optional(),
  }),
  z.object({
    type: z.literal("InsertVariable"),
    index: z.number().int().min(0),
    variable: VariableSchema,
    inputs: z.record(z.string(), z.array(z.number().finite())).optional(),
  }),
  z.object({
    type: z.literal("RemoveVariable"),
    variableId: z.string().min(1),
  }),

  /* ── Scenarios (M4.1) ─────────────────────────────────────────────────*/
  z.object({
    type: z.literal("CreateScenario"),
    scenario: ScenarioSchema,
  }),
  z.object({
    type: z.literal("RenameScenario"),
    scenarioId: z.string().min(1),
    name: z.string().min(1).max(120),
  }),
  z.object({
    type: z.literal("DeleteScenario"),
    scenarioId: z.string().min(1),
  }),
  z.object({
    type: z.literal("SetOverride"),
    scenarioId: z.string().min(1),
    variableId: z.string().min(1),
    value: OverrideSchema.nullable(),
  }),
]);
