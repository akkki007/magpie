"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, Menu, Plus, X } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { SECTIONS, type SectionLabel } from "@/components/app/nav-sections";
import { Mark } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

/**
 * The phone-sized replacement for the icon rail (`components/app/rail.tsx`).
 *
 * The rail is `hidden sm:flex`, so below 640px there is no navigation at all — every app
 * screen is a dead end. This is the way back out: a slim top bar that stacks above the canvas
 * (the page shell switches to `flex-col` on mobile), plus a slide-in drawer that carries the
 * same sections, the same active state, and sign-out. It renders nothing on `sm` and up, where
 * the real rail takes over.
 *
 * State lives here rather than in the URL: a menu is transient chrome, and unlike the tour
 * (`components/app/tour.tsx`) there is nothing to resume after a reload.
 */
export function MobileNav({
  active = "Models",
  initials,
}: {
  active?: SectionLabel;
  initials: string;
}) {
  const [open, setOpen] = useState(false);

  // Esc closes the drawer, matching the backdrop click. Bound only while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Top bar — an in-flow flex child, so it sits above the canvas on mobile. */}
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-app px-4 sm:hidden">
        <Link href="/" aria-label="Magpie home" className="flex items-center gap-2">
          <Mark className="h-6 w-6" />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Magpie</span>
        </Link>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="ml-auto grid h-9 w-9 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </header>

      {open && (
        <div className="sm:hidden">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-ink/30"
          />

          {/* Drawer */}
          <nav
            aria-label="Sections"
            className="fixed inset-y-0 left-0 z-50 flex w-[268px] max-w-[82vw] flex-col bg-surface shadow-e3"
          >
            <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
              <Mark className="h-6 w-6" />
              <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Magpie</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="ml-auto grid h-9 w-9 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink"
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mb-1 flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-[14px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
              >
                <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                New model
              </button>

              {SECTIONS.map((section) => {
                const { icon: Icon, label } = section;
                const href = "href" in section ? section.href : undefined;
                const isActive = label === active;
                const className = cn(
                  "flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-[14px] transition-colors",
                  isActive
                    ? "bg-subtle font-medium text-ink"
                    : "text-ink-muted hover:bg-hover hover:text-ink",
                );
                const icon = <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />;

                return href ? (
                  <Link
                    key={label}
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={className}
                  >
                    {icon}
                    {label}
                  </Link>
                ) : (
                  <button key={label} type="button" onClick={() => setOpen(false)} className={className}>
                    {icon}
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
              <span
                aria-hidden
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-medium text-white"
              >
                {initials}
              </span>
              {/* A form, not a link: signing out is a mutation, and a GET that destroys a
                  session is a hole a prefetcher can walk into. */}
              <form action={signOut} className="ml-auto">
                <button
                  type="submit"
                  className="flex items-center gap-2 rounded-control px-3 py-2 text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink"
                >
                  <LogOut className="h-4 w-4" strokeWidth={1.75} />
                  Sign out
                </button>
              </form>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
