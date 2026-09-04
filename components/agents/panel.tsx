"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { spawnRun } from "@/app/(app)/agents/actions";
import { Approval } from "@/components/agents/approval";
import { Composer } from "@/components/agents/composer";
import { Markdown } from "@/components/agents/markdown";
import { PlanCard } from "@/components/agents/plan-card";
import { Steps } from "@/components/agents/steps";
import { toast } from "@/components/ui/toast";
import type { Mode } from "@/lib/agents/modes";
import type { PendingAction, Step, Todo } from "@/lib/agents/run";

/**
 * The conversation side of a run (`docs/agents-plan.md` A5).
 *
 * Ordered the way someone reads it: what it is doing now, the plan, anything waiting on
 * them, the answer, then the trail. The composer stays pinned at the bottom, because the
 * end of a run is usually the start of the next question — and a follow-up spawns a fresh
 * run rather than continuing this one, since a run is a durable record of one task and
 * appending a second task to it would make both harder to read later.
 */
export function Panel({
  run,
  modelName,
  runsToday,
}: {
  run: {
    id: string;
    task: string;
    mode: string;
    status: "RUNNING" | "WAITING" | "DONE" | "FAILED";
    planTitle: string | null;
    planNote: string | null;
    activity: string | null;
    plan: Todo[];
    steps: Step[];
    pending: PendingAction[];
    result: string | null;
    error: string | null;
  };
  modelName: string;
  runsToday: number;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const bottom = useRef<HTMLDivElement>(null);

  // Follow the run as it grows, the way a chat does — but only while it is live, so reading
  // a finished run does not fight the scroll.
  useEffect(() => {
    if (run.status === "RUNNING") bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [run.steps.length, run.status]);

  const spawn = async (task: string, mode: Mode) => {
    setPending(true);
    const result = await spawnRun(task, mode);
    setPending(false);
    if (result.ok) router.push(`/agents/${result.id}`);
    else toast.error("Could not start that run", { description: result.error });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3.5">
          <PlanCard
            task={run.task}
            title={run.planTitle}
            note={run.planNote}
            todos={run.plan}
            steps={run.steps}
            running={run.status === "RUNNING"}
          />

          {run.status === "WAITING" && run.pending.length > 0 && (
            <Approval runId={run.id} pending={run.pending} />
          )}

          {run.status === "FAILED" && (
            <section className="rounded-card border border-line bg-neg-bg/40 p-3.5">
              <p className="text-[13px] font-medium text-ink">This run failed</p>
              <p className="mt-1 font-mono text-[11px] leading-[1.6] text-ink-2">{run.error}</p>
            </section>
          )}

          {run.result && run.status !== "WAITING" && (
            <section className="rounded-card border border-line bg-surface p-3.5">
              <h2 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
                Finding
              </h2>
              <Markdown source={run.result} />
            </section>
          )}

          <section className="rounded-card border border-line bg-surface px-3.5 py-3">
            <h2 className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
              What it did
            </h2>
            <Steps steps={run.steps} />
          </section>

          <div ref={bottom} />
        </div>
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <Composer
          onSubmit={spawn}
          pending={pending}
          modelName={modelName}
          runsToday={runsToday}
          placeholder="Ask a follow-up, or @ mention a table"
        />
      </div>
    </div>
  );
}
