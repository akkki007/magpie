"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark";

/** Must match the key read by the pre-paint script in app/layout.tsx. */
const STORAGE_KEY = "magpie-theme";

/**
 * The theme is not React state — it is a class on <html>, set by the pre-paint
 * script in app/layout.tsx before React exists, so that /learning never flashes
 * white on the way to dark. That makes it an *external store*, and
 * `useSyncExternalStore` is the hook for exactly that: React subscribes,
 * re-reads on change, and handles the server/client split itself.
 *
 * The obvious alternative — `useState` seeded in an effect — reads worse and
 * behaves worse: it renders one frame with a guess, then sets state during an
 * effect to correct it, which is a cascading render and a lint error both.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * `null` on the server, because there the answer is genuinely unknown: it lives
 * in the visitor's localStorage or OS preference. Callers that need a concrete
 * theme fall back to light; the toggle uses the null to draw no icon at all
 * rather than the wrong one.
 */
function getServerSnapshot(): Theme | null {
  return null;
}

export function useTheme() {
  const resolved = useSyncExternalStore<Theme | null>(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setTheme = useCallback((next: Theme) => {
    const root = document.documentElement;
    root.classList.toggle("dark", next === "dark");
    root.classList.toggle("light", next === "light");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Private mode or blocked storage: the toggle still works for this page. */
    }
  }, []);

  return { theme: resolved ?? "light", resolved: resolved !== null, setTheme };
}

export function ThemeToggle() {
  const { theme, resolved, setTheme } = useTheme();

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      /* Until the theme resolves on the client we cannot know it, so render the
         control at the right size with no icon rather than flashing the wrong
         one and shifting the layout when it corrects itself. */
      className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] border border-paper-line bg-paper-card text-paper-muted transition-colors duration-150 hover:border-paper-faint hover:text-paper-ink"
    >
      {!resolved ? null : theme === "dark" ? (
        <Sun className="h-3.5 w-3.5" strokeWidth={1.75} />
      ) : (
        <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
}
