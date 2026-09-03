"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUp } from "lucide-react";

import { spawnRun } from "@/app/(app)/agents/actions";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

/**
 * Spawning a run (`docs/agents-plan.md` A5).
 *
 * The composer navigates to the run as soon as the row exists rather than waiting for the
 * answer — the whole premise is that you hand over a task and walk away, and a form that
 * blocks for forty seconds teaches you not to. The suggestions are deliberately *tasks*, not
 * questions: "why did X move, and what should we do" is what this is for, and the phrasing
 * of the first thing a person clicks sets their expectation of the rest.
 */
export function Spawn({ suggestions }: { suggestions: string[] }) {
  const [task, setTask] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    start(async () => {
      const result = await spawnRun(trimmed);
      if (result.ok) {
        setTask("");
        router.push(`/agents/${result.id}`);
      } else {
        toast.error("Could not start that run", { description: result.error });
      }
    });
  };

  return (
    <div data-tour="spawn" className="flex flex-col gap-2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(task);
        }}
        className="flex items-end gap-2 rounded-card border border-violet-300 bg-surface p-2.5 focus-within:border-violet-500"
      >
        <textarea
          value={task}
          onChange={(event) => setTask(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(task);
            }
          }}
          rows={2}
          disabled={pending}
          placeholder="Give an agent a job — “work out whether onboarding is tracking to plan, and propose a fix”"
          aria-label="Describe the task"
          className="min-w-0 flex-1 resize-none bg-transparent text-[14px] leading-[1.6] text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="submit"
          disabled={!task.trim() || pending}
          aria-label="Spawn agent"
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
            task.trim() && !pending ? "bg-ink text-white hover:bg-ink-2" : "cursor-not-allowed bg-line text-ink-faint",
          )}
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2} />
        </button>
      </form>

      {task === "" && !pending && (
        <ul className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => submit(suggestion)}
                className="rounded-chip border border-line px-2 py-1 text-left text-[11px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
