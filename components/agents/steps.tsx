"use client";

import { Bot, Calculator, Database, FileText, ListChecks, Search, Sparkles, Table2 } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Step } from "@/lib/agents/run";

/**
 * The step trail (`docs/agents-plan.md` A5).
 *
 * Deliberately not a transcript. What matters afterwards is *what the run touched* — which
 * subagent it asked, which table it read, whether it did its arithmetic with the calculator
 * — because that is what makes the answer checkable. The prose is in the result and the
 * files; this is the provenance.
 *
 * It now includes the tools the *subagents* called, which it could not before: the
 * supervisor holds no read tools, so everything worth recording happened inside a `task`
 * call the message stream cannot see into. The tools report themselves instead
 * (`lib/agents/observe.ts`), which is why a line here can say "5 of 173 rows in Customers"
 * rather than just "asked the data-analyst".
 */

const ICONS: Record<string, typeof Bot> = {
  write_todos: ListChecks,
  write_file: FileText,
  read_file: FileText,
  calculate: Calculator,
  getModelOutline: Table2,
  getVariable: Table2,
  getSeries: Table2,
  runScenario: Table2,
  listTables: Database,
  sampleTable: Database,
  aggregateTable: Database,
  createTable: Database,
  listBoards: Search,
  proposeModelChanges: Sparkles,
  addBoardTile: Sparkles,
};

const LABELS: Record<string, string> = {
  write_todos: "Planned",
  write_file: "Wrote a file",
  read_file: "Read a file",
  calculate: "Calculated",
  getModelOutline: "Read the model outline",
  getVariable: "Looked up a variable",
  getSeries: "Read a series",
  runScenario: "Tried a scenario",
  listTables: "Listed the tables",
  sampleTable: "Sampled a table",
  aggregateTable: "Rolled records into periods",
  listBoards: "Listed the boards",
};

/**
 * A write leaves two lines: the moment it was put to a person, and what became of it.
 * One label for both would misreport one of them — "Proposed a new table — Vendor
 * Invoices" reads as a second proposal when it is the confirmation that the first one
 * landed. So each write tool names its own three outcomes.
 */
const WRITES: Record<string, { asked: string; done: string; refused: string }> = {
  createTable: {
    asked: "Asked to create a table",
    done: "Created the table",
    refused: "The table was refused",
  },
  proposeModelChanges: {
    asked: "Asked to stage plan changes",
    done: "Staged the changes for review",
    refused: "The proposal was refused",
  },
  addBoardTile: {
    asked: "Asked to add a board tile",
    done: "Added the tile",
    refused: "The tile was refused",
  },
};

function labelFor(step: Step): string {
  if (step.kind === "subagent") return `Asked ${step.name}`;
  if (step.kind === "message") return "Wrote the answer";

  const write = WRITES[step.name];
  if (write) {
    if (step.detail === "waiting for approval") return write.asked;
    if (step.detail === "declined") return "You declined it";
    if (step.detail?.startsWith("refused")) return write.refused;
    return write.done;
  }

  return LABELS[step.name] ?? step.name;
}

export function Steps({ steps }: { steps: Step[] }) {
  if (steps.length === 0) {
    return <p className="text-[12px] text-ink-faint">Nothing yet.</p>;
  }

  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const isSubagent = step.kind === "subagent";
        const isThought = step.kind === "message";
        const Icon = isSubagent ? Bot : (ICONS[step.name] ?? Sparkles);
        const label = labelFor(step);
        // The detail already reads as the label for a settled write ("Created the table —
        // Vendor Invoices" is right; "— done" is noise).
        const detail = step.detail === "done" ? undefined : step.detail;

        return (
          <li
            key={`${index}-${step.name}`}
            className="flex items-start gap-2.5 border-b border-line py-2 last:border-b-0"
          >
            <span
              aria-hidden
              className={cn(
                "mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-control",
                isSubagent ? "bg-violet-100 text-violet-500" : "bg-muted text-ink-muted",
              )}
            >
              <Icon className="h-3 w-3" strokeWidth={1.75} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-[12px] text-ink-2">
                {label}
                {detail && !isThought && (
                  <span className="ml-1.5 text-[11px] text-ink-faint">— {detail}</span>
                )}
              </span>
              {isThought && step.detail && (
                <span className="mt-0.5 block text-[11px] leading-[1.55] text-ink-faint">
                  {step.detail}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
