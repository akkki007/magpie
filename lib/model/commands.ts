import type { Override } from "./scenario";
import { TOTAL } from "./types";
import type { FormulaNode, Model, Scenario, Variable, VariableKind } from "./types";

/**
 * The command bus (`docs/modelling-plan.md` §1.3).
 *
 * Every mutation — a user typing in a cell, a menu action, and later an agent
 * tool call — goes through this one list of typed commands, and each `apply`
 * hands back the command that undoes it. That single property is what makes
 * undo, the audit log, version history and AI proposals **one mechanism
 * instead of five**. It is worth the extra indirection now precisely because
 * retrofitting it is what kills projects like this at month six.
 *
 * Today the commands run against an in-memory `Model`. When M0's tables land
 * they run against Postgres and are persisted in order; the shape does not
 * change.
 */

export type Command =
  | {
      type: "SetInput";
      variableId: string;
      member: string;
      period: number;
      value: number;
    }
  | { type: "RenameVariable"; variableId: string; name: string }
  | {
      type: "SetFormula";
      variableId: string;
      /** `null` turns a computed row back into one you type into. */
      formula: FormulaNode | null;
      /**
       * Carried only by an inverse. Kind is otherwise derived — a formula makes
       * a row `FORMULA`, removing one makes it `INPUT` — but a `LINKED` row that
       * gained a formula has to come back as `LINKED`, and deriving cannot know
       * that. An inverse that is nearly right is worse than no undo.
       */
      kind?: VariableKind;
    }
  | {
      type: "InsertVariable";
      index: number;
      variable: Variable;
      /** The variable's input series, so an undone delete comes back whole. */
      inputs?: Record<string, number[]>;
    }
  | { type: "RemoveVariable"; variableId: string }
  /* ── Scenarios (§4, M4.1) ───────────────────────────────────────────────*/
  | { type: "CreateScenario"; scenario: Scenario }
  | { type: "RenameScenario"; scenarioId: string; name: string }
  | { type: "DeleteScenario"; scenarioId: string }
  | {
      type: "SetOverride";
      scenarioId: string;
      variableId: string;
      /** `null` removes the override, so the variable falls back through to base. */
      value: Override | null;
    };

export type CommandResult = { model: Model; inverse: Command; label: string };

/**
 * What this command is called in the undo button and the history panel.
 *
 * Derived from the command rather than passed alongside it, because the server
 * records the label into the log and never runs `applyCommand` — two places
 * writing their own wording is how the history panel ends up disagreeing with
 * the tooltip on the undo button.
 */
export function labelFor(command: Command): string {
  switch (command.type) {
    case "SetInput":
      return "Edit value";
    case "RenameVariable":
      return "Rename variable";
    case "SetFormula":
      return command.formula ? "Edit formula" : "Clear formula";
    case "InsertVariable":
      return "Add variable";
    case "RemoveVariable":
      return "Delete variable";
    case "CreateScenario":
      return "Add scenario";
    case "RenameScenario":
      return "Rename scenario";
    case "DeleteScenario":
      return "Delete scenario";
    case "SetOverride":
      return command.value ? "Override in scenario" : "Clear override";
  }
}

export function applyCommand(model: Model, command: Command): CommandResult {
  switch (command.type) {
    case "SetInput": {
      const { variableId, member, period, value } = command;
      const table = model.inputs[variableId] ?? {};
      const existing = table[member] ?? table[TOTAL] ?? [];
      const before = existing[period] ?? 0;

      const next = [...existing];
      // A series shorter than the horizon (a variable added mid-model) pads
      // with zeroes rather than leaving holes the evaluator has to guess at.
      while (next.length < model.periods.length) next.push(0);
      next[period] = value;

      return {
        model: {
          ...model,
          inputs: { ...model.inputs, [variableId]: { ...table, [member]: next } },
        },
        inverse: { ...command, value: before },
        label: labelFor(command),
      };
    }

    case "RenameVariable": {
      const before = model.variables.find((v) => v.id === command.variableId)?.name ?? "";
      return {
        model: {
          ...model,
          variables: model.variables.map((v) =>
            v.id === command.variableId ? { ...v, name: command.name } : v,
          ),
        },
        // Formulas hold ids, not names, so a rename touches exactly one field
        // and nothing downstream needs to know (§1.1).
        inverse: { type: "RenameVariable", variableId: command.variableId, name: before },
        label: labelFor(command),
      };
    }

    case "SetFormula": {
      const before = model.variables.find((v) => v.id === command.variableId);
      const kind: VariableKind = command.kind ?? (command.formula ? "FORMULA" : "INPUT");

      return {
        model: {
          ...model,
          variables: model.variables.map((v) =>
            v.id === command.variableId
              ? { ...v, kind, ...(command.formula ? { formula: command.formula } : { formula: undefined }) }
              : v,
          ),
        },
        inverse: {
          type: "SetFormula",
          variableId: command.variableId,
          formula: before?.formula ?? null,
          kind: before?.kind,
        },
        label: labelFor(command),
      };
    }

    case "InsertVariable": {
      const variables = [...model.variables];
      const index = Math.min(Math.max(command.index, 0), variables.length);
      variables.splice(index, 0, command.variable);

      return {
        model: {
          ...model,
          variables,
          inputs: command.inputs
            ? { ...model.inputs, [command.variable.id]: command.inputs }
            : model.inputs,
        },
        inverse: { type: "RemoveVariable", variableId: command.variable.id },
        label: labelFor(command),
      };
    }

    case "RemoveVariable": {
      const index = model.variables.findIndex((v) => v.id === command.variableId);
      if (index === -1) {
        return { model, inverse: command, label: labelFor(command) };
      }

      const variable = model.variables[index];
      const inputs = model.inputs[command.variableId];
      const nextInputs = { ...model.inputs };
      delete nextInputs[command.variableId];

      return {
        model: {
          ...model,
          variables: model.variables.filter((v) => v.id !== command.variableId),
          inputs: nextInputs,
        },
        inverse: { type: "InsertVariable", index, variable, inputs },
        label: labelFor(command),
      };
    }
    /* ── Scenarios ─────────────────────────────────────────────────────*/

    case "CreateScenario":
      return {
        model: { ...model, scenarios: [...model.scenarios, command.scenario] },
        inverse: { type: "DeleteScenario", scenarioId: command.scenario.id },
        label: labelFor(command),
      };

    case "RenameScenario": {
      const before = model.scenarios.find((s) => s.id === command.scenarioId)?.name ?? "";
      return {
        model: {
          ...model,
          scenarios: model.scenarios.map((s) =>
            s.id === command.scenarioId ? { ...s, name: command.name } : s,
          ),
        },
        inverse: { type: "RenameScenario", scenarioId: command.scenarioId, name: before },
        label: labelFor(command),
      };
    }

    case "DeleteScenario": {
      const scenario = model.scenarios.find((s) => s.id === command.scenarioId);
      if (!scenario) return { model, inverse: command, label: labelFor(command) };
      return {
        model: {
          ...model,
          scenarios: model.scenarios.filter((s) => s.id !== command.scenarioId),
        },
        // The whole scenario, overrides included — an undone delete has to bring back the
        // numbers, not just the name.
        inverse: { type: "CreateScenario", scenario },
        label: labelFor(command),
      };
    }

    case "SetOverride": {
      const scenario = model.scenarios.find((s) => s.id === command.scenarioId);
      const before = scenario?.overrides.find((o) => o.variableId === command.variableId);

      const overrides = [
        ...(scenario?.overrides ?? []).filter((o) => o.variableId !== command.variableId),
        ...(command.value ? [{ variableId: command.variableId, value: command.value }] : []),
      ];

      return {
        model: {
          ...model,
          scenarios: model.scenarios.map((s) =>
            s.id === command.scenarioId ? { ...s, overrides } : s,
          ),
        },
        inverse: {
          type: "SetOverride",
          scenarioId: command.scenarioId,
          variableId: command.variableId,
          value: before?.value ?? null,
        },
        label: labelFor(command),
      };
    }
  }
}

/** Apply a batch in order, returning the inverses reversed — undo is a replay. */
export function applyAll(model: Model, commands: Command[]) {
  let next = model;
  const inverses: Command[] = [];
  for (const command of commands) {
    const result = applyCommand(next, command);
    next = result.model;
    inverses.unshift(result.inverse);
  }
  return { model: next, inverses };
}
