import { Info } from "lucide-react";

import type { Kpi } from "@/lib/demo/dashboard";
import { cn } from "@/lib/cn";

/**
 * The 3-up KPI band: **one** bordered card divided by 1px vertical rules, not
 * three cards with gaps between them. The distinction is the whole reason the
 * band reads as a single instrument panel — three separate cards would say
 * these are three unrelated things.
 */
export function KpiRow({ items }: { items: Kpi[] }) {
  return (
    <div className="grid grid-cols-1 divide-y divide-line rounded-card border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {items.map((kpi) => (
        <div key={kpi.label} className="px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-medium text-ink-2">{kpi.label}</span>
            <Info className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} aria-hidden />
            <Delta delta={kpi.delta} />
          </div>
          {/* Tabular figures: these numbers sit in a column with the ones below
              them, and proportional digits would make the decimal points wander. */}
          <p className="mt-1.5 text-[34px] leading-[1.1] font-semibold tracking-[-0.02em] text-ink tabular-nums">
            {kpi.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/** The one place colour is allowed to mean something: direction of change. */
export function Delta({ delta }: { delta: Kpi["delta"] }) {
  return (
    <span
      className={cn(
        "rounded-chip px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        delta.direction === "up"
          ? "bg-pos-bg text-pos-fg"
          : "bg-neg-bg text-neg-fg",
      )}
    >
      {delta.value}
    </span>
  );
}
