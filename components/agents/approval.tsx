"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

import { decideRun } from "@/app/(app)/agents/actions";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { PendingAction } from "@/lib/agents/run";

/**
 * The approval gate (`docs/agents-plan.md` A6).
 *
 * This is the module's whole reason for using LangGraph rather than the AI SDK loop next
 * door. The run is **halted inside the graph** — `interruptOn` stopped it before the write
 * tool executed, and it cannot proceed until a person resumes it. Nothing here is a
 * convention the agent is trusting: there is no code path from this state to a write that
 * does not go through one of these two buttons.
 *
 * So the card shows the arguments verbatim. An approval screen that says "the agent wants to
 * make a change" is a rubber stamp; the point is to show exactly what will happen, which for
 * a proposal means the label and the commands, and for a tile means the spec.
 */
export function Approval({ runId, pending }: { runId: string; pending: PendingAction[] }) {
  const [pendingTransition, start] = useTransition();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const decide = (decision: "approve" | "reject") =>
    start(async () => {
      const result = await decideRun(runId, decision, note);
      if (result.ok) {
        toast.success(decision === "approve" ? "Approved — the run is continuing" : "Rejected");
        setNote("");
        setShowNote(false);
      } else {
        toast.error("Could not do that", { description: result.error });
      }
    });

  return (
    <section className="rounded-card border border-blue-200 bg-blue-50/60 p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <AlertTriangle className="h-4 w-4 text-blue-600" strokeWidth={1.75} aria-hidden />
        Waiting for your approval
      </p>
      <p className="mt-1 text-[12px] leading-[1.6] text-ink-muted">
        The run is paused inside the agent. Nothing has been written — it cannot continue
        until you decide.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {pending.map((action, index) => (
          <li key={`${action.name}-${index}`} className="rounded-control border border-line bg-surface p-3">
            <p className="font-mono text-[12px] font-medium text-ink">{action.name}</p>
            {action.description && (
              <p className="mt-1 text-[12px] leading-[1.6] text-ink-muted">{action.description}</p>
            )}
            <pre className="mt-2 max-h-56 overflow-auto rounded-button bg-subtle px-2.5 py-2 font-mono text-[11px] leading-[1.6] text-ink-2">
              {JSON.stringify(action.args, null, 2)}
            </pre>
          </li>
        ))}
      </ul>

      {showNote && (
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="Why? The agent is told, so it can try something else."
          aria-label="Reason for rejecting"
          className="mt-3 w-full resize-none rounded-control border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-blue-600"
        />
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={pendingTransition}
          onClick={() => decide("approve")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-button px-3 py-1.5 text-[13px] font-medium text-white transition-colors",
            pendingTransition ? "cursor-not-allowed bg-line" : "bg-blue-600 hover:bg-blue-700",
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
          Approve
        </button>

        <button
          type="button"
          disabled={pendingTransition}
          onClick={() => (showNote ? decide("reject") : setShowNote(true))}
          className="inline-flex items-center gap-1.5 rounded-button border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
          {showNote ? "Send rejection" : "Reject"}
        </button>

        {pendingTransition && <span className="text-[12px] text-ink-muted">Resuming…</span>}
      </div>
    </section>
  );
}
