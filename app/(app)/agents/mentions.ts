"use server";

import { listBoards } from "@/lib/board/persist";
import { listTables } from "@/lib/data/persist";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * What `@` can name (`docs/agents-plan.md` A5).
 *
 * A mention is not autocomplete decoration: it puts the exact name of a real object into the
 * task, which is what stops "look at the customer table" resolving to the wrong thing. The
 * agent still grounds every id through a tool — a mention narrows the question, it never
 * substitutes for the catalogue.
 */

export type Mention = { kind: "model" | "table" | "board"; name: string; hint: string };

export async function listMentions(): Promise<Mention[]> {
  const session = await getSession();
  if (!session) return [];

  const [models, tables, boards] = await Promise.all([
    db.model.findMany({ select: { name: true, _count: { select: { variables: true } } } }),
    listTables(db),
    listBoards(db),
  ]);

  return [
    ...models.map((m) => ({
      kind: "model" as const,
      name: m.name,
      hint: `${m._count.variables} variables`,
    })),
    ...tables.map((t) => ({
      kind: "table" as const,
      name: t.name,
      hint: `${t.rowCount.toLocaleString("en-US")} rows`,
    })),
    ...boards.map((b) => ({
      kind: "board" as const,
      name: b.title,
      hint: `${b._count.tiles} tiles`,
    })),
  ];
}
