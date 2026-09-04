"use client";

import Link from "next/link";

import {
  CalendarDays,
  CaseSensitive,
  ChartColumn,
  DollarSign,
  FileText,
  Hash,
  LayoutGrid,
  ListFilter,
  Table2,
} from "lucide-react";

import { BoardChart } from "@/components/board/chart";
import { cn } from "@/lib/cn";
import type { Artifact, ArtifactStatus, OutlineView, ProposalDraft, RecordsView, SeriesView, TableDraft, TileDraft } from "@/lib/agents/artifacts";

/**
 * The canvas (`docs/agents-plan.md` A5) — the work, on the left, while the chat runs on the
 * right.
 *
 * **It shows what the agent is looking at, not only what it wants to write.** The first
 * version only had cards at the approval gate, which meant the pane said "nothing built yet"
 * through the entire minute of reading that produced the answer, then flashed a table and
 * went quiet again. Now every read puts its result here as it returns — the rows actually
 * sampled, the series actually rolled up, the model's own outline — so the canvas is a live
 * account of the work rather than a receipt at the end of it.
 *
 * Two card families, one column, in the order they happened:
 *
 * - **Views** are reads. Quiet border, no status chip, and they are evicted oldest-first
 *   once the canvas is full.
 * - **Builds** are writes. They carry a status, they are never evicted, and a table being
 *   proposed is drawn as the grid it will become — you approve by looking at the thing.
 */

const TYPE_ICON: Record<string, typeof Hash> = {
  TEXT: CaseSensitive,
  NUMBER: Hash,
  CURRENCY: DollarSign,
  DATE: CalendarDays,
  SELECT: ListFilter,
};

const STATUS_LABEL: Record<Exclude<ArtifactStatus, "read">, string> = {
  proposed: "awaiting approval",
  created: "created",
  declined: "declined",
  // Approved by a person, then refused by the tool — grounding caught something. Distinct
  // from "declined" on purpose: one is a human's decision, the other is a rejected write,
  // and collapsing them would blame the wrong party.
  failed: "not accepted",
};

const STATUS_TONE: Record<Exclude<ArtifactStatus, "read">, string> = {
  proposed: "bg-chip-amber text-ink",
  created: "bg-pos-bg text-pos-fg",
  declined: "bg-chip-graphite text-ink-2",
  failed: "bg-neg-bg text-neg-fg",
};

export function Canvas({
  artifacts,
  files,
  activity,
}: {
  artifacts: Artifact[];
  files: [string, string][];
  activity: string | null;
}) {
  const empty = artifacts.length === 0 && files.length === 0;

  return (
    <div className="flex min-h-full flex-col">
      {/* The live line. Pinned, because "what is happening right now" should not scroll
          away behind the thing that happened four steps ago. */}
      {activity && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-app/85 px-5 py-2.5 backdrop-blur-sm">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-600" />
          </span>
          <p className="truncate text-[12px] font-medium text-ink-2">{activity}</p>
        </div>
      )}

      {empty ? (
        <Empty working={Boolean(activity)} />
      ) : (
        <div className="flex flex-col gap-4 p-5">
          {artifacts.map((artifact) => (
            <ArtifactCard key={artifact.key} artifact={artifact} />
          ))}

          {files.map(([name, body]) => (
            <Card key={name} icon={FileText} title={name} mono>
              <pre className="max-h-[380px] overflow-auto px-3.5 py-3 text-[12px] leading-[1.75] whitespace-pre-wrap text-ink-2">
                {body}
              </pre>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ working }: { working: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-xs text-center">
        <span
          aria-hidden
          className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-card border border-line bg-surface text-ink-faint"
        >
          <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <p className="text-[13px] font-medium text-ink">
          {working ? "Getting started" : "Nothing to show"}
        </p>
        <p className="mt-1.5 text-[12px] leading-[1.65] text-ink-muted">
          {working
            ? "Everything the agent reads or builds lands here as it happens — the rows it samples, the series it rolls up, the tables it designs."
            : "This run built nothing and read nothing worth drawing."}
        </p>
      </div>
    </div>
  );
}

/* ── One shell, so every card has the same head and the same hairline ─────*/

function Card({
  icon: Icon,
  title,
  subtitle,
  status,
  mono,
  children,
}: {
  icon: typeof Hash;
  title: string;
  subtitle?: string;
  status?: Exclude<ArtifactStatus, "read">;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-card border bg-surface",
        status === "proposed" ? "border-blue-200" : "border-line",
      )}
    >
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[13px] font-medium text-ink", mono && "font-mono text-[12px]")}>
            {title}
          </span>
          {subtitle && <span className="mt-0.5 block truncate text-[11px] text-ink-muted">{subtitle}</span>}
        </span>
        {status && (
          <span
            className={cn(
              "shrink-0 rounded-chip px-1.5 py-[3px] text-[10px] font-semibold",
              STATUS_TONE[status],
            )}
          >
            {STATUS_LABEL[status]}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  switch (artifact.kind) {
    case "records":
      return <Records view={artifact} />;
    case "series":
      return <Series view={artifact} />;
    case "outline":
      return <Outline view={artifact} />;
    case "table":
      return <TableBuild draft={artifact} />;
    case "proposal":
      return <Proposal draft={artifact} />;
    case "tile":
      return <Tile draft={artifact} />;
  }
}

/* ── Views ────────────────────────────────────────────────────────────────*/

/** Real rows, in the grid they came out of — the same shape as the database page. */
function Records({ view }: { view: RecordsView }) {
  return (
    <Card icon={Table2} title={view.name} subtitle={`${view.total} rows`}>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              {view.columns.map((column) => (
                <Th key={column.name} name={column.name} type={column.type} />
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td
                    key={column}
                    className={cn(
                      "border-r border-b border-line px-3 py-2 whitespace-nowrap last:border-r-0",
                      typeof cell === "number" ? "text-right tabular-nums text-ink" : "text-ink-2",
                    )}
                  >
                    {cell === null ? <span className="text-ink-faint">—</span> : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-2 px-3.5 py-2 text-[11px] text-ink-faint">
        <span>
          Showing {view.showing} of {view.total}
        </span>
        <Link href={`/databases/${view.slug}`} className="ml-auto font-medium text-blue-600 hover:underline">
          Open table →
        </Link>
      </p>
    </Card>
  );
}

/**
 * A series, drawn by the board's own chart.
 *
 * Reused rather than redrawn: `BoardChart` is already built to the mark specs the `dataviz`
 * method sets out (24px bar cap, rounded data-end, hairline gridlines, a table view for the
 * contrast finding), and a second chart in the same product drawn to different rules would
 * be a second set of rules to keep right.
 */
function Series({ view }: { view: SeriesView }) {
  return (
    <Card
      icon={ChartColumn}
      title={view.title}
      subtitle={view.source === "records" ? "Rolled up from records" : "From the plan"}
    >
      <div className="px-3.5 py-3">
        <BoardChart
          form={view.series.length > 1 ? "grouped-bar" : "stacked-bar"}
          labels={view.periods}
          series={view.series}
          format={view.format}
        />
        {view.note && <p className="mt-2 text-[11px] leading-[1.6] text-ink-faint">{view.note}</p>}
      </div>
    </Card>
  );
}

/** The plan itself: what the agent is reading when it reads the model. */
function Outline({ view }: { view: OutlineView }) {
  return (
    <Card icon={Table2} title={view.name} subtitle={view.horizon}>
      <div className="divide-y divide-line">
        {view.groups.map((group) => (
          <div key={group.name} className="px-3.5 py-2.5">
            <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
              {group.name}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {group.variables.map((variable) => (
                <li key={variable.name} className="flex items-baseline gap-2 text-[12px]">
                  <span className="shrink-0 text-ink-2">{variable.name}</span>
                  {variable.formula ? (
                    <span className="truncate font-mono text-[11px] text-ink-faint">
                      = {variable.formula}
                    </span>
                  ) : (
                    <span className="text-[11px] text-ink-faint">{variable.kind.toLowerCase()}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Builds ───────────────────────────────────────────────────────────────*/

/** A table being designed, drawn as the grid it will become. */
function TableBuild({ draft }: { draft: TableDraft }) {
  return (
    <Card
      icon={Table2}
      title={draft.name}
      subtitle={draft.description}
      status={draft.status === "read" ? undefined : draft.status}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              {draft.fields.map((field) => (
                <Th key={field.name} name={field.name} type={field.type} />
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {draft.fields.map((field) => (
                <td
                  key={field.name}
                  className="border-r border-b border-line px-3 py-2 align-top text-ink-faint last:border-r-0"
                >
                  {field.options?.length ? (
                    <span className="flex flex-wrap gap-1">
                      {field.options.map((option) => (
                        <span key={option} className="rounded-chip bg-chip-sky px-1.5 py-[2px] text-[10px] text-ink">
                          {option}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-[11px]">{field.type.toLowerCase()}</span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-2 px-3.5 py-2 text-[11px] text-ink-faint">
        <span>{draft.fields.length} columns · no rows yet</span>
        {draft.status === "created" && draft.slug && (
          <Link href={`/databases/${draft.slug}`} className="ml-auto font-medium text-blue-600 hover:underline">
            Open table →
          </Link>
        )}
      </p>
    </Card>
  );
}

/**
 * A proposal, in sentences.
 *
 * The arguments are ids and period indices; `lib/agents/artifacts.ts` resolves them against
 * the model before the card is stored, so this reads "Set New Accounts · Jul 2026 to 2"
 * rather than a JSON blob. The blob is still one disclosure away for anyone who wants to
 * check it — an approval screen must never *hide* what it is asking about.
 */
function Proposal({ draft }: { draft: ProposalDraft }) {
  return (
    <Card
      icon={ChartColumn}
      title={draft.label}
      subtitle={`${draft.commands.length} change${draft.commands.length === 1 ? "" : "s"} to the plan`}
      status={draft.status === "read" ? undefined : draft.status}
    >
      <ol className="divide-y divide-line">
        {draft.lines.map((line, index) => (
          <li key={index} className="flex gap-2 px-3.5 py-2 text-[12px] text-ink-2">
            <span className="shrink-0 text-ink-faint tabular-nums">{index + 1}</span>
            <span>{line}</span>
          </li>
        ))}
      </ol>
      <Raw value={draft.commands} />
    </Card>
  );
}

function Tile({ draft }: { draft: TileDraft }) {
  return (
    <Card
      icon={ChartColumn}
      title={draft.title}
      subtitle={`${draft.summary} · board ${draft.boardSlug}`}
      status={draft.status === "read" ? undefined : draft.status}
    >
      <Raw value={draft.spec} />
    </Card>
  );
}

/* ── Small shared pieces ──────────────────────────────────────────────────*/

function Th({ name, type }: { name: string; type: string }) {
  const Icon = TYPE_ICON[type] ?? CaseSensitive;
  return (
    <th
      scope="col"
      className="min-w-[140px] border-r border-b border-line bg-muted px-3 py-2 text-left font-medium text-ink-muted last:border-r-0"
    >
      <span className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{name}</span>
      </span>
    </th>
  );
}

function Raw({ value }: { value: unknown }) {
  return (
    <details className="border-t border-line">
      <summary className="cursor-pointer px-3.5 py-2 text-[11px] text-ink-faint select-none hover:text-ink-2">
        Exactly what was asked for
      </summary>
      <pre className="max-h-[300px] overflow-auto border-t border-line bg-subtle px-3.5 py-2.5 font-mono text-[11px] leading-[1.65] text-ink-2">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
