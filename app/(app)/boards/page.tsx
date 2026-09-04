import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SeedButton } from "@/components/app/seed-button";
import { AppShell } from "@/components/app/shell";
import { Topbar } from "@/components/app/topbar";
import { seedBoard } from "@/app/(app)/seed/actions";
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
    <AppShell
      active="Boards"
      initials={initialsOf(session.user.name, session.user.email)}
      email={session.user.email}
    >
      <Topbar workspace="Boards" object="All boards" meta={`${boards.length} board(s)`} />

      {boards.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
          <div className="max-w-md text-center">
            <p className="text-[14px] font-medium text-ink">No boards yet</p>
            <p className="mt-1 text-[13px] leading-[1.6] text-ink-muted">
              A board starts empty and fills up by being asked questions — the tiles are the
              answers you decided to keep.
            </p>
            <div className="mt-4 flex justify-center">
              <SeedButton action={seedBoard} label="Create the demo board" />
            </div>
            <p className="mt-4 text-[12px] text-ink-faint">
              Or, with the repo: <code className="text-ink-muted">bun run seed:board</code>
            </p>
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
    </AppShell>
  );
}
