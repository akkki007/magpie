import { evaluate } from "@/lib/model/engine";
import { TOTAL, type FormulaNode, type Model } from "@/lib/model/types";

import type { ResolvedSeries, TileSpec } from "./spec";

/**
 * Drivers and anomalies (`docs/board-plan.md` feature 2).
 *
 * The second half of feature 1's promise — "surface key drivers, and highlight anomalies" —
 * and the half that was left unbuilt, because it is the half where a language model is
 * exactly the wrong tool.
 *
 * **Every number here is arithmetic, not generation.** An LLM asked why a figure moved will
 * produce a fluent answer whether or not it has the numbers, and a board is the last place
 * that belongs: the whole point of a tile is that it resolves from the same data everyone
 * else is looking at. So the AI's job stays what feature 1 made it — choosing what to look
 * at — and the attribution is computed from the resolved series. Nothing in this file can
 * say a category drove a change unless that category's numbers say so.
 *
 * Two questions, deliberately separate:
 *
 * - **Drivers** — of the movement across this chart, how much came from each part. Exact,
 *   and only offered where the parts genuinely sum to the whole.
 * - **Anomalies** — which single periods moved unlike the months before them.
 */

export type Driver = {
  label: string;
  /** This part's contribution to the movement, in the tile's own units. */
  change: number;
  /** Fraction of the total change — null when a share would mislead. See `shareOf`. */
  share: number | null;
};

export type Anomaly = {
  index: number;
  period: string;
  /** Named only when the tile draws more than one series. */
  series?: string;
  value: number;
  change: number;
  direction: "up" | "down";
};

export type Insight = {
  /**
   * What was compared with what, so the tile can say it plainly rather than implying an
   * analysis it did not do:
   *
   * - `levels` — the last period against the first.
   * - `halves` — the second half of the window against the first. Used where the series is
   *   a count of things happening per period, and one month against one month is noise.
   * - `flows` — everything that moved the balance, added up across the window.
   */
  comparison: "levels" | "halves" | "flows";
  window: { from: string; to: string };
  total: { from: number; to: number; change: number };
  drivers: Driver[];
  /**
   * How many parts there are in total, so a top-three list can say it is one. Counted from
   * the parts that actually moved — a category that did not change is not a driver being
   * hidden, it is a non-event.
   */
  partCount: number;
  /**
   * Where the drivers came from, so the tile can word it correctly:
   *
   * - `parts` — the chart's own series.
   * - `flows` — a balance and the flows that moved it, summed over the window. The ARR
   *   bridge: "it opened here, New added this, Churn took that, it closed there."
   * - `formula` — the additive terms of the variable's formula, compared end to end.
   *
   * `null` when there was nothing to attribute the change to.
   */
  basis: "parts" | "flows" | "formula" | null;
  anomalies: Anomaly[];
};

/* ── Anomalies ────────────────────────────────────────────────────────────*/

/**
 * How many scored changes are needed before "unusual" means anything.
 *
 * Six. With fewer, every point is either the median or an outlier, and a board that calls
 * one of four months anomalous is not doing statistics, it is picking a number.
 *
 * Counted after the lookback is spent, so this is six *scored* changes and not six changes:
 * the first `LOOKBACK` of them are the baseline the rest are judged against.
 */
const MIN_SCORED = 6;

/**
 * The modified z-score threshold, on the standard constant.
 *
 * 3.5 is the usual cut for the MAD-based score. Kept rather than tuned down to produce more
 * findings: a callout that fires on ordinary variation trains people to ignore callouts,
 * which costs more than the ones it catches.
 */
const THRESHOLD = 3.5;

/**
 * Iglewicz & Hoaglin's modified z-score, both halves of it.
 *
 * `MAD` is the usual form, `0.6745·d/MAD`. `MEAN_AD` is the documented fallback for when MAD
 * is zero, `d/(1.2533·MeanAD)` — a different constant because it is a different statistic,
 * and getting that wrong makes the fallback quietly less sensitive than the thing it stands
 * in for. See `mad` / `meanAd` below for when the fallback is reached.
 */
const MAD = 0.6745;
const MEAN_AD = 1.253314;

/**
 * How many periods back to look when asking "unlike the months before it".
 *
 * Four. Three behaves identically on every fixture; five and six start to miss a single
 * spike, because a window that long puts the spike's own neighbourhood out of reach of the
 * median that is supposed to describe it.
 */
const LOOKBACK = 4;

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

/**
 * Periods that moved unlike the months before them.
 *
 * **Detrended before scoring, which is the difference between a useful callout and a silly
 * one.** Scoring the raw period-over-period changes flags the tail of any growing series:
 * a forecast that accelerates has larger changes later by construction, and calling those
 * anomalies would mark "the plan is working" as a problem. So each change is compared with
 * the median of the changes preceding it, and the score is on what is left over. Measured,
 * not assumed: on the seeded model, scoring raw calls five months of `New ARR` unusual and
 * detrending calls none.
 *
 * **The neighbourhood looks backwards only, and that is the correction to a real bug.** It
 * used to look two periods either side, which reads better — "unlike the months around
 * it" — and is wrong at the edge of the window, where there is no "after". A one-sided
 * window on a series that curves upward has a median that sits below the final change by
 * construction, so the last residual is large for a reason that has nothing to do with the
 * business. Mixing those biased edge residuals with unbiased interior ones put **"Dec '27
 * was unusual" on four of the seeded model's headline series** — Closing ARR, Closing
 * Accounts, Revenue and Expansion ARR — which is not a finding, it is the end of the chart.
 * Every residual is now built the same way, and all four went quiet.
 *
 * The price is that the first `LOOKBACK` changes cannot be scored: a period has to have a
 * past to be unlike. That is the honest version of what this measures anyway.
 *
 * MAD rather than standard deviation, because the outlier being looked for would itself
 * inflate a standard deviation and hide underneath it.
 */
export function anomalies(labels: string[], values: number[], series?: string): Anomaly[] {
  const changes = values.slice(1).map((value, i) => value - values[i]);

  const scored = changes.flatMap((change, i) =>
    i < LOOKBACK ? [] : [{ i, residual: change - median(changes.slice(i - LOOKBACK, i)) }],
  );
  if (scored.length < MIN_SCORED) return [];

  const residuals = scored.map((s) => s.residual);
  const centre = median(residuals);
  const deviations = residuals.map((residual) => Math.abs(residual - centre));

  /**
   * MAD, with the documented fallback for the case where MAD itself is the problem.
   *
   * A median absolute deviation of zero has two entirely different causes, and the first
   * version of this treated them as one:
   *
   * - The residuals really are all identical — a perfectly regular series, where nothing is
   *   unusual and the honest answer is nothing.
   * - **More than half the residuals are identical**, while a few are enormous. A flat
   *   series with one spike is exactly this: `[0,…,0,50,−50,0,…,0]` has a median deviation
   *   of 0, so the guard fired and the most obvious anomaly there is went unreported. This
   *   is the classic MAD degeneracy, and it hits hardest precisely where the feature is
   *   most useful.
   *
   * So when MAD collapses, score against the *mean* absolute deviation, which only reaches
   * zero when the residuals genuinely are identical. Mean deviation is the less robust
   * statistic — an outlier inflates it, which is why MAD is preferred — but that only
   * applies in the case where MAD has already told us nothing, and being conservative about
   * an obvious spike beats being silent about it.
   */
  const mad = median(deviations);
  const meanAd = mean(deviations);
  if (mad === 0 && meanAd === 0) return [];
  const score = (residual: number) =>
    mad !== 0 ? (MAD * (residual - centre)) / mad : (residual - centre) / (MEAN_AD * meanAd);

  const found: Anomaly[] = [];
  for (const { i, residual } of scored) {
    if (Math.abs(score(residual)) < THRESHOLD) continue;

    // `changes[i]` is the move into period i+1, so that is the period being called unusual.
    const index = i + 1;
    found.push({
      index,
      period: labels[index] ?? `Period ${index + 1}`,
      series,
      value: values[index],
      change: changes[i],
      direction: changes[i] >= 0 ? "up" : "down",
    });
  }

  return found;
}

/* ── Drivers ──────────────────────────────────────────────────────────────*/

/**
 * A variable's formula as signed references, when the formula is a sum and difference of
 * other variables and nothing else.
 *
 * That restriction is the whole reason this is trustworthy. `Closing ARR = Opening + New +
 * Expansion − Churn` decomposes **exactly**: each part's contribution to the change is its
 * own change, and the contributions add up to the parent's change with no residual and no
 * interaction term. A product or a ratio does not work that way — the change in `Opening ×
 * Churn Rate` is not the change in either, and splitting it requires choosing where to put
 * the cross term. Rather than choose, and present the choice as a fact, this returns null
 * and the tile says nothing about drivers.
 *
 * Literals are dropped on purpose: a constant shifts the level and contributes nothing to a
 * change.
 */
export function linearParts(node: FormulaNode): { variableId: string; sign: number }[] | null {
  const parts = new Map<string, number>();

  const walk = (current: FormulaNode, sign: number): boolean => {
    if (current.type === "literal") return true;
    if (current.type === "ref") {
      // A reference pinned to one dimension member is a different quantity from the
      // variable as a whole, and this decomposes over TOTAL. Refused rather than conflated.
      if (current.member) return false;
      parts.set(current.variableId, (parts.get(current.variableId) ?? 0) + sign);
      return true;
    }
    if (current.type === "binary" && (current.op === "+" || current.op === "-")) {
      return walk(current.left, sign) && walk(current.right, current.op === "-" ? -sign : sign);
    }
    return false;
  };

  if (!walk(node, 1)) return null;

  const out = [...parts].map(([variableId, sign]) => ({ variableId, sign })).filter((p) => p.sign !== 0);
  return out.length > 0 ? out : null;
}

/**
 * When a share of the total is worth showing.
 *
 * Not whenever the maths defines it. A tile whose parts moved by +4, −3 and +1 has a total
 * change of 2, and the honest percentages are 200%, −150% and 50% — every one of them
 * arithmetically correct and every one of them nonsense to read on a board. Offsetting
 * movements are the normal case in a breakdown, and a near-zero denominator turns them into
 * a headline.
 *
 * So a share is offered only when the total actually is the story: when the net movement is
 * at least **half** the gross movement underneath it. Below that the tile shows the amounts
 * and says nothing about proportions, which is the true statement — the parts moved a great
 * deal and the total barely did.
 *
 * A half rather than the fifth this started at, because a fifth let the case above through:
 * a net of 2 against a gross of 8 is a ratio of 0.25 and still prints 200%. Checked against
 * the real tiles it has to keep working for — the ARR bridge nets 0.72 of its gross, the
 * accounts bridge 0.77, the onboarding breakdown 1.0 — so the line sits well clear of them.
 */
const SHARE_FLOOR = 0.5;

function shareOf(total: number, changes: number[]): (change: number) => number | null {
  const gross = changes.reduce((sum, change) => sum + Math.abs(change), 0);
  const meaningful = total !== 0 && gross > 0 && Math.abs(total) >= SHARE_FLOOR * gross;
  return (change) => (meaningful ? change / total : null);
}

/** Turn signed contributions into ranked drivers. */
function rank(contributions: { label: string; change: number }[], total: number): Driver[] {
  const share = shareOf(total, contributions.map((c) => c.change));
  return contributions
    .filter((c) => c.change !== 0)
    .map((c) => ({ label: c.label, change: c.change, share: share(c.change) }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

/**
 * The window split in two, for comparing like with like.
 *
 * A breakdown of records is a count *per period*, so "what changed between Jan '26 and Dec
 * '27" comparing those two months alone is a comparison of two small samples: the seeded
 * customers table moves from 6 to 8 onboardings, a total change of 2, against parts that
 * moved by +4, −3 and +1. Every share of that total is arithmetically right and useless —
 * 200%, −150%, 50%.
 *
 * Twelve months against twelve months is the same identity over a sample that can carry it.
 * The middle period is dropped when the count is odd, so the two halves are the same length
 * and the comparison is not quietly weighted.
 */
function halves(length: number): { first: [number, number]; second: [number, number] } | null {
  const half = Math.floor(length / 2);
  if (half < 2) return null;
  return { first: [0, half], second: [length - half, length] };
}

const sum = (values: number[], [from, to]: [number, number]) =>
  values.slice(from, to).reduce((total, value) => total + value, 0);

/** Each part's own movement, end to end. */
function endToEnd(
  parts: { label: string; values: number[]; sign: number }[],
  from: number,
  to: number,
  total: number,
): Driver[] {
  return rank(
    parts.map(({ label, values, sign }) => ({
      label,
      change: sign * ((values[to] ?? 0) - (values[from] ?? 0)),
    })),
    total,
  );
}

/** Each part's second half against its first. */
function betweenHalves(
  parts: { label: string; values: number[] }[],
  split: { first: [number, number]; second: [number, number] },
  total: number,
): Driver[] {
  return rank(
    parts.map(({ label, values }) => ({
      label,
      change: sum(values, split.second) - sum(values, split.first),
    })),
    total,
  );
}

/** Each flow's total across the window — the bridge from one balance to the next. */
function overWindow(
  parts: { label: string; values: number[]; sign: number }[],
  from: number,
  to: number,
  total: number,
): Driver[] {
  return rank(
    parts.map(({ label, values, sign }) => ({
      label,
      change: sign * values.slice(from + 1, to + 1).reduce((sum, value) => sum + value, 0),
    })),
    total,
  );
}

/**
 * The part of a formula that is just last period's answer.
 *
 * `Opening ARR` is `PRIOR(Closing ARR)`, so decomposing `Closing ARR` end to end reports
 * that 96% of two years of growth was "driven by" Opening ARR — exact, and a statement that
 * the balance was already there, which is not a driver of anything. Every stock-and-flow
 * variable has this shape, so it is worth detecting by name rather than working around.
 *
 * Spotting it turns the analysis into the one a finance team actually wants: because
 * `Closing(t) − Closing(t−1)` is the flows in period t, the flows **summed over the window**
 * come to exactly the change in the balance across it. Still no residual, still no
 * interaction term — a different exact identity, and the useful one.
 */
function carriedForward(parentId: string, part: FormulaNode | null | undefined): boolean {
  if (!part || part.type !== "call" || part.fn !== "PRIOR") return false;
  const [subject] = part.args;
  return subject?.type === "ref" && subject.variableId === parentId;
}

/* ── Putting it together ──────────────────────────────────────────────────*/

/** Period-by-period totals across every series a tile draws. */
const totals = (series: ResolvedSeries[]): number[] =>
  series[0]?.values.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)) ?? [];

/**
 * What this tile has to say beyond its own shape.
 *
 * Returns null when there is genuinely nothing — a two-period series, a chart whose parts
 * do not sum, a formula that is not additive. Silence is a real answer here: a callout
 * strip that always says something ends up saying nothing.
 */
export function explain(
  spec: TileSpec,
  resolved: { labels: string[]; series: ResolvedSeries[] },
  model: Model,
): Insight | null {
  const { labels, series } = resolved;
  if (series.length === 0) return null;

  const combined = totals(series);
  const to = combined.length - 1;
  if (to < 1) return null;

  /**
   * Do the parts sum to the whole?
   *
   * A stacked bar says so by its own rule (§1, "only when the parts genuinely sum to a
   * meaningful whole"), and a database breakdown does by construction — the categories are
   * a partition of the same records. A grouped bar of two separate variables does not, so
   * its parts get their own changes but no share of a total that is not one.
   */
  const partition =
    spec.kind !== "text" &&
    (spec.kind === "chart" && spec.form === "stacked-bar"
      ? true
      : spec.source.kind === "database" && Boolean(spec.source.breakdownFieldId));

  /**
   * A partition of records is counted per period, so its halves are compared; anything else
   * is a level, and the last period against the first is the right question about a level.
   */
  const split = partition ? halves(combined.length) : null;
  const comparison: Insight["comparison"] = split ? "halves" : "levels";

  const from = split ? sum(combined, split.first) : combined[0];
  const now = split ? sum(combined, split.second) : combined[to];
  const change = now - from;

  let drivers: Driver[] = [];
  let basis: Insight["basis"] = null;

  if (series.length > 1) {
    const parts = series.map((s) => ({ label: s.label, values: s.values, sign: 1 }));
    drivers = split
      ? betweenHalves(parts, split, change)
      : endToEnd(parts, 0, to, partition ? change : 0);
    basis = drivers.length > 0 ? "parts" : null;
  } else if (spec.kind !== "text" && spec.source.kind === "model" && spec.source.variableIds.length === 1) {
    const [only] = spec.source.variableIds;
    const variable = model.variables.find((v) => v.id === only);
    const parts = variable?.formula ? linearParts(variable.formula) : null;

    if (parts && variable) {
      const evaluation = evaluate(model);
      const named = parts.flatMap(({ variableId, sign }) => {
        const child = model.variables.find((v) => v.id === variableId);
        if (!child) return [];
        return [
          {
            label: child.name,
            values: evaluation.series(variableId, TOTAL),
            sign,
            carry: sign === 1 && carriedForward(variable.id, child.formula),
          },
        ];
      });

      /**
       * A balance carried forward means the flows beside it are the drivers, summed across
       * the window. Anything else is compared end to end.
       */
      const carry = named.find((part) => part.carry);
      const flows = named.filter((part) => !part.carry);

      drivers = carry ? overWindow(flows, 0, to, change) : endToEnd(named, 0, to, change);
      basis = drivers.length > 0 ? (carry ? "flows" : "formula") : null;
    }
  }

  /**
   * Anomalies are looked for in whatever the tile actually claims is one quantity. Where
   * the parts partition a whole, that is the total; where they are separate measures,
   * each series is scored on its own and named, because "March was unusual" is a different
   * statement about Enterprise than about SMB.
   */
  const found =
    series.length === 1
      ? anomalies(labels, series[0].values)
      : partition
        ? anomalies(labels, combined)
        : series.flatMap((s) => anomalies(labels, s.values, s.label));

  const ranked = found.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3);

  if (drivers.length === 0 && ranked.length === 0) return null;
  const partCount = drivers.length;

  return {
    partCount,
    comparison: basis === "flows" ? "flows" : comparison,
    window: { from: labels[0] ?? "", to: labels[to] ?? "" },
    total: { from, to: now, change },
    // Three, because a driver list is read at a glance from across a room. The rest are
    // visible in the chart they came from.
    drivers: drivers.slice(0, 3),
    basis,
    anomalies: ranked,
  };
}
