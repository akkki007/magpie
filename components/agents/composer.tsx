"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChartColumn, ChevronDown, Database, Table2, Zap } from "lucide-react";

import { listMentions, type Mention } from "@/app/(app)/agents/mentions";
import { MODES, type Mode } from "@/lib/agents/modes";
import { cn } from "@/lib/cn";

/**
 * The agent composer (`docs/agents-plan.md` A5).
 *
 * Four controls, and each one changes what actually happens:
 *
 * - **`@` mentions** put the exact name of a real model, table or board into the task, so
 *   "the customer table" cannot resolve to the wrong thing. The agent still grounds every
 *   id through a tool; a mention narrows the question rather than replacing the catalogue.
 * - **Mode** gates tools (`lib/agents/modes.ts`). Ask and Plan hold no write tools at all,
 *   so the difference is real rather than a rephrased instruction.
 * - **Model** is shown because which one answered is part of reading the run later.
 * - **Credits** is a live count of runs today, not a marketing ring: an agent run costs real
 *   tokens and knowing you have made eleven today is the number that matters.
 */

const ICON = { model: Table2, table: Database, board: ChartColumn } as const;

export function Composer({
  onSubmit,
  pending,
  suggestions = [],
  modelName,
  runsToday,
  placeholder = "Give an agent a job, or @ mention a table",
  autoFocus,
}: {
  onSubmit: (task: string, mode: Mode) => void;
  pending: boolean;
  suggestions?: string[];
  modelName: string;
  runsToday: number;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [task, setTask] = useState("");
  const [mode, setMode] = useState<Mode>("do");
  const [modeOpen, setModeOpen] = useState(false);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listMentions().then(setMentions);
  }, []);

  /** The `@word` immediately before the caret, or null. */
  const detectMention = (value: string, caret: number) => {
    const upto = value.slice(0, caret);
    const match = /@([\w\s]{0,30})$/.exec(upto);
    setMentionQuery(match ? match[1] : null);
  };

  const matches = useMemo(() => {
    if (mentionQuery === null) return [];
    const needle = mentionQuery.trim().toLowerCase();
    return mentions.filter((m) => !needle || m.name.toLowerCase().includes(needle)).slice(0, 6);
  }, [mentionQuery, mentions]);

  const insert = (mention: Mention) => {
    const element = box.current;
    const caret = element?.selectionStart ?? task.length;
    const upto = task.slice(0, caret).replace(/@([\w\s]{0,30})$/, `@${mention.name} `);
    const next = upto + task.slice(caret);
    setTask(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(upto.length, upto.length);
    });
  };

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    onSubmit(trimmed, mode);
    setTask("");
  };

  const active = MODES.find((m) => m.value === mode)!;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        {matches.length > 0 && (
          <ul className="absolute bottom-full left-0 z-20 mb-1.5 w-full overflow-hidden rounded-control border border-line bg-surface shadow-e2">
            {matches.map((mention) => {
              const Icon = ICON[mention.kind];
              return (
                <li key={`${mention.kind}-${mention.name}`}>
                  <button
                    type="button"
                    onClick={() => insert(mention)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-hover"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{mention.name}</span>
                    <span className="shrink-0 text-[11px] text-ink-faint">{mention.hint}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(task);
          }}
          className="rounded-card border border-violet-300 bg-surface focus-within:border-violet-500"
        >
          <textarea
            ref={box}
            value={task}
            autoFocus={autoFocus}
            onChange={(event) => {
              setTask(event.target.value);
              detectMention(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setMentionQuery(null);
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                // Enter picks the highlighted mention rather than sending, so typing
                // "@Cust" and hitting Enter completes instead of firing a half-written task.
                if (matches.length > 0) insert(matches[0]);
                else submit(task);
              }
            }}
            rows={2}
            disabled={pending}
            placeholder={placeholder}
            aria-label="Describe the task"
            className="w-full resize-none bg-transparent px-3 pt-2.5 text-[14px] leading-[1.6] text-ink outline-none placeholder:text-ink-faint"
          />

          <div className="flex items-center gap-1.5 px-2 pb-2">
            {/* Mode */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setModeOpen((o) => !o)}
                aria-expanded={modeOpen}
                title={active.hint}
                className="flex items-center gap-1 rounded-button px-2 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover"
              >
                {active.label}
                <ChevronDown className="h-3 w-3 text-ink-faint" strokeWidth={2} aria-hidden />
              </button>

              {modeOpen && (
                <ul className="absolute bottom-full left-0 z-20 mb-1.5 w-[248px] overflow-hidden rounded-control border border-line bg-surface shadow-e2">
                  {MODES.map((option) => (
                    <li key={option.value}>
                      <button
                        type="button"
                        onClick={() => {
                          setMode(option.value);
                          setModeOpen(false);
                        }}
                        className={cn(
                          "w-full px-2.5 py-2 text-left transition-colors hover:bg-hover",
                          option.value === mode && "bg-muted",
                        )}
                      >
                        <span className="block text-[12px] font-medium text-ink">{option.label}</span>
                        <span className="mt-0.5 block text-[11px] leading-[1.5] text-ink-muted">
                          {option.hint}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <span className="text-line">·</span>

            <span
              title="The model answering"
              className="hidden items-center gap-1 rounded-button px-1.5 py-1 text-[11px] text-ink-muted sm:flex"
            >
              <Zap className="h-3 w-3 text-violet-500" strokeWidth={1.75} aria-hidden />
              {modelName}
            </span>

            <span className="ml-auto flex items-center gap-2">
              <CreditRing used={runsToday} />
              <button
                type="submit"
                disabled={!task.trim() || pending}
                aria-label="Spawn agent"
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors",
                  task.trim() && !pending
                    ? "bg-ink text-white hover:bg-ink-2"
                    : "cursor-not-allowed bg-line text-ink-faint",
                )}
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2} />
              </button>
            </span>
          </div>
        </form>
      </div>

      {task === "" && !pending && suggestions.length > 0 && (
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

/** Runs used today out of a soft daily allowance. Real usage, not a decorative ring. */
const DAILY = 25;

function CreditRing({ used }: { used: number }) {
  const left = Math.max(0, DAILY - used);
  const fraction = Math.min(1, used / DAILY);
  const circumference = 2 * Math.PI * 7;

  return (
    <span
      title={`${used} of ${DAILY} runs used today`}
      className="flex items-center gap-1.5 text-[11px] text-ink-muted"
    >
      <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] -rotate-90" aria-hidden>
        <circle cx="9" cy="9" r="7" fill="none" stroke="var(--color-line)" strokeWidth="2" />
        <circle
          cx="9"
          cy="9"
          r="7"
          fill="none"
          stroke={left === 0 ? "var(--color-neg-fg)" : "var(--color-blue-600)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${fraction * circumference} ${circumference}`}
        />
      </svg>
      <span className="tnum hidden sm:inline">{left} left</span>
    </span>
  );
}
