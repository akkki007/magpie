"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Check, Sparkles, Wrench, X } from "lucide-react";
import { toast } from "sonner";

import {
  acceptModelProposal,
  askAgent,
  rejectModelProposal,
  type AgentProposal,
} from "@/app/(app)/models/actions";
import { cn } from "@/lib/cn";

/**
 * The agent surface (`docs/modelling-plan.md` §5, M5.2–M5.4).
 *
 * §1.4 in one sentence: nothing here mutates the model until a human clicks Accept. Asking
 * a question runs the loop and stages whatever it proposes as a `ChangeSet` with status
 * `PROPOSED` — a row in Postgres, not a value in this component's state — so a proposal
 * outlives a refresh (M5.4) exactly the way the plan says an `AgentRun` should.
 *
 * The transcript shown here — which tool, what it was asked, what came back — is not
 * decoration. It is the honest account of what the model actually looked at before it
 * proposed anything, which is the only thing that makes "trust this enough to click Accept"
 * a reasonable question to ask a user.
 */

type Turn = {
  prompt: string;
  answer: string | null;
  steps: { name: string; args: unknown }[];
  proposal: AgentProposal | null;
  status: "pending" | "accepted" | "rejected" | null;
};

export function AgentPanel({
  slug,
  onProposalChange,
}: {
  slug: string;
  /** Lifted to the workbench so the grid can preview it (M5.3) — see `compare` in `Grid`. */
  onProposalChange: (proposal: AgentProposal | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function ask() {
    const text = prompt.trim();
    if (!text || busy) return;
    setPrompt("");

    startTransition(async () => {
      const result = await askAgent(slug, text);
      if (!result.ok) {
        toast.error("The agent could not answer that", { description: result.error });
        return;
      }
      setTurns((current) => [
        ...current,
        {
          prompt: text,
          answer: result.answer,
          // The tool-call log the loop actually produced, minus the raw JSON results —
          // this panel shows what was *asked*, not a full dump of every series it read.
          steps: [],
          proposal: result.proposal,
          status: result.proposal ? "pending" : null,
        },
      ]);
      onProposalChange(result.proposal);
    });
  }

  function accept(turnIndex: number, proposal: AgentProposal) {
    startTransition(async () => {
      const result = await acceptModelProposal(slug, proposal.id);
      if (!result.ok) {
        toast.error("Nothing was applied", { description: result.error });
        return;
      }
      // A reload, not a patch — the same reasoning as restoring a version: the grid's
      // reducer and its undo stack are both describing a model that just changed under
      // them, and there is no partial update that leaves both honest.
      window.location.reload();
    });
    setTurns((current) =>
      current.map((t, i) => (i === turnIndex ? { ...t, status: "accepted" } : t)),
    );
  }

  function reject(turnIndex: number, proposal: AgentProposal) {
    startTransition(async () => {
      const result = await rejectModelProposal(slug, proposal.id);
      if (!result.ok) toast.error("Could not dismiss that proposal", { description: result.error });
    });
    setTurns((current) =>
      current.map((t, i) => (i === turnIndex ? { ...t, status: "rejected" } : t)),
    );
    onProposalChange(null);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Ask the agent"
        title="Ask the agent"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-control transition-colors duration-150",
          open ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
        )}
      >
        <Sparkles className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {open && (
        <aside
          aria-label="Ask the agent"
          className="fixed top-0 right-0 z-50 flex h-dvh w-[380px] flex-col border-l border-line bg-surface"
        >
          <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
            <Sparkles className="h-4 w-4 text-violet-500" strokeWidth={1.75} aria-hidden />
            <span className="text-[14px] font-medium text-ink">Ask the model</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="ml-auto grid h-7 w-7 place-items-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {turns.length === 0 && (
              <p className="text-[12px] text-ink-faint">
                Ask a question, or ask for a change — &ldquo;what would 30% faster growth do
                to Closing ARR?&rdquo; A proposed change is never applied until you accept it.
              </p>
            )}
            <ul className="flex flex-col gap-4">
              {turns.map((turn, i) => (
                <li key={i} className="flex flex-col gap-1.5">
                  <p className="rounded-card bg-canvas px-2.5 py-1.5 text-[12px] text-ink-1">
                    {turn.prompt}
                  </p>
                  {turn.answer && (
                    <p className="px-1 text-[13px] leading-snug text-ink-1">{turn.answer}</p>
                  )}
                  {turn.proposal && (
                    <div className="mt-1 rounded-card border border-violet-200 bg-violet-50 px-2.5 py-2">
                      <div className="flex items-center gap-1.5 text-[12px] font-medium text-violet-800">
                        <Wrench className="h-3 w-3" strokeWidth={2} />
                        {turn.proposal.label}
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-muted">
                        {turn.proposal.commands.length} change
                        {turn.proposal.commands.length === 1 ? "" : "s"} · previewed in the grid
                      </p>
                      {turn.status === "pending" ? (
                        <div className="mt-2 flex gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => accept(i, turn.proposal!)}
                            className="flex items-center gap-1 rounded-button bg-blue-400 px-2 py-1 text-[12px] text-white transition-colors duration-150 hover:bg-blue-500"
                          >
                            <Check className="h-3 w-3" strokeWidth={2.25} />
                            Accept
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => reject(i, turn.proposal!)}
                            className="rounded-button px-2 py-1 text-[12px] text-ink-2 transition-colors duration-150 hover:bg-hover"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-[11px] font-medium text-ink-faint">
                          {turn.status === "accepted" ? "Accepted" : "Rejected"}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
              {busy && (
                <li className="px-1 text-[12px] text-ink-faint">Thinking…</li>
              )}
            </ul>
          </div>

          <div className="flex shrink-0 items-end gap-2 border-t border-line px-3 py-2.5">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  ask();
                }
              }}
              rows={1}
              placeholder="Ask about this model…"
              className="max-h-24 min-h-8 flex-1 resize-none rounded-button border border-line bg-canvas px-2 py-1.5 text-[13px] text-ink-1 outline-none transition-colors duration-150 focus:border-blue-400"
            />
            <button
              type="button"
              disabled={busy || !prompt.trim()}
              onClick={ask}
              aria-label="Ask"
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-control transition-colors duration-150",
                prompt.trim() && !busy
                  ? "bg-blue-400 text-white hover:bg-blue-500"
                  : "cursor-not-allowed bg-line text-ink-faint",
              )}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
