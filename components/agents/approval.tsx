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
 * **What is being asked for is drawn on the canvas, not dumped here.** An approval screen
 * that says "the agent wants to make a change" is a rubber stamp — so the thing itself is
 * rendered beside this: the table as a grid with its real columns, a proposal as the
 * sentences it amounts to, each with the raw arguments one disclosure away. This side names
 * the tool and the decision. Showing the same JSON twice made the pane that mattered look
 * like the redundant one.
 */
/** What each write tool is asking to do, in the words a person would use. */
const ASKED: Record<string, string> = {
  createTable: "Create a table",
  proposeModelChanges: "Stage changes to the plan",
  addBoardTile: "Add a tile to a board",
};

/** The one argument that identifies *which* thing — the rest is on the card. */
function subject(action: PendingAction): string {
  const args = action.args as { name?: unknown; label?: unknown; boardSlug?: unknown };
  const named = args.name ?? args.label ?? args.boardSlug;
  return typeof named === "string" ? named : "";
}

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

      <ul className="mt-3 flex flex-col gap-1.5">
        {pending.map((action, index) => (
          <li
            key={`${action.name}-${index}`}
            className="flex items-baseline gap-2 rounded-control border border-line bg-surface px-3 py-2"
          >
            <span className="text-[12px] text-ink">{ASKED[action.name] ?? action.name}</span>
            <span className="truncate font-mono text-[11px] text-ink-faint">{subject(action)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11px] text-ink-muted">
        {pending.length === 1 ? "It is drawn on the left" : "They are drawn on the left"} — check it
        there before you decide.
      </p>

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
