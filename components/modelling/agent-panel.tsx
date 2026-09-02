"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, Check, Loader2, Sparkles, Square, TriangleAlert, Wrench, X } from "lucide-react";
import { toast } from "sonner";

import { acceptModelProposal, readAgentChat, rejectModelProposal } from "@/app/(app)/models/actions";
import { cn } from "@/lib/cn";
import type { Command } from "@/lib/model/commands";

/**
 * The agent surface, on `useChat` (`docs/modelling-plan.md` §5, M5.2–M5.4).
 *
 * Rebuilt on the AI SDK so the chat itself is properly robust: real token-by-token and
 * tool-call streaming, a stop button, a distinguishable error state with retry, and a
 * transcript that survives a refresh — all things a hand-rolled "await the whole answer,
 * then render it" panel does not get for free. The route handler at
 * `[slug]/agent/route.ts` is the only thing that changed underneath; the safety contract
 * did not.
 *
 * **What did not move to the SDK's own approval mechanism, and why.** The AI SDK has a
 * native `toolApproval: 'user-approval'` feature that gates a tool's `execute` on a
 * client-confirmed approval carried in the message history. This panel does not use it.
 * The `proposeChanges` tool already stages a durable `ChangeSet` with status `PROPOSED` in
 * Postgres (`groundProposal` writes nothing; the tool's `execute` does) — accept and reject
 * are the existing, already-tested `acceptModelProposal` / `rejectModelProposal` actions
 * operating on that row, independent of chat transport. Two competing definitions of "the
 * user said yes" is a way to end up with one that is stale; there is exactly one here.
 */

type ProposeChangesOutput =
  | { ok: true; proposalId: string; label: string; commandCount: number }
  | { ok: false; error: string };

/** What the grid needs to preview a pending proposal — see `compare` in `workbench.tsx`. */
export type PendingProposal = { id: string; label: string; commands: Command[] };

export function AgentPanel({
  slug,
  onProposalChange,
}: {
  slug: string;
  onProposalChange: (proposal: PendingProposal | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  /** proposalId → what happened. Chat state (via `useChat`) does not know about this — it
   *  is a fact about our own ChangeSet, not about the conversation. */
  const [resolved, setResolved] = useState<Record<string, "accepted" | "rejected">>({});
  const [busyProposal, setBusyProposal] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, setMessages, sendMessage, status, stop, error, regenerate } = useChat({
    id: slug,
    transport: new DefaultChatTransport({ api: `/models/${slug}/agent` }),
  });

  // Loaded once, on first open — the same lazy-load pattern History and Comments use.
  // useChat has no built-in "fetch my history" hook; the persistence is ours (M5.4), so
  // hydrating it is one read against the row `onFinish` in the route handler writes.
  const hydrate = useCallback(async () => {
    setOpen(true);
    if (hydrated) return;
    setHydrated(true);
    const result = await readAgentChat(slug);
    if (result.ok && result.messages.length > 0) {
      setMessages(result.messages as UIMessage[]);
    }
  }, [hydrated, setMessages, slug]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // The most recent proposal still awaiting a decision, read straight out of the message
  // parts rather than tracked separately — `messages` already carries the one true record
  // of what was proposed and with what commands.
  const proposalOutputs = useMemo(
    () =>
      messages
        .flatMap((message) => message.parts)
        .filter((part) => part.type === "tool-proposeChanges" && part.state === "output-available")
        .map((part) => {
          const typed = part as unknown as {
            output: ProposeChangesOutput;
            input?: { label: string; commands: Command[] };
          };
          return { output: typed.output, input: typed.input };
        }),
    [messages],
  );

  const pending = useMemo(() => {
    const next = proposalOutputs.findLast(({ output }) => output.ok && !resolved[output.proposalId]);
    if (!next?.input || !next.output.ok) return null;
    return { id: next.output.proposalId, label: next.output.label, commands: next.input.commands };
  }, [proposalOutputs, resolved]);

  useEffect(() => onProposalChange(pending), [pending, onProposalChange]);

  function ask() {
    const text = input.trim();
    if (!text || status !== "ready") return;
    sendMessage({ text });
    setInput("");
  }

  function decide(proposalId: string, decision: "accepted" | "rejected") {
    setBusyProposal(proposalId);
    (decision === "accepted" ? acceptModelProposal : rejectModelProposal)(slug, proposalId).then(
      (result) => {
        setBusyProposal(null);
        if (!result.ok) {
          toast.error(decision === "accepted" ? "Nothing was applied" : "Could not dismiss that proposal", {
            description: result.error,
          });
          return;
        }
        if (decision === "accepted") {
          // A reload, not a patch — the grid's reducer and its undo stack are both
          // describing a model that just changed under them.
          window.location.reload();
          return;
        }
        setResolved((current) => ({ ...current, [proposalId]: decision }));
      },
    );
  }

  const busy = status === "submitted" || status === "streaming";

  return (
    <>
      <button
        type="button"
        aria-label="Ask the agent"
        title="Ask the agent"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : hydrate())}
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
            {messages.length === 0 && (
              <p className="text-[12px] text-ink-faint">
                Ask a question, or ask for a change — &ldquo;what would 30% faster growth do
                to Closing ARR?&rdquo; A proposed change is never applied until you accept it.
              </p>
            )}

            <ul className="flex flex-col gap-3">
              {messages.map((message) => (
                <li key={message.id} className="flex flex-col gap-1.5">
                  {message.role === "user" ? (
                    <p className="rounded-card bg-canvas px-2.5 py-1.5 text-[12px] text-ink-1">
                      {message.parts.map((part) => (part.type === "text" ? part.text : "")).join("")}
                    </p>
                  ) : (
                    message.parts.map((part, i) => (
                      <MessagePart
                        key={i}
                        part={part}
                        resolved={resolved}
                        busyProposal={busyProposal}
                        onDecide={decide}
                      />
                    ))
                  )}
                </li>
              ))}

              {busy && (
                <li className="flex items-center gap-1.5 px-1 text-[12px] text-ink-faint">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                  {status === "submitted" ? "Thinking…" : "Working…"}
                </li>
              )}

              {error && (
                <li className="flex flex-col gap-1.5 rounded-card border border-neg-fg/30 bg-neg-bg px-2.5 py-2">
                  <p className="flex items-start gap-1.5 text-[12px] text-neg-fg">
                    <TriangleAlert className="mt-px h-3 w-3 shrink-0" strokeWidth={1.75} />
                    Something went wrong.
                  </p>
                  <button
                    type="button"
                    onClick={() => regenerate()}
                    className="self-start rounded-button bg-surface px-2 py-1 text-[11px] text-ink-2 transition-colors duration-150 hover:bg-hover"
                  >
                    Retry
                  </button>
                </li>
              )}
            </ul>
          </div>

          <div className="flex shrink-0 items-end gap-2 border-t border-line px-3 py-2.5">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
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
            {busy ? (
              <button
                type="button"
                onClick={() => stop()}
                aria-label="Stop"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-line text-ink-2 transition-colors duration-150 hover:bg-hover"
              >
                <Square className="h-3.5 w-3.5" strokeWidth={2} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!input.trim()}
                onClick={ask}
                aria-label="Ask"
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-control transition-colors duration-150",
                  input.trim()
                    ? "bg-blue-400 text-white hover:bg-blue-500"
                    : "cursor-not-allowed bg-line text-ink-faint",
                )}
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2} />
              </button>
            )}
          </div>
        </aside>
      )}
    </>
  );
}

/**
 * One part of an assistant message. Typed tool parts (`tool-getModelOutline`, …) each carry
 * their own input/output shape — see the AI SDK's `ai/docs/04-ai-sdk-ui/03-chatbot-tool-usage`
 * for the state machine (`input-streaming` → `input-available` → `output-available` /
 * `output-error`) this switches over.
 */
function MessagePart({
  part,
  resolved,
  busyProposal,
  onDecide,
}: {
  part: ReturnType<typeof useChat>["messages"][number]["parts"][number];
  resolved: Record<string, "accepted" | "rejected">;
  busyProposal: string | null;
  onDecide: (proposalId: string, decision: "accepted" | "rejected") => void;
}) {
  switch (part.type) {
    case "text":
      return part.text ? <p className="px-1 text-[13px] leading-snug text-ink-1">{part.text}</p> : null;

    case "tool-getModelOutline":
    case "tool-getVariable":
    case "tool-getSeries":
    case "tool-runScenario":
      // Read tools: a quiet one-line trace of what was looked up, not a data dump. The
      // point of showing this at all is the transparency §5 asks for — what the model
      // actually looked at before it proposed anything — not a debugger.
      return (
        <p className="flex items-center gap-1.5 px-1 text-[11px] text-ink-faint">
          <Wrench className="h-2.5 w-2.5 shrink-0" strokeWidth={1.75} />
          {toolLabel(part.type)}
          {part.state === "output-error" && (
            <span className="text-neg-fg">— {part.errorText}</span>
          )}
        </p>
      );

    case "tool-proposeChanges": {
      if (part.state !== "output-available") {
        return (
          <p className="flex items-center gap-1.5 px-1 text-[11px] text-ink-faint">
            <Wrench className="h-2.5 w-2.5 shrink-0" strokeWidth={1.75} />
            Drafting a proposal…
          </p>
        );
      }

      const output = part.output as ProposeChangesOutput;
      if (!output.ok) {
        return (
          <p className="flex items-start gap-1.5 rounded-card bg-neg-bg px-2.5 py-1.5 text-[11px] text-neg-fg">
            <TriangleAlert className="mt-px h-3 w-3 shrink-0" strokeWidth={1.75} />
            {output.error}
          </p>
        );
      }

      const decision = resolved[output.proposalId];
      return (
        <div className="rounded-card border border-violet-200 bg-violet-50 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-violet-800">
            <Wrench className="h-3 w-3" strokeWidth={2} />
            {output.label}
          </div>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            {output.commandCount} change{output.commandCount === 1 ? "" : "s"} · previewed in the grid
          </p>
          {!decision ? (
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                disabled={busyProposal === output.proposalId}
                onClick={() => onDecide(output.proposalId, "accepted")}
                className="flex items-center gap-1 rounded-button bg-blue-400 px-2 py-1 text-[12px] text-white transition-colors duration-150 hover:bg-blue-500"
              >
                <Check className="h-3 w-3" strokeWidth={2.25} />
                Accept
              </button>
              <button
                type="button"
                disabled={busyProposal === output.proposalId}
                onClick={() => onDecide(output.proposalId, "rejected")}
                className="rounded-button px-2 py-1 text-[12px] text-ink-2 transition-colors duration-150 hover:bg-hover"
              >
                Reject
              </button>
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] font-medium text-ink-faint">
              {decision === "accepted" ? "Accepted" : "Rejected"}
            </p>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

function toolLabel(type: string) {
  switch (type) {
    case "tool-getModelOutline":
      return "Read the model's outline";
    case "tool-getVariable":
      return "Looked up a variable";
    case "tool-getSeries":
      return "Read a series";
    case "tool-runScenario":
      return "Tried a change in a sandbox";
    default:
      return type;
  }
}
