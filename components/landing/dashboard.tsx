import { Info } from "lucide-react";
import { DeltaBadge } from "@/components/ui/chip";
import { GroupedBars, Pie, Legend, Sparkline } from "@/components/ui/charts";

const KPIS = [
  { label: "Revenue", value: "$1,230,569", delta: 5 },
  { label: "Net Profit", value: "$150,120", delta: -3 },
  { label: "Operating Expenses", value: "$423,112", delta: 8 },
];

const DRIVERS = [
  { name: "Gross Profit", formula: "Revenue − Cost of Goods Sold", jan: "$483,920", feb: "$752,180" },
  { name: "Contribution Margin", formula: "Revenue − Variable Costs", jan: "$284,615", feb: "$930,470" },
  { name: "Operating Profit", formula: "Revenue − Operating Expenses", jan: "$175,839", feb: "$406,250" },
];

export function DashboardSurface() {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-line px-4 md:px-5">
        <span
          aria-hidden
          className="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[3px] bg-chip-amber text-[9px] font-bold text-ink"
        >
          A
        </span>
        {/* The parent crumb is context, not the subject — it's the first thing to fold away
            when the bar runs out of room on a phone. */}
        <span className="hidden shrink-0 text-[12.5px] text-ink-muted sm:inline">
          Annual Operating Plan
        </span>
        <span className="hidden shrink-0 text-ink-faint sm:inline">/</span>
        <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">
          Operating Profit Drivers
        </span>
        <span className="ml-auto shrink-0 text-[12.5px] text-ink-muted">Share</span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-5 sm:py-5 md:px-7">
        {/*
          Product surfaces stay on Inter Tight, not the Hinato heading face:
          Hinato has no tabular figures, and this mock has to read as the real
          app sitting inside the page rather than as marketing.
        */}
        <h3 className="font-display text-[30px] font-bold tracking-[-0.03em] text-ink md:text-[38px]">
          Operating Profit Drivers
        </h3>

        {/* KPI card — one bordered card split by rules, not three cards. */}
        <div className="mt-5 grid grid-cols-1 divide-y divide-line rounded-card border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {KPIS.map((k) => (
            <div key={k.label} className="px-4 py-3.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] text-ink-2">{k.label}</span>
                <Info className="h-3 w-3 text-ink-faint" strokeWidth={1.75} />
                <DeltaBadge value={k.delta} />
              </div>
              <p className="tnum mt-1.5 font-display text-[26px] font-bold tracking-[-0.03em] text-ink md:text-[30px]">
                {k.value}
              </p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-card border border-line p-3.5">
            <p className="text-[13px] font-medium text-ink">Monthly Revenue Comparison</p>
            <GroupedBars
              className="mt-2"
              groups={[
                { label: "Jan '24", values: [76, 165, 110] },
                { label: "Feb '24", values: [114, 127, 72] },
                { label: "Mar '24", values: [140, 22, 97] },
              ]}
            />
            <Legend
              className="mt-1"
              items={[
                { label: "Sales", color: "var(--color-viz-1)" },
                { label: "Expenses", color: "var(--color-viz-2)" },
                { label: "Operating Profit", color: "var(--color-viz-3)" },
              ]}
            />
          </div>

          <div className="rounded-card border border-line p-3.5">
            <p className="text-[13px] font-medium text-ink">Profit Breakdown</p>
            <div className="mx-auto mt-2 max-w-[150px]">
              <Pie
                slices={[
                  { label: "Laptop", value: 38 },
                  { label: "Smartphones", value: 36 },
                  { label: "Watch", value: 26 },
                ]}
              />
            </div>
            <Legend
              className="mt-2"
              items={[
                { label: "Laptop", color: "var(--color-viz-1)" },
                { label: "Smartphones", color: "var(--color-viz-2)" },
                { label: "Watch", color: "var(--color-viz-3)" },
              ]}
            />
          </div>
        </div>

        {/* Driver table */}
        <p className="mt-6 text-[15px] font-semibold tracking-[-0.01em] text-ink">
          Operating Profit Change
        </p>
        <div className="mt-2.5 overflow-hidden rounded-card border border-line">
          <div className="flex h-[30px] items-center border-b border-line text-[11.5px] text-ink-muted">
            <div className="w-[150px] shrink-0 border-r border-line px-3 sm:w-[190px]">
              Variable Name
            </div>
            <div className="hidden w-[96px] shrink-0 border-r border-line px-3 sm:block">
              Trend
            </div>
            <div className="hidden flex-1 border-r border-line px-3 md:block">
              Plan Formula
            </div>
            <div className="w-[86px] shrink-0 px-3 text-right">Jan &apos;25</div>
            <div className="hidden w-[86px] shrink-0 px-3 text-right sm:block">Feb &apos;25</div>
          </div>
          {DRIVERS.map((d, i) => (
            <div
              key={d.name}
              className="flex h-[34px] items-center border-b border-line text-[12px] last:border-b-0"
            >
              <div className="flex w-[150px] shrink-0 items-center gap-1.5 border-r border-line px-3 sm:w-[190px]">
                <span className="text-[11px] text-ink-faint">$</span>
                <span className="truncate text-ink-2">{d.name}</span>
              </div>
              <div className="hidden w-[96px] shrink-0 items-center border-r border-line px-3 sm:flex">
                <Sparkline seed={4211 * (i + 3)} />
              </div>
              <div className="hidden min-w-0 flex-1 border-r border-line px-3 md:block">
                <span className="formula-pill inline-block max-w-full truncate px-1.5 py-[2px] text-[11px]">
                  <span className="text-blue-600">$</span> {d.formula}
                </span>
              </div>
              <div className="tnum w-[86px] shrink-0 px-3 text-right text-ink-2">{d.jan}</div>
              <div className="tnum hidden w-[86px] shrink-0 px-3 text-right text-ink-2 sm:block">
                {d.feb}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
