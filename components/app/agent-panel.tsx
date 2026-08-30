import {
  ArrowUp,
  ChevronDown,
  Expand,
  GripVertical,
  Mic,
  Pin,
  Plus,
  Sparkles,
  Table2,
  X,
} from "lucide-react";

import { Legend, LineChart } from "@/components/ui/charts";
import type { agentRun } from "@/lib/demo/dashboard";

/**
 * The agent panel. Static in this slice — M5 in `modelling/main.md` turns it
 * into a real run loop — but the *shape* is the contract, so it is worth being
 * precise about now:
 *
 * - The thinking disclosure and the task list are streamed run state persisted
 *   on `AgentRun`, so a refresh does not lose the transcript.
 * - A chart the agent produced is a pinnable artefact, not a message. That is
 *   why it has a drag handle and a pin: it is on its way to the canvas.
 * - Nothing in here writes to a model. Agent output becomes a `PROPOSED`
 *   ChangeSet that a human accepts (§1.4).
 */
export function AgentPanel({ run }: { run: typeof agentRun }) {
  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-subtle">
      <header className="flex h-[52px] shrink-0 items-center gap-2 px-4">
        <h2 className="truncate text-[14px] font-medium text-ink">{run.title}</h2>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <div className="ml-auto flex items-center gap-1">
          {[Plus, Expand, X].map((Icon, i) => (
            <button
              key={i}
              type="button"
              aria-label={["New chat", "Expand", "Close"][i]}
              className="grid h-8 w-8 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        <p className="rounded-card border border-line bg-surface px-4 py-3 text-[14px] leading-[21px] text-ink-2">
          {run.prompt}
        </p>

        <button
          type="button"
          className="flex items-center gap-2 text-[13px] text-ink-muted transition-colors hover:text-ink"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          Thought for {run.thinkingSeconds} seconds
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </button>

        <div className="space-y-2">
          <h3 className="text-[14px] font-medium text-ink">{run.heading}</h3>
          {run.body.map((paragraph) => (
            <p key={paragraph} className="text-[13px] leading-[21px] text-ink-2">
              {paragraph}
            </p>
          ))}
        </div>

        <figure className="rounded-card border border-line bg-surface">
          <figcaption className="flex items-center gap-2 px-3 py-2.5">
            <GripVertical
              className="h-4 w-4 cursor-grab text-ink-faint"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="truncate text-[13px] font-medium text-ink">
              {run.chart.title}
            </span>
            <button
              type="button"
              aria-label="Pin to canvas"
              className="ml-auto grid h-7 w-7 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              <Pin className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </figcaption>
          <div className="px-3 pb-3">
            <LineChart
              series={run.chart.series}
              ticks={[0, 50, 100, 150, 200, 250]}
              labels={run.chart.labels}
              height={150}
            />
            <Legend
              className="mt-2"
              items={run.chart.series.map((s) => ({ label: s.label, color: s.color }))}
            />
          </div>
        </figure>

        <p className="text-[13px] leading-[21px] text-ink-2">{run.closing}</p>
      </div>

      {/* Composer. `@` mentions are how the agent gets scoped to an object —
          the same idea as passing the model outline rather than the whole
          model, made visible to the user. */}
      <div className="shrink-0 p-4 pt-0">
        <div className="rounded-card border border-blue-200 bg-surface p-3">
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
            @
            <span className="inline-flex items-center gap-1.5 rounded-button border border-line bg-muted px-2 py-1 text-[12px] font-medium text-ink">
              <Table2 className="h-3.5 w-3.5 text-blue-600" strokeWidth={1.75} aria-hidden />
              {run.mention}
            </span>
          </span>

          <p className="mt-3 text-[14px] text-ink-faint">
            Ask something or @ mention a space
          </p>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              aria-label="Attach"
              className="grid h-8 w-8 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1.5 rounded-button border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              Auto
            </button>
            <button
              type="button"
              aria-label="Dictate"
              className="grid h-8 w-8 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              <Mic className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-label="Send"
              className="grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
