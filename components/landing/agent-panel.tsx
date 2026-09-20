import {
  ChevronDown,
  CircleCheck,
  Mic,
  Plus,
  ArrowUp,
  Sparkles,
} from "lucide-react";
import { Orb } from "@/components/ui/logo";
import { LineChart, Legend } from "@/components/ui/charts";

const TASKS = [
  "Preparing customer details",
  "Analyzing historical financial data",
  "Forecasting revenue growth",
  "Assessing potential market risks",
];

export function AgentPanel() {
  return (
    <div className="flex h-full flex-col bg-subtle">
      {/* Panel header */}
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="truncate text-[12.5px] font-medium text-ink">
          Revenue Forecast
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} />
        <Plus className="ml-auto h-4 w-4 shrink-0 text-ink-muted" strokeWidth={1.75} />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 py-4">
        {/* User turn */}
        <div className="ml-6 rounded-card bg-surface px-3 py-2.5 text-[12.5px] leading-[1.55] text-ink-2 shadow-e1">
          What&apos;s my revenue forecast if I apply 30% growth and keep churn the same?
        </div>

        {/* Thinking disclosure */}
        <div className="flex items-center gap-2 text-[12px] text-ink-muted">
          <Orb className="h-3.5 w-3.5" />
          Thought for 8 seconds
          <ChevronDown className="h-3 w-3" strokeWidth={2} />
        </div>

        {/* Task list */}
        <div className="rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[12px] font-medium text-ink">Task list</span>
            <ChevronDown className="h-3 w-3 text-ink-muted" strokeWidth={2} />
          </div>
          <ul className="space-y-2 px-3 py-2.5">
            {TASKS.map((t) => (
              <li key={t} className="flex items-center gap-2 text-[12px] text-ink-2">
                <CircleCheck className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} />
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Result card */}
        <div className="rounded-card border border-line bg-surface p-3">
          <p className="mb-2 text-[12px] font-medium text-ink">
            Profit Trend and Expense Impact
          </p>
          <LineChart
            series={[
              { label: "Sales", values: [12, 30, 48, 44, 34, 50], color: "var(--color-viz-3)" },
              { label: "Profit", values: [48, 78, 96, 74, 62, 66], color: "var(--color-viz-1)" },
              { label: "Operating", values: [88, 96, 92, 98, 96, 84], color: "var(--color-viz-4)" },
            ]}
          />
          <Legend
            className="mt-2"
            items={[
              { label: "Sales", color: "var(--color-viz-3)" },
              { label: "Profit", color: "var(--color-viz-1)" },
              { label: "Operating Profit", color: "var(--color-viz-4)" },
            ]}
          />
        </div>

        <p className="text-[12.5px] leading-[1.6] text-ink-2">
          Created <span className="text-ink">Revenue Forecast — Growth +30% · Q3</span>.
          Increased new customers in EMEA by 30% while keeping churn unchanged, then
          recomputed active accounts and revenue under a dynamic ARPU model.
        </p>
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-4">
        <div className="rounded-card border border-blue-200 bg-surface p-2.5 shadow-e1">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-[12px] text-ink-faint">@</span>
            <span className="inline-flex items-center gap-1.5 rounded-chip border border-line bg-muted px-1.5 py-[3px] text-[11px] font-medium text-ink">
              <span aria-hidden className="text-[9px] text-viz-1">▦</span>
              Revenue Model 2026
            </span>
          </div>
          <p className="mb-2.5 text-[12.5px] text-ink-faint">
            Ask something or @ mention a space
          </p>
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
            <span className="ml-auto inline-flex items-center gap-1 rounded-button border border-line bg-surface px-1.5 py-[3px] text-[11px] text-ink-2">
              <Sparkles className="h-3 w-3 text-ink-muted" strokeWidth={1.75} />
              Auto
            </span>
            <Mic className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
            <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-faint">
              <ArrowUp className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
