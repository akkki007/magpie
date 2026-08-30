import type { ReactNode } from "react";

/**
 * The inline subset lesson prose is allowed to use: `code`, **bold**, _italic_,
 * and [text](href). Deliberately tiny — a full markdown renderer would let a
 * generated lesson introduce headings, images, and styles that bypass the block
 * schema, which is the one thing this design is built to prevent.
 */
// Order matters: **bold** must be tried before *italic*.
const PATTERN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|\[[^\]]+\]\([^)]+\))/g;

export function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;

  for (const m of text.matchAll(PATTERN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];

    if (tok.startsWith("`")) {
      out.push(
        <code
          key={i++}
          className="rounded-[3px] bg-paper-code px-[0.35em] py-[0.12em] font-mono text-[0.86em] text-paper-ink"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={i++} className="font-semibold text-paper-ink">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("_") || tok.startsWith("*")) {
      out.push(<em key={i++}>{tok.slice(1, -1)}</em>);
    } else {
      const label = tok.slice(1, tok.indexOf("]"));
      const href = tok.slice(tok.indexOf("(") + 1, -1);
      const external = href.startsWith("http");
      out.push(
        <a
          key={i++}
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer" : undefined}
          className="underline decoration-paper-line-soft underline-offset-[3px] transition-colors duration-150 hover:decoration-paper-muted"
        >
          {label}
        </a>,
      );
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
