import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { listBoards } from "@/lib/board/persist";
import { db } from "@/lib/db";
import { initialsOf } from "@/lib/initials";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Boards" };

export default async function BoardsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/boards");

  const boards = await listBoards(db);

  return (
    <div data-surface="app" className="flex h-dvh flex-col overflow-hidden bg-app sm:flex-row">
      <Rail active="Boards" initials={initialsOf(session.user.name, session.user.email)} />

      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <Topbar workspace="Boards" object="All boards" meta={`${boards.length} board(s)`} />

        {boards.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-md text-center">
              <p className="text-[14px] font-medium text-ink">No boards yet</p>
              <pre className="mt-3 rounded-control border border-line bg-subtle px-3 py-2 text-left font-mono text-[12px] text-ink-2">
                bun run seed:board
              </pre>
            </div>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {boards.map((board) => (
              <li key={board.slug} className="border-b border-line">
                <Link href={`/boards/${board.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-chip-sky text-[14px]">
                    {board.emoji ?? "📊"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{board.title}</span>
                    <span className="block text-[12px] text-ink-muted">{board._count.tiles} tiles</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-faint">
                    {board.updatedAt.toISOString().slice(0, 10)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
