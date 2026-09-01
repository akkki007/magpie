"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/cn";
import { printFormula } from "@/lib/model/formula";
import { parseFormula } from "@/lib/model/parse";
import { FUNCTIONS, FUNCTION_NAMES } from "@/lib/model/primitives";
import { validateFormula } from "@/lib/model/validate";
import type { FormulaNode, Model, Variable } from "@/lib/model/types";

/**
 * Editing a formula as text (`docs/modelling-plan.md` M2.2).
 *
 * The panel opens on the printed string and saves the parsed tree — §1.1 is
 * unchanged, the text is a rendering at both ends. That only holds because the
 * parser is the printer's exact inverse: open a formula, change nothing, press
 * Enter, and the tree that goes back to Postgres is the one that came out.
 * `scripts/calc-check.ts` asserts it over every formula in the model, because
 * "the editor rewrote a formula I did not touch" is a bug a user would never
 * think to report as one.
 *
 * **Nothing invalid can be saved.** The same `validateFormula` the server runs
 * at the write path runs here on every keystroke, so the message arrives while
 * the user is still looking at the text they typed, and Save is simply
 * unavailable until it clears. The server check is not thereby redundant —
 * this one is a courtesy, that one is the rule (§5).
 */

const PANEL_WIDTH = 460;
const MAX_SUGGESTIONS = 6;

type Suggestion =
  | { kind: "variable"; label: string; detail: string; insert: string }
  | { kind: "function"; label: string; detail: string; insert: string };

export function FormulaEditor({
  model,
  variable,
  anchorRef,
  onSave,
  onClose,
}: {
  model: Model;
  variable: Variable;
  /** The pill the panel hangs off, re-measured while it is open. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onSave: (formula: FormulaNode | null) => void;
  onClose: () => void;
}) {
  const nameOf = useMemo(() => {
    const names = new Map(model.variables.map((v) => [v.id, v.name]));
    return (id: string) => names.get(id) ?? id;
  }, [model.variables]);

  const initial = variable.formula ? printFormula(variable.formula, nameOf) : "";
  const [draft, setDraft] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const [highlight, setHighlight] = useState(0);
  const [highlightFor, setHighlightFor] = useState("");
  const [dismissed, setDismissed] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  /**
   * Re-measured on scroll rather than closed on it. `Menu` closes, which is
   * right for a menu and wrong here: the grid scrolls under a panel that has
   * half-typed text in it, and losing that to a stray wheel event is the kind
   * of thing that stops people using an editor at all.
   */
  useLayoutEffect(() => {
    const measure = () => setAnchor(anchorRef.current?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [anchorRef]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [anchorRef, onClose]);

  /* ── What the text currently means ──────────────────────────────────────*/

  const trimmed = draft.trim();
  const parsed = trimmed ? parseFormula(draft, model) : null;
  const invalid =
    parsed?.ok === true ? validateFormula(parsed.node, model, variable.id) : null;
  const error = parsed && !parsed.ok ? parsed.error.message : (invalid?.message ?? null);
  const saveable = !error;

  /* ── Autocomplete ───────────────────────────────────────────────────────*/

  // The word immediately before the caret. Names contain spaces, so a query
  // that spanned them would match half the model on every keystroke; a single
  // word is what the user is visibly typing, and `Open` still finds
  // `Opening ARR` because variables match on containment.
  const query = /[A-Za-z0-9_]*$/.exec(draft.slice(0, caret))?.[0] ?? "";

  const suggestions = useMemo<Suggestion[]>(() => {
    if (dismissed || query.length < 1) return [];
    const lower = query.toLowerCase();

    const variables: Suggestion[] = model.variables
      .filter((v) => v.name.toLowerCase().includes(lower))
      .sort((a, b) => {
        // A name that starts with what was typed is what was meant.
        const rank = (n: string) => (n.toLowerCase().startsWith(lower) ? 0 : 1);
        return rank(a.name) - rank(b.name) || a.name.length - b.name.length;
      })
      .map((v) => ({
        kind: "variable" as const,
        label: v.name,
        detail: v.kind === "FORMULA" ? "computed" : v.kind.toLowerCase(),
        insert: v.name,
      }));

    const functions: Suggestion[] = FUNCTION_NAMES.filter((fn) =>
      fn.toLowerCase().startsWith(lower),
    ).map((fn) => ({
      kind: "function" as const,
      label: `${fn}(${FUNCTIONS[fn].params.join(", ")})`,
      detail: FUNCTIONS[fn].summary,
      insert: `${fn}(`,
    }));

    return [...functions, ...variables].slice(0, MAX_SUGGESTIONS);
  }, [dismissed, model.variables, query]);

  // Adjusted during render rather than in an effect: an effect would paint one
  // frame with the previous row highlighted, and Enter in that frame accepts
  // the wrong suggestion.
  if (highlightFor !== query) {
    setHighlightFor(query);
    setHighlight(0);
  }

  function accept(suggestion: Suggestion) {
    const before = draft.slice(0, caret - query.length);
    const after = draft.slice(caret);
    const next = before + suggestion.insert + after;
    const position = (before + suggestion.insert).length;
    setDraft(next);
    setDismissed(true);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(position, position);
      setCaret(position);
    });
  }

  function commit() {
    if (!saveable) return;
    if (!trimmed) return onSave(null);
    if (parsed?.ok) onSave(parsed.node);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const open = suggestions.length > 0;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // One Escape dismisses the list, a second closes the editor: otherwise
      // an open list makes it impossible to abandon an edit without the mouse.
      if (open) return setDismissed(true);
      return onClose();
    }
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      return setHighlight((h) => (h + step + suggestions.length) % suggestions.length);
    }
    if (open && (event.key === "Tab" || event.key === "Enter")) {
      event.preventDefault();
      return accept(suggestions[highlight]);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      return commit();
    }
  }

  const preview =
    parsed?.ok && !invalid ? printFormula(parsed.node, nameOf) : null;
  const normalised = preview !== null && preview !== draft.trim();

  if (!anchor) return null;

  const left = Math.max(
    8,
    Math.min(anchor.left, window.innerWidth - PANEL_WIDTH - 8),
  );
  const dropUp = window.innerHeight - anchor.bottom < 300;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Formula for ${variable.name}`}
      style={{
        position: "fixed",
        width: PANEL_WIDTH,
        left,
        ...(dropUp ? { bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6 }),
      }}
      className="z-50 rounded-card border border-line bg-surface shadow-e2"
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[11px] font-semibold tracking-[0.01em] text-ink-faint uppercase">
          {variable.name}
        </span>
        <span className="ml-auto text-[11px] text-ink-faint">
          {variable.formula ? "Editing formula" : "Add a formula"}
        </span>
      </div>

      <div className="px-3 py-2.5">
        <input
          ref={inputRef}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          placeholder="Opening ARR + New ARR – Churn ARR"
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setDismissed(false);
          }}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full rounded-button border bg-canvas px-2 py-1.5 font-mono text-[13px] text-ink-1",
            "outline-none transition-colors duration-150",
            error ? "border-neg-fg/40 focus:border-neg-fg" : "border-line focus:border-blue-400",
          )}
        />

        {error ? (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-neg-fg">
            <TriangleAlert className="mt-px h-3 w-3 shrink-0" strokeWidth={1.75} />
            <span>{error}</span>
          </p>
        ) : normalised ? (
          // Shown only when saving would change the text — a user who typed
          // `a*b` should see that it lands as `a × b` before it happens, and a
          // user who changed nothing should see no noise at all.
          <p className="mt-2 truncate text-[11px] text-ink-faint">Saves as {preview}</p>
        ) : (
          <p className="mt-2 text-[11px] text-ink-faint">
            {trimmed ? " " : "Leave it empty to make this a row you type into."}
          </p>
        )}
      </div>

      {suggestions.length > 0 && (
        <ul className="max-h-[188px] overflow-y-auto border-t border-line p-1">
          {suggestions.map((suggestion, index) => (
            <li key={`${suggestion.kind}-${suggestion.label}`}>
              <button
                type="button"
                // mousedown, not click: the input would blur first otherwise.
                onMouseDown={(event) => {
                  event.preventDefault();
                  accept(suggestion);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded-button px-2 py-1 text-left",
                  index === highlight ? "bg-hover" : "",
                )}
              >
                <span
                  className={cn(
                    "shrink-0 text-[12px]",
                    suggestion.kind === "function" ? "font-mono text-violet-700" : "text-ink-1",
                  )}
                >
                  {suggestion.label}
                </span>
                <span className="truncate text-[11px] text-ink-faint">{suggestion.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <span className="text-[11px] text-ink-faint">
          {suggestions.length > 0 ? "Tab to complete" : "Esc to cancel"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-button px-2 py-1 text-[12px] text-ink-2 transition-colors duration-150 hover:bg-hover"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!saveable}
          onClick={commit}
          className={cn(
            "flex items-center gap-1.5 rounded-button px-2.5 py-1 text-[12px] transition-colors duration-150",
            saveable
              ? "bg-blue-400 text-white hover:bg-blue-500"
              : "cursor-not-allowed bg-line text-ink-faint",
          )}
        >
          {trimmed ? "Save" : "Clear formula"}
          <CornerDownLeft className="h-3 w-3" strokeWidth={2} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
