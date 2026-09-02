"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  ArrowUp,
  Check,
  ChevronDown,
  History,
  Loader2,
  MessageSquarePlus,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  acceptModelProposal,
  deleteAgentChat,
  listAgentChats,
  readAgentChat,
  readProposalStatuses,
  rejectModelProposal,
  type AgentChatSummary,
} from "@/app/(app)/models/actions";
import { cn } from "@/lib/cn";
import type { Command } from "@/lib/model/commands";

/**
 * The agent surface, on `useChat` (`docs/modelling-plan.md` §5, M5.2–M5.4) — with a
 * ChatGPT-style history sub-section over many saved conversations.
 *
 * **Many chats, not one.** Each `AgentChat` row is scoped to `(modelId, actorId)` — someone's
 * own line of questioning, listed for them the way ChatGPT lists a conversation history per
 * account. `AgentPanel` owns which chat is active and the sidebar list; `AgentThread` owns
 * one `useChat` instance for exactly one chat id, remounted (via `key`) whenever the active
 * id changes, so switching threads is never a matter of mutating one hook's state into
 * looking like a different conversation.
 *
 * **What did not move to the SDK's own approval mechanism, and why.** The AI SDK has a
 * native `toolApproval: 'user-approval'` feature that gates a tool's `execute` on a
 * client-confirmed approval carried in the message history. This panel does not use it.
 * The `proposeChanges` tool already stages a durable `ChangeSet` with status `PROPOSED` in
 * Postgres — accept and reject are the existing, already-tested `acceptModelProposal` /
 * `rejectModelProposal` actions operating on that row, independent of chat transport. Two
 * competing definitions of "the user said yes" is a way to end up with one that is stale.
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
  const [showHistory, setShowHistory] = useState(false);
  const [chats, setChats] = useState<AgentChatSummary[] | null>(null);
  const [chatsLoading, setChatsLoading] = useState(false);

  const [currentChatId, setCurrentChatId] = useState(() => crypto.randomUUID());
  const [currentMessages, setCurrentMessages] = useState<UIMessage[]>([]);
  const [switching, setSwitching] = useState(false);

  const resumedRef = useRef(false);

  const refreshChats = useCallback(async () => {
    setChatsLoading(true);
    const result = await listAgentChats(slug);
    setChatsLoading(false);
    if (result.ok) setChats(result.chats);
  }, [slug]);

  // Loaded once, on first open — the same lazy-load pattern History and Comments use. The
  // first time, resume the most recent conversation rather than starting blank: opening the
  // panel to an empty composer when yesterday's thread is one click away is not what a
  // returning user expects from "chat history".
  const show = useCallback(async () => {
    setOpen(true);
    if (chats !== null) return;
    setChatsLoading(true);
    const result = await listAgentChats(slug);
    setChatsLoading(false);
    if (!result.ok) return;
    setChats(result.chats);

    if (!resumedRef.current && result.chats.length > 0) {
      resumedRef.current = true;
      const [mostRecent] = result.chats;
      const loaded = await readAgentChat(slug, mostRecent.id);
      if (loaded.ok) {
        setCurrentChatId(mostRecent.id);
        setCurrentMessages(loaded.messages as UIMessage[]);
      }
    }
  }, [chats, slug]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function startNewChat() {
    setCurrentChatId(crypto.randomUUID());
    setCurrentMessages([]);
  }

  async function openChat(chat: AgentChatSummary) {
    if (chat.id === currentChatId) {
      setShowHistory(false);
      return;
    }
    setSwitching(true);
    const result = await readAgentChat(slug, chat.id);
    setSwitching(false);
    if (!result.ok) {
      toast.error("That chat could not be opened");
      return;
    }
    setCurrentChatId(chat.id);
    setCurrentMessages(result.messages as UIMessage[]);
    setShowHistory(false);
  }

  function removeChat(chat: AgentChatSummary) {
    setChats((current) => current?.filter((c) => c.id !== chat.id) ?? current);
    if (chat.id === currentChatId) startNewChat();
    deleteAgentChat(slug, chat.id).then((result) => {
      if (!result.ok) {
        toast.error("That chat could not be deleted", { description: result.error });
        void refreshChats();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Ask the agent"
        title="Ask the agent"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
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
          <header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-line px-3">
            <Sparkles className="h-4 w-4 shrink-0 text-violet-500" strokeWidth={1.75} aria-hidden />
            <span className="truncate text-[14px] font-medium text-ink">Ask the model</span>

            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-expanded={showHistory}
              title="History"
              className={cn(
                "ml-auto flex shrink-0 items-center gap-1 rounded-button px-1.5 py-1 text-[11px] transition-colors duration-150",
                showHistory ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
              )}
            >
              <History className="h-3.5 w-3.5" strokeWidth={1.75} />
              History
              <ChevronDown
                className={cn("h-3 w-3 transition-transform duration-150", showHistory && "rotate-180")}
                strokeWidth={2}
              />
            </button>
            <button
              type="button"
              onClick={startNewChat}
              aria-label="New chat"
              title="New chat"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              <MessageSquarePlus className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </header>

          {/* The history sub-section — collapsed by default so the conversation keeps the
              panel's width; a chip on the toggle would be one more thing to keep in sync,
              so the count only shows once you open it. */}
          {showHistory && (
            <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-line">
              {chatsLoading && chats === null ? (
                <p className="flex items-center gap-1.5 px-4 py-3 text-[12px] text-ink-faint">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                  Loading…
                </p>
              ) : chats && chats.length === 0 ? (
                <p className="px-4 py-3 text-[12px] text-ink-faint">
                  Nothing yet — ask something to start your first conversation.
                </p>
              ) : (
                <ul>
                  {chats?.map((chat) => (
                    <li key={chat.id}>
                      <button
                        type="button"
                        onClick={() => openChat(chat)}
                        className={cn(
                          "group flex w-full items-center gap-2 px-4 py-2 text-left transition-colors duration-150 hover:bg-hover",
                          chat.id === currentChatId && "bg-hover",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-1">
                          {chat.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-faint">{ago(chat.updatedAt)}</span>
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeChat(chat);
                          }}
                          aria-label={`Delete "${chat.title}"`}
                          className="grid h-5 w-5 shrink-0 place-items-center rounded-control text-ink-faint opacity-0 transition-all duration-150 group-hover:opacity-100 hover:bg-canvas hover:text-neg-fg"
                        >
                          <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {switching ? (
            <div className="flex flex-1 items-center justify-center text-[12px] text-ink-faint">
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              Loading conversation…
            </div>
          ) : (
            <AgentThread
              key={currentChatId}
              slug={slug}
              chatId={currentChatId}
              initialMessages={currentMessages}
              onProposalChange={onProposalChange}
              onTurnFinished={refreshChats}
            />
          )}
        </aside>
      )}
    </>
  );
}

/**
 * One conversation. Mounted fresh per `chatId` (the parent keys it), so `useChat`'s own
 * state — messages, status, error — never has to be reconciled from one conversation into
 * looking like another; switching chats is an unmount and a remount, not a mutation.
 */
function AgentThread({
  slug,
  chatId,
  initialMessages,
  onProposalChange,
  onTurnFinished,
}: {
  slug: string;
  chatId: string;
  initialMessages: UIMessage[];
  onProposalChange: (proposal: PendingProposal | null) => void;
  onTurnFinished: () => void;
}) {
  const [input, setInput] = useState("");
  const [resolved, setResolved] = useState<Record<string, "accepted" | "rejected">>({});
  const [busyProposal, setBusyProposal] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    id: chatId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: `/models/${slug}/agent`,
      // Only the last message goes over the wire; the route handler loads the rest from
      // the `AgentChat` row named by `id`. Sending the whole array on every turn would
      // grow with the conversation for no reason — the server already has a copy.
      prepareSendMessagesRequest: ({ id, messages }) => ({
        body: { id, message: messages[messages.length - 1] },
      }),
    }),
  });

  const busy = status === "submitted" || status === "streaming";

  // Refresh the sidebar once a turn completes — a brand-new chat just got its row and its
  // title, or an existing one just moved to the top of "most recent".
  const lastStatus = useRef(status);
  useEffect(() => {
    if ((lastStatus.current === "submitted" || lastStatus.current === "streaming") && !busy) {
      onTurnFinished();
    }
    lastStatus.current = status;
  }, [status, busy, onTurnFinished]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

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

  /**
   * Reconcile with what actually happened, server-side.
   *
   * A `tool-proposeChanges` message part never changes once the tool has run — it always
   * says what was proposed, not what became of it — so a card driven only by local state
   * looks pending forever the moment this component remounts: switching threads, closing
   * and reopening the panel, or a page reload all lose the `resolved` map entirely. This is
   * what actually answers "is it still pending", by asking Postgres rather than assuming a
   * clean local slate means nothing has happened yet.
   */
  const proposalIds = useMemo(
    () =>
      [...new Set(proposalOutputs.map(({ output }) => (output.ok ? output.proposalId : null)).filter((id): id is string => id !== null))].sort(),
    [proposalOutputs],
  );
  const proposalIdsKey = proposalIds.join(",");

  useEffect(() => {
    if (proposalIds.length === 0) return;
    let cancelled = false;
    readProposalStatuses(slug, proposalIds).then((result) => {
      if (cancelled || !result.ok) return;
      setResolved((current) => {
        const next = { ...current };
        for (const [id, status] of Object.entries(result.statuses)) {
          if (status === "ACCEPTED") next[id] = "accepted";
          else if (status === "REJECTED") next[id] = "rejected";
          // PROPOSED: leave whatever is already there — a status check must never
          // un-resolve a card an in-flight `decide()` just optimistically resolved.
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- proposalIdsKey is the stable form of proposalIds
  }, [proposalIdsKey, slug]);

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

  return (
    <>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="text-[12px] text-ink-faint">
            Ask a question, or ask for a change — &ldquo;what would 30% faster growth do to
            Closing ARR?&rdquo; A proposed change is never applied until you accept it.
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

function ago(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
