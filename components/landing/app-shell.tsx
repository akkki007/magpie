import {
  LayoutGrid,
  Database,
  BookOpen,
  Table2,
  ChartColumn,
  Plus,
} from "lucide-react";
import { Mark, Orb } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

const RAIL = [Plus, Table2, ChartColumn, Database, BookOpen, LayoutGrid];

/**
 * The product frame: 48px icon rail, a floating white canvas, an optional AI panel.
 * Static — this is a marketing surface, not the app.
 */
export function AppShell({
  children,
  panel,
  className,
}: {
  children: React.ReactNode;
  panel?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-panel border border-line bg-app shadow-e3",
        className,
      )}
    >
      {/* Icon rail */}
      <div className="hidden w-[48px] shrink-0 flex-col items-center gap-1 py-3 sm:flex">
        <Mark className="mb-3 h-5 w-5" />
        {RAIL.map((Icon, i) => (
          <span
            key={i}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-control",
              i === 1 && "bg-surface shadow-e1",
            )}
          >
            <Icon
              className={cn("h-4 w-4", i === 1 ? "text-ink" : "text-ink-faint")}
              strokeWidth={1.75}
            />
          </span>
        ))}
        <Orb className="mt-auto h-6 w-6" />
      </div>

      {/* Canvas */}
      <div className="relative m-0 flex min-w-0 flex-1 sm:my-2 sm:mr-2">
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-card border border-line bg-surface">
          <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
          {panel ? (
            <div className="hidden w-[290px] shrink-0 border-l border-line lg:block xl:w-[340px]">
              {panel}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
