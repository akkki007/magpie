"use client";

import { useId, useState } from "react";

import type { ResolvedSeries } from "@/lib/board/spec";
import type { NumberFormat } from "@/lib/model/types";

/**
 * A board chart (`docs/board-plan.md` feature 1), drawn to the mark specs in the `dataviz`
 * method rather than to whatever looked fine.
 *
 * The specs that are load-bearing here, and why each one:
 *
 * - **Bars cap at 24px** and the band's leftover is air. A bar that fills its slot turns the
 *   gaps into a second, accidental encoding.
 * - **4px rounded data-end, square at the baseline.** The rounded end is the end of the
 *   *data*; rounding the baseline too would detach the bar from the axis it is measured
 *   against. In a stack only the topmost segment is rounded, for the same reason.
 * - **A 2px gap in the surface colour separates touching marks** — stacked segments and
 *   adjacent bars alike. White does the separating; a stroke around a mark would add ink
 *   that is not data.
 * - **Gridlines are solid hairlines, recessive.** The reference mock uses dashes; dashes
 *   are more ink for the same information, and the method is right that the grid should
 *   recede. Noted as a deliberate departure from `designs/board-1.jpg`.
 * - **A legend is always present at two or more series.** Identity is never colour alone —
 *   which matters twice over here, because the repo's viz ramp separates by *value* as much
 *   as hue and four of its six steps sit under 3:1 against white.
 * - **A table view exists.** That contrast finding obliges relief that is not dismissable;
 *   the toggle is it, and it doubles as the accessible reading of any chart.
 */

const VIZ = [
  "var(--color-viz-1)",
  "var(--color-viz-2)",
  "var(--color-viz-3)",
  "var(--color-viz-4)",
  "var(--color-viz-5)",
  "var(--color-viz-6)",
];

const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

export type ChartForm = "stacked-bar" | "grouped-bar" | "line";

export function BoardChart({
  form,
  labels,
  series,
  format,
  marks = [],
}: {
  form: ChartForm;
  labels: string[];
  series: ResolvedSeries[];
  format: NumberFormat;
  /** Period indices to flag as unusual (`docs/board-plan.md` feature 2). */
  marks?: number[];
}) {
  const [table, setTable] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          aria-pressed={table}
          className="rounded-button px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        >
          {table ? "Chart" : "Table"}
        </button>
      </div>

      {table ? (
        <DataTable labels={labels} series={series} format={format} />
      ) : (
        <Plot form={form} labels={labels} series={series} format={format} marks={marks} />
      )}

      {/* A single series needs no legend — the title already names it. */}
      {series.length > 1 && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1">
          {series.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: VIZ[i % VIZ.length] }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── The plot ─────────────────────────────────────────────────────────────*/

function Plot({
  form,
  labels,
  series,
  format,
  marks,
}: {
  form: ChartForm;
  labels: string[];
  series: ResolvedSeries[];
  format: NumberFormat;
  marks: number[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();

  const W = 640;
  const H = 260;
  const pad = { l: 46, r: 12, t: 10, b: 28 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const columnTotals = labels.map((_, i) =>
    form === "stacked-bar"
      ? series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)
      : Math.max(...series.map((s) => s.values[i] ?? 0)),
  );
  const peak = Math.max(...columnTotals, 0);
  const ticks = niceTicks(peak);
  const max = ticks.at(-1) || 1;

  const band = plotW / labels.length;
  const y = (value: number) => pad.t + plotH - (value / max) * plotH;

  /**
   * Labels thin out rather than overlap. Measuring text in SVG is awkward and a rotated
   * axis is harder to read than a sparser one — so every nth label, chosen from the band
   * width, and the tooltip carries the rest.
   */
  const step = Math.max(1, Math.ceil(labels.length / Math.floor(plotW / 52)));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${form.replace("-", " ")} chart of ${series.map((s) => s.label).join(", ")}`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={pad.l} y={pad.t - 4} width={plotW} height={plotH + 4} />
          </clipPath>
        </defs>

        {/* Gridlines: solid hairline, one step off the surface. */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={pad.l - 8}
              y={y(tick) + 3.5}
              textAnchor="end"
              fontSize={10}
              fill="var(--color-ink-faint)"
            >
              {compact(tick, format)}
            </text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>
          {form === "line"
            ? series.map((s, si) => (
                <Line key={s.label} values={s.values} color={VIZ[si % VIZ.length]} band={band} pad={pad} y={y} />
              ))
            : labels.map((_, i) =>
                form === "stacked-bar" ? (
                  <Stack key={i} index={i} series={series} band={band} pad={pad} y={y} />
                ) : (
                  <Group key={i} index={i} series={series} band={band} pad={pad} y={y} />
                ),
              )}
        </g>

        {/**
          * Anomaly markers (feature 2).
          *
          * A ring above the column, not a recoloured bar. Colour is doing enough work in a
          * six-series chart already, and a mark that only exists as a hue disappears in
          * greyscale and for a good share of readers — the same reasoning that puts a legend
          * on every multi-series chart here. The shape is the encoding; the callout strip
          * beneath names the period in words, so nothing depends on spotting it.
          */}
        {marks.map((i) => (
          <g key={`mark-${i}`}>
            <line
              x1={pad.l + band * i + band / 2}
              x2={pad.l + band * i + band / 2}
              y1={y(columnTotals[i] ?? 0) - 14}
              y2={y(columnTotals[i] ?? 0) - 4}
              stroke="var(--color-ink-faint)"
              strokeWidth={1}
            />
            <circle
              cx={pad.l + band * i + band / 2}
              cy={y(columnTotals[i] ?? 0) - 18}
              r={3.5}
              fill="var(--color-surface)"
              stroke="var(--color-ink)"
              strokeWidth={1.5}
            >
              <title>{`${labels[i]} — unusual for the months before it`}</title>
            </circle>
          </g>
        ))}

        {/* Axis labels, thinned — but never thinning away a flagged period. */}
        {labels.map((label, i) =>
          i % step === 0 || marks.includes(i) ? (
            <text
              key={label + i}
              x={pad.l + band * i + band / 2}
              y={H - 9}
              textAnchor="middle"
              fontSize={10}
              fontWeight={marks.includes(i) ? 600 : 400}
              fill={marks.includes(i) ? "var(--color-ink-2)" : "var(--color-ink-faint)"}
            >
              {label}
            </text>
          ) : null,
        )}

        {/* Hit targets are the whole band, not the mark — a 6px segment is not hoverable. */}
        {labels.map((label, i) => (
          <rect
            key={`hit-${label}-${i}`}
            x={pad.l + band * i}
            y={pad.t}
            width={band}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {hover !== null && (
          <line
            x1={pad.l + band * hover + band / 2}
            x2={pad.l + band * hover + band / 2}
            y1={pad.t}
            y2={pad.t + plotH}
            stroke="var(--color-line-strong)"
            strokeWidth={1}
          />
        )}
      </svg>

      {hover !== null && (
        <Tooltip
          label={labels[hover]}
          series={series}
          index={hover}
          format={format}
          left={((pad.l + band * hover + band / 2) / W) * 100}
        />
      )}
    </div>
  );
}

type Geom = {
  band: number;
  pad: { l: number; r: number; t: number; b: number };
  y: (value: number) => number;
};

/** Stacked: interior segments square, only the top of the stack gets the rounded data-end. */
function Stack({ index, series, band, pad, y }: Geom & { index: number; series: ResolvedSeries[] }) {
  const width = Math.min(MAX_BAR, band * 0.6);
  const x = pad.l + band * index + (band - width) / 2;

  // A plain loop, not `map` with a running total: the React compiler rejects mutating a
  // closed-over variable inside a callback, and it is right to — a stack's geometry depends
  // on evaluation order, which `map` does not promise to a reader.
  const parts: { si: number; value: number; top: number; bottom: number }[] = [];
  let cursor = 0;
  for (let si = 0; si < series.length; si++) {
    const value = series[si].values[index] ?? 0;
    if (value > 0) parts.push({ si, value, top: y(cursor + value), bottom: y(cursor) });
    cursor += value;
  }

  return (
    <g>
      {parts.map((part, i) => {
        const isTop = i === parts.length - 1;
        // The 2px gap comes out of the bottom of every segment above the first, so the
        // separation is surface colour rather than a drawn line.
        const inset = i === 0 ? 0 : GAP;
        const height = part.bottom - part.top - inset;
        if (height <= 0.5) return null;
        return (
          <path
            key={part.si}
            d={barPath(x, part.top, width, height, isTop ? RADIUS : 0)}
            fill={VIZ[part.si % VIZ.length]}
          />
        );
      })}
    </g>
  );
}

/** Grouped: bars share the band, separated by the same 2px surface gap. */
function Group({ index, series, band, pad, y }: Geom & { index: number; series: ResolvedSeries[] }) {
  const slot = (band * 0.72) / series.length;
  const width = Math.min(MAX_BAR, slot - GAP);
  const start = pad.l + band * index + (band - (width + GAP) * series.length + GAP) / 2;

  return (
    <g>
      {series.map((s, si) => {
        const value = s.values[index] ?? 0;
        const top = y(value);
        const height = y(0) - top;
        if (height <= 0.5) return null;
        return (
          <path
            key={s.label}
            d={barPath(start + si * (width + GAP), top, width, height, RADIUS)}
            fill={VIZ[si % VIZ.length]}
          />
        );
      })}
    </g>
  );
}

function Line({ values, color, band, pad, y }: Geom & { values: number[]; color: string }) {
  const points = values.map((v, i) => [pad.l + band * i + band / 2, y(v)] as const);
  const d = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const last = points.at(-1);

  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* End marker with a 2px surface ring, so it stays legible where lines cross. */}
      {last && (
        <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
      )}
    </g>
  );
}

/** Rounded at the data-end, square at the baseline. */
function barPath(x: number, top: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height);
  const bottom = top + height;
  if (r <= 0) return `M${x} ${top}h${width}v${height}h${-width}Z`;
  return [
    `M${x} ${bottom}`,
    `V${top + r}`,
    `a${r} ${r} 0 0 1 ${r} ${-r}`,
    `h${width - r * 2}`,
    `a${r} ${r} 0 0 1 ${r} ${r}`,
    `V${bottom}`,
    "Z",
  ].join(" ");
}

function Tooltip({
  label,
  series,
  index,
  format,
  left,
}: {
  label: string;
  series: ResolvedSeries[];
  index: number;
  format: NumberFormat;
  left: number;
}) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-2 z-10 min-w-[150px] -translate-x-1/2 rounded-control border border-line bg-surface p-2 shadow-e2"
      style={{ left: `${Math.min(88, Math.max(12, left))}%` }}
    >
      <p className="mb-1.5 text-[11px] font-semibold text-ink">{label}</p>
      <ul className="flex flex-col gap-1">
        {series.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-[11px]">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: VIZ[i % VIZ.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-ink-muted">{s.label}</span>
            <span className="tnum font-medium text-ink">{full(s.values[index] ?? 0, format)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DataTable({
  labels,
  series,
  format,
}: {
  labels: string[];
  series: ResolvedSeries[];
  format: NumberFormat;
}) {
  return (
    <div className="max-h-[260px] overflow-auto rounded-control border border-line">
      <table className="w-full border-separate border-spacing-0 text-[12px]">
        <thead className="sticky top-0">
          <tr>
            <th scope="col" className="border-b border-line bg-muted px-2 py-1.5 text-left font-medium text-ink-muted">
              Period
            </th>
            {series.map((s) => (
              <th
                key={s.label}
                scope="col"
                className="border-b border-line bg-muted px-2 py-1.5 text-right font-medium text-ink-muted"
              >
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, i) => (
            <tr key={label + i}>
              <th scope="row" className="border-b border-line px-2 py-1 text-left font-normal text-ink-2">
                {label}
              </th>
              {series.map((s) => (
                <td key={s.label} className="tnum border-b border-line px-2 py-1 text-right text-ink">
                  {full(s.values[i] ?? 0, format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Numbers ──────────────────────────────────────────────────────────────*/

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function full(value: number, format: NumberFormat): string {
  if (format === "PERCENT") return `${(value * 100).toFixed(1)}%`;
  if (format === "RATIO") return `${value.toFixed(2)}×`;
  return `${format === "CURRENCY" ? "$" : ""}${GROUPED.format(Math.round(value))}`;
}

/** Axis ticks: 500k, not 500,000 — the axis carries scale, the tooltip carries precision. */
export function compact(value: number, format: NumberFormat): string {
  if (format === "PERCENT") return `${Math.round(value * 100)}%`;
  const prefix = format === "CURRENCY" ? "$" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${prefix}${trim(value / 1_000_000)}m`;
  if (abs >= 1_000) return `${prefix}${trim(value / 1_000)}k`;
  return `${prefix}${GROUPED.format(value)}`;
}

const trim = (n: number) => String(Number(n.toFixed(1)));

/** Round numbers on the axis — 0 / 100k / 200k, never 0 / 137k / 274k. */
export function niceTicks(peak: number, count = 4): number[] {
  if (peak <= 0) return [0, 1];
  const raw = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value < peak + step; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}
