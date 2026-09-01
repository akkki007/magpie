import { OPERATORS } from "./primitives";
import type { BinaryOp, FormulaFn, FormulaNode, Variable } from "./types";

/**
 * Building, printing and walking formula ASTs.
 *
 * `docs/modelling-plan.md` §1.1 stores the tree and derives the string. This file is
 * the "derives the string" half — plus the dependency walk, which is the same
 * traversal and is what the engine builds its DAG from and what the grid uses
 * to highlight a row's precedents.
 */

/* ── Builders ─────────────────────────────────────────────────────────────
   Terse on purpose: a fixture that reads like the formula it encodes is a
   fixture whose mistakes are visible. `sub(ref(a), ref(b))` is fine; a raw
   nested object literal for the same thing is not. */

export const lit = (value: number): FormulaNode => ({ type: "literal", value });

export const ref = (variableId: string, member?: string): FormulaNode => ({
  type: "ref",
  variableId,
  ...(member ? { member } : {}),
});

const bin =
  (op: BinaryOp) =>
  (left: FormulaNode, right: FormulaNode): FormulaNode => ({
    type: "binary",
    op,
    left,
    right,
  });

export const add = bin("+");
export const sub = bin("-");
export const mul = bin("*");
export const div = bin("/");
export const pow = bin("^");
export const eq = bin("=");
export const ne = bin("<>");
export const lt = bin("<");
export const lte = bin("<=");
export const gt = bin(">");
export const gte = bin(">=");

export const call = (fn: FormulaFn, ...args: FormulaNode[]): FormulaNode => ({
  type: "call",
  fn,
  args,
});

/** `PRIOR(x, n, fallback)` — the fallback is what a waterfall opens with. */
export const prior = (x: FormulaNode, n = 1, fallback?: FormulaNode) =>
  call("PRIOR", x, lit(n), ...(fallback ? [fallback] : []));

export const iff = (condition: FormulaNode, then: FormulaNode, otherwise: FormulaNode) =>
  call("IF", condition, then, otherwise);

/* ── Printing ─────────────────────────────────────────────────────────────
   Precedence-aware so the printed string means the same thing as the tree.
   A printer that drops a necessary bracket turns a correct model into a
   plausible-looking wrong one, which is worse than a crash. */

export const MEMBER_SEPARATOR = " \u00b7 ";

export function printFormula(
  node: FormulaNode,
  nameOf: (variableId: string) => string,
): string {
  return print(node, 0, nameOf);
}

/**
 * `parentPrecedence` is the level at or below which this node must bracket
 * itself. Associativity is expressed by what the *caller* passes down rather
 * than by a rule here, which keeps the one subtle case in one place: see the
 * binary arm.
 */
function print(
  node: FormulaNode,
  parentPrecedence: number,
  nameOf: (id: string) => string,
): string {
  switch (node.type) {
    case "literal":
      return formatLiteral(node.value);

    case "ref":
      return node.member
        ? `${nameOf(node.variableId)}${MEMBER_SEPARATOR}${node.member}`
        : nameOf(node.variableId);

    case "call":
      return `${node.fn}(${node.args.map((a) => print(a, 0, nameOf)).join(", ")})`;

    case "binary": {
      const { precedence, glyph, associativity } = OPERATORS[node.op];
      // An equal-precedence operand needs a bracket on whichever side the
      // operator does *not* associate towards: `a – (b – c)` on the right of a
      // left-associative `–`, `(a ^ b) ^ c` on the left of a right-associative
      // `^`. A non-associative comparison brackets on both. Get this backwards
      // and a correct tree prints as a string meaning something else.
      const bump = (side: "left" | "right") =>
        associativity === side ? precedence : precedence + 1;
      const body = `${print(node.left, bump("left"), nameOf)} ${glyph} ${print(
        node.right,
        bump("right"),
        nameOf,
      )}`;
      return precedence < parentPrecedence ? `(${body})` : body;
    }
  }
}

/**
 * Rates are authored as decimals and read as percentages by finance people, so
 * `0.075` prints as `7.5%`.
 *
 * The round-trip guard is not decoration. M2.2 lets a user edit this string and
 * saves what comes back, so a lossy rendering silently rewrites the model:
 * a churn rate of `0.010145423274166877` printed as `1.01%` and re-parsed is a
 * different number, and nobody edited it. Percent notation is used only where
 * it is exactly reversible; everything else prints as the decimal it is.
 */
function formatLiteral(value: number) {
  if (value !== 0 && Math.abs(value) < 1) {
    const percent = Number((value * 100).toPrecision(12));
    if (percent / 100 === value) return `${percent}%`;
  }
  return String(value);
}

/* ── Walking ──────────────────────────────────────────────────────────────*/

/** Every variable id this formula reads, in first-seen order. */
export function dependenciesOf(node: FormulaNode | undefined): string[] {
  if (!node) return [];
  const out: string[] = [];
  walk(node, (n) => {
    if (n.type === "ref" && !out.includes(n.variableId)) out.push(n.variableId);
  });
  return out;
}

export function walk(node: FormulaNode, visit: (node: FormulaNode) => void) {
  visit(node);
  if (node.type === "binary") {
    walk(node.left, visit);
    walk(node.right, visit);
  } else if (node.type === "call") {
    node.args.forEach((a) => walk(a, visit));
  }
}

/** Variables whose formulas read `variableId` — used before a delete. */
export function dependentsOf(variables: Variable[], variableId: string): Variable[] {
  return variables.filter((v) => dependenciesOf(v.formula).includes(variableId));
}
