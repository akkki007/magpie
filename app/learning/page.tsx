import Link from "next/link";
import { ChevronRight, Route } from "lucide-react";
import { topics } from "@/learning";
import { progress } from "@/learning/path";

export default function AllTopicsPage() {
  const { done, total } = progress();

  return (
    <main className="mx-auto max-w-[1000px] px-6 pt-14 pb-24">
      <h1 className="font-serif text-[34px] leading-[1.15] text-paper-ink">
        All topics
      </h1>
      <p className="mt-2.5 max-w-[62ch] text-[15.5px] leading-[1.65] text-paper-muted">
        Lessons written from this repository as it gets built — every one points at
        real files, then hands you a lab to implement the idea yourself.
      </p>
      <p className="mt-4 font-mono text-[11.5px] text-paper-faint">
        {topics.length} topic{topics.length === 1 ? "" : "s"} ·{" "}
        {topics.reduce((n, t) => n + t.lessons.length, 0)} lessons
      </p>

      <Link
        href="/learning/path"
        className="group mt-8 flex items-center gap-4 rounded-[10px] border border-paper-ink/15 bg-paper-card px-5 py-4 transition-colors duration-150 hover:border-paper-ink/35"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <Route className="h-4 w-4 text-paper-ink" strokeWidth={1.75} />
            <span className="text-[15.5px] font-medium text-paper-ink">The path</span>
          </span>
          <span className="mt-1 block text-[14px] leading-[1.6] text-paper-muted">
            The dev plan and the curriculum, as one list. Read, build, get reviewed, repeat.
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11px] text-paper-faint">
          {done}/{total} done
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-paper-faint transition-transform duration-150 group-hover:translate-x-0.5"
          strokeWidth={1.75}
        />
      </Link>

      <p className="mt-11 font-mono text-[11px] tracking-[0.06em] text-paper-faint">
        TOPICS
      </p>
      <div className="mt-3 space-y-3">
        {topics.map((t) => (
          <Link
            key={t.slug}
            href={`/learning/${t.slug}`}
            className="group flex items-center gap-4 rounded-[10px] border border-paper-line bg-paper-card px-5 py-4 transition-colors duration-150 hover:border-paper-faint"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-medium text-paper-ink">
                {t.title}
              </span>
              <span className="mt-1 block text-[14px] leading-[1.6] text-paper-muted">
                {t.summary}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[11px] text-paper-faint">
              {t.lessons.length} lessons
            </span>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-paper-faint transition-transform duration-150 group-hover:translate-x-0.5"
              strokeWidth={1.75}
            />
          </Link>
        ))}
      </div>
    </main>
  );
}
