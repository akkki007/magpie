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

/** Blue, 1.25px — a machine drew this. */
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
        stroke="var(--color-blue-400)"
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

export function GroupedBars({
  groups,
  className,
}: {
  groups: { label: string; values: number[] }[];
  className?: string;
}) {
  const w = 300;
  const h = 132;
  const pad = { l: 22, r: 6, t: 6, b: 18 };
  const max = Math.max(...groups.flatMap((g) => g.values));
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const groupW = plotW / groups.length;
  const barW = Math.min(11, (groupW - 12) / groups[0].values.length);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("w-full", className)} aria-hidden>
      {[0, 0.5, 1].map((t) => (
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

export function Donut({
  slices,
  className,
}: {
  slices: { label: string; value: number }[];
  className?: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 52;
  const c = 60;

  /* Precompute each slice's start angle so the render pass stays pure. */
  const arcs = slices.reduce<
    { label: string; from: number; to: number }[]
  >((acc, s) => {
    const from = acc.length ? acc[acc.length - 1].to : -Math.PI / 2;
    acc.push({ label: s.label, from, to: from + (s.value / total) * Math.PI * 2 });
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
            fill={VIZ[i % VIZ.length]}
          />
        );
      })}
    </svg>
  );
}

export function LineChart({
  series,
  className,
}: {
  series: { label: string; values: number[]; color: string }[];
  className?: string;
}) {
  const w = 300;
  const h = 130;
  const pad = { l: 26, r: 8, t: 8, b: 18 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const max = Math.max(...series.flatMap((s) => s.values));
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
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
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
