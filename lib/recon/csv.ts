/**
 * CSV writing, including the parts that are deliberately awkward.
 *
 * R1.1 says ingestion has to survive a BOM, quoted commas, `dd/mm/yyyy` dates and Indian
 * digit grouping. Those messes have to come from somewhere, so the generator emits them:
 * the gateway exports are clean UTF-8 with ISO dates and plain decimals, and the **bank
 * statement is not**, because bank statements never are.
 *
 * Writing the mess here rather than hand-editing a fixture later means R1 is tested
 * against it on every run.
 */

export const BOM = "﻿";

/** Quote only when needed, and double any quotes inside — the RFC 4180 rule. */
export function cell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(
  rows: T[],
  columns: readonly (readonly [header: string, get: (row: T) => string | number])[],
  options: { bom?: boolean } = {},
): string {
  const header = columns.map(([name]) => cell(name)).join(",");
  const body = rows.map((row) => columns.map(([, get]) => cell(get(row))).join(","));
  return `${options.bom ? BOM : ""}${[header, ...body].join("\n")}\n`;
}

/** `2026-06-03` → `03/06/2026`. The format the bank hands you, and a trap for `Date.parse`. */
export function toDdMmYyyy(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}
