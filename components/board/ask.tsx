"use client";

import { useState, useTransition } from "react";
import { ArrowUp } from "lucide-react";

import { askBoard } from "@/app/(app)/boards/actions";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

/**
 * "Ask questions, get instant insight" (`docs/board-plan.md` feature 1).
 *
 * One input, and the answer lands on the board as a tile rather than in a transcript. That
 * is the whole distinction from a chat window: a question worth asking twice becomes part of
 * the report, and the tile keeps the question so anyone reading it later knows what was
 * actually asked.
 */
export function AskBoard({
  boardSlug,
  modelSlug,
  suggestions,
}: {
  boardSlug: string;
  modelSlug: string;
  suggestions: string[];
}) {
  const [question, setQuestion] = useState("");
  const [pending, start] = useTransition();

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    start(async () => {
      const result = await askBoard(boardSlug, modelSlug, trimmed);
      if (result.ok) {
        setQuestion("");
        toast.success("Added a tile");
      } else {
        toast.error("Could not answer that", { description: result.error });
      }
    });
  };

  return (
    <div data-tour="ask" className="flex flex-col gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(question);
        }}
        className="flex items-end gap-2 rounded-card border border-violet-300 bg-surface p-2.5 focus-within:border-violet-500"
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(question);
            }
          }}
          rows={2}
          disabled={pending}
          placeholder="Ask for a chart — “pipeline value by stage for each month”"
          aria-label="Ask this board a question"
          className="min-w-0 flex-1 resize-none bg-transparent text-[14px] leading-[1.6] text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="submit"
          disabled={!question.trim() || pending}
          aria-label="Ask"
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
            question.trim() && !pending
              ? "bg-ink text-white hover:bg-ink-2"
              : "cursor-not-allowed bg-line text-ink-faint",
          )}
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2} />
        </button>
      </form>

      {question === "" && !pending && (
        <ul className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => submit(suggestion)}
                className="rounded-chip border border-line px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending && <p className="px-1 text-[12px] text-ink-muted">Reading the model and the tables…</p>}
    </div>
  );
}
