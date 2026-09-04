import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SeedButton } from "@/components/app/seed-button";
import { AppShell } from "@/components/app/shell";
import { Topbar } from "@/components/app/topbar";
import { seedDatabase } from "@/app/(app)/seed/actions";
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
    <AppShell
      active="Data sources"
      initials={initialsOf(session.user.name, session.user.email)}
      email={session.user.email}
    >
      <Topbar workspace="Database" object="All tables" meta={`${tables.length} table(s)`} />

      {tables.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
          <div className="max-w-md text-center">
            <p className="text-[14px] font-medium text-ink">No tables yet</p>
            <p className="mt-1 text-[13px] leading-[1.6] text-ink-muted">
              Seed the Customers table — real records the model can roll up and a board can
              chart.
            </p>
            <div className="mt-4 flex justify-center">
              <SeedButton action={seedDatabase} label="Seed the demo table" />
            </div>
            <p className="mt-4 text-[12px] text-ink-faint">
              Or, with the repo: <code className="text-ink-muted">bun run seed:database</code>
            </p>
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
    </AppShell>
  );
}
