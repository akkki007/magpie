import type { Aggregation, Grain, Period } from "./types";

/**
 * Time rollup — the single highest-risk piece of correctness in the module
 * (`docs/modelling-plan.md` §1.2, §8).
 *
 * Monthly is the storage grain. Quarter and year are computed here, on read,
 * using the *variable's* aggregation: `Opening ARR` for Q1 is January's value,
 * `Closing ARR` is March's, `New ARR` is the sum of all three, and a rate is
 * an average. Summing an opening balance across three months produces a number
 * that is three times too large and looks completely plausible, which is
 * exactly why this lives in one function that every view calls.
 */

export type Bucket = {
  key: string;
  label: string;
  /** Inclusive index range into the monthly series. */
  from: number;
  to: number;
};

export function bucketsFor(periods: Period[], grain: Grain): Bucket[] {
  if (grain === "MONTH") {
    return periods.map((p, i) => ({ key: p.key, label: p.label, from: i, to: i }));
  }

  const buckets: Bucket[] = [];
  periods.forEach((period, index) => {
    const groupKey =
      grain === "QUARTER"
        ? `${period.year}-Q${Math.floor((period.month - 1) / 3) + 1}`
        : `${period.year}`;

    const open = buckets[buckets.length - 1];
    if (open && open.key === groupKey) {
      open.to = index;
      return;
    }

    const yy = String(period.year).slice(2);
    buckets.push({
      key: groupKey,
      label: grain === "QUARTER" ? `Q${Math.floor((period.month - 1) / 3) + 1} '${yy}` : `FY${yy}`,
      from: index,
      to: index,
    });
  });
  return buckets;
}

export function rollup(
  values: number[],
  buckets: Bucket[],
  aggregation: Aggregation,
): number[] {
  return buckets.map(({ from, to }) => {
    const slice = values.slice(from, to + 1);
    if (slice.length === 0) return 0;

    switch (aggregation) {
      case "SUM":
        return slice.reduce((a, b) => a + b, 0);
      case "FIRST":
        return slice[0];
      case "LAST":
        return slice[slice.length - 1];
      case "AVG":
        return slice.reduce((a, b) => a + b, 0) / slice.length;
      case "NONE":
        // "Do not roll this up" — showing the closing value is the least
        // wrong thing to render, and the grain badge tells the user it is a
        // partial view rather than a total.
        return slice[slice.length - 1];
    }
  });
}

/** Human label for the aggregation, shown in the row tooltip. */
export const AGGREGATION_LABEL: Record<Aggregation, string> = {
  SUM: "Sums over time",
  FIRST: "First period in range",
  LAST: "Last period in range",
  AVG: "Averages over time",
  NONE: "Not aggregated",
};
