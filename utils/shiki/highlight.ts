import type { HighlighterCore } from "shiki/core";

/**
 * Added via: bunx --bun shadcn@latest add https://code-blocks.pheralb.dev/r/client-shiki.json
 *
 * Changed from the registry version in two ways, both deliberate:
 *
 * 1. Everything is imported *inside* `build()` rather than at module top. Shiki's
 *    engine, two themes and ten grammars are a few hundred KB; a static import
 *    would put all of it in the bundle of any page that renders a code block.
 *    Now it is a separate chunk, fetched on first highlight. Same reasoning as
 *    components/learning/mermaid.tsx.
 * 2. `prisma` and `sql` are added to the grammar list — the lessons in
 *    learning/postgres-prisma use both, and the registry's default set has neither.
 */

let highlighter: Promise<HighlighterCore> | null = null;

/** The two themes are shipped together so one render can emit both; see Themes below. */
const Themes = {
  light: "one-light",
  dark: "one-dark-pro",
} as const;

export type Languages =
  | "bash"
  | "css"
  | "html"
  | "js"
  | "json"
  | "mdx"
  | "prisma"
  | "sql"
  | "text"
  | "ts"
  | "tsx";

async function build(): Promise<HighlighterCore> {
  const [
    { createHighlighterCore },
    { createJavaScriptRegexEngine },
    lightTheme,
    darkTheme,
    bash,
    css,
    html,
    js,
    json,
    mdx,
    prisma,
    sql,
    ts,
    tsx,
  ] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("@shikijs/themes/one-light"),
    import("@shikijs/themes/one-dark-pro"),
    import("@shikijs/langs/bash"),
    import("@shikijs/langs/css"),
    import("@shikijs/langs/html"),
    import("@shikijs/langs/js"),
    import("@shikijs/langs/json"),
    import("@shikijs/langs/mdx"),
    import("@shikijs/langs/prisma"),
    import("@shikijs/langs/sql"),
    import("@shikijs/langs/ts"),
    import("@shikijs/langs/tsx"),
  ]);

  return createHighlighterCore({
    themes: [lightTheme.default, darkTheme.default],
    langs: [
      bash.default,
      css.default,
      html.default,
      js.default,
      json.default,
      mdx.default,
      prisma.default,
      sql.default,
      ts.default,
      tsx.default,
    ],
    engine: createJavaScriptRegexEngine(),
  });
}

/** Memoised: the highlighter is built once per page load, however many blocks use it. */
const highlight = (): Promise<HighlighterCore> => (highlighter ??= build());

export { highlight, Themes };
