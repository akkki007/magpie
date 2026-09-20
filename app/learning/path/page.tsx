import Link from "next/link";
import { ArrowRight, Check, CircleDashed, Eye, Hammer, BookOpen } from "lucide-react";
import { path, progress } from "@/learning/path";
import type { TaskStatus } from "@/learning/types";
import { Inline } from "@/components/learning/markdown";
import { cn } from "@/lib/cn";

export const metadata = {
  title: "The path",
  description: "The Magpie dev plan, as a learning path.",
};

const STATUS: Record<
  TaskStatus,
  { label: string; icon: typeof Check; cls: string; dot: string }
> = {
  todo: { label: "Not started", icon: CircleDashed, cls: "text-paper-faint", dot: "bg-paper-line" },
  learn: { label: "Read this", icon: BookOpen, cls: "text-hint-fg", dot: "bg-hint-line" },
  building: { label: "You're building", icon: Hammer, cls: "text-hint-fg", dot: "bg-hint-fg" },
  review: { label: "In review", icon: Eye, cls: "text-paper-ink", dot: "bg-paper-ink" },
  done: { label: "Done", icon: Check, cls: "text-ok-fg", dot: "bg-ok-fg" },
};

export default function PathPage() {
  const { done, total } = progress();

  return (
    <main className="mx-auto max-w-[820px] px-6 pt-12 pb-24">
      <nav className="flex items-center gap-2 text-[13px] text-paper-muted">
        <Link href="/learning" className="transition-colors duration-150 hover:text-paper-ink">
          All topics
        </Link>
        <span className="text-paper-faint">/</span>
        <span className="text-paper-ink-2">The path</span>
      </nav>

      <h1 className="mt-5 font-serif text-[34px] leading-[1.15] text-paper-ink">
        The path
      </h1>
      <p className="mt-2.5 max-w-[64ch] text-[15.5px] leading-[1.65] text-paper-muted">
        The dev plan and the curriculum are the same list. For each task: read the
        lesson, implement it in this repo, and I review it before we move on.
      </p>

      <div className="mt-5 flex items-center gap-3">
        <div className="h-1 w-40 overflow-hidden rounded-full bg-paper-line">
          <div
            className="h-full rounded-full bg-paper-ink transition-[width] duration-300"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
        <span className="font-mono text-[11.5px] text-paper-faint">
          {done}/{total} tasks
        </span>
      </div>

      <div className="mt-11 space-y-12">
        {path.map((phase) => (
          <section key={phase.id}>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[11.5px] tracking-[0.06em] text-paper-faint">
                PHASE {phase.id}
              </span>
              <h2 className="font-serif text-[24px] leading-[1.25] text-paper-ink">
                {phase.title}
              </h2>
              {!phase.detailed ? (
                <span className="rounded-[4px] bg-paper-code px-1.5 py-[2px] font-mono text-[10px] text-paper-muted">
                  SKETCH
                </span>
              ) : null}
            </div>
            <p className="mt-2 max-w-[68ch] text-[14.5px] leading-[1.65] text-paper-muted">
              {phase.goal}
            </p>

            <ol className="mt-5 space-y-2.5">
              {phase.tasks.map((t) => {
                const s = STATUS[t.status];
                const Icon = s.icon;
                const body = (
                  <>
                    <span className="flex w-11 shrink-0 items-center gap-2 pt-[2px]">
                      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                      <span className="font-mono text-[11.5px] text-paper-faint">{t.id}</span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-paper-ink">
                        {t.title}
                      </span>
                      <span className="mt-1 block text-[13.5px] leading-[1.6] text-paper-muted">
                        <Inline text={t.outcome} />
                      </span>
                      <span className="mt-1.5 block text-[13px] leading-[1.55] text-paper-faint">
                        Teaches: <Inline text={t.teaches} />
                      </span>
                      {t.needs?.length ? (
                        <span className="mt-1.5 block font-mono text-[11px] text-paper-faint">
                          after {t.needs.join(", ")}
                        </span>
                      ) : null}
                    </span>

                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 pt-[2px] text-[11.5px]",
                        s.cls,
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <span className="hidden sm:inline">{s.label}</span>
                    </span>

                    {t.lesson ? (
                      <ArrowRight
                        className="mt-[3px] hidden h-4 w-4 shrink-0 text-paper-faint transition-transform duration-150 group-hover:translate-x-0.5 sm:block"
                        strokeWidth={1.75}
                      />
                    ) : null}
                  </>
                );

                const shell =
                  "group flex items-start gap-3 rounded-[10px] border px-4 py-3.5 transition-colors duration-150";

                return (
                  <li key={t.id}>
                    {t.lesson ? (
                      <Link
                        href={`/learning/${t.lesson[0]}/${t.lesson[1]}`}
                        className={cn(
                          shell,
                          "border-paper-line bg-paper-card hover:border-paper-faint",
                        )}
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className={cn(shell, "border-paper-line-soft bg-transparent")}>
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      <p className="mt-14 border-t border-paper-line pt-6 text-[13.5px] leading-[1.65] text-paper-muted">
        Tasks without a lesson link have not been written yet — say{" "}
        <code className="rounded-[3px] bg-paper-code px-[0.35em] py-[0.12em] font-mono text-[0.86em] text-paper-ink">
          next task
        </code>{" "}
        and the lesson gets written before you start it. Full guide to the loop:{" "}
        <code className="rounded-[3px] bg-paper-code px-[0.35em] py-[0.12em] font-mono text-[0.86em] text-paper-ink">
          docs/using-teach.md
        </code>
        .
      </p>
    </main>
  );
}
