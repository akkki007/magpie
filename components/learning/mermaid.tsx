"use client";

import { useEffect, useId, useState } from "react";
import { Expand, X } from "lucide-react";
import { Inline } from "./markdown";
import { useTheme } from "./theme";

/** Mirrors the --color-paper-* tokens in app/globals.css for each theme. */
const MERMAID_COLORS = {
  light: {
    background: "#ffffff",
    primaryColor: "#ffffff",
    primaryBorderColor: "#c9c6c0",
    primaryTextColor: "#1a1a18",
    lineColor: "#8d8a83",
    secondaryColor: "#f5f4f2",
    tertiaryColor: "#f5f4f2",
  },
  dark: {
    background: "#1b1b19",
    primaryColor: "#1b1b19",
    primaryBorderColor: "#43423c",
    primaryTextColor: "#f0efeb",
    lineColor: "#8b877e",
    secondaryColor: "#141412",
    tertiaryColor: "#141412",
  },
} as const;

/**
 * Mermaid is ~500KB, so it is imported dynamically inside the effect — it never
 * touches the shared bundle, and a lesson with no diagram never pays for it.
 */
export function Diagram({ chart, caption }: { chart: string; caption?: string }) {
  const id = useId().replace(/:/g, "");
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* The rendered SVG lives in state, not in a ref read back out of the DOM —
     the modal needs the same markup, and reading a ref during render is both a
     lint error and genuinely unreliable. */
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          fontFamily: "var(--font-sans)",
          /* Mermaid bakes colours into the SVG at render time, so unlike the rest
             of the surface these cannot be swapped by a CSS variable — the diagram
             has to be re-rendered when the theme changes. Hence `theme` in the
             dependency array below. */
          themeVariables: MERMAID_COLORS[theme],
        });
        const { svg: rendered } = await mermaid.render(`m${id}-${theme}`, chart);
        if (alive) setSvg(rendered);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "diagram failed to render");
      }
    })();
    return () => {
      alive = false;
    };
  }, [chart, id, theme]);

  if (error) {
    return (
      <pre className="my-7 overflow-x-auto rounded-[10px] border border-no-line bg-no-bg p-4 font-mono text-[12px] text-no-fg">
        Diagram failed to render: {error}
      </pre>
    );
  }

  return (
    <figure className="my-8">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[11px] tracking-[0.06em] text-paper-faint">
          Diagram
        </span>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-paper-faint transition-colors duration-150 hover:text-paper-ink"
        >
          <Expand className="h-3 w-3" strokeWidth={1.75} />
          Select to expand
        </button>
      </div>

      <button
        onClick={() => setOpen(true)}
        aria-label="Expand diagram"
        className="block w-full cursor-zoom-in overflow-x-auto rounded-[10px] border border-paper-line bg-paper-card px-4 py-6"
      >
        <div
          className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg ?? "" }}
        />
      </button>

      {caption ? (
        <figcaption className="mt-2.5 text-[13.5px] leading-[1.6] text-paper-muted">
          <Inline text={caption} />
        </figcaption>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[90vh] w-full max-w-[1100px] overflow-auto rounded-[14px] border border-paper-line bg-paper-card p-8"
          >
            <button
              onClick={() => setOpen(false)}
              aria-label="Close diagram"
              autoFocus
              className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-[6px] text-paper-muted transition-colors duration-150 hover:bg-paper"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
            <div
              className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg ?? "" }}
            />
          </div>
        </div>
      ) : null}
    </figure>
  );
}
