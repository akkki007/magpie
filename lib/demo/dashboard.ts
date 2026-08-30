/**
 * The Annual Operating Plan dashboard, as fixtures.
 *
 * Every number here is read off `designs/proto-screen-1.jpg` so the built page
 * can be diffed against the design. **This file is scaffolding**: M0/M1 of
 * `modelling/main.md` replace it with `Variable` + `VariableSeries` rows out of
 * Postgres, and the components below already take the shape those queries will
 * return — a variable with a kind, a format, an aggregation and a series — so
 * the swap is a change of source, not a rewrite of the UI.
 */

export type Delta = { value: string; direction: "up" | "down" };

export type Kpi = {
  label: string;
  /** Pre-formatted: formatting rules belong to `Variable.format`, not here. */
  value: string;
  delta: Delta;
};

export const kpis: Kpi[] = [
  { label: "Revenue", value: "$1,230,569", delta: { value: "+5%", direction: "up" } },
  { label: "Net Profit", value: "$150,120", delta: { value: "-3%", direction: "down" } },
  {
    label: "Operating Expenses",
    value: "$423,112",
    delta: { value: "+8%", direction: "up" },
  },
];

/** Grouped bars: one group per month, one bar per series, in series order. */
export const revenueComparison = {
  series: ["Sales", "Expenses", "Operating Profit"],
  groups: [
    { label: "Jan '24", values: [76, 165, 110] },
    { label: "Feb '24", values: [114, 127, 72] },
    { label: "Mar '24", values: [139, 22, 97] },
  ],
};

/**
 * Colours are named per slice rather than taken by index off the ramp: the
 * design assigns specific hues to specific products, and "whatever is third in
 * the array" is not that.
 */
export const profitBreakdown = [
  { label: "Laptop", value: 34, color: "var(--color-viz-6)" },
  { label: "Smartphones", value: 38, color: "var(--color-viz-4)" },
  { label: "Watch", value: 28, color: "var(--color-viz-5)" },
];

/**
 * Grid rows. `kind` is where the numbers come from and `format` is how they
 * render — `modelling/main.md` §2 is explicit that the two are different axes,
 * even though the screens show one glyph per row.
 */
export type GridRow = {
  name: string;
  kind: "INPUT" | "FORMULA" | "LINKED";
  format: "CURRENCY" | "COUNT" | "PERCENT";
  /** Rendered from the AST at display time; stored as a tree, never a string. */
  formula: string;
  /** A time-context modifier on the reference, e.g. "This Month". */
  timeContext?: string;
  /** Deterministic seed for the sparkline, so SSR and hydration agree. */
  seed: number;
  values: string[];
};

export const periods = ["Jan '25", "Feb '25", "Mar '25", "Apr '25"];

export const gridRows: GridRow[] = [
  {
    name: "Gross Profit",
    kind: "FORMULA",
    format: "CURRENCY",
    formula: "Revenue – Cost of Goods Sold",
    seed: 7,
    values: ["$483,920", "$752,180", "$611,405", "$698,240"],
  },
  {
    name: "Contribution Margin",
    kind: "FORMULA",
    format: "CURRENCY",
    formula: "Revenue – Variable Costs",
    timeContext: "This Month",
    seed: 21,
    values: ["$284,615", "$930,470", "$402,118", "$517,903"],
  },
  {
    name: "Operating Profit",
    kind: "FORMULA",
    format: "CURRENCY",
    formula: "Revenue – Operating Expenses",
    seed: 42,
    values: ["$175,839", "$406,250", "$389,004", "$451,776"],
  },
];

/**
 * The agent transcript from the same screen. Persisted on `AgentRun` in the
 * real thing (`modelling/main.md` §5) so a refresh does not lose it.
 */
export const agentRun = {
  title: "Financial Modelling Research",
  prompt:
    "Explain the last 3 months of Operating Profit and show which factor impacted it most.",
  thinkingSeconds: 8,
  heading: "Profit Trend and Expense Impact",
  body: [
    "Over the last three months, Operating Profit has shown a slight increase from $800,000 in January to $830,000 in March.",
    "Below is the detailed analysis and the factors contributing to this trend.",
  ],
  chart: {
    title: "Profit Trend and Expense Impact",
    labels: ["Jan '25", "Feb '25", "Mar '25"],
    series: [
      { label: "Sales", values: [4, 50, 52], color: "var(--color-viz-5)" },
      { label: "Profit", values: [48, 166, 114], color: "var(--color-viz-1)" },
      { label: "Operating Profit", values: [156, 185, 170], color: "var(--color-violet-500)" },
    ],
  },
  closing:
    "The primary factor affecting this trend is the gradual increase in operating expenses, which outpaced gross profit in February.",
  mention: "Profit and Loss (P&L) Statement",
};
