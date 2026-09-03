import type { Cell, FieldType } from "./types";

/**
 * Cell rendering for the database grid.
 *
 * Deliberately *not* `lib/model/format.ts`. That module renders a model cell, where the
 * unit glyph lives in the row header so 24 columns of digits stay readable, and where an
 * exact zero prints as a rule because a zero is noise in a dense forecast. Neither rule
 * holds here: the reference screen puts `$` in the cell, and a credit limit of 0 is a fact
 * about a customer, not noise. Two contexts, two renderers — sharing one would mean a flag,
 * and a flag would mean every call site deciding which product it is in.
 *
 * One locale, fixed, for the same reason the model's formatter fixes one: a
 * locale-dependent number in a server-rendered cell is a hydration mismatch waiting for the
 * first user outside en-US.
 */

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatCell(value: Cell, type: FieldType): string {
  if (value === null || value === undefined || value === "") return "";

  switch (type) {
    case "CURRENCY": {
      const n = Number(value);
      return Number.isFinite(n) ? `$${GROUPED.format(n)}` : String(value);
    }
    case "NUMBER": {
      const n = Number(value);
      return Number.isFinite(n) ? GROUPED.format(n) : String(value);
    }
    case "DATE":
      return formatDate(String(value));
    default:
      return String(value);
  }
}

/**
 * `2025-03-22` → `22/03/2025`, which is what the reference screen shows.
 *
 * Split rather than `new Date()`: parsing a bare `YYYY-MM-DD` gives a UTC midnight, and
 * rendering that through a local-time getter moves the date backwards for anyone west of
 * Greenwich. A date field here is a calendar date, not an instant, so it never becomes a
 * `Date` at all.
 */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

/** What a cell contributes to a search — the rendered text, so "22/03" finds a date. */
export function searchText(value: Cell, type: FieldType): string {
  return `${value ?? ""} ${formatCell(value, type)}`.toLowerCase();
}
