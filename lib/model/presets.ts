import { evaluate } from "./engine";
import type { Model, Scenario, Variable } from "./types";

/**
 * Best / base / worst as three overlays (`docs/modelling-plan.md` M4.4, §4).
 *
 * ── This is not the AI part, and says so ────────────────────────────────
 * §4: "AI forecasting (best / base / worst) is then just an agent generating three
 * overlays." The overlays are the product; *who generates them* is M5. What is here is a
 * deterministic generator, so that the scenario format, the command batch and the UI are
 * all real and exercised before an agent is pointed at them. Calling it AI today would be
 * the landing page's mistake in a different file.
 *
 * ── Direction is measured, not guessed ──────────────────────────────────
 * The hard part of "best case" is knowing which way each driver goes. Raising `New
 * Accounts` helps and raising `Churn Rate` hurts, and nothing in the schema says so — a
 * generator that scaled every input upwards would produce a "best case" with more churn
 * in it.
 *
 * Name-matching for "churn" and "cost" is the usual shortcut and is wrong the first time
 * somebody writes their model in another language. So the direction is computed instead:
 * nudge each input by 1%, re-evaluate, and see which way the objective moved. That is what
 * an analyst does by hand, it needs no new column, and it is right for reasons that do not
 * depend on the words anybody chose.
 *
 * A driver the objective does not respond to is left alone rather than scaled by a token
 * amount. A preset that touches rows the objective does not depend on makes the comparison
 * harder to read and claims a relationship that is not there.
 */

/** How much a 1% nudge to this input moves the objective, as a fraction of the objective. */
export type Driver = {
  variableId: string;
  name: string;
  /** Positive: more of this is better for the objective. Negative: worse. */
  sensitivity: number;
};

const NUDGE = 1.01;
/** Below this, the objective did not really respond — floating point, not a relationship. */
const NOISE = 1e-9;

/**
 * The objective's value as one number, collapsed the way §1.2 says this variable collapses.
 *
 * A stock and a flow are not comparable: `Closing ARR` is what it is at the end, `New ARR`
 * is what it added over the horizon. Reading `aggregation` rather than picking one means a
 * preset built on a balance and a preset built on a flow are both measuring the right thing.
 */
function objectiveValue(model: Model, targetId: string, scenario: Scenario | null): number {
  const series = evaluate(
    scenario ? { ...model, scenarios: [...model.scenarios, scenario] } : model,
    scenario ? scenario.id : model.scenarios.find((s) => s.isBase)?.id,
  ).series(targetId);

  const aggregation = model.variables.find((v) => v.id === targetId)?.aggregation ?? "SUM";
  switch (aggregation) {
    case "FIRST":
      return series[0] ?? 0;
    case "LAST":
    case "NONE":
      return series.at(-1) ?? 0;
    case "AVG":
      return series.length ? series.reduce((a, b) => a + b, 0) / series.length : 0;
    default:
      return series.reduce((a, b) => a + b, 0);
  }
}

/** Every INPUT the objective actually responds to, strongest first. */
export function driversFor(model: Model, targetId: string): Driver[] {
  const baseline = objectiveValue(model, targetId, null);
  if (!Number.isFinite(baseline) || baseline === 0) return [];

  const inputs = model.variables.filter((v: Variable) => v.kind === "INPUT");

  return inputs
    .map((variable) => {
      const probe: Scenario = {
        id: `__probe_${variable.id}`,
        name: "probe",
        isBase: false,
        parentId: model.scenarios.find((s) => s.isBase)?.id,
        overrides: [{ variableId: variable.id, value: { kind: "SCALE", factor: NUDGE } }],
      };
      const moved = objectiveValue(model, targetId, probe);
      return {
        variableId: variable.id,
        name: variable.name,
        sensitivity: (moved - baseline) / Math.abs(baseline),
      };
    })
    .filter((driver) => Math.abs(driver.sensitivity) > NOISE)
    .sort((a, b) => Math.abs(b.sensitivity) - Math.abs(a.sensitivity));
}

/**
 * Two overlays, each moving every driver `spread` in its own direction.
 *
 * The base case is not generated: it already exists, and §4's whole argument is that a
 * scenario is an overlay on it rather than a copy of it. "Best, base and worst" is three
 * things to look at and two things to write.
 */
export function forecastScenarios(
  model: Model,
  targetId: string,
  spread: number,
  names: { upside: string; downside: string },
): { upside: Scenario; downside: Scenario; drivers: Driver[] } {
  const drivers = driversFor(model, targetId);
  const baseId = model.scenarios.find((s) => s.isBase)?.id;

  const build = (id: string, name: string, direction: 1 | -1): Scenario => ({
    id,
    name,
    isBase: false,
    ...(baseId ? { parentId: baseId } : {}),
    overrides: drivers.map((driver) => ({
      variableId: driver.variableId,
      value: {
        kind: "SCALE" as const,
        // `direction` is which case this is; `sensitivity`'s sign is which way this driver
        // has to move to serve it. Churn falls in the upside because its sign is negative.
        factor: 1 + direction * Math.sign(driver.sensitivity) * spread,
      },
    })),
  });

  return {
    upside: build(crypto.randomUUID(), names.upside, 1),
    downside: build(crypto.randomUUID(), names.downside, -1),
    drivers,
  };
}
