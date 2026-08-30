import { cn } from "@/lib/cn";

const TONES = {
  amber: "bg-chip-amber",
  rose: "bg-chip-rose",
  graphite: "bg-chip-graphite",
  sky: "bg-chip-sky",
  blue: "bg-chip-blue",
} as const;

/** Organisational label. Never semantic — deltas use DeltaBadge. */
export function Chip({
  tone = "graphite",
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip px-1.5 py-[3px] text-[11px] font-semibold leading-none tracking-[0.01em] text-ink",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
      <span aria-hidden className="h-1 w-1 rounded-full bg-blue-400" />
      {children}
    </span>
  );
}

export function DeltaBadge({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className={cn(
        "tnum inline-flex items-center rounded-full px-1.5 py-[2px] text-[11px] font-semibold leading-none",
        positive ? "bg-pos-bg text-pos-fg" : "bg-neg-bg text-neg-fg",
      )}
    >
      {positive ? "+" : "−"}
      {Math.abs(value)}%
    </span>
  );
}
