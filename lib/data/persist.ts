import type { PrismaClient } from "@/lib/generated/prisma/client";

import type { Cell, Field, SelectOption, Table, TableSummary } from "./types";
import type { SeedField, SeedRecord } from "../../prisma/database-data";

/**
 * Reading and writing a `DataTable` (`docs/database-plan.md` §2, D1).
 *
 * The read is deliberately one query with two includes rather than three round trips: a
 * table is small enough that its fields and rows arrive together, and the grid cannot
 * render a partial one anyway.
 */

export async function readTable(db: PrismaClient, slug: string): Promise<Table | null> {
  const row = await db.dataTable.findUnique({
    where: { slug },
    include: {
      fields: { orderBy: { order: "asc" } },
      records: { orderBy: { order: "asc" } },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    fields: row.fields.map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      options: (field.options as { options?: SelectOption[] } | null)?.options ?? undefined,
    })),
    rows: row.records.map((record) => ({
      id: record.id,
      cells: record.cells as Record<string, Cell>,
    })),
  };
}

export async function listTables(db: PrismaClient): Promise<TableSummary[]> {
  const rows = await db.dataTable.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { fields: true, records: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    fieldCount: row._count.fields,
    rowCount: row._count.records,
  }));
}

type Fixture = {
  name: string;
  slug: string;
  icon: string | null;
  fields: SeedField[];
  records: SeedRecord[];
};

/**
 * Write a fixture, replacing whatever is at that slug.
 *
 * Idempotent by deletion rather than by upsert. The natural key of a *row* is nothing —
 * two customers may share every visible value — so there is no key to upsert against, and
 * matching on position would silently rewrite the wrong record the moment the fixture
 * gains a row. Replacing the table wholesale is the honest operation for a seed, and the
 * cascade does the rest. It is a seeder, not a sync: nothing calls this on live data.
 */
export async function writeTable(db: PrismaClient, fixture: Fixture): Promise<string> {
  return db.$transaction(async (tx) => {
    await tx.dataTable.deleteMany({ where: { slug: fixture.slug } });

    const table = await tx.dataTable.create({
      data: { name: fixture.name, slug: fixture.slug, icon: fixture.icon },
    });

    /** Fixture keys are stable and human-written; ids are not. This is the bridge. */
    const idOf = new Map<string, string>();

    for (const [index, field] of fixture.fields.entries()) {
      const created = await tx.dataField.create({
        data: {
          tableId: table.id,
          name: field.name,
          type: field.type,
          options: field.options ? { options: optionsFor(field, fixture.records) } : undefined,
          order: index,
        },
      });
      idOf.set(field.key, created.id);
    }

    await tx.dataRecord.createMany({
      data: fixture.records.map((record, index) => ({
        tableId: table.id,
        order: index,
        cells: Object.fromEntries(
          Object.entries(record).map(([key, value]) => [idOf.get(key) ?? key, value]),
        ),
      })),
    });

    return table.id;
  });
}

const TONES = ["blue", "sky", "amber", "rose", "graphite"] as const;

/**
 * A `SELECT` field declared with an empty option list gets its options derived from the
 * data — distinct values in fixture order, tones assigned round-robin.
 *
 * This exists for `Channel Owner`, where the options *are* the data: hand-listing twenty
 * names in the fixture and then generating rows that must agree with that list is two
 * sources of truth for one fact. A field that declares its options keeps them exactly.
 */
function optionsFor(field: SeedField, records: SeedRecord[]): SelectOption[] {
  if (field.options && field.options.length > 0) return field.options;

  const seen: string[] = [];
  for (const record of records) {
    const value = record[field.key];
    if (typeof value === "string" && value && !seen.includes(value)) seen.push(value);
  }

  return seen.map((value, index) => ({ value, tone: TONES[index % TONES.length] }));
}

export type { Field };
