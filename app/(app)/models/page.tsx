import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Table2 } from "lucide-react";

import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Models" };

/**
 * The model list (`docs/modelling-plan.md` M1.4).
 *
 * There is one model today, which is exactly why this exists now: a product that assumes a
 * single model grows a hundred references to it, and the second one turns into a refactor
 * rather than a row. The list is the cheapest possible version of that boundary.
 */
export default async function ModelsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/models");

  const models = await db.model.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      slug: true,
      name: true,
      updatedAt: true,
      horizonStart: true,
      horizonEnd: true,
      _count: { select: { variables: true, scenarios: true } },
    },
  });

  return (
    <div data-surface="app" className="flex h-dvh overflow-hidden bg-app">
      <Rail active="Models" initials={initialsOf(session.user.name, session.user.email)} />

      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <Topbar workspace="Models" object="All models" meta={`${models.length} model(s)`} />

        {models.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-md text-center">
              <p className="text-[14px] font-medium text-ink">No models yet</p>
              <p className="mt-1 text-[13px] leading-[1.6] text-ink-muted">
                The database is empty. Seed the Revenue Model with:
              </p>
              <pre className="mt-3 rounded-control border border-line bg-subtle px-3 py-2 text-left font-mono text-[12px] text-ink-2">
                bun run seed
              </pre>
            </div>
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {models.map((model) => (
              <li key={model.slug} className="border-b border-line">
                <Link
                  href={`/models/${model.slug}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-hover"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-chip-sky">
                    <Table2 className="h-4 w-4 text-ink" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">
                      {model.name}
                    </span>
                    <span className="block text-[12px] text-ink-muted">
                      {model._count.variables} variables · {model._count.scenarios} scenarios ·{" "}
                      {model.horizonStart.toISOString().slice(0, 7)} to{" "}
                      {model.horizonEnd.toISOString().slice(0, 7)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-faint">
                    {model.updatedAt.toISOString().slice(0, 10)}
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

function initialsOf(name: string, email: string) {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}
