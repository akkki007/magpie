import { MEMBER_SEPARATOR } from "./formula";
import { OPERATOR_SPELLINGS, isFunctionName } from "./primitives";
import type { BinaryOp, Dimension, FormulaFn, FormulaNode, Variable } from "./types";

/**
 * Text → `FormulaNode` (`docs/modelling-plan.md` M2.1).
 *
 * ── The grammar is defined as the inverse of the printer ──────────────────
 * Not "a formula syntax" in general: *exactly* what `printFormula` emits, plus
 * the ASCII spellings a keyboard can produce. That constraint is the whole
 * design. M2.2 hands the user the printed string, takes back whatever they
 * typed and saves it, so a formula opened and closed untouched must come back
 * as the same tree — otherwise the editor rewrites models nobody edited. The
 * check that enforces it (`parse(print(f)) deep-equals f` over every formula in
 * the seeded model) lives in `scripts/calc-check.ts`, and it is the reason the
 * printer stopped rounding percentages.
 *
 * So the parser accepts `×` and `*`, `–` and `-`, `≥` and `>=`, and the `·`
 * member separator the grid renders. It does not accept a `BY` clause: §3
 * sketches `[v] BY [dim] = member`, the printer has never emitted it, and a
 * second spelling for one thing is a second thing to keep in sync.
 *
 * ── Names, not identifiers ───────────────────────────────────────────────
 * `Opening ARR + New ARR` has spaces inside its operands, so there is no
 * lexical rule that finds the boundary — the tokeniser has to know the model
 * and take the longest matching variable name. That is why parsing needs a
 * context and why an unknown name is a parse error rather than a free
 * identifier: §1.1 stores ids, and a name that resolves to nothing has nothing
 * to store.
 */

export type ParseError = {
  message: string;
  /** Offsets into the *original* text, for the editor's underline. */
  start: number;
  end: number;
};

export type ParseResult =
  | { ok: true; node: FormulaNode }
  | { ok: false; error: ParseError };

export type ParseContext = {
  variables: Pick<Variable, "id" | "name" | "dimensionId">[];
  dimensions: Dimension[];
};

/* ── Tokens ───────────────────────────────────────────────────────────────*/

type Token =
  | { kind: "number"; value: number; start: number; end: number }
  | { kind: "op"; op: BinaryOp; start: number; end: number }
  | { kind: "fn"; fn: FormulaFn; start: number; end: number }
  | { kind: "variable"; id: string; start: number; end: number }
  | { kind: "punct"; text: "(" | ")" | "," | "·"; start: number; end: number }
  | { kind: "word"; text: string; start: number; end: number }
  | { kind: "end"; start: number; end: number };

const NUMBER = /^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/;
const WORD = /^[A-Za-z0-9_][A-Za-z0-9_'&.-]*/;

class ParseFailure extends Error {
  constructor(readonly error: ParseError) {
    super(error.message);
  }
}

/**
 * Runs of whitespace collapse to one space before matching, so `Opening  ARR`
 * still finds `Opening ARR`. `offsets` maps each character of the collapsed
 * text back to where it came from, so an error still underlines the right
 * characters in what the user actually typed.
 */
function normalise(source: string) {
  let text = "";
  const offsets: number[] = [];
  let inSpace = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (/\s/.test(char)) {
      inSpace = true;
      continue;
    }
    if (inSpace && text.length > 0) {
      text += " ";
      offsets.push(i);
    }
    inSpace = false;
    text += char;
    offsets.push(i);
  }
  offsets.push(source.length);
  return { text, offsets };
}

function tokenise(source: string, context: ParseContext): Token[] {
  const { text, offsets } = normalise(source);
  const at = (i: number) => offsets[Math.min(i, offsets.length - 1)];

  // Longest first: `Closing ARR` must win over a variable called `Closing`,
  // exactly as `<=` must win over `<`.
  const names = context.variables
    .map((v) => ({ id: v.id, lower: v.name.toLowerCase() }))
    .sort((a, b) => b.lower.length - a.lower.length);

  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === " ") {
      i++;
      continue;
    }
    const start = i;

    // A function only where a call can start, so a variable may be called
    // `Max Headcount` without the tokeniser seeing `MAX` and demanding a
    // bracket. `MIN` alone is a name; `MIN(` is a call.
    const word = WORD.exec(text.slice(i));
    if (word) {
      const upper = word[0].toUpperCase();
      if (isFunctionName(upper) && text[i + word[0].length] === "(") {
        i += word[0].length;
        tokens.push({ kind: "fn", fn: upper, start: at(start), end: at(i) });
        continue;
      }
    }

    // Variable names are matched before brackets, digits and operators,
    // because a name is arbitrary text the user chose: `Q1 (plan)` and
    // `2026 Target` are legal names, and anything that lexes the punctuation
    // first can never see them. The word-boundary guard is what keeps this
    // from eating the `MA` of `MAX(`.
    const name = names.find(
      (n) =>
        text.slice(i, i + n.lower.length).toLowerCase() === n.lower &&
        !/[A-Za-z0-9_]/.test(text[i + n.lower.length] ?? ""),
    );
    if (name) {
      i += name.lower.length;
      tokens.push({ kind: "variable", id: name.id, start: at(start), end: at(i) });
      continue;
    }

    const punct = "(),".includes(text[i]) || text[i] === "·" ? text[i] : null;
    if (punct) {
      i++;
      tokens.push({ kind: "punct", text: punct as "(" | ")" | "," | "·", start: at(start), end: at(i) });
      continue;
    }

    const number = NUMBER.exec(text.slice(i));
    if (number) {
      i += number[0].length;
      // `7.5%` is `0.075` by the same expression the printer used to decide it
      // could print a percentage at all, which is what makes the two exact
      // inverses rather than approximately so.
      const isPercent = text[i] === "%";
      if (isPercent) i++;
      const value = isPercent ? Number(number[0]) / 100 : Number(number[0]);
      tokens.push({ kind: "number", value, start: at(start), end: at(i) });
      continue;
    }

    const spelling = OPERATOR_SPELLINGS.find((s) => text.startsWith(s.text, i));
    if (spelling) {
      i += spelling.text.length;
      tokens.push({ kind: "op", op: spelling.op, start: at(start), end: at(i) });
      continue;
    }

    if (word) {
      i += word[0].length;
      tokens.push({ kind: "word", text: word[0], start: at(start), end: at(i) });
      continue;
    }

    throw new ParseFailure({
      message: `Unexpected character ${JSON.stringify(text[i])}`,
      start: at(start),
      end: at(start + 1),
    });
  }

  tokens.push({ kind: "end", start: source.length, end: source.length });
  return tokens;
}

/* ── Parsing ──────────────────────────────────────────────────────────────
   Recursive descent, one level per precedence tier, mirroring `OPERATORS`.
   Written out rather than driven by the table so associativity is visible in
   the shape of each function: the left-associative tiers loop, `^` recurses
   into itself on the right, and comparison does neither. */

const ADDITIVE: BinaryOp[] = ["+", "-"];
const MULTIPLICATIVE: BinaryOp[] = ["*", "/"];
const COMPARISON: BinaryOp[] = ["=", "<>", "<", "<=", ">", ">="];

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly context: ParseContext,
  ) {}

  private peek() {
    return this.tokens[this.index];
  }

  private next() {
    return this.tokens[this.index++];
  }

  private fail(token: Token, message: string): never {
    throw new ParseFailure({ message, start: token.start, end: token.end });
  }

  private eatOp(ops: BinaryOp[]) {
    const token = this.peek();
    if (token.kind === "op" && ops.includes(token.op)) {
      this.index++;
      return token.op;
    }
    return null;
  }

  parse(): FormulaNode {
    const node = this.comparison();
    const token = this.peek();
    if (token.kind !== "end") {
      this.fail(token, "Unexpected trailing input — is an operator missing?");
    }
    return node;
  }

  /** Non-associative: `a < b < c` is a question nobody meant to ask. */
  private comparison(): FormulaNode {
    const left = this.additive();
    const op = this.eatOp(COMPARISON);
    if (!op) return left;
    const node: FormulaNode = { type: "binary", op, left, right: this.additive() };
    const trailing = this.peek();
    if (trailing.kind === "op" && COMPARISON.includes(trailing.op)) {
      this.fail(trailing, "Comparisons do not chain — bracket one of them");
    }
    return node;
  }

  private additive(): FormulaNode {
    let left = this.multiplicative();
    for (let op = this.eatOp(ADDITIVE); op; op = this.eatOp(ADDITIVE)) {
      left = { type: "binary", op, left, right: this.multiplicative() };
    }
    return left;
  }

  private multiplicative(): FormulaNode {
    let left = this.power();
    for (let op = this.eatOp(MULTIPLICATIVE); op; op = this.eatOp(MULTIPLICATIVE)) {
      left = { type: "binary", op, left, right: this.power() };
    }
    return left;
  }

  /** Right-associative: `2 ^ 3 ^ 2` is 512, not 64. */
  private power(): FormulaNode {
    const left = this.unary();
    if (!this.eatOp(["^"])) return left;
    return { type: "binary", op: "^", left, right: this.power() };
  }

  /**
   * There is no unary node in the AST (§1.1's tree has four shapes and adding
   * a fifth costs a column). A negated literal folds; anything else becomes
   * `0 – x`, which evaluates identically and prints as `0 – x`. Printing is
   * therefore not character-identical to what was typed, but the *tree* is
   * stable from the second round on, which is the property that matters.
   */
  private unary(): FormulaNode {
    const sign = this.eatOp(ADDITIVE);
    if (!sign) return this.primary();
    const operand = this.unary();
    if (sign === "+") return operand;
    if (operand.type === "literal") return { type: "literal", value: -operand.value };
    return { type: "binary", op: "-", left: { type: "literal", value: 0 }, right: operand };
  }

  private primary(): FormulaNode {
    const token = this.next();

    switch (token.kind) {
      case "number":
        return { type: "literal", value: token.value };

      case "punct":
        if (token.text === "(") {
          const inner = this.comparison();
          const close = this.next();
          if (close.kind !== "punct" || close.text !== ")") {
            this.fail(close, "Missing a closing bracket");
          }
          return inner;
        }
        return this.fail(token, `Unexpected ${JSON.stringify(token.text)}`);

      case "fn":
        return this.callArgs(token);

      case "variable":
        return this.reference(token);

      case "word":
        return this.fail(
          token,
          `Unknown name "${token.text}" — no variable or function is called that`,
        );

      case "end":
        return this.fail(token, "The formula ends early — something is missing here");

      case "op":
        return this.fail(token, "An operator needs a value before it");
    }
  }

  private callArgs(token: Extract<Token, { kind: "fn" }>): FormulaNode {
    this.next(); // the `(`, guaranteed by the tokeniser
    const args: FormulaNode[] = [];

    const empty = this.peek();
    if (empty.kind === "punct" && empty.text === ")") {
      this.next();
      return { type: "call", fn: token.fn, args };
    }

    for (;;) {
      args.push(this.comparison());
      const separator = this.next();
      if (separator.kind === "punct" && separator.text === ",") continue;
      if (separator.kind === "punct" && separator.text === ")") break;
      this.fail(separator, `${token.fn} is missing a comma or a closing bracket`);
    }

    // Arity is checked by `validateFormula`, not here: a call with the wrong
    // number of arguments has parsed perfectly well and needs the message that
    // names the signature, which is a question about the model, not the text.
    return { type: "call", fn: token.fn, args };
  }

  private reference(token: Extract<Token, { kind: "variable" }>): FormulaNode {
    const separator = this.peek();
    if (separator.kind !== "punct" || separator.text !== "·") {
      return { type: "ref", variableId: token.id };
    }
    this.next();

    const memberToken = this.next();
    const typed =
      memberToken.kind === "word"
        ? memberToken.text
        : memberToken.kind === "variable"
          ? this.context.variables.find((v) => v.id === memberToken.id)?.name
          : undefined;
    if (!typed) this.fail(memberToken, "Expected a member name after ·");

    const variable = this.context.variables.find((v) => v.id === token.id);
    const dimension = this.context.dimensions.find((d) => d.id === variable?.dimensionId);
    if (!dimension) {
      this.fail(
        memberToken,
        `${variable?.name ?? "That variable"} has no dimension, so it has no members`,
      );
    }

    const lower = typed.toLowerCase();
    const member = dimension.members.find(
      (m) => m.key.toLowerCase() === lower || m.name.toLowerCase() === lower,
    );
    if (!member) {
      this.fail(
        memberToken,
        `${dimension.name} has no member "${typed}" — try ${dimension.members
          .map((m) => m.key)
          .join(", ")}`,
      );
    }

    return { type: "ref", variableId: token.id, member: member.key };
  }
}

export function parseFormula(source: string, context: ParseContext): ParseResult {
  if (!source.trim()) {
    return {
      ok: false,
      error: { message: "A formula cannot be empty", start: 0, end: source.length },
    };
  }
  try {
    return { ok: true, node: new Parser(tokenise(source, context), context).parse() };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, error: error.error };
    throw error;
  }
}

/** The separator the editor should insert; re-exported so callers need one import. */
export { MEMBER_SEPARATOR };
