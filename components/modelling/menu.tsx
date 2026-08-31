"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * A small dropdown, written rather than installed.
 *
 * It needs exactly four behaviours — close on outside click, close on Escape,
 * flip upwards near the bottom of the window, and survive being opened from
 * inside a scrolling grid. A headless menu library would bring a portal, focus
 * trapping and a positioning engine for that, and the styling would still be
 * ours.
 *
 * ── Why the panel is portalled to `document.body` ────────────────────────
 * The row menus open from inside a sticky `<th>`, and a sticky cell with a
 * `z-index` creates its own stacking context. A `z-50` panel nested in one
 * cannot paint above the *next* row's sticky cell, so the menu rendered
 * correctly, sat at the right coordinates, and was invisible. Portalling lifts
 * it out of the table's stacking contexts entirely; `position: fixed` off the
 * trigger's measured rect keeps it anchored, and any scroll closes it rather
 * than letting it drift away from the row it belongs to.
 */

type Anchor = { top: number; bottom: number; left: number; right: number };

export function Menu({
  trigger,
  triggerClassName,
  children,
  align = "start",
  width = 200,
  ariaLabel,
}: {
  /** Inline content only — this component supplies the `<button>` itself. */
  trigger: (state: { open: boolean }) => React.ReactNode;
  triggerClassName?: string;
  children: (api: { close: () => void }) => React.ReactNode;
  align?: "start" | "end";
  width?: number;
  ariaLabel?: string;
}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const open = anchor !== null;
  const close = () => setAnchor(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The panel lives outside this component's DOM subtree, so it has to be
      // named explicitly — otherwise the first mousedown inside the menu
      // unmounts it before the item's click ever fires.
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setAnchor(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setAnchor(null);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    // Capture phase: the grid's own scroll container is what usually moves.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  /** Below the trigger, unless that would run off the bottom of the window. */
  const dropUp = anchor ? window.innerHeight - anchor.bottom < 260 : false;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => {
          if (open) return setAnchor(null);
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
          });
        }}
        className={triggerClassName}
      >
        {trigger({ open })}
      </button>

      {anchor &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="menu"
            style={{
              position: "fixed",
              width,
              // Clamped so a menu opened near the right edge stays on screen.
              left: Math.max(
                8,
                Math.min(
                  align === "end" ? anchor.right - width : anchor.left,
                  window.innerWidth - width - 8,
                ),
              ),
              ...(dropUp
                ? { bottom: window.innerHeight - anchor.top + 4 }
                : { top: anchor.bottom + 4 }),
            }}
            className="z-50 rounded-card border border-line bg-surface p-1 shadow-e2"
          >
            {children({ close })}
          </div>,
          document.body,
        )}
    </>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.01em] text-ink-faint uppercase">
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />;
}

export function MenuItem({
  children,
  onSelect,
  icon: Icon,
  danger,
  disabled,
  hint,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-button px-2 py-1.5 text-left text-[13px]",
        "transition-colors duration-150",
        disabled
          ? "cursor-not-allowed text-ink-faint"
          : danger
            ? "text-neg-fg hover:bg-neg-bg"
            : "text-ink-2 hover:bg-hover",
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} />}
      <span className="truncate">{children}</span>
      {hint && <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{hint}</span>}
    </button>
  );
}

/** A menu row that reports state — the grain picker and the column toggles. */
export function MenuChoice({
  children,
  selected,
  onSelect,
  hint,
}: {
  children: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-button px-2 py-1.5 text-left text-[13px] text-ink-2 transition-colors duration-150 hover:bg-hover"
    >
      <Check
        className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-blue-600" : "text-transparent")}
        strokeWidth={2.25}
      />
      <span className="truncate">{children}</span>
      {hint && <span className="ml-auto shrink-0 text-[11px] text-ink-faint">{hint}</span>}
    </button>
  );
}
