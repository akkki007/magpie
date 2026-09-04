"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Check, MessageSquare, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { addModelComment, readModelComments, resolveModelComment } from "@/app/(app)/models/actions";
import { cn } from "@/lib/cn";
import type { Comment } from "@/lib/model/comments";
import type { Model } from "@/lib/model/types";

/**
 * Comments, anchored to a variable and a period (`docs/modelling-plan.md` §6, M6.1).
 *
 * Not part of the command bus (see `lib/model/comments.ts`): a comment does not change what
 * the model computes, so there is nothing here to undo and nothing for the ghost overlay to
 * preview. It is a conversation about a number, not an edit to one.
 */
export function CommentsPanel({ slug, model }: { slug: string; model: Model }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [variableId, setVariableId] = useState(model.variables[0]?.id ?? "");
  const [period, setPeriod] = useState(model.periods.length - 1);
  const [body, setBody] = useState("");
  const [busy, startTransition] = useTransition();

  const load = useCallback(async () => {
    const result = await readModelComments(slug);
    if (!result.ok) return setError(result.error);
    setError(null);
    setComments(result.comments);
  }, [slug]);

  const show = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function add() {
    const text = body.trim();
    if (!text || !variableId) return;
    startTransition(async () => {
      const result = await addModelComment(slug, variableId, period, text);
      if (!result.ok) {
        toast.error("That comment was not saved", { description: result.error });
        return;
      }
      setBody("");
      await load();
    });
  }

  function resolve(comment: Comment, resolved: boolean) {
    startTransition(async () => {
      const result = await resolveModelComment(slug, comment.id, resolved);
      if (!result.ok) {
        toast.error("That did not save", { description: result.error });
        return;
      }
      await load();
    });
  }

  const visible = (comments ?? []).filter((c) => showResolved || !c.resolvedAt);

  return (
    <>
      <button
        type="button"
        aria-label="Comments"
        title="Comments"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-control transition-colors duration-150",
          open ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
        )}
      >
        <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {open && (
        /* Full-bleed on a phone, a side panel from `sm` up: a fixed 3xx px panel is not a
            narrow panel on a 360px screen — it is the whole screen with a sliver of canvas
            showing, or an overflow. Below `sm` it takes the width it will actually take and
            states it as `inset-x-0`, so there is no number here to disagree with the
            viewport. */
        <aside
          aria-label="Comments"
          className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col border-line bg-surface sm:right-0 sm:left-auto sm:w-[360px] sm:border-l"
        >
          <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
            <span className="text-[14px] font-medium text-ink">Comments</span>
            <button
              type="button"
              onClick={() => setShowResolved((v) => !v)}
              className="ml-auto rounded-button px-2 py-1 text-[11px] text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              {showResolved ? "Hide resolved" : "Show resolved"}
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="grid h-7 w-7 place-items-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </header>

          <div className="flex shrink-0 flex-col gap-1.5 border-b border-line px-4 py-2.5">
            <div className="flex gap-1.5">
              <select
                value={variableId}
                onChange={(event) => setVariableId(event.target.value)}
                className="min-w-0 flex-1 rounded-button border border-line bg-canvas px-1.5 py-1 text-[12px] text-ink-1 outline-none"
              >
                {model.variables.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              <select
                value={period}
                onChange={(event) => setPeriod(Number(event.target.value))}
                className="w-24 shrink-0 rounded-button border border-line bg-canvas px-1.5 py-1 text-[12px] text-ink-1 outline-none"
              >
                {model.periods.map((p, i) => (
                  <option key={p.key} value={i}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-1.5">
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    add();
                  }
                }}
                rows={1}
                placeholder="Leave a note on this cell…"
                className="max-h-20 min-h-8 flex-1 resize-none rounded-button border border-line bg-canvas px-2 py-1.5 text-[12px] text-ink-1 outline-none transition-colors duration-150 focus:border-blue-400"
              />
              <button
                type="button"
                disabled={busy || !body.trim()}
                onClick={add}
                className={cn(
                  "shrink-0 rounded-button px-2.5 py-1.5 text-[12px] transition-colors duration-150",
                  body.trim() && !busy
                    ? "bg-blue-400 text-white hover:bg-blue-500"
                    : "cursor-not-allowed bg-line text-ink-faint",
                )}
              >
                Comment
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {error && <p className="px-4 py-3 text-[12px] text-neg-fg">{error}</p>}
            {comments && visible.length === 0 && (
              <p className="px-4 py-3 text-[12px] text-ink-faint">Nothing here yet.</p>
            )}
            <ul>
              {visible.map((comment) => (
                <li key={comment.id} className="border-b border-line px-4 py-2.5">
                  <div className="flex items-baseline gap-1.5 text-[11px] text-ink-faint">
                    <span className="font-medium text-ink-2">{comment.variableName}</span>
                    <span>·</span>
                    <span>{comment.periodLabel}</span>
                    <span className="ml-auto">{comment.authorName}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-snug text-ink-1">{comment.body}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => resolve(comment, !comment.resolvedAt)}
                    className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-muted transition-colors duration-150 hover:text-ink"
                  >
                    {comment.resolvedAt ? (
                      <>
                        <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
                        Reopen
                      </>
                    ) : (
                      <>
                        <Check className="h-3 w-3" strokeWidth={1.75} />
                        Resolve
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </>
  );
}
