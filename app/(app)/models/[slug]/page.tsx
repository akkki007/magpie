import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app/shell";
import { Workbench } from "@/components/modelling/workbench";
import { db } from "@/lib/db";
import { readModel } from "@/lib/model/persist";
import { getSession } from "@/lib/session";
import { initialsOf } from "@/lib/initials";

/**
 * One model's workspace (`docs/modelling-plan.md` M1.4).
 *
 * The model comes from Postgres and is handed to the client as data. That was the M0 seam:
 * `buildRevenueModel()` became `readModel()`, returning the same `Model` object, and nothing
 * below this line changed. The seed proves the two identical field for field, which is the
 * only reason the swap was safe to make without seeing the screen.
 *
 * Auth sits in the page next to the data, not in a layout — on Next 16 a layout does not stop
 * the page beneath it from running or from shipping its data in the RSC payload
 * (`docs/auth-plan.md` §4). The same check is repeated inside the server action, because that
 * is a separate HTTP entry point and this one does not protect it.
 *
 * `requireMembership` goes here the moment A3's org tables exist. Until then any signed-in
 * user can read any model — correct for a single-tenant dev database, a hole the day it isn't.
 */
export async function generateMetadata({
  params,
}: PageProps<"/models/[slug]">): Promise<Metadata> {
  const model = await db.model.findUnique({
    where: { slug: (await params).slug },
    select: { name: true },
  });
  return { title: model?.name ?? "Model" };
}

export default async function ModelPage({ params }: PageProps<"/models/[slug]">) {
  const { slug } = await params;

  const session = await getSession();
  if (!session) redirect(`/sign-in?next=/models/${slug}`);

  const model = await readModel(db, slug);
  if (!model) notFound();

  return (
    <AppShell
      active="Models"
      initials={initialsOf(session.user.name, session.user.email)}
      email={session.user.email}
    >
      <Workbench initialModel={model} slug={slug} modelName={model.name} />
    </AppShell>
  );
}
