import Image from "next/image";
import Link from "next/link";
import {
  BookOpen,
  ClipboardCheck,
  FileCode2,
  Info,
  Key,
  TriangleAlert,
} from "lucide-react";
import type { Block } from "@/learning/types";
import { Inline } from "./markdown";
import { Diagram } from "./mermaid";
import { Quiz } from "./quiz";
import { cn } from "@/lib/cn";

const CALLOUT = {
  note: { icon: Info, bg: "bg-paper-card", line: "border-paper-line", fg: "text-paper-muted" },
  warn: { icon: TriangleAlert, bg: "bg-hint-bg", line: "border-hint-line", fg: "text-hint-fg" },
  key: { icon: Key, bg: "bg-ok-bg", line: "border-ok-line", fg: "text-ok-fg" },
} as const;

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </>
  );
}

function BlockView({ block: b }: { block: Block }) {
  switch (b.kind) {
    case "heading":
      return (
        <h2
          id={b.id}
          className="mt-14 mb-4 scroll-mt-24 font-serif text-[26px] leading-[1.25] font-normal text-paper-ink"
        >
          {b.text}
        </h2>
      );

    case "prose":
      return (
        <p className="my-4 text-[15.5px] leading-[1.72] text-paper-ink-2">
          <Inline text={b.text} />
        </p>
      );

    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag
          className={cn(
            "my-4 space-y-2 pl-5 text-[15.5px] leading-[1.7] text-paper-ink-2",
            b.ordered ? "list-decimal" : "list-disc",
            "marker:text-paper-faint",
          )}
        >
          {b.items.map((it, i) => (
            <li key={i} className="pl-1">
              <Inline text={it} />
            </li>
          ))}
        </Tag>
      );
    }

    case "code":
      return (
        <div className="my-6 overflow-hidden rounded-[10px] border border-paper-line bg-paper-card">
          {b.file ? (
            <div className="flex items-center gap-2 border-b border-paper-line-soft px-4 py-2">
              <FileCode2 className="h-3.5 w-3.5 text-paper-faint" strokeWidth={1.75} />
              <span className="font-mono text-[11.5px] text-paper-muted">{b.file}</span>
            </div>
          ) : null}
          <pre className="overflow-x-auto px-4 py-3.5">
            <code className="font-mono text-[12.5px] leading-[1.65] text-paper-ink">
              {b.code.trim()}
            </code>
          </pre>
        </div>
      );

    case "table":
      return (
        <div className="my-7 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-paper-line">
                {b.head.map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-[13px] font-medium text-paper-muted first:pl-0 last:pr-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-b border-paper-line-soft last:border-0">
                  {r.map((c, j) => (
                    <td
                      key={j}
                      className="px-3 py-2.5 align-top text-[14px] leading-[1.6] text-paper-ink-2 first:pl-0 last:pr-0"
                    >
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "diagram":
      return <Diagram chart={b.mermaid} caption={b.caption} />;

    case "image":
      return (
        <figure className="my-8">
          <Image
            src={b.src}
            alt={b.alt}
            width={b.width}
            height={b.height}
            className="w-full rounded-[10px] border border-paper-line bg-paper-card"
            sizes="(max-width: 768px) 100vw, 720px"
          />
          {b.caption ? (
            <figcaption className="mt-2.5 text-[13.5px] leading-[1.6] text-paper-muted">
              <Inline text={b.caption} />
            </figcaption>
          ) : null}
        </figure>
      );

    case "callout": {
      const c = CALLOUT[b.tone];
      const Icon = c.icon;
      return (
        <aside className={cn("my-6 rounded-[10px] border px-4 py-3.5", c.bg, c.line)}>
          <div className="flex items-center gap-2">
            <Icon className={cn("h-3.5 w-3.5 shrink-0", c.fg)} strokeWidth={1.75} />
            <span className={cn("text-[12.5px] font-semibold", c.fg)}>
              {b.title ?? (b.tone === "key" ? "The idea" : b.tone === "warn" ? "Watch out" : "Note")}
            </span>
          </div>
          <p className="mt-1.5 text-[14.5px] leading-[1.65] text-paper-ink-2">
            <Inline text={b.text} />
          </p>
        </aside>
      );
    }

    case "source":
      return (
        <aside className="my-6 rounded-[10px] border border-paper-line bg-paper-card px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-paper-faint" strokeWidth={1.75} />
            <span className="font-mono text-[12px] text-paper-ink">
              {b.path}
              {b.lines ? <span className="text-paper-faint">:{b.lines}</span> : null}
            </span>
            <span className="ml-auto font-mono text-[10.5px] tracking-[0.06em] text-paper-faint">
              IN THIS REPO
            </span>
          </div>
          <p className="mt-1.5 text-[14.5px] leading-[1.65] text-paper-ink-2">
            <Inline text={b.note} />
          </p>
        </aside>
      );

    case "docs":
      return (
        <aside className="my-6 rounded-[10px] border border-paper-line bg-paper-card px-4 py-3.5">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-paper-faint" strokeWidth={1.75} />
            <span className="text-[12.5px] font-semibold text-paper-muted">
              Read the docs
            </span>
          </div>
          <ul className="mt-2.5 space-y-2">
            {b.links.map((l) => (
              <li key={l.href} className="text-[14px] leading-[1.6]">
                <a
                  href={l.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-paper-ink underline decoration-paper-line underline-offset-[3px] transition-colors duration-150 hover:decoration-paper-muted"
                >
                  {l.label}
                </a>
                {l.note ? (
                  <span className="text-paper-muted"> — {l.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </aside>
      );

    case "task":
      return (
        <section className="mt-14">
          <div className="flex items-baseline gap-3">
            <h2
              id="task"
              className="scroll-mt-24 font-serif text-[26px] leading-[1.25] text-paper-ink"
            >
              Your Turn — Build It
            </h2>
            <Link
              href="/learning/path"
              className="font-mono text-[11.5px] text-paper-faint transition-colors duration-150 hover:text-paper-ink"
            >
              TASK {b.taskId}
            </Link>
          </div>

          <p className="my-4 text-[15.5px] leading-[1.72] text-paper-ink-2">
            <Inline text={b.goal} />
          </p>

          <div className="my-5 rounded-[10px] border border-paper-line bg-paper-card px-4 py-3.5">
            <div className="flex items-center gap-2">
              <FileCode2 className="h-3.5 w-3.5 text-paper-faint" strokeWidth={1.75} />
              <span className="text-[12.5px] font-semibold text-paper-muted">
                Files you&apos;ll touch
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {b.files.map((f) => (
                <li key={f} className="font-mono text-[12px] text-paper-ink">
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {b.parts.map((p) => (
            <div key={p.title} className="mt-7">
              <h3 className="font-serif text-[19px] leading-[1.3] text-paper-ink">
                {p.title}
              </h3>
              <ol className="mt-3 space-y-2 pl-5 text-[15px] leading-[1.7] text-paper-ink-2 marker:text-paper-faint list-decimal">
                {p.steps.map((step, i) => (
                  <li key={i} className="pl-1">
                    <Inline text={step} />
                  </li>
                ))}
              </ol>
            </div>
          ))}

          <div className="mt-8 rounded-[10px] border border-ok-line bg-ok-bg px-4 py-3.5">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-3.5 w-3.5 text-ok-fg" strokeWidth={1.75} />
              <span className="text-[12.5px] font-semibold text-ok-fg">
                What I&apos;ll review it against
              </span>
            </div>
            <ul className="mt-2.5 space-y-2">
              {b.criteria.map((c, i) => (
                <li
                  key={i}
                  className="flex gap-2.5 text-[14.5px] leading-[1.6] text-paper-ink-2"
                >
                  <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ok-fg" />
                  <span>
                    <Inline text={c} />
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-ok-line pt-3 text-[13.5px] leading-[1.6] text-paper-ink-2">
              When it builds and you think it&apos;s right, say{" "}
              <strong className="font-semibold text-paper-ink">
                &ldquo;review {b.taskId}&rdquo;
              </strong>{" "}
              and I&apos;ll go through it properly — correctness first, then design, then
              style.
            </p>
          </div>
        </section>
      );

    case "quiz":
      return (
        <Quiz
          question={b.question}
          options={b.options}
          answer={b.answer}
          explain={b.explain}
        />
      );
  }
}
