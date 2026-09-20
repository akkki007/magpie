import type { Model, Period, Variable } from "../model/types";
import type { CashSeries } from "./cash";

/**
 * The cash position, as a `Model` the existing engine evaluates (`docs/recon-plan.md` R6.1).
 *
 * This is the join between the two halves of the product, and it is deliberately a *data*
 * join rather than a code one. The reconciliation produces three series; they become `LINKED`
 * variables (`docs/modelling-plan.md` §6 — a variable whose numbers come from a source rather
 * than from a human or a formula); the position rows on top of them are ordinary `FORMULA`
 * variables evaluated by `lib/model/engine.ts`.
 *
 * Nothing here re-implements arithmetic. `CUMULATIVE` and `+` come from the same evaluator
 * the revenue model uses, which means the cash line cannot drift from the grid's behaviour,
 * and a bug in the running total is one bug rather than two. That was the whole argument for
 * building the engine before anything that needed it.
 *
 * Paise are converted to rupees at this boundary, because the grid formats currency and the
 * modelling engine's `number` is a rupee amount. Integer paise stop at the edge of the
 * reconciliation module, which is exactly where they should stop.
 */

const G = { flow: "cash-flow", position: "cash-position" } as const;

export const CASH_VARS = {
  reconciled: "cash-reconciled",
  inFlight: "cash-in-flight",
  atRisk: "cash-at-risk",
  confirmed: "cash-confirmed-position",
  expected: "cash-expected-position",
  band: "cash-unverified-band",
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const periodsFrom = (keys: string[]): Period[] =>
  keys.map((key) => {
    const [year, month] = key.split("-").map(Number);
    return { key, label: `${MONTHS[month - 1]} '${String(year).slice(2)}`, year, month };
  });

/** Integer paise in, rupees out. The one place the conversion happens. */
const toRupees = (series: number[]) => series.map((paise) => paise / 100);

export function buildCashModel(cash: CashSeries, atRisk = cash.atRisk): Model {
  const linked = (id: string, name: string, note: string): Variable => ({
    id,
    groupId: G.flow,
    name,
    kind: "LINKED",
    format: "CURRENCY",
    // A flow sums across time; the position rows below are balances and say so. Getting
    // this pair wrong is §1.2's silent-quarterly-error, arriving in a different module.
    aggregation: "SUM",
    note,
  });

  const variables: Variable[] = [
    linked(
      CASH_VARS.reconciled,
      "Reconciled inflow",
      "Bank credits the matcher tied to a settlement. This money exists.",
    ),
    linked(
      CASH_VARS.inFlight,
      "In-flight settlements",
      "Payouts the bank has not confirmed, plus captured payments whose T+2 payout falls past the statement. Expected, not confirmed.",
    ),
    linked(
      CASH_VARS.atRisk,
      "Exceptions at risk",
      "Value the matcher could not resolve. Falls as the review queue is worked.",
    ),
    {
      id: CASH_VARS.confirmed,
      groupId: G.position,
      name: "Confirmed position",
      kind: "FORMULA",
      format: "CURRENCY",
      /** A balance: the quarterly view takes the closing month, never the sum. */
      aggregation: "LAST",
      formula: { type: "call", fn: "CUMULATIVE", args: [{ type: "ref", variableId: CASH_VARS.reconciled }] },
      note: "Only money the bank has confirmed against a settlement.",
    },
    {
      id: CASH_VARS.expected,
      groupId: G.position,
      name: "Expected position",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "LAST",
      formula: {
        type: "binary",
        op: "+",
        left: { type: "ref", variableId: CASH_VARS.confirmed },
        right: { type: "call", fn: "CUMULATIVE", args: [{ type: "ref", variableId: CASH_VARS.inFlight }] },
      },
      note: "Confirmed cash plus what the gateway still owes.",
    },
    {
      id: CASH_VARS.band,
      groupId: G.position,
      name: "Unverified band",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "LAST",
      formula: { type: "call", fn: "CUMULATIVE", args: [{ type: "ref", variableId: CASH_VARS.atRisk }] },
      note: "How much of the position above is unverified. An honest forecast states this.",
    },
  ];

  return {
    id: "cash-position",
    name: "Cash position",
    baseGrain: "MONTH",
    periods: periodsFrom(cash.periodKeys),
    groups: [
      { id: G.flow, name: "Movements", chip: "sky" },
      { id: G.position, name: "Position", chip: "blue" },
    ],
    variables,
    dimensions: [],
    inputs: {
      // `LINKED` series live in the same input table an INPUT row would use. That is the
      // point of §6: a linked variable is one whose values arrive from a source instead of a
      // person, and everything downstream — evaluation, rollup, scenarios — cannot tell.
      [CASH_VARS.reconciled]: { "": toRupees(cash.reconciled) },
      [CASH_VARS.inFlight]: { "": toRupees(cash.inFlight) },
      [CASH_VARS.atRisk]: { "": toRupees(atRisk) },
    },
    scenarios: [{ id: "base", name: "Base", isBase: true, overrides: [] }],
  };
}
