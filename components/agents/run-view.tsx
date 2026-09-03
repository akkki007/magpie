"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileText } from "lucide-react";

import { readRun } from "@/app/(app)/agents/actions";
import { Approval } from "@/components/agents/approval";
import { PlanCard } from "@/components/agents/plan-card";
import { Steps } from "@/components/agents/steps";
import type { PendingAction, Step, Todo } from "@/lib/agents/run";

export type RunSnapshot = {
  id: string;
  task: string;
  status: "RUNNING" | "WAITING" | "DONE" | "FAILED";
  plan: Todo[];
  steps: Step[];
  files: Record<string, unknown>;
  pending: PendingAction[];
  result: string | null;
  error: string | null;
};

/**
 * A run, live (`docs/agents-plan.md` A5).
 *
 * **Polling, not streaming.** The plan's §5 says so and it is worth the sentence: the value
 * here is the finished artefact, not watching a model type. Progress arrives at the
 * granularity that actually changes — a todo flipping to completed, a subagent returning —
 * which is seconds apart, not tokens apart. A socket would be more machinery for a worse fit.
 *
 * Polling stops the moment the run reaches a terminal state, and a WAITING run keeps polling
 * because approving it here starts it moving again.
 */
export function RunView({ initial }: { initial: RunSnapshot }) {
  const [run, setRun] = useState(initial);
  const live = run.status === "RUNNING" || run.status === "WAITING";

  useEffect(() => {
    if (!live) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      const next = await readRun(run.id);
      if (cancelled || !next) return;
      setRun({
        id: next.id,
        task: next.task,
        status: next.status,
        plan: (next.plan as Todo[] | null) ?? [],
        steps: (next.steps as Step[] | null) ?? [],
        files: (next.files as Record<string, unknown> | null) ?? {},
        pending: (next.pending as PendingAction[] | null) ?? [],
        result: next.result,
        error: next.error,
      });
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, run.id]);

  const files = Object.entries(run.files).filter(([, body]) => typeof body === "string");

  return (
    <div className="flex flex-col gap-4">
      <PlanCard
        task={run.task}
        todos={run.plan}
        steps={run.steps}
        running={run.status === "RUNNING"}
      />

      {run.status === "WAITING" && run.pending.length > 0 && (
        <Approval runId={run.id} pending={run.pending} />
      )}

      {run.status === "FAILED" && (
        <section className="rounded-card border border-line bg-neg-bg/40 p-4">
          <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <AlertTriangle className="h-4 w-4 text-neg-fg" strokeWidth={1.75} aria-hidden />
            This run failed
          </p>
          <p className="mt-1.5 font-mono text-[12px] leading-[1.6] text-ink-2">{run.error}</p>
        </section>
      )}

      {run.status === "DONE" && run.result && (
        <section className="rounded-card border border-line bg-surface p-4">
          <h2 className="text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
            Finding
          </h2>
          <div className="mt-2 text-[14px] leading-[1.75] whitespace-pre-wrap text-ink-2">
            {run.result}
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-card border border-line bg-surface p-4">
          <h2 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
            What it did
          </h2>
          <Steps steps={run.steps} />
        </section>

        <section className="rounded-card border border-line bg-surface p-4">
          <h2 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
            Working files
          </h2>
          {files.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No files written.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {files.map(([name, body]) => (
                <li key={name}>
                  <details className="rounded-control border border-line">
                    <summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-ink-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
                      <span className="font-mono">{name}</span>
                    </summary>
                    <pre className="max-h-72 overflow-auto border-t border-line px-2.5 py-2 text-[11px] leading-[1.7] whitespace-pre-wrap text-ink-2">
                      {String(body)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
