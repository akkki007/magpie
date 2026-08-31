import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { Workbench } from "@/components/modelling/workbench";
import { buildRevenueModel } from "@/lib/model/revenue-model";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Revenue Model 2026" };

/**
 * The modelling workspace, built to `designs/modelling-1.jpg`.
 *
 * The model is assembled on the server and handed to the client as data. That
 * is the M0 seam (`docs/modelling-plan.md` M0): when the Prisma tables land,
 * `buildRevenueModel()` becomes a query returning the same `Model` object and
 * nothing below this line changes.
 *
 * Note where the auth check is: in the page, next to the data. Not in the
 * layout — on Next 16 a layout does not stop the page beneath it from running
 * or from shipping its data in the RSC payload (docs/auth-plan.md §4).
 */
export default async function ModelPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/workspace");

  const model = buildRevenueModel();

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
