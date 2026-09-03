"use client";

import Link from "next/link";

import { CalendarDays, CaseSensitive, ChartColumn, DollarSign, FileText, Hash, ListFilter } from "lucide-react";

import { cn } from "@/lib/cn";
import type { Artifact, ArtifactStatus } from "@/lib/agents/artifacts";

/**
 * The canvas (`docs/agents-plan.md` A5) — the work, on the left, while the chat runs on the
 * right.
 *
 * A table the agent is designing is rendered **as a table**, with its real columns and their
 * real types, before anyone has approved it. That is the whole idea: you approve by looking
 * at the thing, not by reading a sentence about it. An empty canvas is honest too — a run
 * that only read and answered built nothing, and should not pretend otherwise.
 */

const TYPE_ICON: Record<string, typeof Hash> = {
  TEXT: CaseSensitive,
  NUMBER: Hash,
  CURRENCY: DollarSign,
  DATE: CalendarDays,
  SELECT: ListFilter,
};

const STATUS_LABEL: Record<ArtifactStatus, string> = {
  proposed: "awaiting approval",
  created: "created",
  declined: "declined",
  // Approved by a person, then refused by the tool — grounding caught something. Distinct
  // from "declined" on purpose: one is a human's decision, the other is a rejected write,
  // and collapsing them would blame the wrong party.
  failed: "not accepted",
};

const STATUS_TONE: Record<ArtifactStatus, string> = {
  proposed: "bg-chip-amber text-ink",
  created: "bg-ok-bg text-ok-fg",
  declined: "bg-neg-bg text-neg-fg",
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
  if (artifacts.length === 0 && files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-[13px] font-medium text-ink">Nothing built yet</p>
          <p className="mt-1.5 text-[12px] leading-[1.65] text-ink-muted">
            {activity
              ? `${activity}. Anything the agent designs — a table, a proposal, a board tile — appears here before it is approved.`
              : "This run read and answered without building anything. Tables, proposals and board tiles show up here as they are designed."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      {artifacts.map((artifact, index) => (
        <ArtifactCard key={index} artifact={artifact} />
      ))}

      {files.map(([name, body]) => (
        <section key={name} className="overflow-hidden rounded-card border border-line bg-surface">
          <h3 className="flex items-center gap-1.5 border-b border-line px-3.5 py-2.5 text-[12px] text-ink-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
            <span className="font-mono">{name}</span>
          </h3>
          <pre className="max-h-[380px] overflow-auto px-3.5 py-3 text-[12px] leading-[1.75] whitespace-pre-wrap text-ink-2">
            {body}
          </pre>
        </section>
      ))}
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-card border bg-surface",
        artifact.status === "proposed" ? "border-blue-200" : "border-line",
      )}
    >
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">
            {artifact.kind === "table"
              ? artifact.name
              : artifact.kind === "proposal"
                ? artifact.label
                : `Tile on ${artifact.boardSlug}`}
          </span>
          {artifact.kind === "table" && artifact.description && (
            <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
              {artifact.description}
            </span>
          )}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-chip px-1.5 py-[3px] text-[10px] font-semibold",
            STATUS_TONE[artifact.status],
          )}
        >
          {STATUS_LABEL[artifact.status]}
        </span>
      </header>

      {artifact.kind === "table" && (
        /* Rendered as the grid it will become, so approving it is looking at the thing. */
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[12px]">
            <thead>
              <tr>
                {artifact.fields.map((field) => {
                  const Icon = TYPE_ICON[field.type] ?? CaseSensitive;
                  return (
                    <th
                      key={field.name}
                      scope="col"
                      className="min-w-[140px] border-r border-b border-line bg-muted px-3 py-2 text-left font-medium text-ink-muted last:border-r-0"
                    >
                      <span className="flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
                        <span className="truncate">{field.name}</span>
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                {artifact.fields.map((field) => (
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
          <p className="flex items-center gap-2 px-3.5 py-2 text-[11px] text-ink-faint">
            <span>{artifact.fields.length} columns · no rows yet</span>
            {artifact.status === "created" && artifact.slug && (
              <Link
                href={`/databases/${artifact.slug}`}
                className="ml-auto font-medium text-blue-600 hover:underline"
              >
                Open table →
              </Link>
            )}
          </p>
        </div>
      )}

      {artifact.kind === "proposal" && (
        <div className="px-3.5 py-3">
          <p className="mb-1.5 text-[11px] text-ink-faint">
            {artifact.commands.length} command{artifact.commands.length === 1 ? "" : "s"}
          </p>
          <pre className="max-h-[300px] overflow-auto rounded-control border border-line bg-subtle px-2.5 py-2 font-mono text-[11px] leading-[1.65] text-ink-2">
            {JSON.stringify(artifact.commands, null, 2)}
          </pre>
        </div>
      )}

      {artifact.kind === "tile" && (
        <div className="px-3.5 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <ChartColumn className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            Board tile
          </p>
          <pre className="max-h-[300px] overflow-auto rounded-control border border-line bg-subtle px-2.5 py-2 font-mono text-[11px] leading-[1.65] text-ink-2">
            {JSON.stringify(artifact.spec, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}
