import { z } from "zod";

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
      op: z.enum(["+", "-", "*", "/", "^"]),
      left: FormulaNodeSchema,
      right: FormulaNodeSchema,
    }),
    z.object({
      type: z.literal("call"),
      fn: z.enum(["PRIOR", "NEXT", "YTD", "CUMULATIVE", "MIN", "MAX", "ABS"]),
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
    type: z.literal("InsertVariable"),
    index: z.number().int().min(0),
    variable: VariableSchema,
    inputs: z.record(z.string(), z.array(z.number().finite())).optional(),
  }),
  z.object({
    type: z.literal("RemoveVariable"),
    variableId: z.string().min(1),
  }),
]);
