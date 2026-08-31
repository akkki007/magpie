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

export const call = (fn: FormulaFn, ...args: FormulaNode[]): FormulaNode => ({
  type: "call",
  fn,
  args,
});

/** `PRIOR(x, n, fallback)` — the fallback is what a waterfall opens with. */
export const prior = (x: FormulaNode, n = 1, fallback?: FormulaNode) =>
  call("PRIOR", x, lit(n), ...(fallback ? [fallback] : []));

/* ── Printing ─────────────────────────────────────────────────────────────
   Precedence-aware so the printed string means the same thing as the tree.
   A printer that drops a necessary bracket turns a correct model into a
   plausible-looking wrong one, which is worse than a crash. */

const PRECEDENCE: Record<BinaryOp, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "^": 3,
};

/** `–` (en dash) reads better than a hyphen at 12px in a dense grid. */
const GLYPH: Record<BinaryOp, string> = {
  "+": "+",
  "-": "–",
  "*": "×",
  "/": "÷",
  "^": "^",
};

export function printFormula(
  node: FormulaNode,
  nameOf: (variableId: string) => string,
): string {
  return print(node, 0, nameOf);
}

function print(
  node: FormulaNode,
  parentPrecedence: number,
  nameOf: (id: string) => string,
): string {
  switch (node.type) {
    case "literal":
      return formatLiteral(node.value);

    case "ref":
      return node.member ? `${nameOf(node.variableId)} · ${node.member}` : nameOf(node.variableId);

    case "call":
      return `${node.fn}(${node.args.map((a) => print(a, 0, nameOf)).join(", ")})`;

    case "binary": {
      const precedence = PRECEDENCE[node.op];
      const body = `${print(node.left, precedence, nameOf)} ${GLYPH[node.op]} ${print(
        node.right,
        // The right operand of a non-associative op needs a bracket at equal
        // precedence: `a – (b – c)` is not `a – b – c`.
        node.op === "-" || node.op === "/" ? precedence + 1 : precedence,
        nameOf,
      )}`;
      return precedence < parentPrecedence ? `(${body})` : body;
    }
  }
}

function formatLiteral(value: number) {
  // Rates are authored as decimals but read as percentages by finance people.
  if (value !== 0 && Math.abs(value) < 1) return `${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
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
