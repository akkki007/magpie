"use client";

import { useMemo, useState } from "react";
import { Check, RotateCcw, Undo2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { toIndianDecimal } from "@/lib/recon/money";
import type { QueueEntry, RunReport } from "@/lib/recon/report";
import { applyQueueCommand, type QueueCommand, type QueueState } from "@/lib/recon/queue-commands";
import { FAILURE_LABEL, type FailureClass } from "@/lib/recon/types";

/**
 * The review queue (`docs/recon-plan.md` R5.1–R5.4).
 *
 * This is the product surface of the track's *honest exception list*, and the ordering rules
 * are the argument. Grouped by failure class, because a controller works one kind of problem
 * at a time and thirteen of one class is one decision rather than thirteen. Sorted by cash
 * impact, because that is the order money gets found in. And **every row carries the evidence
 * that produced it** — §1.2's whole point is that a reviewer accepts or rejects in two seconds
 * without opening another file.
 */

const money = (paise: number) => `₹${toIndianDecimal(Math.abs(paise))}`;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

type Row = QueueEntry & { id: string };
type Group = { key: string; failure: FailureClass | null; entries: Row[]; cash: number };

export function ReviewQueue({ report }: { report: RunReport }) {
  const [state, setState] = useState<QueueState>({});
  const [history, setHistory] = useState<{ inverse: QueueCommand; label: string }[]>([]);

  const run = (command: QueueCommand) => {
    const result = applyQueueCommand(state, command);
    setState(result.state);
    setHistory((past) => [...past, { inverse: result.inverse, label: result.label }]);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setState(applyQueueCommand(state, last.inverse).state);
    setHistory((past) => past.slice(0, -1));
  };

  /**
   * Grouped and ordered once rather than per render. Entry ids are the index in the report,
   * which is stable for a given run — all the command bus needs to name what it changed.
   */
  const groups = useMemo<Group[]>(() => {
    const byClass = new Map<string, Group>();
    for (const [index, entry] of report.queue.entries()) {
      const key = entry.class ?? "UNCLASSIFIED";
      const group = byClass.get(key) ?? { key, failure: entry.class, entries: [], cash: 0 };
      group.entries.push({ ...entry, id: String(index) });
      group.cash += Math.abs(entry.amount);
      byClass.set(key, group);
    }
    for (const group of byClass.values()) {
      group.entries.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    }
    return [...byClass.values()].sort((a, b) => b.cash - a.cash);
  }, [report.queue]);

  const statusOf = (id: string) => state[id] ?? "open";
  const outstanding = report.queue.filter((_, index) => statusOf(String(index)) === "open");
  const outstandingCash = outstanding.reduce((total, entry) => total + Math.abs(entry.amount), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Summary report={report} outstanding={outstanding.length} cash={outstandingCash} />

      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <p className="text-[13px] text-ink-muted">
          <span className="font-medium text-ink">{outstanding.length}</span> outstanding ·{" "}
          <span className="tabular-nums">{money(outstandingCash)}</span> unresolved ·{" "}
          {report.queue.length - outstanding.length} reviewed
        </p>
        <button
          type="button"
          onClick={undo}
          disabled={history.length === 0}
          className="inline-flex items-center gap-1.5 rounded-button px-2 py-1 text-[13px] text-ink-2 hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent"
        >
          <Undo2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {history.length === 0 ? "Nothing to undo" : `Undo — ${history[history.length - 1].label}`}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <ClassGroup key={group.key} group={group} statusOf={statusOf} run={run} />
        ))}
        {groups.length === 0 && (
          <p className="p-8 text-center text-[13px] text-ink-muted">
            Nothing to review — the deterministic tiers resolved every link in this batch.
          </p>
        )}
      </div>

      {/* Stated, not hidden: recon has no tables yet, the same gap M0 closes for modelling. */}
      <p className="shrink-0 border-t border-line px-4 py-2 text-[12px] text-ink-faint">
        Decisions are held in memory and reset on reload — recon has no persistence yet
        (<code className="text-ink-muted">docs/recon-plan.md</code> R5.2). Each one is already a
        typed command with its inverse, so persisting them is a storage change, not a rewrite.
      </p>
    </div>
  );
}

/** R5.4 — the run summary, live from the scoreboard rather than retyped. */
function Summary({
  report,
  outstanding,
  cash,
}: {
  report: RunReport;
  outstanding: number;
  cash: number;
}) {
  const tiles = [
    { label: "Match rate", value: percent(report.headline.matchRate) },
    { label: "Auto-apply precision", value: percent(report.headline.precision) },
    {
      label: "False-match rate",
      value: percent(report.headline.falseMatchRate),
      /** The one number where zero is the only acceptable answer (§6). */
      good: report.headline.falseMatchRate === 0,
    },
    { label: "Records", value: report.batch.records.toLocaleString("en-IN") },
    { label: "Outstanding", value: String(outstanding) },
    { label: "Cash at risk", value: money(cash) },
  ];

  return (
    <div className="grid shrink-0 grid-cols-2 border-b border-line sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.label} className="border-r border-line px-4 py-3 last:border-r-0">
          <p className="text-[11px] uppercase tracking-[0.04em] text-ink-faint">{tile.label}</p>
          <p
            className={cn(
              "mt-0.5 font-display text-[20px] leading-none tabular-nums text-ink",
              tile.good && "text-pos-fg",
            )}
          >
            {tile.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/** R5.3 — bulk actions per class, which is the difference between a demo and a tool. */
function ClassGroup({
  group,
  statusOf,
  run,
}: {
  group: Group;
  statusOf: (id: string) => "open" | "accepted" | "rejected";
  run: (command: QueueCommand) => void;
}) {
  const open = group.entries.filter((entry) => statusOf(entry.id) === "open");
  const scope = group.failure ?? "unclassified";

  return (
    <section className="border-b border-line last:border-b-0">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-subtle px-4 py-2.5">
        <span className="rounded-chip bg-chip-sky px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink">
          {group.failure ?? "UNCLASSIFIED"}
        </span>
        <span className="text-[13px] text-ink-2">
          {group.failure
            ? FAILURE_LABEL[group.failure]
            : "No rule could name a class — this is the queue R4 reads"}
        </span>
        <span className="text-[13px] text-ink-muted">
          {group.entries.length} item{group.entries.length === 1 ? "" : "s"} ·{" "}
          <span className="tabular-nums">{money(group.cash)}</span>
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={open.length === 0}
            onClick={() =>
              run({ type: "Resolve", ids: open.map((entry) => entry.id), to: "accepted", scope })
            }
            className="rounded-button border border-line-strong bg-surface px-2 py-1 text-[12px] font-medium text-ink hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-faint"
          >
            Accept all {open.length || ""}
          </button>
          <button
            type="button"
            disabled={open.length === 0}
            onClick={() =>
              run({ type: "Resolve", ids: open.map((entry) => entry.id), to: "rejected", scope })
            }
            className="rounded-button px-2 py-1 text-[12px] text-ink-2 hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-faint"
          >
            Reject all
          </button>
        </div>
      </header>

      <ul>
        {group.entries.map((entry) => (
          <QueueRow key={entry.id} entry={entry} status={statusOf(entry.id)} scope={scope} run={run} />
        ))}
      </ul>
    </section>
  );
}

function QueueRow({
  entry,
  status,
  scope,
  run,
}: {
  entry: Row;
  status: "open" | "accepted" | "rejected";
  scope: string;
  run: (command: QueueCommand) => void;
}) {
  const resolved = status !== "open";

  return (
    <li
      data-status={status}
      className={cn(
        "flex gap-4 border-t border-line px-4 py-3 first:border-t-0",
        resolved && "bg-subtle",
      )}
    >
      <div className="w-32 shrink-0 text-right">
        <p
          className={cn(
            "font-display text-[15px] leading-tight tabular-nums text-ink",
            resolved && "text-ink-faint line-through",
          )}
        >
          {entry.amount < 0 ? `(${money(entry.amount)})` : money(entry.amount)}
        </p>
        <p className="mt-0.5 text-[11px] uppercase tracking-[0.04em] text-ink-faint">
          {entry.outcome === "PROPOSED" ? "Proposed" : "Exception"}
        </p>
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-muted">
          <code className="text-ink-2">{entry.rule}</code>
          <span aria-hidden>·</span>
          <span>{entry.lane.replaceAll("_", " ").toLowerCase()}</span>
          <span aria-hidden>·</span>
          <span className="truncate font-mono text-[11px]">
            {entry.left.join(", ") || "—"} → {entry.right.join(", ") || "—"}
          </span>
        </p>
        {/* The evidence line is the feature. Without it a reviewer has to go and look. */}
        <ul className={cn("mt-1 space-y-0.5", resolved && "opacity-55")}>
          {entry.evidence.map((line, index) => (
            <li key={index} className="text-[13px] leading-[1.5] text-ink-2">
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex w-24 shrink-0 items-start justify-end gap-1">
        {resolved ? (
          <button
            type="button"
            onClick={() => run({ type: "Restore", states: { [entry.id]: "open" }, scope })}
            className="inline-flex items-center gap-1 rounded-button px-2 py-1 text-[12px] text-ink-muted hover:bg-hover"
          >
            <RotateCcw className="h-3 w-3" strokeWidth={1.75} aria-hidden />
            {status === "accepted" ? "Accepted" : "Rejected"}
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label="Accept this match"
              onClick={() => run({ type: "Resolve", ids: [entry.id], to: "accepted", scope })}
              className="grid h-7 w-7 place-items-center rounded-button border border-line-strong bg-surface text-ink hover:bg-hover"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Reject this match"
              onClick={() => run({ type: "Resolve", ids: [entry.id], to: "rejected", scope })}
              className="grid h-7 w-7 place-items-center rounded-button text-ink-muted hover:bg-hover"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
