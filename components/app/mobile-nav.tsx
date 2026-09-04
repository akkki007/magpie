"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, MoreHorizontal, Plus, X } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { SECTIONS, SHORT_LABEL, TAB_LABELS, type SectionLabel } from "@/components/app/nav";
import { Orb } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

/**
 * The rail, for a phone (`docs/design-system.md`).
 *
 * A bottom bar rather than a drawer behind a hamburger, for two reasons. The rail's whole
 * point is that navigation is always visible and one tap away — a drawer trades that for a
 * tap and an animation, which is the opposite of what the rail was for. And a phone's
 * reachable area is the bottom third of the screen, not the top-left corner where a
 * hamburger goes; the sections people move between all day should not need a thumb stretch.
 *
 * It is the *same* list as the rail, from `nav.tsx`, so the two cannot drift apart. What
 * differs is only how many fit: five tabs, with the remainder behind "More" — see
 * `TAB_LABELS` for why five.
 *
 * This is `sm:hidden`, and the rail is `hidden sm:flex`. Exactly one of them is on screen at
 * any width, which is what makes them safe to state as two components rather than one
 * component with a pile of conditionals inside it.
 */
function isTab(label: SectionLabel) {
  return (TAB_LABELS as readonly SectionLabel[]).includes(label);
}

export function MobileNav({
  active,
  initials,
  email,
}: {
  active?: SectionLabel;
  initials: string;
  /** Shown in the sheet, so the account being signed out of is named rather than assumed. */
  email?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  /**
   * A tab needs an `href`, and `SECTIONS` holds entries without one, so this narrows rather
   * than asserting. If a label in `TAB_LABELS` ever names an inert section the tab is
   * dropped instead of rendering a `<Link>` with `href={undefined}` — which type-checks
   * nowhere and navigates to the current page at runtime.
   */
  const tabs = SECTIONS.filter(
    (section): section is Extract<(typeof SECTIONS)[number], { href: string }> =>
      "href" in section && isTab(section.label),
  );
  /** Whatever the bar could not fit — the sheet's job is to leave nothing unreachable. */
  const overflow = SECTIONS.filter((section) => !tabs.some((tab) => tab.label === section.label));
  const activeIsHidden = active !== undefined && overflow.some((s) => s.label === active);

  return (
    <>
      {sheetOpen && (
        <MoreSheet
          overflow={overflow}
          active={active}
          initials={initials}
          email={email}
          onClose={() => setSheetOpen(false)}
        />
      )}

      <nav
        aria-label="Sections"
        /**
         * `pb-[env(safe-area-inset-bottom)]` is not decoration: on a notched iPhone the home
         * indicator sits over the bottom ~34px of the viewport, and without this the last row
         * of tap targets is under it. The inset is 0 everywhere else, so it costs nothing.
         */
        className="flex shrink-0 items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {tabs.map(({ icon: Icon, label, href }) => {
          const isActive = label === active;
          return (
            <Link
              key={label}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                // min-h-[52px] is the floor for a comfortable thumb target; the icon and
                // label together already exceed it, so this is a guard rather than a size.
                "flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2",
                "transition-colors active:bg-hover",
                isActive ? "text-ink" : "text-ink-faint",
              )}
            >
              <Icon
                className="h-[18px] w-[18px] shrink-0"
                strokeWidth={isActive ? 2 : 1.75}
                aria-hidden
              />
              <span className="max-w-full truncate text-[10px] leading-none font-medium">
                {SHORT_LABEL[label] ?? label}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-expanded={sheetOpen}
          aria-label="More"
          className={cn(
            "flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2",
            "transition-colors active:bg-hover",
            // An active section hiding inside the sheet has to show on the bar, or the user
            // is on a page that nothing on screen claims.
            activeIsHidden ? "text-ink" : "text-ink-faint",
          )}
        >
          <MoreHorizontal className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="text-[10px] leading-none font-medium">More</span>
        </button>
      </nav>
    </>
  );
}

/**
 * Everything the bar has no room for: the two unbuilt sections, and the rail's bottom
 * cluster — new model, Ask Magpie, sign out, and who you are signed in as.
 *
 * A sheet from the bottom rather than a centred dialog, because it is anchored to the button
 * that opened it and lands under the same thumb.
 */
function MoreSheet({
  overflow,
  active,
  initials,
  email,
  onClose,
}: {
  overflow: readonly (typeof SECTIONS)[number][];
  active?: SectionLabel;
  initials: string;
  email?: string;
  onClose: () => void;
}) {
  // Escape closes it. Worth wiring even on a surface reached by touch: a phone with a
  // keyboard attached is a real thing, and this is four lines.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 sm:hidden">
      {/* The scrim is the dismiss target, which is why it is a button and not a div with an
          onClick — a tap anywhere outside the sheet should close it, and that behaviour
          should be reachable by a screen reader rather than mouse-only. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-ink/20"
      />

      <div
        role="dialog"
        aria-label="More sections"
        className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-panel border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
            More
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="grid h-8 w-8 place-items-center rounded-control text-ink-muted active:bg-hover"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <ul className="px-2 pb-2">
          <SheetRow icon={Plus} label="New model" onClick={onClose} />
          <SheetRow icon={OrbIcon} label="Ask Magpie" onClick={onClose} />

          {overflow.map((section) => {
            const href = "href" in section ? section.href : undefined;
            return (
              <SheetRow
                key={section.label}
                icon={section.icon}
                label={section.label}
                href={href}
                isActive={section.label === active}
                onClick={onClose}
              />
            );
          })}
        </ul>

        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-medium text-white"
          >
            {initials}
          </span>
          {email && (
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">{email}</span>
          )}

          {/* A form, not a link: signing out is a mutation, and a GET that
              destroys a session is a hole a prefetcher can walk into. */}
          <form action={signOut} className="ml-auto shrink-0">
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-button px-2 py-1.5 text-[13px] font-medium text-ink-2 active:bg-hover"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/** So `Orb` — which takes no `strokeWidth` — can sit in the same row shape as a lucide icon. */
function OrbIcon({ className }: { className?: string }) {
  return <Orb className={className} />;
}

function SheetRow({
  icon: Icon,
  label,
  href,
  isActive,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  isActive?: boolean;
  onClick: () => void;
}) {
  const className = cn(
    "flex min-h-[44px] w-full items-center gap-3 rounded-control px-2 text-[14px] active:bg-hover",
    isActive ? "font-medium text-ink" : "text-ink-2",
  );
  const inner = (
    <>
      <Icon className="h-[18px] w-[18px] shrink-0 text-ink-muted" />
      {label}
    </>
  );

  return (
    <li>
      {href ? (
        <Link
          href={href}
          onClick={onClick}
          aria-current={isActive ? "page" : undefined}
          className={className}
        >
          {inner}
        </Link>
      ) : (
        // Inert, exactly as in the rail — but visibly so, rather than looking tappable and
        // doing nothing.
        <button type="button" disabled className={cn(className, "text-ink-faint")}>
          {inner}
        </button>
      )}
    </li>
  );
}
