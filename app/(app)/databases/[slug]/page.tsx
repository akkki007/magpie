import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { TableGrid } from "@/components/database/table-grid";
import { readTable } from "@/lib/data/persist";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { initialsOf } from "@/lib/initials";

export async function generateMetadata({
  params,
}: PageProps<"/databases/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const table = await readTable(db, slug);
  return { title: table ? table.name : "Database" };
}

/**
 * One table (`docs/database-plan.md` D2).
 *
 * The whole table — fields and rows together — is read in one query and handed to a client
 * component, because search filters across every column and a server round trip per
 * keystroke would be a worse search than an `input`. At 200 rows a page that payload is
 * small; the day a table is genuinely large, the filter moves to the server and this page
 * is the thing that changes.
 */
export default async function DatabaseTablePage({ params }: PageProps<"/databases/[slug]">) {
  const { slug } = await params;

  const session = await getSession();
  if (!session) redirect(`/sign-in?next=/databases/${slug}`);

  const table = await readTable(db, slug);
  if (!table) notFound();

  return (
    <div data-surface="app" className="flex h-dvh overflow-hidden bg-app">
      <Rail active="Data sources" initials={initialsOf(session.user.name, session.user.email)} />

      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <Topbar
          workspace="Database"
          object={table.name}
          meta={`${table.rows.length.toLocaleString("en-US")} rows`}
        />
        <TableGrid table={table} />
      </main>
    </div>
  );
}
