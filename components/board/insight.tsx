"use client";

import { ArrowDownRight, ArrowUpRight, TriangleAlert } from "lucide-react";

import { full } from "@/components/board/chart";
import { cn } from "@/lib/cn";
import type { Insight } from "@/lib/board/insight";
import type { NumberFormat } from "@/lib/model/types";

/**
 * The callout strip under a chart (`docs/board-plan.md` feature 2).
 *
 * Every figure here is computed in `lib/board/insight.ts` from the series the tile already
 * drew — nothing is generated, and nothing can appear that the chart above it does not also
 * show. This component's only job is to say what was compared, because the comparison is the
 * part a reader cannot infer from a number: "up 23" means one thing against last month and
 * another against last year, and a driver strip that does not say which is a strip you have
 * to take on trust.
 */

const HEADING: Record<NonNullable<Insight["basis"]>, string> = {
  flows: "What moved it",
  formula: "What it is made of",
  parts: "What drove the change",
};

function comparedWith(insight: Insight): string {
  const { from, to } = insight.window;
  switch (insight.comparison) {
    case "flows":
      return `Everything that moved the balance across ${from} – ${to}`;
    case "halves":
      return `The second half of ${from} – ${to} against the first`;
    case "levels":
      return `${to} against ${from}`;
  }
}

export function Insights({ insight, format }: { insight: Insight; format: NumberFormat }) {
  const parts = insight.partCount;
  const { drivers, anomalies } = insight;
  const signed = (value: number) => `${value >= 0 ? "+" : "−"}${full(Math.abs(value), format)}`;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-[11px] text-ink-faint">{comparedWith(insight)}</p>

      {drivers.length > 0 && (
        <>
          <p className="mt-1.5 text-[12px] text-ink-2">
            <span className="font-medium text-ink">{full(insight.total.to, format)}</span>
            {insight.total.change !== 0 && (
              <>
                {" "}
                <span className={insight.total.change >= 0 ? "text-pos-fg" : "text-neg-fg"}>
                  {signed(insight.total.change)}
                </span>{" "}
                from {full(insight.total.from, format)}
              </>
            )}
          </p>

          <h4 className="mt-2.5 text-[10px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
            {HEADING[insight.basis ?? "parts"]}
          </h4>

          <ul className="mt-1.5 flex flex-col gap-1">
            {drivers.map((driver) => (
              <li key={driver.label} className="flex items-baseline gap-2 text-[12px]">
                {driver.change >= 0 ? (
                  <ArrowUpRight className="h-3 w-3 shrink-0 translate-y-[2px] text-pos-fg" strokeWidth={2} aria-hidden />
                ) : (
                  <ArrowDownRight className="h-3 w-3 shrink-0 translate-y-[2px] text-neg-fg" strokeWidth={2} aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-ink-2">{driver.label}</span>
                <span className="shrink-0 tabular-nums text-ink">{signed(driver.change)}</span>
                {/* A share is only printed where one is meaningful — see `shareOf`. */}
                {driver.share !== null && (
                  <span className="w-10 shrink-0 text-right tabular-nums text-ink-faint">
                    {Math.round(driver.share * 100)}%
                  </span>
                )}
              </li>
            ))}
          </ul>

          {parts > drivers.length && (
            <p className="mt-1.5 text-[11px] text-ink-faint">
              The largest {drivers.length} of {parts}. The rest are in the chart.
            </p>
          )}
        </>
      )}

      {anomalies.length > 0 && (
        <ul className={cn("flex flex-col gap-1", drivers.length > 0 ? "mt-3" : "mt-1.5")}>
          {anomalies.map((anomaly) => (
            <li
              key={`${anomaly.index}-${anomaly.series ?? ""}`}
              className="flex items-baseline gap-2 text-[12px] text-ink-2"
            >
              <TriangleAlert
                className="h-3 w-3 shrink-0 translate-y-[2px] text-ink-faint"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>
                <span className="font-medium text-ink">{anomaly.period}</span>
                {anomaly.series && <span className="text-ink-muted"> · {anomaly.series}</span>}{" "}
                {/* "before it", not "around it": the comparison is with the months preceding
                    this one, and only those. See `anomalies` on why it looks backwards. */}
                {anomaly.direction === "up" ? "rose" : "fell"} {full(Math.abs(anomaly.change), format)},
                unlike the months before it
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
