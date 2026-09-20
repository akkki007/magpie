"use client";

import { useEffect, useState } from "react";

/**
 * The floating "where am I" pill. Tracks which section heading is currently in
 * view — on a long lesson the scrollbar tells you how far you are but not what
 * you are reading.
 */
export function ProgressPill({ sections }: { sections: { id: string; text: string }[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!sections.length) return;

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-12% 0px -70% 0px" },
    );

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }

    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setPct(max > 0 ? Math.min(1, h.scrollTop / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [sections]);

  const label = sections.find((s) => s.id === active)?.text;
  if (!label) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-6">
      <div className="flex max-w-[min(92vw,420px)] items-center gap-2.5 rounded-full border border-paper-line bg-paper-card/95 px-3.5 py-2 shadow-[0_1px_3px_rgba(26,26,24,.06),0_8px_24px_rgba(26,26,24,.06)] backdrop-blur">
        <span aria-hidden className="relative h-3.5 w-3.5 shrink-0">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 -rotate-90">
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--color-paper-line)" strokeWidth="3" />
            <circle
              cx="10" cy="10" r="8" fill="none"
              stroke="var(--color-paper-ink)" strokeWidth="3" strokeLinecap="round"
              strokeDasharray={`${pct * 50.3} 50.3`}
            />
          </svg>
        </span>
        <span className="truncate text-[12.5px] text-paper-ink-2">{label}</span>
      </div>
    </div>
  );
}
