import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import { Rail } from "@/components/app/rail";
import { Topbar } from "@/components/app/topbar";
import { ReviewQueue } from "@/components/recon/review-queue";
import { readRunReport } from "@/lib/recon/report";
import { getSession } from "@/lib/session";
import { initialsOf } from "@/lib/initials";

export const metadata: Metadata = { title: "Reconciliation" };

/**
 * The review queue screen (`docs/recon-plan.md` R5).
 *
 * Auth sits in the page next to the data, not in a layout — on Next 16 a layout does not stop
 * the page beneath it from running or from shipping its data in the RSC payload
 * (`docs/auth-plan.md` §4), and the same reasoning applies here as on `/workspace`.
 */
export default async function ReconPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/recon");

  return (
    <div data-surface="app" className="flex h-dvh flex-col overflow-hidden bg-app sm:flex-row">
      <Rail active="Reconciliation" initials={initialsOf(session.user.name, session.user.email)} />

      <main className="my-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface sm:ml-0">
        <Topbar workspace="Reconciliation" object="June–August 2026" meta="Deterministic run" />
        <Suspense fallback={<Loading />}>
          <Report />
        </Suspense>
      </main>
    </div>
  );
}

/**
 * Reading the run report, deliberately behind `connection()`.
 *
 * This is the Next 16 trap that would otherwise ship silently. Synchronous I/O — including
 * `readFileSync` — completes during prerendering, so without this the queue would be baked
 * into the static HTML at build time and every visitor would see whichever run happened to be
 * on disk when the build ran. `connection()` stops prerendering here, and the `<Suspense>`
 * boundary above lets the rest of the shell still be static.
 *
 * A reconciliation screen showing a stale exception list is worse than one that is slow.
 */
async function Report() {
  await connection();
  const report = readRunReport();

  if (!report) return <Empty />;

  return <ReviewQueue report={report} />;
}

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-[13px] text-ink-muted">Reading the last run…</p>
    </div>
  );
}

/** A fresh clone has no `data/` — say which command produces one rather than crashing. */
function Empty() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <p className="text-[14px] font-medium text-ink">No run to review yet</p>
        <p className="mt-1 text-[13px] leading-[1.6] text-ink-muted">
          The queue renders <code className="text-ink-2">data/recon/eval-report.json</code>, which
          the scoreboard writes. Generate one with:
        </p>
        <pre className="mt-3 rounded-control border border-line bg-subtle px-3 py-2 text-left font-mono text-[12px] leading-relaxed text-ink-2">
          bun run recon:seed{"\n"}bun run recon:eval
        </pre>
      </div>
    </div>
  );
}
