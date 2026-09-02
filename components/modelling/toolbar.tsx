"use client";

import { useState } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  GitBranch,
  Pencil,
  Plus,
  Redo2,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { Menu, MenuChoice, MenuItem, MenuLabel, MenuSeparator } from "@/components/modelling/menu";
import { cn } from "@/lib/cn";
import { AGGREGATION_LABEL } from "@/lib/model/grain";
import { scenarioTree } from "@/lib/model/scenario";
import type { Grain, Scenario } from "@/lib/model/types";

export type ViewOptions = {
  grain: Grain;
  trend: boolean;
  formula: boolean;
  /** The scenario to show a delta against, or `null` for no comparison (M4.3). */
  compare: string | null;
  compact: boolean;
};

const GRAINS: { value: Grain; label: string; hint: string }[] = [
  { value: "MONTH", label: "Month", hint: "Base grain" },
  { value: "QUARTER", label: "Quarter", hint: "Rolled up" },
  { value: "YEAR", label: "Year", hint: "Rolled up" },
];

export function Toolbar({
  query,
  onQueryChange,
  scenarios,
  scenarioId,
  onScenarioChange,
  onScenarioCreate,
  onScenarioRename,
  onScenarioDelete,
  view,
  onViewChange,
  allCollapsed,
  onToggleCollapseAll,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  scenarios: Scenario[];
  scenarioId: string;
  onScenarioChange: (id: string) => void;
  /** `parentId` is what the new scenario branches from — the base, or the current one. */
  onScenarioCreate: (parentId: string | null) => void;
  onScenarioRename: (scenarioId: string, name: string) => void;
  onScenarioDelete: (scenarioId: string) => void;
  view: ViewOptions;
  onViewChange: (next: ViewOptions) => void;
  allCollapsed: boolean;
  onToggleCollapseAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const scenario = scenarios.find((s) => s.id === scenarioId);
  const isBase = scenario?.isBase ?? true;
  const baseId = scenarios.find((s) => s.isBase)?.id;

  // Renaming happens inside the open menu rather than in a dialog: it is a two-word edit,
  // and the list it belongs to is the thing you are looking at while you do it.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
      <button
        type="button"
        onClick={onToggleCollapseAll}
        aria-label={allCollapsed ? "Expand all groups" : "Collapse all groups"}
        title={allCollapsed ? "Expand all groups" : "Collapse all groups"}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
      >
        {allCollapsed ? (
          <ChevronsUpDown className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <ChevronsDownUp className="h-4 w-4" strokeWidth={1.75} />
        )}
      </button>

      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onQueryChange("");
          }}
          placeholder="Search"
          aria-label="Search variables"
          className="h-8 w-full rounded-control border border-line bg-surface pr-8 pl-8 text-[13px] text-ink transition-colors duration-150 placeholder:text-ink-faint hover:border-line-strong focus:border-blue-600 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-1.5 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-ink-faint transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center">
        <IconButton label="Undo" onClick={onUndo} disabled={!canUndo} hint="⌘Z">
          <Undo2 className="h-4 w-4" strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Redo" onClick={onRedo} disabled={!canRedo} hint="⇧⌘Z">
          <Redo2 className="h-4 w-4" strokeWidth={1.75} />
        </IconButton>
      </div>

      <Menu
        align="end"
        width={264}
        ariaLabel="Scenario"
        triggerClassName={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-button px-2.5 text-[13px] font-medium",
          "transition-colors duration-150 hover:bg-hover",
          isBase ? "text-ink-2" : "text-violet-700",
        )}
        trigger={() => (
          <>
            <GitBranch
              className={cn("h-4 w-4", isBase ? "text-ink-muted" : "text-violet-500")}
              strokeWidth={1.75}
              aria-hidden
            />
            {isBase ? "Scenario" : scenario?.name}
          </>
        )}
      >
        {({ close }) => (
          <>
            <MenuLabel>Scenario</MenuLabel>
            {scenarioTree(scenarios).map(({ scenario: option, depth }) => (
              <MenuChoice
                key={option.id}
                selected={option.id === scenarioId}
                hint={
                  option.isBase
                    ? "Base"
                    : option.overrides.length
                      ? `${option.overrides.length} override${option.overrides.length > 1 ? "s" : ""}`
                      : "No changes"
                }
                onSelect={() => {
                  onScenarioChange(option.id);
                  close();
                }}
              >
                {/* Indent, not a tree line: the depth is almost always one, and drawing
                    connectors for that would be more chrome than information. */}
                <span style={{ paddingLeft: depth * 12 }}>{option.name}</span>
              </MenuChoice>
            ))}

            <MenuSeparator />

            {renaming ? (
              <form
                className="flex items-center gap-1 px-1 py-0.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = draft.trim();
                  if (next && next !== scenario?.name) onScenarioRename(renaming, next);
                  setRenaming(null);
                }}
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                  aria-label="Scenario name"
                  className="h-7 w-full rounded-button border border-blue-400 bg-canvas px-1.5 text-[13px] text-ink outline-none"
                />
              </form>
            ) : (
              <>
                <MenuItem
                  icon={Plus}
                  onSelect={() => {
                    onScenarioCreate(baseId ?? null);
                    close();
                  }}
                >
                  New scenario
                </MenuItem>
                {scenario && !scenario.isBase && (
                  <>
                    <MenuItem
                      icon={GitBranch}
                      onSelect={() => {
                        onScenarioCreate(scenario.id);
                        close();
                      }}
                    >
                      {`Branch from ${scenario.name}`}
                    </MenuItem>
                    <MenuItem
                      icon={Pencil}
                      onSelect={() => {
                        setDraft(scenario.name);
                        setRenaming(scenario.id);
                      }}
                    >
                      Rename
                    </MenuItem>
                    <MenuItem
                      icon={Trash2}
                      danger
                      onSelect={() => {
                        onScenarioDelete(scenario.id);
                        close();
                      }}
                    >
                      Delete
                    </MenuItem>
                  </>
                )}
              </>
            )}

            <MenuSeparator />
            <p className="px-2 pt-0.5 pb-1.5 text-[11px] leading-[15px] text-ink-faint">
              {isBase
                ? "Scenarios are overlays: only the rows they override differ from the base case."
                : "Typing here changes this scenario only. Held cells are marked."}
            </p>
          </>
        )}
      </Menu>

      <Menu
        align="end"
        width={228}
        ariaLabel="View"
        triggerClassName="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-button px-2.5 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-hover"
        trigger={() => (
          <>
            <SlidersHorizontal className="h-4 w-4 text-ink-muted" strokeWidth={1.75} aria-hidden />
            View
          </>
        )}
      >
        {({ close }) => (
          <>
            <MenuLabel>Compare with</MenuLabel>
            <MenuChoice
              selected={view.compare === null}
              onSelect={() => {
                onViewChange({ ...view, compare: null });
                close();
              }}
            >
              Nothing
            </MenuChoice>
            {scenarios
              // Comparing a scenario with itself is a column of dashes.
              .filter((option) => option.id !== scenarioId)
              .map((option) => (
                <MenuChoice
                  key={option.id}
                  selected={view.compare === option.id}
                  onSelect={() => {
                    onViewChange({ ...view, compare: option.id });
                    close();
                  }}
                >
                  {option.name}
                </MenuChoice>
              ))}
            <MenuSeparator />

            <MenuLabel>Time grain</MenuLabel>
            {GRAINS.map((grain) => (
              <MenuChoice
                key={grain.value}
                selected={view.grain === grain.value}
                hint={grain.hint}
                onSelect={() => {
                  onViewChange({ ...view, grain: grain.value });
                  close();
                }}
              >
                {grain.label}
              </MenuChoice>
            ))}

            <MenuSeparator />
            <MenuLabel>Columns</MenuLabel>
            <MenuChoice
              selected={view.trend}
              onSelect={() => onViewChange({ ...view, trend: !view.trend })}
            >
              Trend
            </MenuChoice>
            <MenuChoice
              selected={view.formula}
              onSelect={() => onViewChange({ ...view, formula: !view.formula })}
            >
              Formula
            </MenuChoice>

            <MenuSeparator />
            <MenuChoice
              selected={view.compact}
              onSelect={() => onViewChange({ ...view, compact: !view.compact })}
            >
              Compact rows
            </MenuChoice>

            <MenuSeparator />
            <p className="px-2 pt-0.5 pb-1.5 text-[11px] leading-[15px] text-ink-faint">
              {view.grain === "MONTH"
                ? "Monthly is the stored grain — cells are editable here."
                : `Rolled up from months. ${AGGREGATION_LABEL.FIRST.toLowerCase()} for balances, sums for flows.`}
            </p>
          </>
        )}
      </Menu>
    </div>
  );
}

function IconButton({
  label,
  hint,
  onClick,
  disabled,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-control transition-colors duration-150",
        disabled
          ? "cursor-not-allowed text-ink-faint/50"
          : "text-ink-muted hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
