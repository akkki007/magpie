import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getTopic, topics } from "@/learning";

export function generateStaticParams() {
  return topics.map((t) => ({ topic: t.slug }));
}

export async function generateMetadata({ params }: PageProps<"/learning/[topic]">) {
  const topic = getTopic((await params).topic);
  return { title: topic?.title ?? "Topic", description: topic?.summary };
}

export default async function TopicPage({ params }: PageProps<"/learning/[topic]">) {
  const topic = getTopic((await params).topic);
  if (!topic) notFound();

  return (
    <main className="mx-auto max-w-[1000px] px-6 pt-12 pb-24">
      <nav className="flex items-center gap-2 text-[13px] text-paper-muted">
        <Link href="/learning" className="transition-colors duration-150 hover:text-paper-ink">
          All topics
        </Link>
        <span className="text-paper-faint">/</span>
        <span className="text-paper-ink-2">{topic.title}</span>
      </nav>

      <h1 className="mt-5 font-serif text-[34px] leading-[1.15] text-paper-ink">
        {topic.title}
      </h1>
      <p className="mt-2.5 max-w-[68ch] text-[15.5px] leading-[1.65] text-paper-muted">
        {topic.summary}
      </p>
      <p className="mt-4 font-mono text-[11.5px] text-paper-faint">
        {topic.lessons.length} lessons
        {topic.phase ? ` · phase ${topic.phase} on the path` : ""}
      </p>

      <div className="mt-9 space-y-3">
        {topic.lessons.map((l) => (
          <Link
            key={l.slug}
            href={`/learning/${topic.slug}/${l.slug}`}
            className="group flex items-start gap-4 rounded-[10px] border border-paper-line bg-paper-card px-5 py-4 transition-colors duration-150 hover:border-paper-faint"
          >
            {/* pt aligns the number to the title's first baseline, not the card's centre */}
            <span className="w-5 shrink-0 pt-[3px] font-mono text-[12px] text-paper-faint">
              {l.n}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-medium text-paper-ink">
                {l.title}
              </span>
              <span className="mt-1 block text-[14px] leading-[1.6] text-paper-muted">
                {l.summary}
              </span>
            </span>
            <ChevronRight
              className="mt-[3px] h-4 w-4 shrink-0 text-paper-faint transition-transform duration-150 group-hover:translate-x-0.5"
              strokeWidth={1.75}
            />
          </Link>
        ))}
      </div>
    </main>
  );
}
