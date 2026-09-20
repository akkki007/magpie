/** `bun run seed:board` — the board from `designs/board-1.jpg`, empty and ready to be asked. */
import { db } from "../lib/db";

const SLUG = "financial-performance-overview";

const board = await db.board.upsert({
  where: { slug: SLUG },
  update: {},
  create: {
    slug: SLUG,
    title: "Financial Performance Overview",
    emoji: "📈",
  },
});

const tiles = await db.boardTile.count({ where: { boardId: board.id } });
console.log(`\n  Board "${board.title}" → /boards/${SLUG} · ${tiles} tile(s)\n`);
