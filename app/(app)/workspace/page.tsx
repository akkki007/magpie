import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { Workbench } from "@/components/modelling/workbench";
import { db } from "@/lib/db";
import { readModel } from "@/lib/model/persist";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Revenue Model 2026" };

/**
 * The modelling workspace, built to `designs/modelling-1.jpg`.
 *
 * The model comes from Postgres and is handed to the client as data. That was the M0 seam
 * (`docs/modelling-plan.md` M0), and it held: `buildRevenueModel()` became `readModel()`,
 * returning the same `Model` object, and nothing below this line changed. The seed script
 * proves the two are identical field for field, which is the only reason the swap was safe to
 * make blind.
 *
 * Note where the auth check is: in the page, next to the data. Not in the
 * layout — on Next 16 a layout does not stop the page beneath it from running
 * or from shipping its data in the RSC payload (docs/auth-plan.md §4).
 */
export default async function ModelPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/workspace");

  const model = await readModel(db, "revenue-model-2026");
  if (!model) notFound();

  return (
    <div data-surface="app" className="flex h-dvh overflow-hidden bg-app">
      <Rail active="Models" initials={initialsOf(session.user.name, session.user.email)} />

      {/* The canvas: a white document floating on the desk, not a full-bleed
          page. Hairline border, no shadow. */}
      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <Topbar workspace="Models" object={model.name} meta="Edited 2d ago" />
        <Workbench initialModel={model} />
      </main>
    </div>
  );
}

/** Two letters for the rail avatar; falls back to the email when there is no name. */
function initialsOf(name: string, email: string) {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}
