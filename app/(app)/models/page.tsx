import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Table2 } from "lucide-react";

import { SeedButton } from "@/components/app/seed-button";
import { AppShell } from "@/components/app/shell";
import { Topbar } from "@/components/app/topbar";
import { seedModel } from "@/app/(app)/seed/actions";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { initialsOf } from "@/lib/initials";

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
    <AppShell
      active="Models"
      initials={initialsOf(session.user.name, session.user.email)}
      email={session.user.email}
    >
      <Topbar workspace="Models" object="All models" meta={`${models.length} model(s)`} />

      {models.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
          <div className="max-w-md text-center">
            <p className="text-[14px] font-medium text-ink">No models yet</p>
            <p className="mt-1 text-[13px] leading-[1.6] text-ink-muted">
              The database is empty. Seed the Revenue Model 2026 — 24 months, a formula tree
              and three scenarios — and the whole app has something to show.
            </p>
            <div className="mt-4 flex justify-center">
              <SeedButton action={seedModel} label="Seed the demo model" />
            </div>
            {/* The command stays, below the button rather than instead of it: whoever is
                holding the repo gets the verification harness the script wraps around this,
                which the button deliberately skips. */}
            <p className="mt-4 text-[12px] text-ink-faint">
              Or, with the repo: <code className="text-ink-muted">bun run seed</code>
            </p>
          </div>
        </div>
      ) : (
        <ul data-tour="model-list" className="min-h-0 flex-1 overflow-y-auto">
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
    </AppShell>
  );
}
