import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot } from "lucide-react";

import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { SpawnPanel } from "@/components/agents/spawn-panel";
import { db } from "@/lib/db";
import { initialsOf } from "@/lib/initials";
import { getSession } from "@/lib/session";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Agents" };

const STATUS_TONE = {
  RUNNING: "bg-chip-sky text-ink",
  WAITING: "bg-chip-amber text-ink",
  DONE: "bg-ok-bg text-ok-fg",
  FAILED: "bg-neg-bg text-neg-fg",
} as const;

const STATUS_LABEL = {
  RUNNING: "running",
  WAITING: "needs you",
  DONE: "done",
  FAILED: "failed",
} as const;

/** Finance-ops runs (`docs/agents-plan.md` A5). */
export default async function AgentsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/agents");

  // Scoped to the person who spawned them, the same reasoning AgentChat uses: a run is
  // somebody's own line of questioning, not a shared record of the model.
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const runsToday = await db.agentRun.count({
    where: { actorId: session.user.id, createdAt: { gte: midnight } },
  });

  const runs = await db.agentRun.findMany({
    where: { actorId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, task: true, status: true, createdAt: true, plan: true, planTitle: true, mode: true },
  });

  return (
    <div data-surface="app" className="flex h-dvh flex-col overflow-hidden bg-app sm:flex-row">
      <Rail active="Agents" initials={initialsOf(session.user.name, session.user.email)} />

      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <Topbar workspace="Agents" object="Finance ops" meta={`${runs.length} run(s)`} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[820px] px-6 py-6">
            <h1 className="text-[22px] leading-tight font-semibold text-ink">Spawn an agent</h1>
            <p className="mt-1.5 text-[13px] leading-[1.65] text-ink-muted">
              It plans, delegates to specialists, reads the model and the tables, and comes back
              with a finding. Anything it wants to change stops for your approval first.
            </p>

            <div className="mt-4">
              <SpawnPanel
                suggestions={SUGGESTIONS}
                modelName={process.env.OPENAI_MODEL ?? "gpt-5.6"}
                runsToday={runsToday}
              />
            </div>

            <h2 className="mt-8 mb-2 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
              Runs
            </h2>

            {runs.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No runs yet.</p>
            ) : (
              <ul className="overflow-hidden rounded-card border border-line">
                {runs.map((run) => {
                  const todos = Array.isArray(run.plan) ? (run.plan as { status?: string }[]) : [];
                  const done = todos.filter((t) => t.status === "completed").length;

                  return (
                    <li key={run.id} className="border-b border-line last:border-b-0">
                      <Link href={`/agents/${run.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-hover">
                        <span className="mt-[2px] grid h-7 w-7 shrink-0 place-items-center rounded-control bg-violet-100">
                          <Bot className="h-3.5 w-3.5 text-violet-500" strokeWidth={1.75} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-ink">
                            {run.planTitle ?? run.task}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-ink-faint">
                            {run.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                            {` · ${run.mode}`}
                            {todos.length > 0 && ` · ${done}/${todos.length} tasks`}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-chip px-1.5 py-[3px] text-[10px] font-semibold",
                            STATUS_TONE[run.status],
                          )}
                        >
                          {STATUS_LABEL[run.status]}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

const SUGGESTIONS = [
  "Is customer onboarding tracking to the plan's new-accounts forecast? If not, propose a corrected forecast.",
  "Build a database table for tracking vendor contracts, then tell me what fields you chose and why.",
  "Find the biggest driver of ARR growth in the plan and put a chart of it on the board.",
  "Which months look anomalous in the customer data, and what would explain them?",
];
