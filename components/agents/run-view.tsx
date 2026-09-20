"use client";

import { useEffect, useState } from "react";

import { readRun } from "@/app/(app)/agents/actions";
import { CopilotCanvas } from "@/components/agents/copilot-canvas";
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
 * **Streaming, over `/agents/[id]/stream`.** `lib/agents/bus.ts` hands the run's own process a
 * snapshot the instant a tool returns — a chart drawn, a table proposed, a todo ticked off —
 * and this reads it over Server-Sent Events instead of asking on a timer. `EventSource`
 * reconnects on its own if the connection drops (a Vercel Function's execution limit, a proxy
 * hiccup), and each reconnect gets the current row again as its first event, so nothing is
 * lost by dropping and picking back up.
 *
 * **A slow poll still runs underneath it**, deliberately not removed. This is a live
 * financial workspace: a stream that silently stopped delivering (blocked by some proxy in a
 * way that never fires `onerror`) is a worse failure than a redundant request every few
 * seconds, so `readRun` keeps confirming the truth independently of whatever the stream says.
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

    const source = new EventSource(`/agents/${run.id}/stream`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as Partial<RunSnapshot> & { id: string; status: RunSnapshot["status"] };
      setRun((prev) => (prev.id === event.id ? { ...prev, ...event } : prev));
    };

    return () => source.close();
  }, [live, run.id]);

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
    }, 5000);

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
        <CopilotCanvas runId={run.id} live={live} artifacts={run.artifacts} files={files} activity={run.activity} />
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
