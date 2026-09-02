import { z } from "zod";

import { CommandSchema } from "./command-schema";
import { applyAll, type Command } from "./commands";
import { evaluate } from "./engine";
import { printFormula } from "./formula";
import { validateFormula } from "./validate";
import { TOTAL, type Model } from "./types";

/**
 * What the agent is allowed to read and to propose (`docs/modelling-plan.md` §5, M5.1).
 *
 * No SDK import here, on purpose — the same boundary `lib/recon/adjudicate.ts` draws for
 * the reconciliation module. Everything that decides whether a proposal is *safe* lives in
 * this file; `openai-agent.ts` only knows how to drive a conversation and call the
 * functions below. Swapping vendors, which this repo has already done once, must not be
 * able to change what counts as an acceptable command.
 *
 * §5's tool list is `getModelOutline`, `getVariable`, `getSeries`, `searchDataSources`,
 * `runScenario`, plus the command union as writes. `searchDataSources` is not here: it
 * reads `DataSource` rows M7 has not built yet, and a tool over a table that does not
 * exist is not a smaller version of the feature, it is a broken one.
 */

/* ── Reads: outline plus targeted reads, never the full data ────────────────
   §5: "prompt + model outline (outline plus targeted reads, never the full data — it
   keeps context small)". The outline is names, kinds and formulas as text — never a
   series. A model outgrows a context window in its numbers long before it does in its
   variable list, so the outline has to stay outline-shaped even as the model grows. */

export function getModelOutline(model: Model) {
  const nameOf = (id: string) => model.variables.find((v) => v.id === id)?.name ?? id;
  return {
    name: model.name,
    periods: { first: model.periods[0]?.label, last: model.periods.at(-1)?.label, count: model.periods.length },
    groups: model.groups.map((g) => ({ id: g.id, name: g.name })),
    variables: model.variables.map((v) => ({
      id: v.id,
      name: v.name,
      groupId: v.groupId,
      kind: v.kind,
      format: v.format,
      aggregation: v.aggregation,
      dimensionId: v.dimensionId,
      // The printed string, not the tree — an outline is for reading, and a nested AST
      // costs far more tokens to convey the same fact than "Opening ARR + New ARR".
      formula: v.formula ? printFormula(v.formula, nameOf) : undefined,
    })),
    dimensions: model.dimensions.map((d) => ({ id: d.id, name: d.name, members: d.members })),
    scenarios: model.scenarios.map((s) => ({
      id: s.id,
      name: s.name,
      isBase: s.isBase,
      parentId: s.parentId,
      overriddenVariableIds: s.overrides.map((o) => o.variableId),
    })),
  };
}

export const GetVariableInput = z.object({ variableId: z.string() });

export function getVariable(model: Model, args: z.infer<typeof GetVariableInput>) {
  const variable = model.variables.find((v) => v.id === args.variableId);
  if (!variable) return { error: `No variable with id ${args.variableId}` };
  const nameOf = (id: string) => model.variables.find((v) => v.id === id)?.name ?? id;
  return {
    ...variable,
    formula: variable.formula ? printFormula(variable.formula, nameOf) : undefined,
  };
}

export const GetSeriesInput = z.object({
  variableId: z.string(),
  scenarioId: z.string().optional(),
  /** A member key, for a dimensioned variable — omit for the rolled-up total. */
  member: z.string().optional(),
});

export function getSeries(model: Model, args: z.infer<typeof GetSeriesInput>) {
  const variable = model.variables.find((v) => v.id === args.variableId);
  if (!variable) return { error: `No variable with id ${args.variableId}` };
  const values = evaluate(model, args.scenarioId).series(args.variableId, args.member ?? TOTAL);
  return {
    variableId: args.variableId,
    name: variable.name,
    format: variable.format,
    periods: model.periods.map((p, i) => ({ period: p.label, value: values[i] })),
  };
}

export const RunScenarioInput = z.object({
  scenarioId: z.string().optional(),
  /** Hypothetical commands, evaluated in memory. Nothing here reaches Postgres. */
  commands: z.array(CommandSchema).max(50),
});

/**
 * Zod's own diagnostics, handed back verbatim rather than replaced with "not well-formed".
 *
 * A live run found this the hard way: the model tried a VALUES override's `cells` as
 * `{"0": 212}` and then as a bare array, six times, alternating between the two wrong
 * shapes with no idea why either failed. A generic rejection gives a tool-calling loop
 * nothing to correct; the exact path and expectation ("cells.0: expected array, received
 * number") is the same thing a human gets from a TypeScript error, and it is what lets the
 * next call actually be different from the last one instead of another guess.
 */
function issuesOf(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * A sandbox: apply commands to an in-memory copy and report a few key series, without
 * writing anything. This is what lets the agent check its own arithmetic — "if I raise
 * growth 20%, does Closing ARR actually move the way I expect" — before it proposes
 * anything a human has to look at, rather than presenting a first guess as a fact.
 */
export function runScenario(model: Model, args: z.infer<typeof RunScenarioInput>) {
  const parsed = z.array(CommandSchema).safeParse(args.commands);
  if (!parsed.success) return { error: issuesOf(parsed.error) };

  let draft: Model;
  try {
    draft = applyAll(model, parsed.data as Command[]).model;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not apply those commands." };
  }

  const evaluation = evaluate(draft, args.scenarioId);
  return {
    affected: draft.variables
      .filter((v) => v.kind === "FORMULA" || parsed.data.some((c) => "variableId" in c && c.variableId === v.id))
      .slice(0, 20)
      .map((v) => ({
        id: v.id,
        name: v.name,
        last: evaluation.series(v.id).at(-1),
      })),
  };
}

/* ── The write: one grounded, validated batch ────────────────────────────── */

export const ProposeChangesInput = z.object({
  label: z.string().min(1).max(120),
  commands: z.array(CommandSchema).min(1).max(50),
});

export type GroundedProposal =
  | { ok: true; label: string; commands: Command[] }
  | { ok: false; error: string };

/**
 * The gate a proposal passes before a human ever sees it (§1.4, §5).
 *
 * "The agent may only reference variables that exist or that it creates in the same
 * changeset, and every formula AST is validated and cycle-checked before the user sees
 * it. A proposal that does not compile never reaches the UI." Three things enforce that:
 *
 * 1. Every referenced id — a variable, a scenario — must already exist in the model or
 *    have been created earlier in this same batch. A model hallucinating an id is the
 *    single most likely failure mode of a tool-calling loop, and it must fail here, not
 *    as a cryptic foreign-key error after the user clicked Accept.
 * 2. Every formula is run through the same `validateFormula` a human's edit goes through
 *    — unknown names, arity, members, cycles. One gate for both, per §5.
 * 3. The whole batch is replayed in memory with `applyAll`, which catches anything the
 *    two checks above do not (a malformed InsertVariable, an out-of-range period).
 */
export function groundProposal(model: Model, args: z.infer<typeof ProposeChangesInput>): GroundedProposal {
  const parsed = z.array(CommandSchema).safeParse(args.commands);
  if (!parsed.success) return { ok: false, error: issuesOf(parsed.error) };
  const commands = parsed.data as Command[];

  const variableIds = new Set(model.variables.map((v) => v.id));
  const scenarioIds = new Set(model.scenarios.map((s) => s.id));
  const knownVariables = [...model.variables];
  /** Scenarios created earlier in this batch — a SetOverride later in the same batch has
   *  to see whether one of *those* is the base, not only the ones already in Postgres. */
  const knownScenarios = new Map(model.scenarios.map((s) => [s.id, s]));

  for (const command of commands) {
    switch (command.type) {
      case "InsertVariable":
        if (command.variable.formula) {
          const invalid = validateFormula(
            command.variable.formula,
            { variables: knownVariables, dimensions: model.dimensions },
            command.variable.id,
          );
          if (invalid) return { ok: false, error: `${command.variable.name}: ${invalid.message}` };
        }
        variableIds.add(command.variable.id);
        knownVariables.push(command.variable);
        break;

      case "SetFormula": {
        if (!variableIds.has(command.variableId)) {
          return { ok: false, error: `No variable ${command.variableId} to set a formula on` };
        }
        if (command.formula) {
          const invalid = validateFormula(
            command.formula,
            { variables: knownVariables, dimensions: model.dimensions },
            command.variableId,
          );
          if (invalid) return { ok: false, error: invalid.message };
        }
        break;
      }

      case "SetInput":
      case "RenameVariable":
      case "RemoveVariable":
        if (!variableIds.has(command.variableId)) {
          return { ok: false, error: `No variable ${command.variableId} in this model` };
        }
        if (command.type === "RemoveVariable") variableIds.delete(command.variableId);
        break;

      case "CreateScenario":
        scenarioIds.add(command.scenario.id);
        knownScenarios.set(command.scenario.id, command.scenario);
        break;
      case "RenameScenario":
      case "DeleteScenario":
        if (!scenarioIds.has(command.scenarioId)) {
          return { ok: false, error: `No scenario ${command.scenarioId} in this model` };
        }
        if (command.type === "DeleteScenario") scenarioIds.delete(command.scenarioId);
        break;
      case "SetOverride": {
        if (!scenarioIds.has(command.scenarioId)) {
          return { ok: false, error: `No scenario ${command.scenarioId} in this model` };
        }
        if (!variableIds.has(command.variableId)) {
          return { ok: false, error: `No variable ${command.variableId} in this model` };
        }
        // The same refusal `commands-db.ts` enforces at accept time — caught here instead
        // of there. A live run found this the hard way: without it, a proposal that
        // targets the base case passes this gate, renders as something a human can
        // accept, and only fails once they click Accept. §5's whole promise is that a
        // proposal which does not compile never reaches the UI in the first place.
        const scenario = model.scenarios.find((s) => s.id === command.scenarioId);
        const created = knownScenarios.get(command.scenarioId);
        if ((scenario?.isBase ?? created?.isBase) === true) {
          return { ok: false, error: "The base case holds values, not overrides — override a scenario instead" };
        }
        break;
      }
    }
  }

  try {
    applyAll(model, commands);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That batch does not apply." };
  }

  return { ok: true, label: args.label, commands };
}
