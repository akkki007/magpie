"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

import { TOUR, stepsFor } from "@/lib/tour";

/**
 * Plays `lib/tour.ts` over the real app. Inert unless the URL carries `?tour=`.
 *
 * **Crossing pages is the whole problem.** driver.js highlights elements on the page it is
 * on; a walkthrough of four screens is four separate runs that have to feel like one. The
 * step index lives in the URL rather than in state or storage: a reload mid-tour resumes
 * exactly where it was, and the recording can be restarted from any step by editing the
 * address bar — which is what makes a re-take cheap.
 *
 * A step whose element is missing is dropped rather than fatal, because the alternative is a
 * tour that dies silently on a renamed div in the middle of a recording. `bun run
 * tour:check` is what actually catches that, before the camera is on.
 */
export function Tour() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const raw = params.get("tour");

  useEffect(() => {
    if (raw === null) return;

    const from = Number(raw) || 0;
    const local = stepsFor(pathname).filter(({ index }) => index >= from);
    if (local.length === 0) return;

    let cancelled = false;
    let instance: Driver | null = null;
    let observer: MutationObserver | null = null;

    const start = () => {
      if (cancelled) return;

      // A step whose element never arrived is dropped rather than fatal — the alternative
      // is a tour that dies on a renamed div in the middle of a take.
      const usable = local.filter(({ step }) => !step.target || document.querySelector(step.target));
      if (usable.length === 0) return;

      const last = usable.at(-1)!;
      const next = TOUR[last.index + 1];

      instance = driver({
        allowClose: true,
        overlayColor: "#101014",
        overlayOpacity: 0.6,
        stagePadding: 6,
        stageRadius: 10,
        popoverClass: "magpie-tour",
        doneBtnText: next ? "Next screen →" : "Done",
        steps: usable.map(({ step, index }) => ({
          element: step.target ?? undefined,
          popover: {
            title: step.title,
            description: step.body,
            side: "bottom",
            align: "start",
            showProgress: true,
            // Counted globally, not per screen: driver.js only knows about this page's
            // run, so "3 of 10" has to be computed from the step's absolute index or the
            // counter would restart at every navigation.
            progressText: `${index + 1} of ${TOUR.length}`,
          },
        })),
        /** The last step of a screen hands off to the first step of the next one. */
        onDestroyed: () => {
          if (cancelled) return;
          if (next) router.push(`${next.path}?tour=${last.index + 1}`);
          else router.replace(pathname);
        },
      });

      instance.drive();
    };

    const first = local[0].step.target;
    if (!first || document.querySelector(first)) {
      start();
    } else {
      // Elements mount after paint on a freshly navigated page, and one frame is not
      // reliably enough — so wait for the first target rather than guessing a delay.
      observer = new MutationObserver(() => {
        if (document.querySelector(first)) {
          observer?.disconnect();
          start();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      instance?.destroy();
    };
  }, [raw, pathname, router]);

  return null;
}
