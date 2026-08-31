"use client";

import { useMemo } from "react";
import { TrendingDown } from "lucide-react";

import { cn } from "@/lib/cn";
import { evaluate } from "@/lib/model/engine";
import { toIndianDecimal } from "@/lib/recon/money";
import { buildCashModel, CASH_VARS } from "@/lib/recon/cash-model";
import type { CashSeries } from "@/lib/recon/cash";
import type { QueueEntry } from "@/lib/recon/report";
import type { QueueState } from "@/lib/recon/queue-commands";

/**
 * The forward cash position (`docs/recon-plan.md` R6).
 *
 * Two things make this more than a chart.
 *
 * **It is evaluated by the modelling engine, not by this component.** The three reconciled
 * series become `LINKED` variables and the position rows are `FORMULA` variables that
 * `lib/model/engine.ts` computes — the same evaluator the revenue grid uses. So the running
 * total here cannot drift from the running total there, and `CUMULATIVE` is one
 * implementation rather than two. That is the payoff for having built the engine first.
 *
 * **Working the queue moves it, live.** The at-risk series is recomputed from the queue's
 * decisions on every render, so accepting a class of exceptions visibly shrinks the
 * unverified band. That is R6's "done when", and it is also the honest claim §6 asks for: a
 * forecast that states how much of itself is unverified, and shrinks that number only when a
 * human actually resolves something.
 */
/**
 * Rupees, Indian-grouped, with the symbol.
 *
 * Deliberately *not* `lib/model/format`'s `formatValue`, which is symbol-less and en-US
 * grouped — a correct choice for a 24-column grid where the unit glyph lives in the row
 * header and bare digits are what keep it readable. Three columns of ₹3.5 crore is a
 * statement, not a grid, and it sits directly under tiles that use Indian grouping. Two money
 * formats disagreeing on one screen is the sort of detail a finance reviewer notices first.
 *
 * Built on the module's own string formatter rather than `Intl` so the server render and the
 * client hydration cannot disagree about grouping.
 */
const rupees = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  if (Math.round(value) === 0) return "–";
  return `₹${toIndianDecimal(Math.round(value) * 100).slice(0, -3)}`;
};

export function CashPosition({
  cash,
  queue,
  state,
}: {
  cash: CashSeries;
  queue: QueueEntry[];
  state: QueueState;
}) {
  /**
   * The at-risk line, less whatever has been reviewed.
   *
   * A resolved entry leaves the band whether it was accepted or rejected — both are answers.
   * What the band measures is *unreviewed* value, not bad value.
   */
  const { adjusted, resolvedValue } = useMemo(() => {
    const next = [...cash.atRisk];
    let resolved = 0;
    for (const [index, entry] of queue.entries()) {
      if ((state[String(index)] ?? "open") === "open") continue;
      const period = cash.entryPeriods[index];
      if (period === undefined) continue;
      next[period] -= Math.abs(entry.amount);
      resolved += Math.abs(entry.amount);
    }
    return { adjusted: next, resolvedValue: resolved };
  }, [cash, queue, state]);

  const { model, series } = useMemo(() => {
    const built = buildCashModel(cash, adjusted);
    const evaluation = evaluate(built);
    return { model: built, series: evaluation.series };
  }, [cash, adjusted]);

  const rows = [
    { id: CASH_VARS.reconciled, label: "Reconciled inflow", tone: "flow" as const },
    { id: CASH_VARS.inFlight, label: "In-flight settlements", tone: "flow" as const },
    { id: CASH_VARS.atRisk, label: "Exceptions at risk", tone: "risk" as const },
    { id: CASH_VARS.confirmed, label: "Confirmed position", tone: "strong" as const },
    { id: CASH_VARS.expected, label: "Expected position", tone: "strong" as const },
    { id: CASH_VARS.band, label: "Unverified band", tone: "risk" as const },
  ];

  const bandNow = series(CASH_VARS.band).at(-1) ?? 0;

  return (
    <section className="shrink-0 border-b border-line">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pb-2 pt-3">
        <h2 className="text-[13px] font-medium text-ink">Cash position</h2>
        <p className="text-[12px] text-ink-muted">
          Reconciled cash driving the modelling engine — {model.variables.length} variables,{" "}
          {model.periods.length} periods, evaluated by <code>lib/model/engine.ts</code>
        </p>
        {resolvedValue > 0 && (
          <p className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-pos-fg">
            <TrendingDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            band down {rupees(resolvedValue / 100)} · {rupees(bandNow)} still unverified
          </p>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-t border-line text-[13px]">
          <thead>
            <tr className="text-ink-faint">
              <th scope="col" className="w-56 px-4 py-1.5 text-left text-[11px] font-normal uppercase tracking-[0.04em]">
                Variable
              </th>
              {model.periods.map((period) => (
                <th
                  key={period.key}
                  scope="col"
                  className="px-4 py-1.5 text-right text-[11px] font-normal uppercase tracking-[0.04em]"
                >
                  {period.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const values = series(row.id);
              const isPosition = row.tone === "strong";
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "border-t border-line",
                    index === 3 && "border-t-line-strong",
                    isPosition && "bg-subtle",
                  )}
                >
                  <th scope="row" className="px-4 py-1.5 text-left font-normal">
                    <span className={cn("text-ink-2", isPosition && "font-medium text-ink")}>
                      {row.label}
                    </span>
                  </th>
                  {values.map((value, period) => (
                    <td
                      key={period}
                      className={cn(
                        "px-4 py-1.5 text-right tabular-nums",
                        isPosition ? "font-medium text-ink" : "text-ink-2",
                        row.tone === "risk" && value !== 0 && "text-neg-fg",
                      )}
                    >
                      {rupees(value)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="px-4 pb-3 pt-2 text-[12px] leading-[1.5] text-ink-faint">
        The band is the point: it says how much of the position above nobody has verified.
        Working the queue below moves it. Months rather than days because the engine&rsquo;s
        period is month-shaped — a daily curve is an engine change, not a screen change.
      </p>
    </section>
  );
}
