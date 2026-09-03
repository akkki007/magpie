"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarDays, CaseSensitive, DollarSign, Hash, Plus, Search } from "lucide-react";

import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/cn";
import { formatCell, searchText } from "@/lib/data/format";
import type { FieldType, Table } from "@/lib/data/types";

/**
 * The database grid (`docs/database-plan.md` D2) — `designs/database/db-1.jpg`.
 *
 * Read-only for now, on purpose: D4 (a column becoming a `LINKED` variable) is the product,
 * and D3's editing is the task that gets cut if the deadline bites. Rendering is therefore
 * built so editing drops in per-cell later without the surrounding structure moving.
 *
 * Not virtualised. The model grid earned virtualisation (M1.3) because a model is dense and
 * small and every column is on screen at once; a database is the opposite shape, and 200
 * rows a page costs nothing while a virtualiser costs a day. The marketing line about
 * millions of rows is a claim about Postgres, not about the DOM.
 */

const PAGE_SIZE = 200;

/** Matches the column-type glyphs in the reference header row. */
const TYPE_ICON: Record<FieldType, typeof CaseSensitive> = {
  TEXT: CaseSensitive,
  NUMBER: Hash,
  CURRENCY: DollarSign,
  DATE: CalendarDays,
  SELECT: ArrowUpRight,
};

export function TableGrid({ table }: { table: Table }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  /**
   * Searching the *rendered* text as well as the raw value, so typing "22/03" finds a date
   * stored as `2025-03-22`. Precomputed per row rather than per keystroke: the haystack
   * does not change while someone types, and rebuilding it on every character is the
   * difference between a search that feels instant and one that stutters at a few thousand
   * rows.
   */
  const haystacks = useMemo(
    () =>
      table.rows.map((row) =>
        table.fields.map((field) => searchText(row.cells[field.id] ?? null, field.type)).join(" "),
      ),
    [table],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return table.rows.map((_, index) => index);
    return table.rows.map((_, index) => index).filter((index) => haystacks[index].includes(needle));
  }, [query, table.rows, haystacks]);

  const visible = matches.slice(0, limit);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search — one input, client-side. §1.4: no saved views, no filters, no sorts. */}
      <div className="shrink-0 px-4 py-3">
        <div className="flex items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1.5 focus-within:border-strong">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE_SIZE);
            }}
            placeholder="Search"
            aria-label={`Search ${table.name}`}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th
                scope="col"
                className="w-12 border-b border-r border-line bg-muted px-2 py-2 text-left font-medium text-ink-faint"
              >
                <span className="sr-only">Row</span>
              </th>
              {table.fields.map((field) => {
                const Icon = TYPE_ICON[field.type];
                return (
                  <th
                    key={field.id}
                    scope="col"
                    className="min-w-[160px] border-b border-r border-line bg-muted px-3 py-2 text-left font-medium text-ink-muted"
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden />
                      <span className="truncate">{field.name}</span>
                    </span>
                  </th>
                );
              })}
              {/* Inert until D3. Visibly a placeholder rather than a button that lies. */}
              <th scope="col" className="w-full border-b border-line bg-muted px-3 py-2 text-left">
                <span className="flex items-center gap-1.5 text-ink-faint" title="Adding fields lands in D3">
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  <span className="font-medium">Add</span>
                </span>
              </th>
            </tr>
          </thead>

          <tbody>
            {visible.map((index) => {
              const row = table.rows[index];
              return (
                <tr key={row.id} className="group hover:bg-hover">
                  <td className="border-b border-r border-line px-2 py-1.5 text-right align-middle text-[12px] tnum text-ink-faint">
                    {index + 1}
                  </td>
                  {table.fields.map((field) => (
                    <td
                      key={field.id}
                      className={cn(
                        "border-b border-r border-line px-3 py-1.5 align-middle text-ink",
                        (field.type === "CURRENCY" || field.type === "NUMBER") && "tnum",
                      )}
                    >
                      <CellValue field={field} value={row.cells[field.id] ?? null} />
                    </td>
                  ))}
                  <td className="border-b border-line" />
                </tr>
              );
            })}
          </tbody>
        </table>

        {matches.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
            No rows match “{query}”.
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-2 text-[12px] text-ink-muted">
        <span>
          {visible.length === matches.length
            ? `${matches.length} row${matches.length === 1 ? "" : "s"}`
            : `Showing ${visible.length} of ${matches.length}`}
          {query && ` · filtered from ${table.rows.length}`}
        </span>
        {visible.length < matches.length && (
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE_SIZE)}
            className="rounded-button px-2 py-1 font-medium text-blue-600 transition-colors hover:bg-hover"
          >
            Load {Math.min(PAGE_SIZE, matches.length - visible.length)} more
          </button>
        )}
      </div>
    </div>
  );
}

function CellValue({
  field,
  value,
}: {
  field: Table["fields"][number];
  value: Parameters<typeof formatCell>[0];
}) {
  if (value === null || value === "") return <span className="text-ink-faint">—</span>;

  /**
   * A SELECT renders as a chip only when its value is one the field declares. An
   * undeclared value is real data with no styling decision attached to it, and inventing a
   * colour for it would make an unknown look identical to a known one.
   */
  if (field.type === "SELECT") {
    const option = field.options?.find((o) => o.value === value);
    return option ? <Chip tone={option.tone}>{option.value}</Chip> : <span>{String(value)}</span>;
  }

  return <span className="truncate">{formatCell(value, field.type)}</span>;
}
