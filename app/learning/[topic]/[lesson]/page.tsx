import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getLesson, topics } from "@/learning";
import { Blocks } from "@/components/learning/blocks";
import { ProgressPill } from "@/components/learning/progress";

export function generateStaticParams() {
  return topics.flatMap((t) =>
    t.lessons.map((l) => ({ topic: t.slug, lesson: l.slug })),
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/learning/[topic]/[lesson]">) {
  const p = await params;
  const found = getLesson(p.topic, p.lesson);
  return {
    title: found?.lesson.title ?? "Lesson",
    description: found?.lesson.summary,
  };
}

export default async function LessonPage({
  params,
}: PageProps<"/learning/[topic]/[lesson]">) {
  const p = await params;
  const found = getLesson(p.topic, p.lesson);
  if (!found) notFound();
  const { topic, lesson, prev, next } = found;

  // Section headings drive the floating progress indicator.
  const sections = lesson.blocks
    .filter((b) => b.kind === "heading")
    .map((b) => ({ id: b.id, text: b.text }));
  if (lesson.blocks.some((b) => b.kind === "task")) {
    sections.push({ id: "task", text: "Your Turn — Build It" });
  }

  return (
    <>
      <main className="mx-auto max-w-[720px] px-6 pt-12 pb-28">
        <nav className="flex flex-wrap items-center gap-2 text-[13px] text-paper-muted">
          <Link href="/learning" className="transition-colors duration-150 hover:text-paper-ink">
            All topics
          </Link>
          <span className="text-paper-faint">/</span>
          <Link
            href={`/learning/${topic.slug}`}
            className="transition-colors duration-150 hover:text-paper-ink"
          >
            {topic.title}
          </Link>
        </nav>

        <p className="mt-6 font-mono text-[11.5px] tracking-[0.06em] text-paper-faint">
          LESSON {lesson.n} · {lesson.minutes} MIN
        </p>
        <h1 className="mt-2 font-serif text-[32px] leading-[1.18] text-paper-ink">
          {lesson.title}
        </h1>
        <p className="mt-3 text-[16px] leading-[1.65] text-paper-muted">
          {lesson.summary}
        </p>

        <hr className="mt-8 border-paper-line" />

        <article>
          <Blocks blocks={lesson.blocks} />
        </article>

        <nav className="mt-16 flex flex-col gap-3 border-t border-paper-line pt-6 sm:flex-row">
          {prev ? (
            <Link
              href={`/learning/${topic.slug}/${prev.slug}`}
              className="group flex flex-1 items-center gap-3 rounded-[10px] border border-paper-line bg-paper-card px-4 py-3 transition-colors duration-150 hover:border-paper-faint"
            >
              <ArrowLeft className="h-4 w-4 shrink-0 text-paper-faint" strokeWidth={1.75} />
              <span className="min-w-0">
                <span className="block font-mono text-[10.5px] tracking-[0.06em] text-paper-faint">
                  PREVIOUS
                </span>
                <span className="block truncate text-[14px] text-paper-ink">
                  {prev.title}
                </span>
              </span>
            </Link>
          ) : null}

          {next ? (
            <Link
              href={`/learning/${topic.slug}/${next.slug}`}
              className="group flex flex-1 items-center gap-3 rounded-[10px] border border-paper-line bg-paper-card px-4 py-3 text-right transition-colors duration-150 hover:border-paper-faint sm:justify-end"
            >
              <span className="min-w-0">
                <span className="block font-mono text-[10.5px] tracking-[0.06em] text-paper-faint">
                  NEXT
                </span>
                <span className="block truncate text-[14px] text-paper-ink">
                  {next.title}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-paper-faint" strokeWidth={1.75} />
            </Link>
          ) : null}
        </nav>
      </main>

      <ProgressPill sections={sections} />
    </>
  );
}
