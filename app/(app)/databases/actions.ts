"use server";

import { z } from "zod";

import { rollupToSeries, type RollupResult, type RollupSpec } from "@/lib/data/rollup";
import { listTables, readTable } from "@/lib/data/persist";
import type { Field } from "@/lib/data/types";
import { db } from "@/lib/db";
import { readModel } from "@/lib/model/persist";
import { getSession } from "@/lib/session";

/**
 * Reading a database from the modelling side (`docs/database-plan.md` D4).
 *
 * The rollup runs **here**, not in the browser, even though `rollupToSeries` is pure and
 * could run either side. A table is unbounded in a way a pasted CSV is not: shipping every
 * record to the client so it can add them up would put the size of the database on the wire
 * to compute twenty-four numbers. The pure function stays isomorphic so it is testable and
 * so a future preview *could* run locally; today the only caller is this one.
 *
 * Auth is checked here for the reason `models/actions.ts` gives at length: a server function
 * is an HTTP endpoint that happens to be written as a function.
 */

const SpecSchema = z.object({
  dateFieldId: z.string().min(1),
  valueFieldId: z.string().min(1).nullable(),
  aggregation: z.enum(["SUM", "COUNT", "AVG"]),
});

export type RollupSource = {
  slug: string;
  name: string;
  icon: string | null;
  rowCount: number;
  fields: Field[];
};

/**
 * The picker's options: every table, with its columns but **without its rows**. The columns
 * are what the form needs; the rows are what would make this expensive.
 */
export async function listRollupSources(): Promise<RollupSource[]> {
  const session = await getSession();
  if (!session) return [];

  const summaries = await listTables(db);
  const tables = await db.dataTable.findMany({
    select: {
      slug: true,
      fields: { orderBy: { order: "asc" }, select: { id: true, name: true, type: true } },
    },
  });
  const fieldsBySlug = new Map(tables.map((t) => [t.slug, t.fields]));

  return summaries.map((summary) => ({
    slug: summary.slug,
    name: summary.name,
    icon: summary.icon,
    rowCount: summary.rowCount,
    fields: (fieldsBySlug.get(summary.slug) ?? []) as Field[],
  }));
}

export async function rollupForModel(
  modelSlug: string,
  tableSlug: string,
  spec: RollupSpec,
): Promise<RollupResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session has expired — sign in again." };

  const parsed = SpecSchema.safeParse(spec);
  if (!parsed.success) return { ok: false, error: "That rollup is not well-formed." };

  const [model, table] = await Promise.all([readModel(db, modelSlug), readTable(db, tableSlug)]);
  if (!model) return { ok: false, error: "That model no longer exists." };
  if (!table) return { ok: false, error: "That table no longer exists." };

  return rollupToSeries(table, model, parsed.data);
}
