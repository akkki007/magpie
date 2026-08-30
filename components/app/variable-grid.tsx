import { ChevronRight, Maximize2 } from "lucide-react";

import { Sparkline } from "@/components/ui/charts";
import type { GridRow } from "@/lib/demo/dashboard";

/**
 * The variable grid, in the shape `modelling/main.md` describes: rows are
 * variables, columns are periods, and the first three columns are *about* the
 * variable rather than about a period.
 *
 * Two things here are load-bearing for later:
 *
 * - The first column is sticky, because a 60-period model scrolls sideways and
 *   a number you cannot name is worthless.
 * - The formula is rendered as a pill from a string today and from an AST at
 *   M2. It renders as text either way, which is exactly why §1.1 stores the
 *   tree: the display string is derived, never the source of truth.
 */
const GLYPH: Record<GridRow["format"], string> = {
  CURRENCY: "$",
  COUNT: "#",
  PERCENT: "%",
};

export function VariableGrid({
  rows,
  periods,
}: {
  rows: GridRow[];
  periods: string[];
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-line">
      <table className="w-full min-w-[720px] border-collapse text-[12px] tabular-nums">
        <thead>
          <tr className="bg-muted text-left text-ink-muted">
            <th className="sticky left-0 z-10 h-8 min-w-[230px] bg-muted px-3 font-medium">
              <span className="flex items-center gap-2">
                <Maximize2 className="h-3.5 w-3.5 rotate-90" strokeWidth={1.75} aria-hidden />
                Variable Name
              </span>
            </th>
            <th className="h-8 w-[130px] border-l border-line px-3 font-medium">Trend</th>
            <th className="h-8 min-w-[240px] border-l border-line px-3 font-medium">
              Plan Formula
            </th>
            {periods.map((p) => (
              <th
                key={p}
                className="h-8 min-w-[110px] border-l border-line px-3 text-right font-medium"
              >
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-line hover:bg-hover">
              <th
                scope="row"
                className="sticky left-0 z-10 h-[30px] bg-surface px-3 text-left font-normal"
              >
                <span className="flex items-center gap-2">
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-ink-faint"
                    strokeWidth={2}
                    aria-hidden
                  />
                  <span className="w-3 shrink-0 text-center text-ink-muted">
                    {GLYPH[row.format]}
                  </span>
                  <span className="truncate text-ink">{row.name}</span>
                </span>
              </th>
              <td className="border-l border-line px-3">
                <Sparkline seed={row.seed} />
              </td>
              <td className="border-l border-line px-3">
                <span className="flex items-center gap-1.5">
                  {/* `.formula-pill` is defined once in globals.css and shared
                      with the landing mock, so the two can never drift. */}
                  <span className="formula-pill inline-flex max-w-[210px] items-center gap-1 truncate px-1.5 py-0.5">
                    <span className="text-ink-muted">{GLYPH[row.format]}</span>
                    {row.formula}
                  </span>
                  {row.timeContext && (
                    <span className="shrink-0 rounded-chip bg-violet-50 px-1.5 py-0.5 text-[11px] text-ink-muted">
                      {row.timeContext}
                    </span>
                  )}
                </span>
              </td>
              {row.values.map((v, i) => (
                <td
                  key={periods[i]}
                  className="border-l border-line px-3 text-right text-ink"
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
