import type { ChipTone } from "@/lib/model/types";

/**
 * The database module's shapes (`docs/database-plan.md` §2).
 *
 * These mirror the Prisma models the way `lib/model/types.ts` mirrors the modelling tables:
 * the query returns the shape the UI already takes, so nothing above this layer knows there
 * is a database underneath.
 */

export type FieldType = "TEXT" | "NUMBER" | "CURRENCY" | "DATE" | "SELECT";

export type SelectOption = { value: string; tone: ChipTone };

export type Field = {
  id: string;
  name: string;
  type: FieldType;
  /** `SELECT` only. Empty means "no chips defined", which the grid renders as plain text. */
  options?: SelectOption[];
};

/**
 * One value. `null` is empty — distinct from `""`, which is a text field someone cleared,
 * and from `0`, which is a number someone meant.
 */
export type Cell = string | number | null;

/** Keyed by field **id**, never name — a rename must not orphan the values under it. */
export type Row = {
  id: string;
  cells: Record<string, Cell>;
};

export type Table = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  fields: Field[];
  rows: Row[];
};

/** A table's header, for the sidebar and the index — without dragging every row along. */
export type TableSummary = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  fieldCount: number;
  rowCount: number;
};
