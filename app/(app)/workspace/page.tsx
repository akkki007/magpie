import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eye, Filter, GitCompare, Workflow } from "lucide-react";

import { AgentPanel } from "@/components/app/agent-panel";
import { KpiRow } from "@/components/app/kpi-row";
import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { VariableGrid } from "@/components/app/variable-grid";
import { GroupedBars, Legend, Pie, vizColors } from "@/components/ui/charts";
import {
  agentRun,
  gridRows,
  kpis,
  periods,
  profitBreakdown,
  revenueComparison,
} from "@/lib/demo/dashboard";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Operating Profit Drivers" };

/**
 * The dashboard, built to `designs/proto-screen-1.jpg`.
 *
 * The numbers come from `lib/demo/dashboard.ts` because the modelling tables do
 * not exist yet — M0/M1 in `modelling/main.md` replace that import with a query
 * and nothing on this page changes shape.
 *
 * Note where the auth check is: in the page, next to the data. Not in the
 * layout — on Next 16 a layout does not stop the page beneath it from running
 * or from shipping its data in the RSC payload (docs/auth-plan.md §4).
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/workspace");

  const initials = initialsOf(session.user.name, session.user.email);

  return (
    <div data-surface="app" className="flex h-dvh overflow-hidden bg-app">
      <Rail active="Dashboards" initials={initials} />

      {/* The canvas: a white document floating on the desk, not a full-bleed
          page. 12px gutter, hairline border, no shadow. */}
      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <Topbar
          workspace="Annual Operating Plan"
          workspaceInitial="A"
          object="Operating Profit Drivers"
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 lg:px-8">
          <h1 className="font-display text-[40px] leading-[1.05] font-bold tracking-[-0.03em] text-ink">
            Operating Profit Drivers
          </h1>

          <div className="mt-6">
            <KpiRow items={kpis} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title="Monthly Revenue Comparison">
              <GroupedBars
                groups={revenueComparison.groups}
                ticks={[0, 50, 100, 150, 200, 250]}
                rightTicks={[0, 10, 20, 30, 40, 50]}
                height={170}
              />
              <Legend
                className="mt-3"
                items={revenueComparison.series.map((label, i) => ({
                  label,
                  color: vizColors[i],
                }))}
              />
            </ChartCard>

            <ChartCard title="Profit Breakdown">
              <div className="grid place-items-center">
                <Pie slices={profitBreakdown} className="max-w-[190px]" />
              </div>
              <Legend
                className="mt-3"
                items={profitBreakdown.map((slice) => ({
                  label: slice.label,
                  color: slice.color,
                }))}
              />
            </ChartCard>
          </div>

          <section className="mt-8">
            <div className="mb-3 flex flex-wrap items-center gap-4">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
                Operating Profit Change
              </h2>
              <div className="ml-auto flex items-center gap-1">
                <GridAction icon={Workflow} label="Scenario" />
                <GridAction icon={GitCompare} label="Compare" />
                <GridAction icon={Eye} label="Views" />
                <button
                  type="button"
                  aria-label="Filter"
                  className="grid h-8 w-8 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink"
                >
                  <Filter className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>

            <VariableGrid rows={gridRows} periods={periods} />
          </section>
        </div>
      </main>

      <div className="hidden w-[34%] max-w-[560px] min-w-[380px] shrink-0 lg:block">
        <AgentPanel run={agentRun} />
      </div>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="mb-4 text-[17px] font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function GridAction({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-button px-2.5 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover"
    >
      <Icon className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
      {label}
    </button>
  );
}

/** Two letters for the rail avatar; falls back to the email when there is no name. */
function initialsOf(name: string, email: string) {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}
