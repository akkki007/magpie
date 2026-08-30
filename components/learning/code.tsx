"use client";

import { useState } from "react";
import { Check, Copy, FileCode2 } from "lucide-react";
import { CodeblockShiki } from "@/components/code-block/client/shiki";
import type { Languages } from "@/utils/shiki/highlight";

/**
 * The lesson code block: our chrome (file caption, hairline border, copy button)
 * around the shadcn/Shiki highlighter.
 *
 * Kept separate from components/code-block/* on purpose — that directory is
 * vendored from a registry and should stay re-addable without losing this.
 */

/** Grammars we actually load. Anything else renders unhighlighted rather than throwing. */
const SUPPORTED = new Set<Languages>([
  "bash",
  "css",
  "html",
  "js",
  "json",
  "mdx",
  "prisma",
  "sql",
  "text",
  "ts",
  "tsx",
]);

/** A few spellings a lesson might reasonably use for a grammar we do load. */
const ALIASES: Record<string, Languages> = {
  javascript: "js",
  typescript: "ts",
  shell: "bash",
  sh: "bash",
  md: "mdx",
  markdown: "mdx",
  plaintext: "text",
  txt: "text",
};

function resolveLang(lang: string): Languages {
  const l = lang.toLowerCase();
  if (SUPPORTED.has(l as Languages)) return l as Languages;
  return ALIASES[l] ?? "text";
}

export function CodeBlock({
  lang,
  file,
  code,
}: {
  lang: string;
  file?: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);
  const source = code.trim();

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard blocked (insecure origin, denied permission). The code is
         selectable either way, so there is nothing useful to report here. */
    }
  }

  return (
    <div className="group my-6 overflow-hidden rounded-[10px] border border-paper-line bg-paper-card">
      <div className="flex items-center gap-2 border-b border-paper-line-soft px-4 py-2">
        {file ? (
          <>
            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-paper-faint" strokeWidth={1.75} />
            <span className="truncate font-mono text-[11.5px] text-paper-muted">{file}</span>
          </>
        ) : (
          <span className="font-mono text-[11px] tracking-[0.06em] text-paper-faint uppercase">
            {resolveLang(lang)}
          </span>
        )}

        <button
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-1 font-mono text-[10.5px] text-paper-faint transition-colors duration-150 hover:bg-paper hover:text-paper-ink"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" strokeWidth={2} />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" strokeWidth={1.75} />
              Copy
            </>
          )}
        </button>
      </div>

      <CodeblockShiki
        code={source}
        language={resolveLang(lang)}
        className="py-1 text-[12.5px] leading-[1.65]"
      />
    </div>
  );
}
