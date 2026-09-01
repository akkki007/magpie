import type { BinaryOp, FormulaFn } from "./types";

/**
 * The formula language, described in one table.
 *
 * `docs/modelling-plan.md` §3 caps the language at "roughly 25 primitives", and §8 names
 * formula scope creep as a standing risk. A single table is the cheapest way to
 * hold that line: the tokeniser, the parser, the arity check, the autocomplete
 * menu and the agent's tool schema all read from here, so adding a primitive is
 * one entry plus one `case` in the evaluator — and *not* adding one is visibly
 * a decision rather than an omission.
 *
 * `satisfies Record<FormulaFn, …>` is the part that matters: extend the union
 * in `types.ts` without describing the function here and the build fails.
 */

export type FnSpec = {
  /** Inclusive argument count bounds. `max: null` means variadic. */
  arity: { min: number; max: number | null };
  /** Argument names, for the editor's signature hint. `…` marks the variadic tail. */
  params: string[];
  summary: string;
};

export const FUNCTIONS = {
  PRIOR: {
    arity: { min: 1, max: 3 },
    params: ["value", "periods", "fallback"],
    summary: "The value n periods earlier; the fallback before the model starts.",
  },
  NEXT: {
    arity: { min: 1, max: 3 },
    params: ["value", "periods", "fallback"],
    summary: "The value n periods later; the fallback past the horizon.",
  },
  YTD: {
    arity: { min: 1, max: 1 },
    params: ["value"],
    summary: "Sum from January of the current year to this period, inclusive.",
  },
  CUMULATIVE: {
    arity: { min: 1, max: 1 },
    params: ["value"],
    summary: "Sum from the first period of the model to this one.",
  },
  OPENING: {
    arity: { min: 1, max: 1 },
    params: ["value"],
    summary: "The value in the first period of the current year.",
  },
  CLOSING: {
    arity: { min: 1, max: 1 },
    params: ["value"],
    summary: "The value in the last period of the current year, or of the horizon if it ends first.",
  },
  GROWTH: {
    arity: { min: 1, max: 2 },
    params: ["value", "periods"],
    summary: "Growth rate over n periods: (now − then) ÷ then. Zero where there is no base.",
  },
  SPREAD: {
    arity: { min: 2, max: 2 },
    params: ["value", "periods"],
    summary: "Recognise each period's amount evenly over the following n periods.",
  },
  IF: {
    arity: { min: 3, max: 3 },
    params: ["condition", "then", "otherwise"],
    summary: "The second argument when the condition is true, the third when it is not.",
  },
  MIN: { arity: { min: 1, max: null }, params: ["value", "…"], summary: "The smallest of its arguments." },
  MAX: { arity: { min: 1, max: null }, params: ["value", "…"], summary: "The largest of its arguments." },
  ABS: { arity: { min: 1, max: 1 }, params: ["value"], summary: "Magnitude, sign discarded." },

  /* ── Aggregators over a dimension (§3, §1.6) ───────────────────────────
     Named `MEMBER_*` rather than reusing `SUM`/`MIN`/`MAX`, because these
     collapse a different axis: `MIN` is the smallest of several values in one
     cell, `MEMBER_MIN` is the smallest *plan* in that cell. §1.6 keeps those
     two questions apart everywhere else (`aggregation` vs `memberRollup`) and
     the language must not quietly merge them.

     They take no dimension argument: a variable carries exactly one
     `dimensionId`, so "over its dimension" has one meaning and naming it again
     would only create a way to name the wrong one. */
  MEMBER_SUM: {
    arity: { min: 1, max: 1 },
    params: ["variable"],
    summary: "Sum across the members of the variable's dimension.",
  },
  MEMBER_AVG: {
    arity: { min: 1, max: 1 },
    params: ["variable"],
    summary: "Mean across the members of the variable's dimension.",
  },
  MEMBER_MIN: {
    arity: { min: 1, max: 1 },
    params: ["variable"],
    summary: "Smallest member value.",
  },
  MEMBER_MAX: {
    arity: { min: 1, max: 1 },
    params: ["variable"],
    summary: "Largest member value.",
  },
  MEMBER_COUNT: {
    arity: { min: 1, max: 1 },
    params: ["variable"],
    summary: "How many members the variable's dimension has.",
  },
} satisfies Record<FormulaFn, FnSpec>;

export const FUNCTION_NAMES = Object.keys(FUNCTIONS) as FormulaFn[];

export const isFunctionName = (word: string): word is FormulaFn =>
  Object.hasOwn(FUNCTIONS, word);

/** The aggregators whose single argument must be a dimensioned reference. */
export const MEMBER_FUNCTIONS = FUNCTION_NAMES.filter((fn) => fn.startsWith("MEMBER_"));

/* ── Operators ────────────────────────────────────────────────────────────*/

export type OpSpec = {
  /** Higher binds tighter. */
  precedence: number;
  /** How the printer renders it, and the glyph the parser prefers. */
  glyph: string;
  /** Extra spellings the parser accepts — a keyboard has no `×`. */
  aliases: string[];
  /**
   * Left-associative operators need a bracket around an equal-precedence
   * *right* operand (`a – (b – c)`); right-associative ones need it on the
   * left (`(a ^ b) ^ c`). Getting this backwards prints a tree as a string
   * that means something else — a correct model rendered as a plausible wrong
   * one, which is worse than a crash.
   */
  associativity: "left" | "right" | "none";
};

export const OPERATORS = {
  "=": { precedence: 1, glyph: "=", aliases: ["=="], associativity: "none" },
  "<>": { precedence: 1, glyph: "≠", aliases: ["≠", "!="], associativity: "none" },
  "<": { precedence: 1, glyph: "<", aliases: [], associativity: "none" },
  "<=": { precedence: 1, glyph: "≤", aliases: ["≤"], associativity: "none" },
  ">": { precedence: 1, glyph: ">", aliases: [], associativity: "none" },
  ">=": { precedence: 1, glyph: "≥", aliases: ["≥"], associativity: "none" },
  /** `–` (en dash) reads better than a hyphen at 12px in a dense grid. */
  "+": { precedence: 2, glyph: "+", aliases: [], associativity: "left" },
  "-": { precedence: 2, glyph: "–", aliases: ["–", "—", "−"], associativity: "left" },
  /** `·` is deliberately *not* a multiplication alias: the printer already
   *  spends it on the member separator (`ACV · growth`). */
  "*": { precedence: 3, glyph: "×", aliases: ["×"], associativity: "left" },
  "/": { precedence: 3, glyph: "÷", aliases: ["÷"], associativity: "left" },
  "^": { precedence: 4, glyph: "^", aliases: ["**"], associativity: "right" },
} satisfies Record<BinaryOp, OpSpec>;

export const COMPARISONS: BinaryOp[] = ["=", "<>", "<", "<=", ">", ">="];

export const isComparison = (op: BinaryOp) => COMPARISONS.includes(op);

/**
 * Every spelling of every operator, longest first — the tokeniser must try
 * `<=` before `<`, or `a <= b` lexes as `a < (= b)` and fails to parse.
 */
export const OPERATOR_SPELLINGS: { text: string; op: BinaryOp }[] = (
  Object.entries(OPERATORS) as [BinaryOp, OpSpec][]
)
  .flatMap(([op, spec]) => [op, spec.glyph, ...spec.aliases].map((text) => ({ text, op })))
  .filter((entry, i, all) => all.findIndex((e) => e.text === entry.text) === i)
  .sort((a, b) => b.text.length - a.text.length);
