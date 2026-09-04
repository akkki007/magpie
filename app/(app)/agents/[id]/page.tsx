import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Rail } from "@/components/app/rail";
import { RunView } from "@/components/agents/run-view";
import { MODES } from "@/lib/agents/modes";
import type { Artifact } from "@/lib/agents/artifacts";
import type { PendingAction, Step, Todo } from "@/lib/agents/run";
import { db } from "@/lib/db";
import { initialsOf } from "@/lib/initials";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Agent run" };

export default async function AgentRunPage({ params }: PageProps<"/agents/[id]">) {
  const { id } = await params;

  const session = await getSession();
  if (!session) redirect(`/sign-in?next=/agents/${id}`);

  const run = await db.agentRun.findUnique({ where: { id } });
  if (!run) notFound();

  // Someone else's run is a 404, not a 403 — the same reasoning `docs/auth-plan.md` §4
  // gives for not leaking which things exist.
  if (run.actorId && run.actorId !== session.user.id) notFound();

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const runsToday = await db.agentRun.count({
    where: { actorId: session.user.id, createdAt: { gte: midnight } },
  });

  const mode = MODES.find((m) => m.value === run.mode);

  return (
    <div data-surface="app" className="flex h-dvh flex-col overflow-hidden bg-app sm:flex-row">
      <Rail active="Agents" initials={initialsOf(session.user.name, session.user.email)} />

      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
          <Link
            href="/agents"
            aria-label="All runs"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          </Link>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-ink">
              {run.planTitle ?? run.task}
            </span>
          </span>
          {mode && (
            <span
              title={mode.hint}
              className="shrink-0 rounded-chip border border-line px-1.5 py-[3px] text-[10px] font-semibold text-ink-muted"
            >
              {mode.label}
            </span>
          )}
        </header>

        <RunView
          modelName={process.env.OPENAI_MODEL ?? "gpt-5.6"}
          runsToday={runsToday}
          initial={{
            id: run.id,
            task: run.task,
            mode: run.mode,
            status: run.status,
            planTitle: run.planTitle,
            planNote: run.planNote,
            activity: run.activity,
            plan: (run.plan as Todo[] | null) ?? [],
            steps: (run.steps as Step[] | null) ?? [],
            files: (run.files as Record<string, unknown> | null) ?? {},
            artifacts: (run.artifacts as Artifact[] | null) ?? [],
            pending: (run.pending as PendingAction[] | null) ?? [],
            result: run.result,
            error: run.error,
          }}
        />
      </main>
    </div>
  );
}
