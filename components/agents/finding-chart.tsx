"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChartColumn, Check, Pin } from "lucide-react";

import { pinChart } from "@/app/(app)/agents/actions";
import { BoardChart } from "@/components/board/chart";
import { toast } from "@/components/ui/toast";
import type { Artifact } from "@/lib/agents/artifacts";

/**
 * The one chart the answer is about, drawn inside the conversation
 * (`docs/agents-plan.md` A5).
 *
 * **The canvas keeps every read; this is the one the agent pointed at.** Those are different
 * jobs. The canvas is the working record — every series rolled up, every table sampled, in
 * the order it happened — and it is what you scroll when you want to check the agent's
 * reasoning. But a finding that says "New ARR fell 12% in Nov '26" beside a column of nine
 * cards makes the reader do the matching, and the reader is the person who has the least
 * context for it. So the agent names the chart that carries its point, in `submitFinding`,
 * and it is drawn here against the sentence it belongs to.
 *
 * The card is chosen by the model and grounded by the code — the same division feature 1 of
 * the board draws. Nothing here can render a chart the run did not actually produce, because
 * `submitFinding` refuses a key that is not among the charts drawn.
 *
 * Drawn with `BoardChart`, like the canvas, so there is one chart implementation in this
 * product and not three.
 */
export function FindingChart({ runId, card }: { runId: string; card: Artifact }) {
  const [pinned, setPinned] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (card.kind !== "series") return null;

  const pin = () =>
    startTransition(async () => {
      const result = await pinChart(runId, card.key);
      if (result.ok) {
        setPinned(result.slug);
        toast.success("Pinned to the board", { description: card.title });
      } else {
        toast.error("Could not pin that chart", { description: result.error });
      }
    });

  return (
    <figure className="mt-2.5 overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <ChartColumn className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-ink">{card.title}</span>
          <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
            {card.source === "records" ? "Rolled up from records" : "From the plan"}
          </span>
        </span>

        {/**
         * The pin is offered only where a *reference* can be made. A series scoped to a
         * scenario or one dimension member has no tile that means the same thing, so it
         * carries no `ref` and gets no pin — rather than a pin that quietly puts a different
         * quantity on the wall. See `SeriesRef` in `lib/agents/artifacts.ts`.
         */}
        {card.ref &&
          (pinned ? (
            <Link
              href={`/boards/${pinned}`}
              className="flex shrink-0 items-center gap-1 rounded-control px-1.5 py-1 text-[11px] text-ink-2 hover:bg-subtle"
            >
              <Check className="h-3 w-3" strokeWidth={2} aria-hidden />
              On the board
            </Link>
          ) : (
            <button
              type="button"
              onClick={pin}
              disabled={pending}
              title="Pin this chart to a board"
              aria-label={`Pin ${card.title} to a board`}
              className="shrink-0 rounded-control p-1.5 text-ink-faint hover:bg-subtle hover:text-ink-2 disabled:opacity-50"
            >
              <Pin className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            </button>
          ))}
      </header>

      <div className="px-3 py-2.5">
        <BoardChart
          form={card.series.length > 1 ? "grouped-bar" : "stacked-bar"}
          labels={card.periods}
          series={card.series}
          format={card.format}
        />
        {card.note && (
          <figcaption className="mt-2 text-[11px] leading-[1.6] text-ink-faint">{card.note}</figcaption>
        )}
      </div>
    </figure>
  );
}
