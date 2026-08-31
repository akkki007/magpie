import { add, div, lit, mul, prior, ref, sub } from "./formula";
import { TOTAL } from "./types";
import type { Model, Period, Variable } from "./types";

/**
 * "Revenue Model 2026" — the model behind `designs/modelling-1.jpg`.
 *
 * **This file is scaffolding, and it is honest scaffolding.** It builds the
 * same object M0's query will return (`docs/modelling-plan.md` M0), so the swap to
 * Postgres is a change of source and not a rewrite of anything above it. What
 * it is *not* is a table of pre-baked display numbers: every figure in the grid
 * is computed by `engine.ts` from these inputs, which is what makes editing a
 * churn assumption move sixty cells.
 *
 * The model itself is a standard SaaS ARR waterfall, because that is what the
 * brief's first use case is:
 *
 *     Closing ARR = Opening ARR + New ARR – Churn ARR + Expansion ARR
 *     Opening ARR = Closing ARR of the prior month
 *
 * New business is dimensioned by Subscription Plan, so the plan mix flows
 * through `New Accounts × ACV` per member and rolls up (§1.6).
 */

/* Ids are stable strings rather than array indices: formulas reference them,
   and a formula that survives a reorder is the entire argument of §1.1. */
export const V = {
  openingArr: "v_opening_arr",
  newArr: "v_new_arr",
  churnArr: "v_churn_arr",
  expansionArr: "v_expansion_arr",
  closingArr: "v_closing_arr",
  revenue: "v_revenue",
  revenueCash: "v_revenue_cash",

  openingAccounts: "v_opening_accounts",
  newAccounts: "v_new_accounts",
  churnAccounts: "v_churn_accounts",
  closingAccounts: "v_closing_accounts",
  arpa: "v_arpa",

  netNewArr: "v_net_new_arr",
  grr: "v_grr",
  nrr: "v_nrr",
  logoChurn: "v_logo_churn",

  startingArr: "v_starting_arr",
  startingAccounts: "v_starting_accounts",
  acv: "v_acv",
  churnRate: "v_churn_rate",
  expansionRate: "v_expansion_rate",
  collected: "v_collected",
} as const;

const G = {
  arr: "g_arr",
  accounts: "g_accounts",
  churn: "g_churn",
  assumptions: "g_assumptions",
} as const;

const PLAN = "d_plan";
const MEMBERS = ["starter", "growth", "enterprise"] as const;

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthlyPeriods(startYear: number, count: number): Period[] {
  return Array.from({ length: count }, (_, i) => {
    const year = startYear + Math.floor(i / 12);
    const month = (i % 12) + 1;
    return {
      key: `${year}-${String(month).padStart(2, "0")}`,
      label: `${MONTH_NAMES[month - 1]} '${String(year).slice(2)}`,
      year,
      month,
    };
  });
}

const HORIZON = 24;

/** Deterministic, so the server render and the client hydration agree. */
const shape = (n: number, fn: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => fn(i));

const flat = (n: number, value: number) => shape(n, () => value);

export function buildRevenueModel(): Model {
  const periods = monthlyPeriods(2026, HORIZON);

  const variables: Variable[] = [
    /* ── ARR & Summary ─────────────────────────────────────────────────── */
    {
      id: V.openingArr,
      groupId: G.arr,
      name: "Opening ARR",
      kind: "FORMULA",
      format: "CURRENCY",
      // FIRST, not SUM: a quarter opens where its first month opened. Summing
      // three opening balances is the classic silently-wrong number (§1.2).
      aggregation: "FIRST",
      formula: prior(ref(V.closingArr), 1, ref(V.startingArr)),
      note: "Last month's closing ARR; the opening balance in month one.",
    },
    {
      id: V.newArr,
      groupId: G.arr,
      name: "New ARR",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "SUM",
      dimensionId: PLAN,
      memberRollup: "SUM",
      formula: mul(ref(V.newAccounts), ref(V.acv)),
      note: "New accounts × ACV, per subscription plan.",
    },
    {
      id: V.churnArr,
      groupId: G.arr,
      name: "Churn ARR",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "SUM",
      formula: mul(ref(V.openingArr), ref(V.churnRate)),
    },
    {
      id: V.expansionArr,
      groupId: G.arr,
      name: "Expansion ARR",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "SUM",
      formula: mul(ref(V.openingArr), ref(V.expansionRate)),
    },
    {
      id: V.closingArr,
      groupId: G.arr,
      name: "Closing ARR",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "LAST",
      formula: add(sub(add(ref(V.openingArr), ref(V.newArr)), ref(V.churnArr)), ref(V.expansionArr)),
      note: "The waterfall: opening + new – churn + expansion.",
    },
    {
      id: V.revenue,
      groupId: G.arr,
      name: "Revenue",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "SUM",
      formula: div(ref(V.closingArr), lit(12)),
      note: "Recognised monthly: one twelfth of closing ARR.",
    },
    {
      id: V.revenueCash,
      groupId: G.arr,
      name: "Revenue (Cash Flow)",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "SUM",
      formula: add(
        mul(ref(V.revenue), ref(V.collected)),
        mul(prior(ref(V.revenue)), sub(lit(1), ref(V.collected))),
      ),
      note: "Collections lag: part this month, the rest a month later.",
    },

    /* ── Account Summary ───────────────────────────────────────────────── */
    {
      id: V.openingAccounts,
      groupId: G.accounts,
      name: "Opening Accounts",
      kind: "FORMULA",
      format: "COUNT",
      aggregation: "FIRST",
      formula: prior(ref(V.closingAccounts), 1, ref(V.startingAccounts)),
    },
    {
      id: V.newAccounts,
      groupId: G.accounts,
      name: "New Accounts",
      kind: "INPUT",
      format: "COUNT",
      aggregation: "SUM",
      dimensionId: PLAN,
      memberRollup: "SUM",
      note: "Hardcoded plan. Edit any cell and the whole waterfall follows.",
    },
    {
      id: V.churnAccounts,
      groupId: G.accounts,
      name: "Churn Accounts",
      kind: "FORMULA",
      format: "COUNT",
      aggregation: "SUM",
      formula: mul(ref(V.openingAccounts), ref(V.churnRate)),
    },
    {
      id: V.closingAccounts,
      groupId: G.accounts,
      name: "Closing Accounts",
      kind: "FORMULA",
      format: "COUNT",
      aggregation: "LAST",
      formula: sub(add(ref(V.openingAccounts), ref(V.newAccounts)), ref(V.churnAccounts)),
    },
    {
      id: V.arpa,
      groupId: G.accounts,
      name: "ARPA",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "AVG",
      formula: div(ref(V.closingArr), ref(V.closingAccounts)),
      note: "Annual revenue per account — closing ARR over closing accounts.",
    },

    /* ── Churn Build ───────────────────────────────────────────────────── */
    {
      id: V.netNewArr,
      groupId: G.churn,
      name: "Net New ARR",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "SUM",
      formula: sub(add(ref(V.newArr), ref(V.expansionArr)), ref(V.churnArr)),
    },
    {
      id: V.grr,
      groupId: G.churn,
      name: "Gross Revenue Retention",
      kind: "FORMULA",
      format: "PERCENT",
      aggregation: "AVG",
      timeContext: "Monthly",
      formula: div(sub(ref(V.openingArr), ref(V.churnArr)), ref(V.openingArr)),
    },
    {
      id: V.nrr,
      groupId: G.churn,
      name: "Net Revenue Retention",
      kind: "FORMULA",
      format: "PERCENT",
      aggregation: "AVG",
      timeContext: "Monthly",
      formula: div(
        add(sub(ref(V.openingArr), ref(V.churnArr)), ref(V.expansionArr)),
        ref(V.openingArr),
      ),
    },
    {
      id: V.logoChurn,
      groupId: G.churn,
      name: "Logo Churn",
      kind: "FORMULA",
      format: "PERCENT",
      aggregation: "AVG",
      timeContext: "Monthly",
      formula: div(ref(V.churnAccounts), ref(V.openingAccounts)),
    },

    /* ── Assumptions ───────────────────────────────────────────────────── */
    {
      id: V.startingArr,
      groupId: G.assumptions,
      name: "Starting ARR",
      kind: "INPUT",
      format: "CURRENCY",
      aggregation: "FIRST",
      note: "The opening balance the waterfall starts from.",
    },
    {
      id: V.startingAccounts,
      groupId: G.assumptions,
      name: "Starting Accounts",
      kind: "INPUT",
      format: "COUNT",
      aggregation: "FIRST",
    },
    {
      id: V.acv,
      groupId: G.assumptions,
      name: "ACV",
      kind: "INPUT",
      format: "CURRENCY",
      aggregation: "LAST",
      dimensionId: PLAN,
      // Averages across plans, holds its level across time — the two axes are
      // different questions, which is why `memberRollup` is its own field.
      memberRollup: "AVG",
      note: "Annual contract value by plan. Steps up with the 2027 price rise.",
    },
    {
      id: V.churnRate,
      groupId: G.assumptions,
      name: "Gross Churn Rate",
      kind: "INPUT",
      format: "PERCENT",
      aggregation: "AVG",
      timeContext: "Monthly",
    },
    {
      id: V.expansionRate,
      groupId: G.assumptions,
      name: "Expansion Rate",
      kind: "INPUT",
      format: "PERCENT",
      aggregation: "AVG",
      timeContext: "Monthly",
    },
    {
      id: V.collected,
      groupId: G.assumptions,
      name: "Collected In Month",
      kind: "INPUT",
      format: "PERCENT",
      aggregation: "AVG",
    },
  ];

  return {
    id: "m_revenue_2026",
    name: "Revenue Model 2026",
    baseGrain: "MONTH",
    periods,
    dimensions: [
      {
        id: PLAN,
        name: "Subscription Plan",
        members: [
          { key: MEMBERS[0], name: "Starter" },
          { key: MEMBERS[1], name: "Growth" },
          { key: MEMBERS[2], name: "Enterprise" },
        ],
      },
    ],
    groups: [
      { id: G.arr, name: "ARR & Summary", chip: "amber" },
      { id: G.accounts, name: "Account Summary", chip: "sky" },
      { id: G.churn, name: "Churn Build", chip: "rose" },
      { id: G.assumptions, name: "Assumptions", chip: "graphite" },
    ],
    variables,
    inputs: {
      [V.newAccounts]: {
        starter: shape(HORIZON, (i) => Math.round(126 + 4.6 * i + 5 * Math.sin(i * 1.1))),
        growth: shape(HORIZON, (i) => Math.round(44 + 2.1 * i + 3 * Math.sin(i * 0.7 + 1))),
        enterprise: shape(HORIZON, (i) => Math.max(3, Math.round(4 + 0.28 * i + 1.4 * Math.sin(i * 0.9)))),
      },
      [V.acv]: {
        // A price rise at the start of FY27 — visible in the year view, and a
        // reason for the grain switch to exist.
        starter: shape(HORIZON, (i) => (i < 12 ? 1188 : 1308)),
        growth: shape(HORIZON, (i) => (i < 12 ? 9540 : 10020)),
        enterprise: shape(HORIZON, (i) => (i < 12 ? 68400 : 71800)),
      },
      [V.startingArr]: { [TOTAL]: flat(HORIZON, 12_400_000) },
      [V.startingAccounts]: { [TOTAL]: flat(HORIZON, 1240) },
      [V.churnRate]: {
        [TOTAL]: shape(HORIZON, (i) => 0.0098 - 0.00004 * i + 0.0004 * Math.sin(i * 1.3)),
      },
      [V.expansionRate]: {
        [TOTAL]: shape(HORIZON, (i) => 0.0128 + 0.00006 * i + 0.0005 * Math.sin(i * 0.8)),
      },
      [V.collected]: { [TOTAL]: flat(HORIZON, 0.72) },
    },
    scenarios: [
      { id: "s_base", name: "Base case", isBase: true, overrides: [] },
      {
        id: "s_upside",
        name: "Upside",
        isBase: false,
        // Overlays, not copies (§4): three rows differ, everything else falls
        // through to base, so fixing the base case fixes every scenario.
        overrides: [
          { variableId: V.newAccounts, scale: 1.28 },
          { variableId: V.churnRate, scale: 0.72 },
          { variableId: V.expansionRate, scale: 1.18 },
        ],
      },
      {
        id: "s_downside",
        name: "Downside",
        isBase: false,
        overrides: [
          { variableId: V.newAccounts, scale: 0.72 },
          { variableId: V.churnRate, scale: 1.55 },
          { variableId: V.expansionRate, scale: 0.82 },
        ],
      },
    ],
  };
}
