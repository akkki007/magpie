import { cn } from "@/lib/cn";

/* Deterministic pseudo-random so server and client render identically. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function sparkPath(seed: number, points = 14, w = 72, h = 20) {
  const rand = seeded(seed);
  const values = Array.from({ length: points }, () => rand());
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (points - 1)) * w;
      const y = h - 2 - ((v - min) / span) * (h - 4);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Violet, 1.25px — a machine drew this. */
export function Sparkline({
  seed,
  className,
  width = 72,
  height = 20,
}: {
  seed: number;
  className?: string;
  width?: number;
  height?: number;
}) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      className={cn("overflow-visible", className)}
      fill="none"
    >
      <path
        d={sparkPath(seed, 14, width, height)}
        stroke="var(--color-violet-400)"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const VIZ = [
  "var(--color-viz-1)",
  "var(--color-viz-2)",
  "var(--color-viz-3)",
  "var(--color-viz-4)",
  "var(--color-viz-5)",
  "var(--color-viz-6)",
];

/**
 * Grouped bars. `ticks` turns on the labelled left axis from the dashboard
 * screen; `rightTicks` adds the second scale on the right. Both are optional so
 * the small marketing version keeps rendering exactly as it did.
 */
export function GroupedBars({
  groups,
  className,
  ticks,
  rightTicks,
  height = 132,
}: {
  groups: { label: string; values: number[] }[];
  className?: string;
  ticks?: number[];
  rightTicks?: number[];
  height?: number;
}) {
  const w = 300;
  const h = height;
  const pad = {
    l: ticks ? 30 : 22,
    r: rightTicks ? 26 : 6,
    t: 6,
    b: ticks ? 22 : 18,
  };
  // With a labelled axis the bars must be measured against the axis, not
  // against their own maximum, or the tick values are decoration that lies.
  const max = ticks
    ? Math.max(...ticks)
    : Math.max(...groups.flatMap((g) => g.values));
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const groupW = plotW / groups.length;
  const barW = Math.min(11, (groupW - 12) / groups[0].values.length);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("w-full", className)} aria-hidden>
      {(ticks ? ticks.map((_, i) => i / (ticks.length - 1)) : [0, 0.5, 1]).map(
        (t) => (
          <line
            key={t}
            x1={pad.l}
            x2={w - pad.r}
            y1={pad.t + plotH * t}
            y2={pad.t + plotH * t}
            stroke="var(--color-line)"
            strokeWidth={1}
            strokeDasharray={t === 1 ? undefined : "2 3"}
          />
        ),
      )}

      {/* Axis labels. Ticks arrive low-to-high and are drawn bottom-up. */}
      {ticks?.map((value, i) => (
        <text
          key={`l${value}`}
          x={pad.l - 6}
          y={pad.t + plotH - (i / (ticks.length - 1)) * plotH + 3}
          textAnchor="end"
          fontSize={8}
          fill="var(--color-ink-faint)"
        >
          {value}
        </text>
      ))}
      {rightTicks?.map((value, i) => (
        <text
          key={`r${value}`}
          x={w - pad.r + 6}
          y={pad.t + plotH - (i / (rightTicks.length - 1)) * plotH + 3}
          textAnchor="start"
          fontSize={8}
          fill="var(--color-ink-faint)"
        >
          {value}
        </text>
      ))}
      {groups.map((g, gi) => {
        const gx = pad.l + gi * groupW + (groupW - barW * g.values.length - 4) / 2;
        return (
          <g key={g.label}>
            {g.values.map((v, vi) => {
              const bh = (v / max) * plotH;
              return (
                <rect
                  key={vi}
                  x={gx + vi * (barW + 2)}
                  y={pad.t + plotH - bh}
                  width={barW}
                  height={bh}
                  fill={VIZ[vi]}
                  rx={1}
                />
              );
            })}
            <text
              x={pad.l + gi * groupW + groupW / 2}
              y={h - 5}
              textAnchor="middle"
              fontSize={8}
              fill="var(--color-ink-faint)"
            >
              {g.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Pie({
  slices,
  className,
}: {
  /** `color` wins over the ramp when a slice has a hue of its own. */
  slices: { label: string; value: number; color?: string }[];
  className?: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 52;
  const c = 60;

  /* Precompute each slice's start angle so the render pass stays pure. */
  const arcs = slices.reduce<
    { label: string; from: number; to: number; color?: string }[]
  >((acc, s) => {
    const from = acc.length ? acc[acc.length - 1].to : -Math.PI / 2;
    acc.push({
      label: s.label,
      from,
      to: from + (s.value / total) * Math.PI * 2,
      color: s.color,
    });
    return acc;
  }, []);

  return (
    <svg viewBox="0 0 120 120" className={cn("w-full", className)} aria-hidden>
      {arcs.map((a, i) => {
        const x1 = c + r * Math.cos(a.from);
        const y1 = c + r * Math.sin(a.from);
        const x2 = c + r * Math.cos(a.to);
        const y2 = c + r * Math.sin(a.to);
        const large = a.to - a.from > Math.PI ? 1 : 0;
        return (
          <path
            key={a.label}
            d={`M${c} ${c} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`}
            fill={a.color ?? VIZ[i % VIZ.length]}
          />
        );
      })}
    </svg>
  );
}

export function LineChart({
  series,
  className,
  ticks,
  labels,
  height = 130,
}: {
  series: { label: string; values: number[]; color: string }[];
  className?: string;
  /** Low-to-high axis values. Given, they define the scale, not the data. */
  ticks?: number[];
  /** One per period, drawn under the plot. */
  labels?: string[];
  height?: number;
}) {
  const w = 300;
  const h = height;
  const pad = { l: ticks ? 34 : 26, r: 8, t: 8, b: labels ? 22 : 18 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const max = ticks
    ? Math.max(...ticks)
    : Math.max(...series.flatMap((s) => s.values));
  const n = series[0].values.length;

  const toPath = (values: number[]) =>
    values
      .map((v, i) => {
        const x = pad.l + (i / (n - 1)) * plotW;
        const y = pad.t + plotH - (v / max) * plotH;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("w-full", className)} aria-hidden>
      {(ticks
        ? ticks.map((_, i) => i / (ticks.length - 1))
        : [0, 0.25, 0.5, 0.75, 1]
      ).map((t) => (
        <line
          key={t}
          x1={pad.l}
          x2={w - pad.r}
          y1={pad.t + plotH * t}
          y2={pad.t + plotH * t}
          stroke="var(--color-line)"
          strokeDasharray="2 3"
        />
      ))}
      {ticks?.map((value, i) => (
        <text
          key={value}
          x={pad.l - 6}
          y={pad.t + plotH - (i / (ticks.length - 1)) * plotH + 3}
          textAnchor="end"
          fontSize={8}
          fill="var(--color-ink-faint)"
        >
          ${value}
        </text>
      ))}
      {labels?.map((label, i) => (
        <text
          key={label}
          x={pad.l + (i / (labels.length - 1)) * plotW}
          y={h - 5}
          textAnchor="middle"
          fontSize={8}
          fill="var(--color-ink-faint)"
        >
          {label}
        </text>
      ))}
      {series.map((s) => (
        <path
          key={s.label}
          d={toPath(s.values)}
          fill="none"
          stroke={s.color}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export function Legend({
  items,
  className,
}: {
  items: { label: string; color: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-1.5", className)}>
      {items.map((i) => (
        <span
          key={i.label}
          className="inline-flex items-center gap-1.5 rounded-button border border-line bg-surface px-2 py-1 text-[10px] font-medium text-ink-2"
        >
          <span
            aria-hidden
            className="h-2 w-2 rounded-[2px]"
            style={{ background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export const vizColors = VIZ;
