import { matchPeriod } from "@/lib/model/csv-import";
import type { Model } from "@/lib/model/types";

import type { Cell, Table } from "./types";

/**
 * A database column, bucketed by a date column, as a series a model can hold
 * (`docs/database-plan.md` §3). This is the module the whole database module exists for.
 *
 * Pure and isomorphic, exactly like `lib/model/csv-import.ts`, and it returns **the same
 * result contract** on purpose: `{ ok, series, matched, total, unmatched }`. That is what
 * lets the workbench reuse one dispatch path for both — a rollup and a paste are two
 * producers of the same thing, and the model must not be able to tell them apart. The
 * moment it can, "where did this number come from" has two answers.
 *
 * Period matching is imported rather than rewritten, for the same reason.
 */

export type Aggregation = "SUM" | "COUNT" | "AVG";

export type RollupSpec = {
  dateFieldId: string;
  /** Ignored by COUNT, required by the others. */
  valueFieldId: string | null;
  aggregation: Aggregation;
};

export type RollupResult =
  | { ok: true; series: number[]; matched: number; total: number; unmatched: string[] }
  | { ok: false; error: string };

function numberOf(cell: Cell): number | null {
  if (cell === null || cell === "") return null;
  const n = typeof cell === "number" ? cell : Number(String(cell).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function rollupToSeries(table: Table, model: Model, spec: RollupSpec): RollupResult {
  const dateField = table.fields.find((f) => f.id === spec.dateFieldId);
  if (!dateField) return { ok: false, error: "That date column no longer exists." };

  const valueField =
    spec.aggregation === "COUNT" ? null : table.fields.find((f) => f.id === spec.valueFieldId);
  if (spec.aggregation !== "COUNT" && !valueField) {
    return { ok: false, error: `${spec.aggregation} needs a column to ${spec.aggregation.toLowerCase()}.` };
  }

  const sums = Array(model.periods.length).fill(0) as number[];
  const counts = Array(model.periods.length).fill(0) as number[];
  const covered = new Set<number>();
  const unmatched: string[] = [];
  let total = 0;

  for (const row of table.rows) {
    const rawDate = row.cells[dateField.id];
    if (rawDate === null || rawDate === undefined || rawDate === "") continue;

    total++;
    const index = matchPeriod(model, String(rawDate));
    if (index === -1) {
      // A record outside the horizon is the ordinary case, not an error — a database holds
      // history the model does not span. Reported as a count so it can be *said* rather
      // than silently dropped, which is how "the total looks low" becomes unanswerable.
      unmatched.push(String(rawDate));
      continue;
    }

    if (spec.aggregation === "COUNT") {
      sums[index] += 1;
      counts[index] += 1;
      covered.add(index);
      continue;
    }

    const value = numberOf(row.cells[valueField!.id]);
    // A blank cell is not a zero. Counting it as one would drag an average down by the
    // number of records nobody has filled in yet.
    if (value === null) continue;

    sums[index] += value;
    counts[index] += 1;
    covered.add(index);
  }

  if (covered.size === 0) {
    return {
      ok: false,
      error:
        unmatched.length > 0
          ? `No record fell inside this model's horizon (${model.periods[0]?.label} – ${model.periods.at(-1)?.label}).`
          : `No record in ${table.name} has a value in both columns.`,
    };
  }

  const series =
    spec.aggregation === "AVG"
      ? sums.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : 0))
      : sums;

  return { ok: true, series, matched: covered.size, total, unmatched };
}

/**
 * What the resulting variable should be called if nobody renames it, and how it should be
 * formatted. Derived rather than asked for: naming a variable is the kind of step that
 * turns a two-click demo into a form, and the same "don't make someone name a folder"
 * reasoning M4.1 gave for new scenarios.
 */
export function describeRollup(
  table: Table,
  spec: RollupSpec,
): { name: string; format: "CURRENCY" | "COUNT"; aggregation: "SUM" | "AVG" } {
  const valueField = table.fields.find((f) => f.id === spec.valueFieldId);

  if (spec.aggregation === "COUNT") {
    return { name: `${table.name} count`, format: "COUNT", aggregation: "SUM" };
  }

  const verb = spec.aggregation === "AVG" ? "Average" : "Total";
  return {
    name: `${verb} ${(valueField?.name ?? "value").toLowerCase()}`,
    // A sum of currency is currency; a count of anything is a count. Getting this wrong
    // renders ₹4.5m as "4500000" in a column of dollars.
    format: valueField?.type === "CURRENCY" ? "CURRENCY" : "COUNT",
    // §1.2 — how the series collapses across *time*, which is not the same question as how
    // the records collapsed into a month. An average per month still sums to a year? No:
    // it averages. Getting this pair wrong is the silent-quarterly-error.
    aggregation: spec.aggregation === "AVG" ? "AVG" : "SUM",
  };
}


/* ── Breakdown: one series per category ───────────────────────────────────*/

export type BreakdownSpec = RollupSpec & { breakdownFieldId: string };

export type BreakdownResult =
  | {
      ok: true;
      series: { label: string; values: number[] }[];
      matched: number;
      total: number;
      unmatched: string[];
    }
  | { ok: false; error: string };

/**
 * The same rollup, split by a second column — "pipeline value by stage, per month".
 * This is the shape a stacked bar is, and the one a board asks for most.
 *
 * **Series are capped at `MAX_SERIES` and the tail folds into "Other".** Not a display
 * nicety: the viz ramp has six steps, and a seventh series would either repeat a hue (two
 * categories that look identical) or generate one outside the ramp (a colour the design
 * system does not own). Both are worse than an honest bucket. The cap keeps the largest
 * categories by total, because those are the ones a reader is looking for.
 */
const MAX_SERIES = 6;

export function rollupByBreakdown(
  table: Table,
  model: Model,
  spec: BreakdownSpec,
): BreakdownResult {
  const breakdownField = table.fields.find((f) => f.id === spec.breakdownFieldId);
  if (!breakdownField) return { ok: false, error: "That breakdown column no longer exists." };

  /* Group first, then reuse the single-series rollup per group — one implementation of the
     bucketing arithmetic, not two. */
  const groups = new Map<string, Table["rows"]>();
  for (const row of table.rows) {
    const raw = row.cells[breakdownField.id];
    const key = raw === null || raw === undefined || raw === "" ? "Unspecified" : String(raw);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  if (groups.size === 0) return { ok: false, error: `${table.name} has no rows to break down.` };

  const rolled: { label: string; values: number[]; weight: number }[] = [];
  let matched = 0;
  let total = 0;
  const unmatched: string[] = [];

  for (const [label, rows] of groups) {
    const result = rollupToSeries({ ...table, rows }, model, spec);
    if (!result.ok) continue;
    rolled.push({
      label,
      values: result.series,
      weight: result.series.reduce((a, b) => a + b, 0),
    });
    matched = Math.max(matched, result.matched);
    total += result.total;
    unmatched.push(...result.unmatched);
  }

  if (rolled.length === 0) {
    return {
      ok: false,
      error: `No record in ${table.name} fell inside this model's horizon.`,
    };
  }

  rolled.sort((a, b) => b.weight - a.weight);

  const kept = rolled.slice(0, MAX_SERIES - (rolled.length > MAX_SERIES ? 1 : 0));
  const tail = rolled.slice(kept.length);

  const series = kept.map(({ label, values }) => ({ label, values }));
  if (tail.length > 0) {
    series.push({
      label: `Other (${tail.length})`,
      values: model.periods.map((_, i) => tail.reduce((sum, s) => sum + s.values[i], 0)),
    });
  }

  return { ok: true, series, matched, total, unmatched };
}
