import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { RunView } from "@/components/agents/run-view";
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

  return (
    <div data-surface="app" className="flex h-dvh overflow-hidden bg-app">
      <Rail active="Agents" initials={initialsOf(session.user.name, session.user.email)} />

      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <Topbar workspace="Agents" object="Run" meta={run.createdAt.toISOString().slice(0, 16).replace("T", " ")} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[900px] px-6 py-6">
            <Link
              href="/agents"
              className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
              All runs
            </Link>

            <h1 className="mt-3 text-[20px] leading-[1.4] font-semibold text-ink">{run.task}</h1>

            <div className="mt-5">
              <RunView
                initial={{
                  id: run.id,
                  task: run.task,
                  status: run.status,
                  plan: (run.plan as Todo[] | null) ?? [],
                  steps: (run.steps as Step[] | null) ?? [],
                  files: (run.files as Record<string, unknown> | null) ?? {},
                  pending: (run.pending as PendingAction[] | null) ?? [],
                  result: run.result,
                  error: run.error,
                }}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
