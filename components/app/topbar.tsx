import { History, MessageSquare, Settings, Star, Table2 } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * The 52px breadcrumb bar from `designs/modelling-1.jpg`: where you are on the
 * left, what you can do to this object on the right.
 *
 * The right cluster is deliberately quiet — ghost icon buttons, no fills. In
 * this system the loudest thing on a product screen is the numbers, and a row
 * of chrome competing with them is the fastest way to make a finance tool feel
 * like a website.
 */
export function Topbar({
  workspace,
  object,
  meta,
  history,
}: {
  workspace: string;
  object: string;
  /** e.g. "Edited 2d ago" — provenance, not an action. */
  meta?: string;
  /**
   * Replaces the inert History button when a surface can actually show history.
   * A slot rather than a `slug` prop: this bar is a server component and knows
   * nothing about models, and the panel needs to be a client one.
   */
  history?: React.ReactNode;
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
        <Table2 className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        <span className="truncate text-[14px] text-ink-2">{workspace}</span>
        <span className="text-ink-faint">/</span>
        <span
          aria-hidden
          className="grid h-5 w-5 shrink-0 place-items-center rounded-chip bg-chip-sky text-[10px] font-semibold text-ink"
        >
          {object.slice(0, 1)}
        </span>
        <span aria-current="page" className="truncate text-[14px] font-medium text-ink">
          {object}
        </span>
      </nav>

      <div className="ml-auto flex items-center gap-1">
        {meta && <span className="mr-1 hidden text-[12px] text-ink-faint md:block">{meta}</span>}
        <button
          type="button"
          className="rounded-button px-2.5 py-1.5 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-hover"
        >
          Share
        </button>
        {history}
        {(
          [
            ...(history ? [] : ([[History, "Version history"]] as const)),
            [MessageSquare, "Comments"],
            [Star, "Favourite"],
            [Settings, "Model settings"],
          ] as const
        ).map(([Icon, label]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-control",
              "text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ))}
      </div>
    </header>
  );
}
