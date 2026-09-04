import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { AskBoard } from "@/components/board/ask";
import { Tile } from "@/components/board/tile";
import { readBoard } from "@/lib/board/persist";
import { resolveTile } from "@/lib/board/spec";
import { listTables, readTable } from "@/lib/data/persist";
import type { Table } from "@/lib/data/types";
import { db } from "@/lib/db";
import { initialsOf } from "@/lib/initials";
import { readModel } from "@/lib/model/persist";
import { getSession } from "@/lib/session";

/** The model a board reads from. One for now; a board will name its own once there are several. */
const MODEL_SLUG = "revenue-model-2026";

export async function generateMetadata({ params }: PageProps<"/boards/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const board = await readBoard(db, slug);
  return { title: board ? board.title : "Board" };
}

/**
 * One board (`docs/board-plan.md`).
 *
 * **Tiles resolve on every render.** Nothing here is a stored number: each tile is a
 * reference plus a form, and the figures come from the model and the database tables at read
 * time. That is what "one source of truth" has to mean in practice — a board that cached its
 * own numbers would start disagreeing with the model the first time somebody edited a cell,
 * and it would be the board people trusted, because it is the one on the wall.
 */
export default async function BoardPage({ params }: PageProps<"/boards/[slug]">) {
  const { slug } = await params;

  const session = await getSession();
  if (!session) redirect(`/sign-in?next=/boards/${slug}`);

  const board = await readBoard(db, slug);
  if (!board) notFound();

  const [model, summaries] = await Promise.all([readModel(db, MODEL_SLUG), listTables(db)]);
  const tables = (await Promise.all(summaries.map((s) => readTable(db, s.slug)))).filter(
    (t): t is Table => t !== null,
  );

  return (
    <div data-surface="app" className="flex h-dvh flex-col overflow-hidden bg-app sm:flex-row">
      <Rail active="Boards" initials={initialsOf(session.user.name, session.user.email)} />

      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <Topbar workspace="Boards" object={board.title} meta={`${board.tiles.length} tiles`} />

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1100px] px-4 py-5 sm:px-6 sm:py-6">
            <h1 className="flex items-center gap-3 text-[26px] leading-tight font-semibold text-ink">
              {board.emoji && <span aria-hidden>{board.emoji}</span>}
              {board.title}
            </h1>

            <div className="mt-5">
              <AskBoard
                boardSlug={board.slug}
                modelSlug={MODEL_SLUG}
                suggestions={SUGGESTIONS}
              />
            </div>

            {!model && (
              <p className="mt-6 rounded-control border border-line bg-subtle px-3 py-2 text-[13px] text-ink-muted">
                No model is seeded, so tiles cannot resolve. Run <code>bun run seed</code>.
              </p>
            )}

            {board.tiles.length === 0 ? (
              <p className="mt-8 text-[13px] text-ink-muted">
                Nothing on this board yet — ask it something above.
              </p>
            ) : (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {model &&
                  board.tiles.map((tile) => (
                    <div
                      key={tile.id}
                      className={tile.spec.kind === "chart" ? "md:col-span-2 lg:col-span-1" : undefined}
                    >
                      <Tile
                        boardSlug={board.slug}
                        id={tile.id}
                        question={tile.question}
                        resolved={resolveTile(tile.spec, { model, tables })}
                      />
                    </div>
                  ))}
              </div>
            )}

            {board.broken.length > 0 && (
              <p className="mt-6 text-[12px] text-ink-faint">
                {board.broken.length} tile(s) were written in a shape this build no longer
                understands and are not shown.
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Starters, so an empty board is not a blank prompt. */
const SUGGESTIONS = [
  "Customers onboarded each month, broken down by customer type",
  "Total credit limit by status per month",
  "How has ARR moved over the horizon?",
  "How many customers do we have now?",
];
