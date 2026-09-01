import { FUNCTIONS } from "./primitives";
import type { Dimension, FormulaFn, FormulaNode, Variable } from "./types";

/**
 * The gate a formula passes before it is written (`docs/modelling-plan.md` M2.3, §5).
 *
 * Parsing answers "is this a formula"; this answers "is this a formula *in
 * this model*" — the questions need different information and produce
 * different messages, which is why they are not one function. An agent posting
 * a tree straight to the server never parses anything, and it must hit exactly
 * the same checks as a person typing (§5: "a proposal that does not compile
 * never reaches the UI"), so this runs at the boundary rather than in the
 * editor.
 */

export type ValidationError = { message: string };

export type ValidationContext = {
  variables: Pick<Variable, "id" | "name" | "formula" | "dimensionId">[];
  dimensions: Dimension[];
};

/**
 * A reference is *lagged* when it can only read another period, so it can
 * never re-enter the cell it started from.
 *
 * This is the static half of the engine's runtime rule, and it has to agree
 * with it exactly. The engine memoises `(variable, member, period)` and calls
 * a repeat visit to the same key a circular reference — which makes
 * `Opening ARR = PRIOR(Closing ARR)` legal even though the variable graph has
 * a loop in it. A validator that walked the variable graph naively would
 * reject the central formula of every waterfall in finance.
 *
 * Only `PRIOR` and `NEXT` shift the period without also reading the current
 * one. `YTD`, `CUMULATIVE`, `GROWTH`, `SPREAD`, `OPENING` and `CLOSING` all
 * include period `t` in their range, so a self-reference through any of them
 * is a genuine loop.
 */
function isLaggedArgument(fn: FormulaFn, index: number, args: FormulaNode[]) {
  if (index !== 0 || (fn !== "PRIOR" && fn !== "NEXT")) return false;
  const shift = args[1];
  // An absent shift defaults to 1. A computed one could evaluate to zero, so
  // it is treated as immediate: rejecting a formula that might be circular is
  // recoverable, accepting one that is means a page that renders zeroes.
  if (!shift) return true;
  return shift.type === "literal" && shift.value !== 0;
}

/** Variable ids this formula reads *within the same period*. */
function immediateDependencies(node: FormulaNode | undefined, into = new Set<string>()) {
  if (!node) return into;
  switch (node.type) {
    case "ref":
      into.add(node.variableId);
      break;
    case "binary":
      immediateDependencies(node.left, into);
      immediateDependencies(node.right, into);
      break;
    case "call":
      node.args.forEach((arg, i) => {
        if (!isLaggedArgument(node.fn, i, node.args)) immediateDependencies(arg, into);
      });
      break;
  }
  return into;
}

export function validateFormula(
  formula: FormulaNode,
  context: ValidationContext,
  /** The variable this formula is about to become. */
  targetId: string,
): ValidationError | null {
  const byId = new Map(context.variables.map((v) => [v.id, v]));
  const dimensions = new Map(context.dimensions.map((d) => [d.id, d]));

  const structural = checkNode(formula);
  if (structural) return structural;

  return checkCycle();

  function checkNode(node: FormulaNode): ValidationError | null {
    switch (node.type) {
      case "literal":
        return Number.isFinite(node.value)
          ? null
          : { message: "A number in the formula is not finite" };

      case "ref": {
        const target = byId.get(node.variableId);
        if (!target) {
          return { message: "The formula references a variable that is not in this model" };
        }
        if (!node.member) return null;
        const dimension = dimensions.get(target.dimensionId ?? "");
        if (!dimension) {
          return { message: `${target.name} has no dimension, so it has no members` };
        }
        if (!dimension.members.some((m) => m.key === node.member)) {
          return { message: `${dimension.name} has no member "${node.member}"` };
        }
        return null;
      }

      case "binary":
        return checkNode(node.left) ?? checkNode(node.right);

      case "call": {
        const { arity, params } = FUNCTIONS[node.fn];
        const count = node.args.length;
        if (count < arity.min || (arity.max !== null && count > arity.max)) {
          return {
            message: `${node.fn} takes ${describeArity(node.fn)}, not ${count} — ${node.fn}(${params.join(", ")})`,
          };
        }
        // §1.6: "the members" is a property of a stored variable, not of an
        // expression, so MEMBER_AVG(ACV × 2) has nothing to average over.
        if (node.fn.startsWith("MEMBER_")) {
          const arg = node.args[0];
          if (arg.type !== "ref") {
            return { message: `${node.fn} needs a single variable, not an expression` };
          }
          const target = byId.get(arg.variableId);
          if (target && !target.dimensionId) {
            return { message: `${target.name} has no dimension for ${node.fn} to work across` };
          }
        }
        return node.args.reduce<ValidationError | null>(
          (found, arg) => found ?? checkNode(arg),
          null,
        );
      }
    }
  }

  /** Depth-first from the target back to itself, over same-period edges only. */
  function checkCycle(): ValidationError | null {
    const formulaFor = (id: string) =>
      id === targetId ? formula : byId.get(id)?.formula;

    const path: string[] = [];
    const visiting = new Set<string>();
    const settled = new Set<string>();

    function visit(id: string): string[] | null {
      if (visiting.has(id)) return [...path.slice(path.indexOf(id)), id];
      if (settled.has(id)) return null;

      visiting.add(id);
      path.push(id);
      for (const next of immediateDependencies(formulaFor(id))) {
        const loop = visit(next);
        if (loop) return loop;
      }
      path.pop();
      visiting.delete(id);
      settled.add(id);
      return null;
    }

    const loop = visit(targetId);
    if (!loop) return null;

    // Naming the loop is the whole point: "circular reference" alone leaves a
    // user to find it by hand across sixty rows.
    const names = loop.map((id) => byId.get(id)?.name ?? id).join(" → ");
    return { message: `Circular reference: ${names}` };
  }
}

function describeArity(fn: FormulaFn) {
  const { min, max } = FUNCTIONS[fn].arity;
  const plural = (n: number) => `${n} argument${n === 1 ? "" : "s"}`;
  if (max === null) return `at least ${plural(min)}`;
  if (min === max) return plural(min);
  return `${min} to ${plural(max)}`;
}
