"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Mark } from "@/components/ui/logo";
import { ThemeToggle } from "./theme";

export type SearchItem = {
  topic: string;
  topicSlug: string;
  lessonSlug: string;
  n: string;
  title: string;
  summary: string;
};

export function LearningHeader({ index }: { index: SearchItem[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-paper-line/60 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1000px] items-center gap-2.5 px-6">
          <Link href="/learning" className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-[7px] border border-paper-line bg-paper-card">
              <Mark className="h-3.5 w-3.5" />
            </span>
            <span className="font-serif text-[16px] text-paper-ink">Learn</span>
            <span className="text-[12px] text-paper-faint">by Magpie</span>
          </Link>

          <button
            onClick={() => setOpen(true)}
            className="ml-auto inline-flex items-center gap-2 rounded-[8px] border border-paper-line bg-paper-card px-2.5 py-1.5 text-[12.5px] text-paper-muted transition-colors duration-150 hover:border-paper-faint"
          >
            <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
            Search
            <kbd className="font-mono text-[10.5px] text-paper-faint">⌘K</kbd>
          </button>

          <ThemeToggle />
        </div>
      </header>

      {open ? <Palette index={index} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Palette({ index, onClose }: { index: SearchItem[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const router = useRouter();

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return index.slice(0, 8);
    return index
      .filter((i) =>
        `${i.topic} ${i.title} ${i.summary}`.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [q, index]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim p-6 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] overflow-hidden rounded-[12px] border border-paper-line bg-paper-card shadow-[0_1px_3px_rgba(26,26,24,.07),0_18px_48px_rgba(26,26,24,.12)]"
      >
        <div className="flex items-center gap-2.5 border-b border-paper-line-soft px-4">
          <Search className="h-4 w-4 shrink-0 text-paper-faint" strokeWidth={1.75} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) {
                router.push(`/learning/${hits[0].topicSlug}/${hits[0].lessonSlug}`);
                onClose();
              }
            }}
            placeholder="Search lessons"
            className="h-12 flex-1 bg-transparent text-[15px] text-paper-ink outline-none placeholder:text-paper-faint"
          />
          <button onClick={onClose} aria-label="Close search" className="text-paper-faint">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {hits.length ? (
          <ul className="max-h-[52vh] overflow-y-auto p-2">
            {hits.map((h) => (
              <li key={`${h.topicSlug}/${h.lessonSlug}`}>
                <Link
                  href={`/learning/${h.topicSlug}/${h.lessonSlug}`}
                  onClick={onClose}
                  className="flex items-baseline gap-3 rounded-[8px] px-3 py-2.5 transition-colors duration-150 hover:bg-paper"
                >
                  <span className="font-mono text-[11px] text-paper-faint">{h.n}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-paper-ink">
                      {h.title}
                    </span>
                    <span className="block truncate text-[12.5px] text-paper-muted">
                      {h.topic}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-[13.5px] text-paper-muted">
            No lessons match “{q}”.
          </p>
        )}
      </div>
    </div>
  );
}
