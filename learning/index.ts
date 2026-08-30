import type { Topic } from "./types";
import type { SearchItem } from "@/components/learning/chrome";

import nextjsAppRouter from "./nextjs-app-router/meta";

/**
 * The topic registry. The `teach` skill appends to this list — that is the only
 * wiring a new topic needs.
 */
export const topics: Topic[] = [nextjsAppRouter];

export function getTopic(slug: string) {
  return topics.find((t) => t.slug === slug);
}

export function getLesson(topicSlug: string, lessonSlug: string) {
  const topic = getTopic(topicSlug);
  const lesson = topic?.lessons.find((l) => l.slug === lessonSlug);
  if (!topic || !lesson) return null;
  const i = topic.lessons.indexOf(lesson);
  return {
    topic,
    lesson,
    prev: i > 0 ? topic.lessons[i - 1] : null,
    next: i < topic.lessons.length - 1 ? topic.lessons[i + 1] : null,
  };
}

export function searchIndex(): SearchItem[] {
  return topics.flatMap((t) =>
    t.lessons.map((l) => ({
      topic: t.title,
      topicSlug: t.slug,
      lessonSlug: l.slug,
      n: l.n,
      title: l.title,
      summary: l.summary,
    })),
  );
}
