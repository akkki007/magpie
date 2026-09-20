import type { ReactNode } from "react";

/**
 * Response formatting for agent output (`docs/agents-plan.md` A5).
 *
 * A block-level renderer, not the inline one `components/learning/markdown.tsx` uses. That
 * one is deliberately tiny because a generated *lesson* must not be able to introduce
 * headings that bypass its block schema. An agent's finding is the opposite case: it is
 * prose written for a person, it arrives with headings, bullets and bold, and rendering it
 * raw is what makes a good answer look like a log line.
 *
 * Still a small subset, and still hand-rolled rather than a markdown library: what an LLM
 * actually emits here is headings, lists, bold, inline code and paragraphs. Everything else
 * degrades to text, which is the right failure — an unrecognised construct should read
 * plainly, never as broken markup.
 */

// **bold** before *italic*, or the bold delimiters get eaten one asterisk at a time.
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\))/g;

function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];

    if (token.startsWith("`")) {
      out.push(
        <code
          key={key++}
          className="rounded-[3px] bg-muted px-[0.35em] py-[0.1em] font-mono text-[0.88em] text-ink"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={key++} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token) ?? [];
      out.push(
        <a key={key++} href={href} className="text-blue-600 underline decoration-blue-200">
          {label}
        </a>,
      );
    } else {
      out.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }

    last = at + token.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: 2 | 3; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "pre"; text: string };

/**
 * Lines → blocks. A single pass, because the shapes are unambiguous: a fence opens and
 * closes, a `- ` or `1. ` line continues a list, a `#` line is a heading, a blank line ends
 * a paragraph.
 */
function parse(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: string[] | null = null;

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "p", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) {
      blocks.push(list.ordered ? { kind: "ol", items: list.items } : { kind: "ul", items: list.items });
      list = null;
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      if (fence) {
        blocks.push({ kind: "pre", text: fence.join("\n") });
        fence = null;
      } else {
        closeParagraph();
        closeList();
        fence = [];
      }
      continue;
    }

    if (fence) {
      fence.push(line);
      continue;
    }

    if (line.trim() === "") {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      // Everything above h3 flattens: an agent's answer sits inside a card that already
      // has a heading, so its own h1 would out-shout the page it is on.
      blocks.push({ kind: "h", level: heading[1].length <= 2 ? 2 : 3, text: heading[2] });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      closeParagraph();
      if (!list || list.ordered) {
        closeList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      closeParagraph();
      if (!list || !list.ordered) {
        closeList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    // A wrapped list item indents under its bullet; append rather than start a paragraph
    // in the middle of a list.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  if (fence) blocks.push({ kind: "pre", text: fence.join("\n") });
  closeParagraph();
  closeList();

  return blocks;
}

export function Markdown({ source }: { source: string }) {
  const blocks = parse(source);

  return (
    <div className="flex flex-col gap-2.5">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "h":
            return block.level === 2 ? (
              <h3 key={index} className="mt-1.5 text-[14px] font-semibold text-ink">
                <Inline text={block.text} />
              </h3>
            ) : (
              <h4 key={index} className="mt-1 text-[13px] font-semibold text-ink">
                <Inline text={block.text} />
              </h4>
            );

          case "ul":
            return (
              <ul key={index} className="flex flex-col gap-1.5 pl-1">
                {block.items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-[1.7] text-ink-2">
                    <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                    <span className="min-w-0">
                      <Inline text={item} />
                    </span>
                  </li>
                ))}
              </ul>
            );

          case "ol":
            return (
              <ol key={index} className="flex flex-col gap-1.5 pl-1">
                {block.items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-[1.7] text-ink-2">
                    <span className="tnum mt-[1px] shrink-0 text-ink-faint">{i + 1}.</span>
                    <span className="min-w-0">
                      <Inline text={item} />
                    </span>
                  </li>
                ))}
              </ol>
            );

          case "pre":
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-control border border-line bg-subtle px-2.5 py-2 font-mono text-[11px] leading-[1.65] text-ink-2"
              >
                {block.text}
              </pre>
            );

          default:
            return (
              <p key={index} className="text-[13px] leading-[1.7] text-ink-2">
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
