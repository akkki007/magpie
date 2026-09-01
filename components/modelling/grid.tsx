"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  EllipsisVertical,
  Layers,
  Pencil,
  Plus,
  Sigma,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { FormulaEditor } from "@/components/modelling/formula-editor";
import { Menu, MenuItem, MenuSeparator } from "@/components/modelling/menu";
import type { GridRow } from "@/components/modelling/rows";
import type { ViewOptions } from "@/components/modelling/toolbar";
import { cn } from "@/lib/cn";
import type { Evaluation } from "@/lib/model/engine";
import { dependenciesOf, printFormula } from "@/lib/model/formula";
import { FORMAT_GLYPH, formatValue } from "@/lib/model/format";
import { rollup, type Bucket } from "@/lib/model/grain";
import type { ChipTone, FormulaNode, Model } from "@/lib/model/types";
import { TOTAL } from "@/lib/model/types";

/**
 * The grid from `designs/modelling-1.jpg`.
 *
 * Three things it does that a static table does not, and each is a deliberate
 * cost:
 *
 * - **The first column is sticky and the header is sticky.** A 24-period model
 *   scrolls in both axes, and a number you cannot name or date is worthless.
 * - **Every number is computed**, not stored for display. The cells you can
 *   type into are the INPUT rows; everything else is the engine's output and
 *   moves the moment an input does.
 * - **The formula pill is rendered from the AST** (`docs/modelling-plan.md` §1.1),
 *   so renaming a variable rewrites sixty pills and breaks nothing.
 *
 * Not virtualised yet. §8 is right that it will need to be, and the honest
 * trigger is when a model outgrows a screenful of rows — retrofitting it into
 * *this* markup is a contained job because every row already comes from
 * `flattenRows`, which is exactly the list a virtualiser needs.
 */

export type Selection = { rowKey: string; column: number };
export type Editing = { rowKey: string; column: number; draft: string };

export type GridApi = {
  onSelect: (selection: Selection) => void;
  onStartEdit: (rowKey: string, column: number, draft?: string) => void;
  onDraftChange: (draft: string) => void;
  onCommitEdit: (move: "down" | "right" | "none") => void;
  onCancelEdit: () => void;
  onToggleGroup: (groupId: string) => void;
  onToggleVariable: (variableId: string) => void;
  onTrace: (variableId: string | null) => void;
  onFormulaStart: (variableId: string) => void;
  onFormulaCancel: () => void;
  onFormulaCommit: (variableId: string, formula: FormulaNode | null) => void;
  onRenameStart: (variableId: string) => void;
  onRenameCommit: (variableId: string, name: string) => void;
  onRenameCancel: () => void;
  onDuplicate: (variableId: string) => void;
  onDelete: (variableId: string) => void;
  onAddStart: (groupId: string | null) => void;
  onAddCommit: (groupId: string, name: string) => void;
};

const CHIP: Record<ChipTone, string> = {
  amber: "bg-chip-amber",
  rose: "bg-chip-rose",
  graphite: "bg-chip-graphite",
  sky: "bg-chip-sky",
  blue: "bg-chip-blue",
};

/**
 * The grid's geometry, exported because virtualisation made it load-bearing outside this file.
 *
 * Scrolling the selection into view used to be `querySelector('[data-selected]')`, which works
 * only while every cell is in the DOM. It no longer is, so the caller computes the position
 * from these instead — and both axes being a fixed size is exactly what makes that possible.
 */
export const GRID_GEOMETRY = {
  headerHeight: 32,
  rowHeight: (compact: boolean) => (compact ? 26 : 30),
  nameWidth: 292,
  trendWidth: 116,
  formulaWidth: 246,
  periodWidth: 108,
} as const;

const { nameWidth: NAME_WIDTH, trendWidth: TREND_WIDTH, formulaWidth: FORMULA_WIDTH, periodWidth: PERIOD_WIDTH } =
  GRID_GEOMETRY;

export function Grid({
  model,
  rows,
  buckets,
  evaluation,
  view,
  selection,
  editing,
  trace,
  renaming,
  adding,
  formulaEditing,
  api,
  viewport,
}: {
  model: Model;
  rows: GridRow[];
  buckets: Bucket[];
  /** The scrolling element the grid lives in — the window virtualisation reads. */
  viewport: React.RefObject<HTMLElement | null>;
  evaluation: Evaluation;
  view: ViewOptions;
  selection: Selection | null;
  editing: Editing | null;
  trace: string | null;
  /** The variable whose formula panel is open — at most one at a time. */
  formulaEditing: string | null;
  renaming: string | null;
  adding: string | null;
  api: GridApi;
}) {
  const nameOf = useMemo(() => {
    const names = new Map(model.variables.map((v) => [v.id, v.name]));
    return (id: string) => names.get(id) ?? "Unknown";
  }, [model.variables]);

  /** Rolled-up values per row. Recomputed when the model, grain or rows move. */
  const valuesByRow = useMemo(() => {
    const out = new Map<string, number[]>();
    for (const row of rows) {
      if (row.kind === "variable") {
        out.set(row.key, rollup(evaluation.series(row.variable.id), buckets, row.variable.aggregation));
      } else if (row.kind === "member") {
        out.set(
          row.key,
          rollup(
            evaluation.series(row.variable.id, row.member.key),
            buckets,
            row.variable.aggregation,
          ),
        );
      }
    }
    return out;
  }, [rows, buckets, evaluation]);

  /** The rows a trace lights up: the traced variable's direct precedents. */
  const tracedIds = useMemo(() => {
    if (!trace) return null;
    const target = model.variables.find((v) => v.id === trace);
    return new Set(dependenciesOf(target?.formula));
  }, [trace, model.variables]);

  const rowHeight = GRID_GEOMETRY.rowHeight(view.compact);
  const metaColumns = 1 + (view.trend ? 1 : 0) + (view.formula ? 1 : 0);

  /**
   * Virtualisation, both axes (`docs/modelling-plan.md` M1.3).
   *
   * Done now, at 22 rows and 24 columns, because nothing is slow yet — which is precisely the
   * window in which it is cheap. The plan's warning is the reason: *retrofitting it into a
   * working grid is a rewrite*, and a grid that has grown selection, editing, tracing and
   * sticky columns around an assumption that every cell exists is a much worse place to start.
   *
   * Hand-rolled rather than a library, for one reason that matters here: both axes are a
   * **fixed size** — `rowHeight` is 26 or 30, `PERIOD_WIDTH` is 108 — so the first and last
   * visible index are arithmetic, not measurement. A virtualiser that measures elements would
   * be solving a problem this grid does not have, and would fight the sticky header and first
   * column while doing it.
   *
   * The skipped rows and columns become spacers of exactly the right size, so scroll position,
   * scrollbar length and the sticky offsets are all unchanged. Nothing outside this block
   * knows the grid is windowed.
   */
  /**
   * The pill the open formula panel hangs off. A callback ref rather than a
   * `ref` prop because only the one row being edited assigns it, and the panel
   * is portalled out of the table — it needs a live rect, not a DOM parent.
   */
  const formulaAnchorRef = useRef<HTMLElement | null>(null);
  const setFormulaAnchor = (element: HTMLElement | null) => {
    formulaAnchorRef.current = element;
  };

  const [port, setPort] = useState({ top: 0, left: 0, height: 900, width: 1400 });

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;

    // Read straight from the element rather than storing scroll in React state per event:
    // this runs on every scroll frame, and a setState round trip per pixel is the one way to
    // make a virtualised grid slower than the grid it replaced.
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setPort({
          top: element.scrollTop,
          left: element.scrollLeft,
          height: element.clientHeight,
          width: element.clientWidth,
        }),
      );
    };

    read();
    element.addEventListener("scroll", read, { passive: true });
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", read);
      observer.disconnect();
    };
  }, [viewport]);

  /** Rows above and below the fold that are rendered anyway, so scrolling never shows a gap. */
  const OVERSCAN_ROWS = 8;
  const OVERSCAN_COLUMNS = 3;

  const firstRow = Math.max(0, Math.floor(port.top / rowHeight) - OVERSCAN_ROWS);
  const lastRow = Math.min(
    rows.length,
    Math.ceil((port.top + port.height) / rowHeight) + OVERSCAN_ROWS,
  );
  const visibleRows = rows.slice(firstRow, lastRow);
  const padTop = firstRow * rowHeight;
  const padBottom = (rows.length - lastRow) * rowHeight;

  const leadWidth =
    NAME_WIDTH + (view.trend ? TREND_WIDTH : 0) + (view.formula ? FORMULA_WIDTH : 0);
  const firstColumn = Math.max(
    0,
    Math.floor((port.left - leadWidth) / PERIOD_WIDTH) - OVERSCAN_COLUMNS,
  );
  const lastColumn = Math.min(
    buckets.length,
    Math.ceil((port.left + port.width - leadWidth) / PERIOD_WIDTH) + OVERSCAN_COLUMNS,
  );
  const visibleBuckets = buckets.slice(firstColumn, lastColumn);
  const padLeft = firstColumn * PERIOD_WIDTH;
  const padRight = (buckets.length - lastColumn) * PERIOD_WIDTH;

  /** Every `<td>` a full-width row has to span: the meta columns, the spacers, the periods. */
  const spannedColumns =
    metaColumns - 1 + (padLeft > 0 ? 1 : 0) + visibleBuckets.length + (padRight > 0 ? 1 : 0) + 1;

  return (
    <table className="border-separate border-spacing-0 text-[12px] tabular-nums">
      <colgroup>
        <col style={{ width: NAME_WIDTH }} />
        {view.trend && <col style={{ width: TREND_WIDTH }} />}
        {view.formula && <col style={{ width: FORMULA_WIDTH }} />}
        {padLeft > 0 && <col style={{ width: padLeft }} />}
        {visibleBuckets.map((bucket) => (
          <col key={bucket.key} style={{ width: PERIOD_WIDTH }} />
        ))}
        {padRight > 0 && <col style={{ width: padRight }} />}
        {/* Spacer: absorbs the leftover width so the period columns keep a
            fixed size instead of stretching on a wide screen. */}
        <col />
      </colgroup>

      <thead>
        <tr>
          <th
            scope="col"
            className="sticky top-0 left-0 z-40 h-8 border-r border-b border-line bg-surface px-3 text-left font-medium text-ink-muted"
          >
            <span className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} aria-hidden />
              Variable Name
            </span>
          </th>
          {view.trend && <HeadCell>Trend</HeadCell>}
          {view.formula && <HeadCell>Formula</HeadCell>}
          {padLeft > 0 && <HeadCell divider={false}>{null}</HeadCell>}
          {visibleBuckets.map((bucket) => (
            <HeadCell key={bucket.key} align="right" divider={false}>
              {bucket.label}
            </HeadCell>
          ))}
          {padRight > 0 && <HeadCell divider={false}>{null}</HeadCell>}
          <HeadCell divider={false}>{null}</HeadCell>
        </tr>
      </thead>

      <tbody>
        {padTop > 0 && (
          <tr aria-hidden style={{ height: padTop }}>
            <td colSpan={spannedColumns + 1} />
          </tr>
        )}
        {visibleRows.map((row) => {
          if (row.kind === "group") {
            return (
              <tr key={row.key} className="group">
                <th
                  scope="row"
                  style={{ height: rowHeight }}
                  className="sticky left-0 z-20 border-r border-b border-line bg-surface px-2 text-left font-normal"
                >
                  <span className="flex items-center gap-1.5">
                    <Disclosure
                      open={!row.collapsed}
                      label={`${row.collapsed ? "Expand" : "Collapse"} ${row.group.name}`}
                      onClick={() => api.onToggleGroup(row.group.id)}
                    />
                    <span
                      className={cn(
                        "rounded-chip px-1.5 py-0.5 text-[11px] font-semibold text-ink",
                        CHIP[row.group.chip],
                      )}
                    >
                      {row.group.name}
                    </span>
                    {row.collapsed && (
                      <span className="text-[11px] text-ink-faint">{row.count}</span>
                    )}
                  </span>
                </th>
                <td
                  colSpan={spannedColumns}
                  className="border-b border-line bg-surface"
                />
              </tr>
            );
          }

          if (row.kind === "add") {
            const isAdding = adding === row.groupId;
            return (
              <tr key={row.key} className="group">
                <th
                  scope="row"
                  style={{ height: rowHeight }}
                  className="sticky left-0 z-20 border-r border-b border-line bg-surface px-2 text-left font-normal"
                >
                  {isAdding ? (
                    <InlineInput
                      placeholder="Variable name"
                      onCommit={(value) => api.onAddCommit(row.groupId, value)}
                      onCancel={() => api.onAddStart(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => api.onAddStart(row.groupId)}
                      className="flex w-full items-center gap-1.5 rounded-button px-1 py-1 text-[12px] text-ink-faint transition-colors duration-150 hover:text-ink-muted"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                      New variable
                    </button>
                  )}
                </th>
                <td
                  colSpan={spannedColumns}
                  className="border-b border-line bg-surface"
                />
              </tr>
            );
          }

          const variable = row.variable;
          const isMember = row.kind === "member";
          const error = evaluation.errors[variable.id];
          const values = valuesByRow.get(row.key) ?? [];
          const monthly = evaluation.series(variable.id, isMember ? row.member.key : TOTAL);
          const editable = variable.kind === "INPUT" && view.grain === "MONTH";
          const traced = tracedIds?.has(variable.id) ?? false;
          const isTraceTarget = trace === variable.id;
          const isFormulaEditing = formulaEditing === variable.id;

          return (
            <tr key={row.key} className="group">
              {/* ── Name ─────────────────────────────────────────────────── */}
              <th
                scope="row"
                style={{ height: rowHeight }}
                title={variable.note ?? undefined}
                className={cn(
                  "sticky left-0 z-20 border-r border-b border-line px-2 text-left font-normal",
                  "transition-colors duration-150",
                  // One background wins, chosen here. Stacking `bg-surface` and
                  // `bg-blue-50` in the class string would leave the outcome to
                  // Tailwind's stylesheet order rather than to this condition.
                  traced || isTraceTarget
                    ? "bg-blue-50 group-hover:bg-blue-50"
                    : "bg-surface group-hover:bg-hover",
                )}
              >
                <span
                  className="flex items-center gap-1.5"
                  style={{ paddingLeft: isMember ? 18 : 0 }}
                >
                  {row.kind === "variable" && row.expandable ? (
                    <Disclosure
                      open={row.expanded}
                      label={`${row.expanded ? "Collapse" : "Expand"} ${variable.name}`}
                      onClick={() => api.onToggleVariable(variable.id)}
                    />
                  ) : (
                    <span className="h-4 w-4 shrink-0" aria-hidden />
                  )}

                  <span
                    aria-hidden
                    className={cn(
                      "w-3 shrink-0 text-center text-[11px]",
                      isMember ? "text-ink-faint" : "text-ink-muted",
                    )}
                  >
                    {isMember ? "·" : FORMAT_GLYPH[variable.format]}
                  </span>

                  {renaming === variable.id && !isMember ? (
                    <InlineInput
                      defaultValue={variable.name}
                      onCommit={(value) => api.onRenameCommit(variable.id, value)}
                      onCancel={api.onRenameCancel}
                    />
                  ) : (
                    <span
                      className={cn(
                        "truncate",
                        isMember ? "text-ink-2" : "text-ink",
                        error && "text-neg-fg",
                      )}
                      onDoubleClick={() => !isMember && api.onRenameStart(variable.id)}
                    >
                      {isMember ? row.member.name : variable.name}
                    </span>
                  )}

                  {error && (
                    <TriangleAlert
                      className="h-3.5 w-3.5 shrink-0 text-neg-fg"
                      strokeWidth={1.75}
                      aria-label={error}
                    />
                  )}

                  {!isMember && (
                    <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
                      {variable.formula && (
                        <RowAction
                          label={isTraceTarget ? "Clear trace" : "Trace precedents"}
                          active={isTraceTarget}
                          onClick={() => api.onTrace(isTraceTarget ? null : variable.id)}
                        >
                          <Sigma className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </RowAction>
                      )}
                      <RowAction
                        label="Duplicate variable"
                        onClick={() => api.onDuplicate(variable.id)}
                      >
                        <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </RowAction>
                      <Menu
                        align="end"
                        width={210}
                        ariaLabel={`Actions for ${variable.name}`}
                        triggerClassName="grid h-6 w-6 place-items-center rounded-button text-ink-faint transition-colors duration-150 hover:bg-line hover:text-ink"
                        trigger={() => (
                          <EllipsisVertical className="h-3.5 w-3.5" strokeWidth={1.75} />
                        )}
                      >
                        {({ close }) => (
                          <>
                            <MenuItem
                              icon={Pencil}
                              onSelect={() => {
                                api.onRenameStart(variable.id);
                                close();
                              }}
                            >
                              Rename
                            </MenuItem>
                            <MenuItem
                              icon={Copy}
                              onSelect={() => {
                                api.onDuplicate(variable.id);
                                close();
                              }}
                            >
                              Duplicate
                            </MenuItem>
                            {variable.formula && (
                              <MenuItem
                                icon={Sigma}
                                onSelect={() => {
                                  api.onTrace(isTraceTarget ? null : variable.id);
                                  close();
                                }}
                              >
                                {isTraceTarget ? "Clear trace" : "Trace precedents"}
                              </MenuItem>
                            )}
                            {variable.dimensionId && (
                              <MenuItem
                                icon={Layers}
                                onSelect={() => {
                                  api.onToggleVariable(variable.id);
                                  close();
                                }}
                              >
                                Expand by plan
                              </MenuItem>
                            )}
                            <MenuSeparator />
                            <MenuItem
                              icon={Trash2}
                              danger
                              onSelect={() => {
                                api.onDelete(variable.id);
                                close();
                              }}
                            >
                              Delete
                            </MenuItem>
                          </>
                        )}
                      </Menu>
                    </span>
                  )}
                </span>
              </th>

              {/* ── Trend ────────────────────────────────────────────────── */}
              {view.trend && (
                <td className="border-r border-b border-line bg-surface px-3 transition-colors duration-150 group-hover:bg-hover">
                  <SeriesSpark values={monthly} />
                </td>
              )}

              {/* ── Formula ──────────────────────────────────────────────── */}
              {view.formula && (
                <td className="border-r border-b border-line bg-surface px-2 transition-colors duration-150 group-hover:bg-hover">
                  {variable.formula ? (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        // Clicking the pill edits it (M2.2). Trace kept its two
                        // other homes — the hover button on the row and the row
                        // menu — so nothing was traded away for this.
                        ref={isFormulaEditing ? setFormulaAnchor : undefined}
                        onClick={() => api.onFormulaStart(variable.id)}
                        title={`${printFormula(variable.formula, nameOf)} — click to edit`}
                        className={cn(
                          "formula-pill inline-flex max-w-[196px] items-center gap-1 px-1.5 py-0.5",
                          "transition-colors duration-150 hover:bg-violet-200",
                          (isTraceTarget || isFormulaEditing) && "bg-violet-200",
                        )}
                      >
                        <span className="shrink-0 text-ink-muted">
                          {FORMAT_GLYPH[variable.format]}
                        </span>
                        <span className="truncate">{printFormula(variable.formula, nameOf)}</span>
                      </button>
                      {variable.timeContext && (
                        <span className="shrink-0 rounded-chip bg-violet-50 px-1.5 py-0.5 text-[11px] text-ink-muted">
                          {variable.timeContext}
                        </span>
                      )}
                    </span>
                  ) : variable.kind === "INPUT" ? (
                    <button
                      type="button"
                      ref={isFormulaEditing ? setFormulaAnchor : undefined}
                      onClick={() => api.onFormulaStart(variable.id)}
                      className={cn(
                        "rounded-button px-1 py-0.5 text-[11px] text-ink-faint",
                        "transition-colors duration-150 hover:bg-violet-100 hover:text-ink-2",
                        isFormulaEditing && "bg-violet-100 text-ink-2",
                      )}
                      title="Replace these typed values with a formula"
                    >
                      Hardcoded
                    </button>
                  ) : (
                    <span className="text-[11px] text-ink-faint">Linked</span>
                  )}

                  {isFormulaEditing && (
                    <FormulaEditor
                      model={model}
                      variable={variable}
                      anchorRef={formulaAnchorRef}
                      onSave={(formula) => api.onFormulaCommit(variable.id, formula)}
                      onClose={api.onFormulaCancel}
                    />
                  )}
                </td>
              )}

              {/* ── Periods ──────────────────────────────────────────────── */}
              {padLeft > 0 && <td aria-hidden className="border-b border-line" />}
              {visibleBuckets.map((bucket, offset) => {
                // The global column index, not the position in the window. Selection,
                // editing and keyboard movement all address columns absolutely, and slicing
                // the array without re-adding the offset would silently point every one of
                // them at the wrong period the moment the grid scrolls.
                const column = firstColumn + offset;
                const isSelected =
                  selection?.rowKey === row.key && selection.column === column;
                const isEditing =
                  editing?.rowKey === row.key && editing.column === column;
                const value = values[column] ?? 0;

                return (
                  <td
                    key={bucket.key}
                    data-selected={isSelected || undefined}
                    onMouseDown={() => api.onSelect({ rowKey: row.key, column })}
                    onDoubleClick={() =>
                      editable && api.onStartEdit(row.key, column)
                    }
                    className={cn(
                      "border-b border-line px-3 text-right transition-colors duration-150",
                      editable ? "cursor-cell" : "cursor-default",
                      isSelected
                        ? "bg-surface shadow-[inset_0_0_0_1.5px_var(--color-blue-600)] group-hover:bg-surface"
                        : "bg-surface group-hover:bg-hover",
                    )}
                  >
                    {isEditing ? (
                      <CellInput
                        draft={editing.draft}
                        onDraftChange={api.onDraftChange}
                        onCommit={api.onCommitEdit}
                        onCancel={api.onCancelEdit}
                      />
                    ) : error ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      <span
                        className={cn(
                          value === 0 && "text-ink-faint",
                          value < 0 && "text-neg-fg",
                        )}
                      >
                        {formatValue(value, variable.format)}
                      </span>
                    )}
                  </td>
                );
              })}

              <td className="border-b border-line bg-surface transition-colors duration-150 group-hover:bg-hover" />
            </tr>
          );
        })}
        {padBottom > 0 && (
          <tr aria-hidden style={{ height: padBottom }}>
            <td colSpan={spannedColumns + 1} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function HeadCell({
  children,
  align = "left",
  divider = true,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  divider?: boolean;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 z-30 h-8 border-b border-line bg-surface px-3 font-medium text-ink-muted",
        divider && "border-r",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Disclosure({
  open,
  label,
  onClick,
}: {
  open: boolean;
  label: string;
  onClick: () => void;
}) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      onClick={onClick}
      className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] text-ink-faint transition-colors duration-150 hover:bg-line hover:text-ink"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  );
}

function RowAction({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid h-6 w-6 place-items-center rounded-button transition-colors duration-150",
        active ? "bg-violet-100 text-violet-700" : "text-ink-faint hover:bg-line hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * An editor commits on Enter/Tab *and* on blur — clicking away has to save,
 * the same as any spreadsheet. Both can fire for one edit: committing on Enter
 * moves focus, which fires blur on the still-mounted input. Without this latch
 * the second call writes the same value again and lands a second entry on the
 * undo stack, so the first ⌘Z looks like it did nothing.
 *
 * The latch lives in the editor because the editor is what unmounts: a fresh
 * edit gets a fresh ref, with nothing to reset.
 */
function useCommitOnce<T extends unknown[]>(commit: (...args: T) => void) {
  const done = useRef(false);
  return (...args: T) => {
    if (done.current) return;
    done.current = true;
    commit(...args);
  };
}

/** The cell editor. Committing moves the selection the way a spreadsheet does. */
function CellInput({
  draft,
  onDraftChange,
  onCommit,
  onCancel,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onCommit: (move: "down" | "right" | "none") => void;
  onCancel: () => void;
}) {
  const commit = useCommitOnce(onCommit);
  const cancel = useCommitOnce(onCancel);

  return (
    <input
      autoFocus
      value={draft}
      aria-label="Cell value"
      onChange={(event) => onDraftChange(event.target.value)}
      onBlur={() => commit("none")}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit("down");
        } else if (event.key === "Tab") {
          event.preventDefault();
          commit("right");
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      onFocus={(event) => event.currentTarget.select()}
      className="w-full bg-transparent text-right text-[12px] text-ink outline-none"
    />
  );
}

/** Rename and add-variable share one editor. */
function InlineInput({
  defaultValue = "",
  placeholder,
  onCommit,
  onCancel,
}: {
  defaultValue?: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const commit = useCommitOnce(onCommit);
  const cancel = useCommitOnce(onCancel);

  return (
    <input
      autoFocus
      defaultValue={defaultValue}
      placeholder={placeholder}
      aria-label={placeholder ?? "Variable name"}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      onBlur={(event) => {
        const value = event.currentTarget.value.trim();
        if (value && value !== defaultValue) commit(value);
        else cancel();
      }}
      onFocus={(event) => event.currentTarget.select()}
      className="min-w-0 flex-1 rounded-[4px] border border-blue-600 bg-surface px-1 py-0.5 text-[12px] text-ink outline-none"
    />
  );
}

/**
 * The trend column. Always drawn from the **monthly** series even when the
 * grid is showing quarters: the sparkline's job is the shape of the variable,
 * and eight quarterly points hide the seasonality that is the reason to look.
 */
function SeriesSpark({ values }: { values: number[] }) {
  const width = 72;
  const height = 20;
  const path = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - 2 - ((value - min) / span) * (height - 4);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      fill="none"
      className="overflow-visible"
    >
      <path
        d={path}
        stroke="var(--color-violet-400)"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
