import { z } from "zod";

import { rollupByBreakdown, rollupToSeries } from "@/lib/data/rollup";
import type { Table } from "@/lib/data/types";
import { evaluate } from "@/lib/model/engine";
import { TOTAL, type Model, type NumberFormat } from "@/lib/model/types";

import { explain, type Insight } from "./insight";

/**
 * What a board tile *is* (`docs/board-plan.md`).
 *
 * A tile is a **reference plus a form**, never numbers. Everything it draws is resolved at
 * read time from a model series or a database rollup, which is the one rule that makes
 * "align everyone around the same integrated data" true rather than aspirational: a board
 * that stored its own figures would be a fourth place a number can come from, and it would
 * start disagreeing with the model the first time someone edited a cell.
 *
 * The schema is also the AI's output contract (feature 1). It is parsed on generation *and*
 * on every read — a tile written by an older build, or by a model that drifted, is rejected
 * at the boundary instead of crashing the board it sits on.
 */

const ModelSource = z.object({
  kind: z.literal("model"),
  /** Capped at the viz ramp's width; see `rollupByBreakdown` for why six. */
  variableIds: z.array(z.string()).min(1).max(6),
});

const DatabaseSource = z.object({
  kind: z.literal("database"),
  tableSlug: z.string(),
  dateFieldId: z.string(),
  valueFieldId: z.string().nullable(),
  aggregation: z.enum(["SUM", "COUNT", "AVG"]),
  /** A SELECT column to split by — what makes a stacked bar stacked. */
  breakdownFieldId: z.string().nullable(),
});

export const ChartSource = z.discriminatedUnion("kind", [ModelSource, DatabaseSource]);

export const TileSpec = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chart"),
    title: z.string().min(1).max(90),
    /**
     * `stacked` only when the parts genuinely sum to a meaningful whole. A stacked bar of
     * things that do not add up is the classic lie, so the prompt says so and the resolver
     * cannot fix it — this is a judgement the question has to carry.
     */
    form: z.enum(["stacked-bar", "grouped-bar", "line"]),
    source: ChartSource,
    /** One line under the title: what the reader should take from it. */
    note: z.string().max(220).optional(),
  }),
  z.object({
    kind: z.literal("kpi"),
    label: z.string().min(1).max(60),
    source: ChartSource,
    note: z.string().max(220).optional(),
  }),
  z.object({
    kind: z.literal("text"),
    title: z.string().min(1).max(90),
    body: z.string().min(1).max(1200),
  }),
]);

export type TileSpec = z.infer<typeof TileSpec>;
export type ChartSource = z.infer<typeof ChartSource>;

/* ── Resolution ───────────────────────────────────────────────────────────*/

export type ResolvedSeries = { label: string; values: number[] };

export type Resolved =
  | {
      ok: true;
      kind: "chart";
      title: string;
      form: "stacked-bar" | "grouped-bar" | "line";
      note?: string;
      labels: string[];
      series: ResolvedSeries[];
      format: NumberFormat;
      /**
       * Drivers and anomalies, computed from the series above (feature 2). Null when there
       * is nothing to say — a two-period chart, parts that do not sum, a formula that is
       * not additive. Silence is a real answer: a callout strip that always says something
       * ends up saying nothing.
       */
      insight: Insight | null;
    }
  | {
      ok: true;
      kind: "kpi";
      label: string;
      note?: string;
      value: number;
      previous: number | null;
      format: NumberFormat;
    }
  | { ok: true; kind: "text"; title: string; body: string }
  | { ok: false; error: string };

export type ResolveContext = { model: Model; tables: Table[] };

export function resolveTile(spec: TileSpec, ctx: ResolveContext): Resolved {
  if (spec.kind === "text") {
    return { ok: true, kind: "text", title: spec.title, body: spec.body };
  }

  const data = resolveSource(spec.source, ctx);
  if (!data.ok) return data;

  if (spec.kind === "kpi") {
    /**
     * A KPI is the *last* period of a single series, against the one before it. Summing a
     * series would be wrong for anything that is a balance rather than a flow, and the
     * variable already declares which it is (§1.2) — but a KPI card has room for one
     * number, and "where it stands now" is the question a card is asked. Stated here
     * because it is a choice, not an obvious default.
     */
    const series = data.series[0];
    if (!series) return { ok: false, error: "That KPI resolved to no series." };
    const values = series.values;
    return {
      ok: true,
      kind: "kpi",
      label: spec.label,
      note: spec.note,
      value: values.at(-1) ?? 0,
      previous: values.length > 1 ? (values.at(-2) ?? null) : null,
      format: data.format,
    };
  }

  return {
    ok: true,
    kind: "chart",
    title: spec.title,
    form: spec.form,
    note: spec.note,
    labels: data.labels,
    series: data.series,
    format: data.format,
    /**
     * Computed on every read, not stored and not asked for.
     *
     * Not stored, for the reason §1 gives about tiles holding references rather than
     * numbers: a driver saved beside a tile would start disagreeing with the chart the
     * first time anyone edited a cell. Not asked for either — no flag on the spec — so
     * every tile that already exists gains this without being rewritten, and a tile with
     * nothing unusual in it simply renders no strip.
     */
    insight: explain(spec, { labels: data.labels, series: data.series }, ctx.model),
  };
}

type SourceData =
  | { ok: true; labels: string[]; series: ResolvedSeries[]; format: NumberFormat }
  | { ok: false; error: string };

function resolveSource(source: ChartSource, { model, tables }: ResolveContext): SourceData {
  const labels = model.periods.map((p) => p.label);

  if (source.kind === "model") {
    const evaluation = evaluate(model);
    const series: ResolvedSeries[] = [];
    let format: NumberFormat = "COUNT";

    for (const id of source.variableIds) {
      const variable = model.variables.find((v) => v.id === id);
      // A tile naming a deleted variable fails loudly rather than drawing a flat line —
      // a chart that silently omits a series is a chart that lies about its own subject.
      if (!variable) return { ok: false, error: `This tile references a variable that no longer exists.` };
      series.push({ label: variable.name, values: evaluation.series(id, TOTAL) });
      format = variable.format;
    }

    /**
     * Mixed units are refused rather than plotted. Two measures on different scales is the
     * dual-axis chart under another name, and one y-scale with a percent and a dollar
     * amount on it makes the small one invisible. Two charts is the honest answer.
     */
    const formats = new Set(
      source.variableIds.map((id) => model.variables.find((v) => v.id === id)?.format),
    );
    if (formats.size > 1) {
      return {
        ok: false,
        error: "Those variables are in different units — they need separate tiles, not one axis.",
      };
    }

    return { ok: true, labels, series, format };
  }

  const table = tables.find((t) => t.slug === source.tableSlug);
  if (!table) return { ok: false, error: "This tile references a table that no longer exists." };

  const valueField = table.fields.find((f) => f.id === source.valueFieldId);
  const format: NumberFormat = valueField?.type === "CURRENCY" ? "CURRENCY" : "COUNT";

  if (source.breakdownFieldId) {
    const result = rollupByBreakdown(table, model, {
      dateFieldId: source.dateFieldId,
      valueFieldId: source.valueFieldId,
      aggregation: source.aggregation,
      breakdownFieldId: source.breakdownFieldId,
    });
    return result.ok
      ? { ok: true, labels, series: result.series, format }
      : { ok: false, error: result.error };
  }

  const result = rollupToSeries(table, model, {
    dateFieldId: source.dateFieldId,
    valueFieldId: source.valueFieldId,
    aggregation: source.aggregation,
  });
  return result.ok
    ? { ok: true, labels, series: [{ label: table.name, values: result.series }], format }
    : { ok: false, error: result.error };
}
