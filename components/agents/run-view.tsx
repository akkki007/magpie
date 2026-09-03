"use client";

import { useEffect, useState } from "react";

import { readRun } from "@/app/(app)/agents/actions";
import { Canvas } from "@/components/agents/canvas";
import { Panel } from "@/components/agents/panel";
import type { Artifact } from "@/lib/agents/artifacts";
import type { PendingAction, Step, Todo } from "@/lib/agents/run";

export type RunSnapshot = {
  id: string;
  task: string;
  mode: string;
  status: "RUNNING" | "WAITING" | "DONE" | "FAILED";
  planTitle: string | null;
  planNote: string | null;
  activity: string | null;
  plan: Todo[];
  steps: Step[];
  files: Record<string, unknown>;
  artifacts: Artifact[];
  pending: PendingAction[];
  result: string | null;
  error: string | null;
};

/**
 * A run: the work on the left, the conversation on the right
 * (`docs/agents-plan.md` A5).
 *
 * **Polling, not streaming.** Progress here arrives at the granularity that actually changes
 * — a todo flipping to completed, a subagent returning, a table taking shape — which is
 * seconds apart, not tokens apart. A socket would be more machinery for a worse fit. It
 * polls fast (900ms) while running because the canvas is meant to feel live, and stops the
 * moment the run is terminal so a finished run costs nothing to read.
 */
export function RunView({
  initial,
  modelName,
  runsToday,
}: {
  initial: RunSnapshot;
  modelName: string;
  runsToday: number;
}) {
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
        mode: next.mode,
        status: next.status,
        planTitle: next.planTitle,
        planNote: next.planNote,
        activity: next.activity,
        plan: (next.plan as Todo[] | null) ?? [],
        steps: (next.steps as Step[] | null) ?? [],
        files: (next.files as Record<string, unknown> | null) ?? {},
        artifacts: (next.artifacts as Artifact[] | null) ?? [],
        pending: (next.pending as PendingAction[] | null) ?? [],
        result: next.result,
        error: next.error,
      });
    }, 900);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, run.id]);

  const files = Object.entries(run.files).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="min-w-0 flex-1 overflow-y-auto bg-app">
        <Canvas artifacts={run.artifacts} files={files} activity={run.activity} />
      </div>

      <aside
        aria-label="Agent"
        className="hidden w-[420px] shrink-0 flex-col overflow-hidden border-l border-line bg-subtle lg:flex"
      >
        <Panel run={run} modelName={modelName} runsToday={runsToday} />
      </aside>

      {/* Below lg there is no room for two panes, so the conversation is the page and the
          canvas scrolls above it — the same content, stacked, rather than a hidden column. */}
      <div className="fixed inset-x-0 bottom-0 z-20 max-h-[62vh] overflow-hidden border-t border-line bg-subtle lg:hidden">
        <Panel run={run} modelName={modelName} runsToday={runsToday} />
      </div>
    </div>
  );
}
