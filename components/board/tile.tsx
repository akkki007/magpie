"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { BoardChart, full } from "@/components/board/chart";
import { Insights } from "@/components/board/insight";
import { deleteTile } from "@/app/(app)/boards/actions";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { Resolved } from "@/lib/board/spec";

/**
 * One tile on a board (`docs/board-plan.md`).
 *
 * `question` rides along and is shown under the title. A figure on an executive board has to
 * be able to say where it came from, and for an AI-generated tile the question *is* the
 * provenance — the same reasoning the change log uses for keeping an actor's name.
 */
export function Tile({
  boardSlug,
  id,
  question,
  resolved,
}: {
  boardSlug: string;
  id: string;
  question: string | null;
  resolved: Resolved;
}) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);

  if (gone) return null;

  const remove = () =>
    start(async () => {
      const result = await deleteTile(boardSlug, id);
      if (result.ok) setGone(true);
      else toast.error("Could not remove that tile", { description: result.error });
    });

  if (!resolved.ok) {
    return (
      <Card onRemove={remove} pending={pending}>
        <p className="text-[13px] font-medium text-ink">This tile no longer resolves</p>
        <p className="mt-1 text-[12px] leading-[1.6] text-ink-muted">{resolved.error}</p>
        {question && <Provenance question={question} />}
      </Card>
    );
  }

  if (resolved.kind === "text") {
    return (
      <Card onRemove={remove} pending={pending}>
        <h3 className="text-[14px] font-medium text-ink">{resolved.title}</h3>
        <p className="mt-2 text-[13px] leading-[1.7] text-ink-2">{resolved.body}</p>
        {question && <Provenance question={question} />}
      </Card>
    );
  }

  if (resolved.kind === "kpi") {
    const { value, previous } = resolved;
    const delta = previous && previous !== 0 ? ((value - previous) / Math.abs(previous)) * 100 : null;

    return (
      <Card onRemove={remove} pending={pending}>
        <p className="flex items-center gap-2 text-[12px] text-ink-muted">
          {resolved.label}
          {delta !== null && (
            <span
              className={cn(
                "tnum rounded-full px-1.5 py-[2px] text-[11px] font-semibold leading-none",
                delta >= 0 ? "bg-pos-bg text-pos-fg" : "bg-neg-bg text-neg-fg",
              )}
            >
              {delta >= 0 ? "+" : "−"}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </p>
        <p className="tnum mt-1.5 text-[28px] leading-none font-semibold text-ink">
          {full(value, resolved.format)}
        </p>
        {resolved.note && <p className="mt-2 text-[12px] leading-[1.6] text-ink-muted">{resolved.note}</p>}
        {question && <Provenance question={question} />}
      </Card>
    );
  }

  return (
    <Card onRemove={remove} pending={pending}>
      <h3 className="text-[14px] font-medium text-ink">{resolved.title}</h3>
      {resolved.note && <p className="mt-1 text-[12px] leading-[1.6] text-ink-muted">{resolved.note}</p>}
      <div className="mt-3">
        <BoardChart
          form={resolved.form}
          labels={resolved.labels}
          series={resolved.series}
          format={resolved.format}
          /* The flagged periods, so the chart and the strip below it point at the same months. */
          marks={[...new Set(resolved.insight?.anomalies.map((a) => a.index) ?? [])]}
        />
      </div>
      {resolved.insight && (
        <Insights insight={resolved.insight} format={resolved.format} />
      )}
      {question && <Provenance question={question} />}
    </Card>
  );
}

function Card({
  children,
  onRemove,
  pending,
}: {
  children: React.ReactNode;
  onRemove: () => void;
  pending: boolean;
}) {
  return (
    <section
      className={cn(
        "group relative rounded-card border border-line bg-surface p-4 transition-opacity",
        pending && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={onRemove}
        disabled={pending}
        aria-label="Remove tile"
        className="absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-control text-ink-faint transition-opacity hover:bg-hover hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      {children}
    </section>
  );
}

function Provenance({ question }: { question: string }) {
  return (
    <p className="mt-3 border-t border-line pt-2 text-[11px] leading-[1.5] text-ink-faint">
      Asked: “{question}”
    </p>
  );
}
