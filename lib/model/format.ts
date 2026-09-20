import type { NumberFormat } from "./types";

/**
 * Number rendering. One module, one locale, so the server render and the
 * client hydration cannot disagree — a locale-dependent `toLocaleString` in a
 * cell is a hydration mismatch waiting for the first user outside en-US.
 *
 * The grid deliberately shows **no currency symbol**: `designs/modelling-1`
 * puts the unit glyph in the row header (`$`, `#`, `%`) and keeps the columns
 * as bare digits, which is what lets 24 columns of numbers stay readable.
 */

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const GROUPED_2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const FORMAT_GLYPH: Record<NumberFormat, string> = {
  CURRENCY: "$",
  COUNT: "#",
  PERCENT: "%",
  RATIO: "×",
};

export function formatValue(value: number, format: NumberFormat): string {
  if (!Number.isFinite(value)) return "—";
  // An exact zero is noise in a dense grid; finance sheets show a rule.
  if (value === 0) return "–";

  switch (format) {
    case "CURRENCY":
      return GROUPED.format(Math.round(value));
    case "COUNT":
      return GROUPED.format(Math.round(value));
    case "PERCENT":
      return `${(value * 100).toFixed(1)}%`;
    case "RATIO":
      return `${GROUPED_2.format(value)}×`;
  }
}

/** What an editable cell shows once you are typing in it. */
export function toEditable(value: number, format: NumberFormat): string {
  if (format === "PERCENT") return String(Number((value * 100).toFixed(4)));
  if (format === "RATIO") return String(Number(value.toFixed(4)));
  return String(Number(value.toFixed(2)));
}

/**
 * Parse what a user typed back into storage units. Accepts `1,240`, `$4.8m`,
 * `1.4%`, `(500)` — the shorthands people actually type into a model — and
 * returns `null` for anything it cannot read, so a bad keystroke leaves the
 * previous value alone instead of writing a zero.
 */
export function parseValue(raw: string, format: NumberFormat): number | null {
  let text = raw.trim().toLowerCase();
  if (!text) return null;

  let sign = 1;
  // Accounting negatives: (500) means -500.
  if (text.startsWith("(") && text.endsWith(")")) {
    sign = -1;
    text = text.slice(1, -1);
  }

  text = text.replace(/[$,\s%×x]/g, "");

  let multiplier = 1;
  const suffix = text.at(-1);
  if (suffix === "k") multiplier = 1e3;
  else if (suffix === "m") multiplier = 1e6;
  else if (suffix === "b") multiplier = 1e9;
  if (multiplier !== 1) text = text.slice(0, -1);

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;

  const value = sign * parsed * multiplier;
  // A percent field is stored as a decimal. Typing `1.4` or `1.4%` both mean
  // 1.4% — nobody types `0.014` into a churn row.
  if (format === "PERCENT") return value / 100;
  return value;
}
