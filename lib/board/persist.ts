import type { PrismaClient } from "@/lib/generated/prisma/client";

import { TileSpec } from "./spec";

/**
 * Reading and writing boards (`docs/board-plan.md`).
 *
 * Every tile's `spec` is parsed with the zod schema on the way **out**, not trusted because
 * it was valid on the way in. A board is long-lived and its tiles were written by a language
 * model against a catalogue that changes; a tile whose shape no longer parses is dropped
 * with a reason rather than rendered into a crash.
 */

export type StoredTile = {
  id: string;
  order: number;
  question: string | null;
  spec: TileSpec;
};

export type StoredBoard = {
  id: string;
  slug: string;
  title: string;
  emoji: string | null;
  tiles: StoredTile[];
  /** Tiles that no longer parse, named so the page can say so instead of hiding them. */
  broken: { id: string; question: string | null }[];
};

export async function readBoard(db: PrismaClient, slug: string): Promise<StoredBoard | null> {
  const row = await db.board.findUnique({
    where: { slug },
    include: { tiles: { orderBy: { order: "asc" } } },
  });
  if (!row) return null;

  const tiles: StoredTile[] = [];
  const broken: { id: string; question: string | null }[] = [];

  for (const tile of row.tiles) {
    const parsed = TileSpec.safeParse(tile.spec);
    if (parsed.success) {
      tiles.push({ id: tile.id, order: tile.order, question: tile.question, spec: parsed.data });
    } else {
      broken.push({ id: tile.id, question: tile.question });
    }
  }

  return { id: row.id, slug: row.slug, title: row.title, emoji: row.emoji, tiles, broken };
}

export async function listBoards(db: PrismaClient) {
  return db.board.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      slug: true,
      title: true,
      emoji: true,
      updatedAt: true,
      _count: { select: { tiles: true } },
    },
  });
}

const KIND = { chart: "CHART", kpi: "KPI", text: "TEXT" } as const;

export async function addTile(
  db: PrismaClient,
  boardId: string,
  spec: TileSpec,
  question: string | null,
) {
  const last = await db.boardTile.findFirst({
    where: { boardId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  return db.boardTile.create({
    data: {
      boardId,
      kind: KIND[spec.kind],
      spec,
      question,
      order: (last?.order ?? -1) + 1,
    },
  });
}

export async function removeTile(db: PrismaClient, boardId: string, tileId: string) {
  await db.boardTile.deleteMany({ where: { id: tileId, boardId } });
}
