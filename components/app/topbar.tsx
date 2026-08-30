import { LayoutPanelTop, Settings, Star } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * The 52px breadcrumb bar: where you are on the left, what you can do to this
 * object on the right. The crumb chip is a pastel label — organisational, never
 * semantic (docs/design-system.md §2).
 */
export function Topbar({
  workspace,
  workspaceInitial,
  object,
}: {
  workspace: string;
  workspaceInitial: string;
  object: string;
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="grid h-5 w-5 shrink-0 place-items-center rounded-chip bg-chip-amber text-[11px] font-semibold text-ink"
        >
          {workspaceInitial}
        </span>
        <span className="truncate text-[15px] font-medium text-ink">{workspace}</span>
        <span className="text-ink-faint">/</span>
        <LayoutPanelTop
          className="h-4 w-4 shrink-0 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="truncate text-[15px] font-medium text-ink">{object}</span>
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="rounded-button px-2.5 py-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        >
          Share
        </button>
        {[Star, Settings].map((Icon, i) => (
          <button
            key={i}
            type="button"
            aria-label={i === 0 ? "Favourite" : "Settings"}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-control",
              "text-ink-muted transition-colors hover:bg-hover hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ))}
      </div>
    </header>
  );
}
