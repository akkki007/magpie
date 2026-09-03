import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { listTables } from "@/lib/data/persist";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { initialsOf } from "@/lib/initials";

export const metadata: Metadata = { title: "Databases" };

/** The table list (`docs/database-plan.md` D2) — the same boundary the model list draws. */
export default async function DatabasesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/databases");

  const tables = await listTables(db);

  return (
    <div data-surface="app" className="flex h-dvh overflow-hidden bg-app">
      <Rail active="Data sources" initials={initialsOf(session.user.name, session.user.email)} />

      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <Topbar workspace="Database" object="All tables" meta={`${tables.length} table(s)`} />

        {tables.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-md text-center">
              <p className="text-[14px] font-medium text-ink">No tables yet</p>
              <p className="mt-1 text-[13px] leading-[1.6] text-ink-muted">
                Seed the Customers table with:
              </p>
              <pre className="mt-3 rounded-control border border-line bg-subtle px-3 py-2 text-left font-mono text-[12px] text-ink-2">
                bun run seed:database
              </pre>
            </div>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {tables.map((table) => (
              <li key={table.slug} className="border-b border-line">
                <Link
                  href={`/databases/${table.slug}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-hover"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-chip-sky text-[14px]">
                    {table.icon ?? "🗂️"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">
                      {table.name}
                    </span>
                    <span className="block text-[12px] text-ink-muted">
                      {table.rowCount.toLocaleString("en-US")} rows · {table.fieldCount} fields
                    </span>
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
