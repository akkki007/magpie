"use client";

import { useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { Inline } from "./markdown";
import { cn } from "@/lib/cn";

const LETTERS = ["A", "B", "C", "D", "E"];

/**
 * Retrieval practice. Answering is the point, so the correct option is revealed
 * only after a choice — and a wrong answer explains the *mechanism* rather than
 * just marking it red. State is per-mount and intentionally not persisted:
 * re-testing yourself later is the whole value.
 */
export function Quiz({
  question,
  options,
  answer,
  explain,
}: {
  question: string;
  options: string[];
  answer: number;
  explain: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const done = picked !== null;
  const right = picked === answer;

  return (
    <div className="my-6 overflow-hidden rounded-[10px] border border-paper-line bg-paper-card">
      <div className="px-5 pt-4 pb-3">
        <span className="font-mono text-[11px] tracking-[0.06em] text-paper-faint">
          Quiz
        </span>
        <p className="mt-2 text-[15.5px] leading-[1.6] text-paper-ink">
          <Inline text={question} />
        </p>
      </div>

      <div className="space-y-2 px-5 pb-4">
        {options.map((opt, i) => {
          const isAnswer = i === answer;
          const isPicked = i === picked;
          const reveal = done && (isAnswer || isPicked);

          return (
            <button
              key={i}
              disabled={done}
              onClick={() => setPicked(i)}
              className={cn(
                "flex w-full items-center gap-3 rounded-[8px] border px-3 py-2.5 text-left text-[14px] transition-colors duration-150",
                !done && "border-paper-line-soft hover:border-paper-line hover:bg-paper",
                done && !reveal && "border-transparent text-paper-faint",
                reveal && isAnswer && "border-ok-line bg-ok-bg text-paper-ink",
                reveal && !isAnswer && "border-no-line bg-no-bg text-paper-ink",
              )}
            >
              <span
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-[4px] font-mono text-[10px]",
                  reveal && isAnswer && "bg-ok-line text-ok-fg",
                  reveal && !isAnswer && "bg-no-line text-no-fg",
                  !reveal && "bg-paper-code text-paper-muted",
                )}
              >
                {LETTERS[i]}
              </span>
              <span className="flex-1">
                <Inline text={opt} />
              </span>
              {reveal && isAnswer ? (
                <Check className="h-4 w-4 shrink-0 text-ok-fg" strokeWidth={2} />
              ) : null}
              {reveal && !isAnswer ? (
                <X className="h-4 w-4 shrink-0 text-no-fg" strokeWidth={2} />
              ) : null}
            </button>
          );
        })}

        {done && !right ? (
          <div className="rounded-[8px] border border-hint-line bg-hint-bg px-4 py-3">
            <p className="text-[13.5px] font-semibold text-hint-fg">Not quite</p>
            <p className="mt-1 text-[14px] leading-[1.6] text-paper-ink-2">
              <Inline text={explain} />
            </p>
          </div>
        ) : null}

        {done && right ? (
          <div className="rounded-[8px] border border-ok-line bg-ok-bg px-4 py-3">
            <p className="text-[13.5px] font-semibold text-ok-fg">That&apos;s it</p>
            <p className="mt-1 text-[14px] leading-[1.6] text-paper-ink-2">
              <Inline text={explain} />
            </p>
          </div>
        ) : null}
      </div>

      {done ? (
        <div className="flex justify-end border-t border-paper-line-soft px-5 py-2.5">
          <button
            onClick={() => setPicked(null)}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-paper-muted transition-colors duration-150 hover:text-paper-ink"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
