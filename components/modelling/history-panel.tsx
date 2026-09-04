"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  BookmarkPlus,
  History,
  Redo2,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  createVersion,
  readModelHistory,
  rollbackTo,
} from "@/app/(app)/models/actions";
import { cn } from "@/lib/cn";
import type { HistoryEntry, VersionEntry } from "@/lib/model/changesets";

/**
 * Version history (`docs/modelling-plan.md` M3.4).
 *
 * The `History` icon in the topbar was decoration until M3.1 gave it something to read.
 * What it shows is the command stream itself — not a second log written alongside the
 * writes, which is the arrangement that eventually disagrees with them. If an edit is not
 * here, it did not reach Postgres, and that is worth being able to see.
 *
 * Undos and rollbacks appear as their own entries rather than removing what they acted on,
 * because the log is append-only (§1.3). "Akshay undid the rename" is the answer to a
 * question a finance team actually asks; a rename that has silently vanished is not.
 */

type Loaded = { entries: HistoryEntry[]; versions: VersionEntry[] };

export function HistoryPanel({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, startTransition] = useTransition();

  const load = useCallback(async () => {
    const result = await readModelHistory(slug);
    if (!result.ok) return setError(result.error);
    setError(null);
    setData({ entries: result.entries, versions: result.versions });
  }, [slug]);

  // Fetched by the click that opens the panel, not by an effect watching `open`. History is
  // a thing you go and look at — there is no state to synchronise, just a request caused by
  // an action, and an effect would be describing it as the former.
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

  function saveVersion() {
    const name = label.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await createVersion(slug, name);
      if (!result.ok) {
        toast.error("That version was not saved", { description: result.error });
        return;
      }
      setLabel("");
      toast.success(`Saved "${name}"`);
      await load();
    });
  }

  function restore(version: VersionEntry) {
    startTransition(async () => {
      const result = await rollbackTo(slug, version.id, crypto.randomUUID());
      if (!result.ok) {
        toast.error("Nothing was rolled back", {
          description: result.error,
          duration: Infinity,
        });
        return;
      }
      // A reload, not a refresh. The grid holds the model in a reducer with its own undo
      // stack, and both are now describing a model that no longer exists — there is no
      // partial update that leaves them honest.
      window.location.reload();
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Version history"
        title="Version history"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        className={cn(
          "grid h-8 w-8 place-items-center rounded-control transition-colors duration-150",
          open ? "bg-hover text-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
        )}
      >
        <History className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {open && (
        <>
          {/* Dismissal, not scrim: the grid behind stays readable while you compare. */}
          <button
            type="button"
            aria-label="Close version history"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          {/* Full-bleed on a phone, a side panel from `sm` up: a fixed 3xx px panel is not a
              narrow panel on a 360px screen — it is the whole screen with a sliver of canvas
              showing, or an overflow. Below `sm` it takes the width it will actually take and
              states it as `inset-x-0`, so there is no number here to disagree with the
              viewport. */}
          <aside
            aria-label="Version history"
            className={cn(
              "fixed inset-x-0 top-0 z-50 flex h-dvh flex-col sm:right-0 sm:left-auto sm:w-[360px]",
              "border-line bg-surface sm:border-l",
            )}
          >
            <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
              <span className="text-[14px] font-medium text-ink">History</span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="ml-auto grid h-7 w-7 place-items-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </header>

            <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveVersion();
                }}
                placeholder="Name this version"
                className="min-w-0 flex-1 rounded-button border border-line bg-canvas px-2 py-1 text-[12px] text-ink-1 outline-none transition-colors duration-150 focus:border-blue-400"
              />
              <button
                type="button"
                disabled={busy || !label.trim()}
                onClick={saveVersion}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-button px-2 py-1 text-[12px] transition-colors duration-150",
                  label.trim() && !busy
                    ? "bg-blue-400 text-white hover:bg-blue-500"
                    : "cursor-not-allowed bg-line text-ink-faint",
                )}
              >
                <BookmarkPlus className="h-3 w-3" strokeWidth={2} />
                Save
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {error && <p className="px-4 py-3 text-[12px] text-neg-fg">{error}</p>}

              {data && data.versions.length > 0 && (
                <section className="border-b border-line">
                  <SectionLabel>Versions</SectionLabel>
                  <ul>
                    {data.versions.map((version) => (
                      <li
                        key={version.id}
                        className="group flex items-baseline gap-2 px-4 py-1.5 transition-colors duration-150 hover:bg-hover"
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-1">
                          {version.label}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-faint">
                          {ago(version.createdAt)}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => restore(version)}
                          className="flex shrink-0 items-center gap-1 rounded-button px-1.5 py-0.5 text-[11px] text-ink-muted transition-all duration-150 hover:bg-canvas hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <SectionLabel>Changes</SectionLabel>
                {data?.entries.length === 0 && (
                  <p className="px-4 py-3 text-[12px] text-ink-faint">
                    Nothing yet. Every edit you make appears here with who made it and when.
                  </p>
                )}
                <ul>
                  {data?.entries.map((entry, index) => {
                    const previous = data.entries[index - 1];
                    const newDay = !previous || day(previous.createdAt) !== day(entry.createdAt);
                    return (
                      <li key={entry.id}>
                        {newDay && (
                          <div className="px-4 pt-2.5 pb-1 text-[11px] text-ink-faint">
                            {day(entry.createdAt)}
                          </div>
                        )}
                        <div className="flex items-baseline gap-2 px-4 py-1.5 transition-colors duration-150 hover:bg-hover">
                          <Mark kind={entry.kind} />
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-1">
                            {entry.label}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-muted">
                            {entry.actorName}
                          </span>
                          <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">
                            {ago(entry.createdAt)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </aside>
        </>
      )}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-[0.01em] text-ink-faint uppercase">
      {children}
    </div>
  );
}

function Mark({ kind }: { kind: HistoryEntry["kind"] }) {
  if (kind === "UNDO") return <Undo2 className="h-3 w-3 shrink-0 text-ink-faint" strokeWidth={1.75} />;
  if (kind === "REDO") return <Redo2 className="h-3 w-3 shrink-0 text-ink-faint" strokeWidth={1.75} />;
  if (kind === "ROLLBACK") return <RotateCcw className="h-3 w-3 shrink-0 text-ink-faint" strokeWidth={1.75} />;
  return <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-blue-400" />;
}

function day(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
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
