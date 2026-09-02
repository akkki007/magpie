/**
 * The modelling types, in the shape `docs/modelling-plan.md` §1–§2 specifies.
 *
 * This is the in-memory version of the M0 Prisma schema. Field names match the
 * planned columns deliberately: when the tables land, the query returns this
 * shape and nothing above `lib/model` changes. That is the whole point of
 * writing it this way rather than shaping the data around the table markup.
 *
 * Two rules from the plan are enforced by these types rather than by comments:
 *
 * 1. **Formulas are ASTs with ID references, never strings** (§1.1). A rename
 *    is a change to one `name` field; sixty formulas keep working because they
 *    never held the name. `printFormula` derives the display string.
 * 2. **Aggregation belongs to the variable, not the chart** (§1.2). `Opening
 *    ARR` for a quarter is the *first* month, `Closing ARR` the *last*, `New
 *    ARR` the *sum*. The grain switch in the toolbar is a pure rollup that
 *    reads this field, so it cannot be silently wrong per chart.
 */

/** Storage grain is MONTH in v1; the others are rollups computed on read. */
export type Grain = "MONTH" | "QUARTER" | "YEAR";

/** Where a variable's numbers come from. Not the same axis as `format`. */
export type VariableKind = "INPUT" | "FORMULA" | "LINKED";

/** How a number renders. `$ # %` in the grid are format, never kind. */
export type NumberFormat = "CURRENCY" | "COUNT" | "PERCENT" | "RATIO";

/** How a series collapses across time. See §1.2 — get this wrong and every
 *  quarterly view in the product is quietly incorrect. */
export type Aggregation = "SUM" | "FIRST" | "LAST" | "AVG" | "NONE";

/** Organisational only — the pastel highlighter chips, never semantic. */
export type ChipTone = "amber" | "rose" | "graphite" | "sky" | "blue";

/**
 * Arithmetic and comparison. Comparison yields 1 or 0 so it composes with the
 * rest of the language rather than introducing a boolean type the grid would
 * then have to format — a cell is always a number (§3).
 */
export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">=";

/**
 * The function set, deliberately tiny (§3: "roughly 25 primitives — resist
 * adding more; every one added is one the AI can get wrong and a user must
 * learn"). Time functions are the reason the evaluator is period-aware.
 *
 * Arity, parameter names and help text live in `primitives.ts`, which the
 * tokeniser, the validator and the editor's autocomplete all read; this union
 * is only the set of legal names.
 */
export type FormulaFn =
  // Time
  | "PRIOR"
  | "NEXT"
  | "YTD"
  | "CUMULATIVE"
  | "OPENING"
  | "CLOSING"
  | "GROWTH"
  | "SPREAD"
  // Logic and arithmetic
  | "IF"
  | "MIN"
  | "MAX"
  | "ABS"
  // Across the members of a dimension (§1.6)
  | "MEMBER_SUM"
  | "MEMBER_AVG"
  | "MEMBER_MIN"
  | "MEMBER_MAX"
  | "MEMBER_COUNT";

export type FormulaNode =
  | { type: "literal"; value: number }
  /** A reference. `member` pins a dimension slice (`[v] BY plan = "Growth"`);
   *  without it the reference follows the evaluation context. */
  | { type: "ref"; variableId: string; member?: string }
  | { type: "binary"; op: BinaryOp; left: FormulaNode; right: FormulaNode }
  | { type: "call"; fn: FormulaFn; args: FormulaNode[] };

export type Period = {
  /** Sortable storage key, e.g. `2026-01`. */
  key: string;
  /** What the column header shows, e.g. `Jan '26`. */
  label: string;
  year: number;
  /** 1–12. */
  month: number;
};

export type DimensionMember = { key: string; name: string };

export type Dimension = {
  id: string;
  name: string;
  members: DimensionMember[];
};

export type VariableGroup = {
  id: string;
  name: string;
  chip: ChipTone;
};

export type Variable = {
  id: string;
  groupId: string;
  name: string;
  kind: VariableKind;
  format: NumberFormat;
  aggregation: Aggregation;
  /** Present only when `kind === "FORMULA"`. */
  formula?: FormulaNode;
  /** Expands the row into one child per member (§1.6). */
  dimensionId?: string;
  /**
   * How member series combine into the parent row. Explicit rather than
   * inferred from `aggregation`, because the two are different questions:
   * `ACV` averages across plans but is a LAST across time, and guessing one
   * from the other is how a rate gets summed into nonsense.
   */
  memberRollup?: "SUM" | "AVG";
  /** A modifier on the row's reference, rendered as the violet time chip. */
  timeContext?: string;
  /** Shown in the row tooltip; the seed of a real description field. */
  note?: string;
};

/**
 * An overlay, never a copy (§4). Unoverridden variables fall through to base.
 *
 * The shapes an override can take live in `scenario.ts`, because they are parsed
 * out of a `jsonb` column and the parser and the type should not be written twice.
 */
export type ScenarioOverride = {
  variableId: string;
  value: import("./scenario").Override;
};

export type Scenario = {
  id: string;
  name: string;
  isBase: boolean;
  /** Scenarios branch from scenarios (§2); the base case has no parent. */
  parentId?: string;
  overrides: ScenarioOverride[];
};

/**
 * Input values, keyed `variableId → memberKey → series`. `TOTAL` ("") is the
 * undimensioned row. A dimensioned INPUT stores one series per member and no
 * total: the total is a rollup, so it can never disagree with its children.
 */
export type InputTable = Record<string, Record<string, number[]>>;

export type Model = {
  id: string;
  name: string;
  baseGrain: "MONTH";
  periods: Period[];
  groups: VariableGroup[];
  variables: Variable[];
  dimensions: Dimension[];
  inputs: InputTable;
  scenarios: Scenario[];
};

/** The member key for "no dimension / the rolled-up parent row". */
export const TOTAL = "";
