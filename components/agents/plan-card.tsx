"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Step, Todo } from "@/lib/agents/run";

/**
 * The plan card (`docs/agents-plan.md` A5) — the agent's own todo list, as the progress bar.
 *
 * This is the only honest progress a multi-step run has. A spinner cannot distinguish
 * "reading the third of four series" from "hung", and a percentage would be invented. The
 * todos are written by the agent itself with `write_todos`, so the list is what it actually
 * believes it is doing rather than a narration we composed for it.
 *
 * Collapsible, and collapsed by default once the run is done: mid-run the list is the thing
 * you are watching, afterwards the answer is, and the plan becomes evidence you open if you
 * want to check the working.
 */

const STATUS = {
  completed: { label: "completed", tone: "text-ink-muted" },
  in_progress: { label: "in progress", tone: "text-ink" },
  pending: { label: "pending", tone: "text-ink-muted" },
} as const;

export function PlanCard({
  task,
  title,
  note,
  todos,
  steps,
  running,
}: {
  task: string;
  title?: string | null;
  note?: string | null;
  todos: Todo[];
  steps: Step[];
  running: boolean;
  /** What the run is doing right now, from `lib/agents/run.ts`. */
}) {
  const [open, setOpen] = useState(true);

  const done = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const activeIndex = todos.findIndex((t) => t.status === "in_progress");

  return (
    <section className="rounded-card border border-line bg-surface">
      <p className="flex items-center gap-1.5 px-4 pt-3.5 text-[12px] text-ink-muted">
        <Sparkles className="h-3.5 w-3.5 text-violet-500" strokeWidth={1.75} aria-hidden />
        {running ? (
          <>
            {/* The live sentence lives on the canvas, which is where the work is. Repeating
                it here put the same clause in both panes; the count is the thing this side
                can say that the other one cannot. */}
            <span>
              {steps.length} step{steps.length === 1 ? "" : "s"} so far
            </span>
            <Loader2 className="h-3 w-3 animate-spin text-ink-faint" aria-hidden />
          </>
        ) : (
          <span>
            Took {steps.length} step{steps.length === 1 ? "" : "s"}
          </span>
        )}
      </p>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-2.5 flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left transition-colors hover:bg-hover"
      >
        {/* The header answers "where has it got to" without expanding anything, which is
            the question someone glancing at a running job actually has. */}
        {running && activeIndex >= 0 ? (
          <>
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-faint" aria-hidden />
            <span className="text-[14px] font-medium text-ink">
              Task {activeIndex + 1} of {total} in progress
            </span>
          </>
        ) : (
          <>
            <span className="text-[14px] font-medium text-ink">Task list</span>
            {total > 0 && (
              <span className="text-[12px] text-ink-muted">
                {done}/{total} completed
              </span>
            )}
          </>
        )}
        <span className="ml-auto text-ink-faint">
          {open ? (
            <ChevronUp className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-4 py-3.5">
          {title && <p className="text-[14px] font-medium text-ink">{title}</p>}
          <p className={cn("text-[13px] leading-[1.65] text-ink-muted", title && "mt-1")}>
            {note || task}
          </p>

          {total === 0 ? (
            <p className="mt-3 text-[12px] text-ink-faint">
              {running ? "Writing a plan…" : "This run finished without writing a plan."}
            </p>
          ) : (
            <>
              <p className="mt-3.5 mb-2 text-[11px] font-semibold tracking-[0.04em] text-ink-faint uppercase">
                {total} task{total === 1 ? "" : "s"}
              </p>
              <ol className="flex flex-col gap-2.5">
                {todos.map((todo, index) => {
                  const status = STATUS[todo.status as keyof typeof STATUS] ?? STATUS.pending;
                  const isDone = todo.status === "completed";
                  const isActive = todo.status === "in_progress";

                  return (
                    <li key={`${index}-${todo.content}`} className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className={cn(
                          "mt-[1px] grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                          isDone && "border-blue-600 bg-blue-600",
                          isActive && "border-blue-600",
                          !isDone && !isActive && "border-line-strong",
                        )}
                      >
                        {isDone && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                        {isActive && (
                          <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-600" aria-hidden />
                        )}
                      </span>
                      <span
                        className={cn(
                          "text-[13px] leading-[1.55]",
                          isDone ? "text-ink-muted" : "text-ink-2",
                        )}
                      >
                        {todo.content}
                        <span className="sr-only"> — {status.label}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
