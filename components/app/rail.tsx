import Link from "next/link";
import { LogOut, Plus } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { MobileNav } from "@/components/app/mobile-nav";
import { SECTIONS, type SectionLabel } from "@/components/app/nav-sections";
import { Mark, Orb } from "@/components/ui/logo";
import { cn } from "@/lib/cn";

/**
 * The 68px icon rail from every prototype screen.
 *
 * It sits on the page background rather than inside the white canvas — that is
 * what makes the canvas read as a document floating on a desk, which is the
 * whole spatial idea of the shell. The active item is a white tile, not a
 * coloured one: in this system elevation carries state and colour carries
 * information.
 */
export function Rail({
  active = "Models",
  initials,
}: {
  active?: SectionLabel;
  initials: string;
}) {
  return (
    <>
      {/* On phones the rail is replaced by a top bar + slide-in drawer. */}
      <MobileNav active={active} initials={initials} />

      <nav
        aria-label="Sections"
        className="hidden w-[68px] shrink-0 flex-col items-center gap-1 py-4 sm:flex"
      >
      <Link href="/" aria-label="Magpie home" className="mb-4">
        <Mark className="h-6 w-6" />
      </Link>

      <button
        type="button"
        aria-label="New model"
        className="grid h-9 w-9 place-items-center rounded-control text-ink-muted transition-colors hover:bg-hover hover:text-ink"
      >
        <Plus className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </button>

      {SECTIONS.map((section) => {
        const { icon: Icon, label } = section;
        const href = "href" in section ? section.href : undefined;
        const isActive = label === active;
        const className = cn(
          "grid h-9 w-9 place-items-center rounded-control transition-colors",
          isActive
            ? "bg-surface text-ink shadow-e1"
            : "text-ink-faint hover:bg-hover hover:text-ink-muted",
        );
        const icon = <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />;

        return href ? (
          <Link
            key={label}
            href={href}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={className}
          >
            {icon}
          </Link>
        ) : (
          <button key={label} type="button" aria-label={label} className={className}>
            {icon}
          </button>
        );
      })}

      <div className="mt-auto flex flex-col items-center gap-3">
        <button
          type="button"
          aria-label="Ask Magpie"
          className="grid h-8 w-8 place-items-center rounded-full"
        >
          <Orb className="h-7 w-7" />
        </button>

        {/* A form, not a link: signing out is a mutation, and a GET that
            destroys a session is a hole a prefetcher can walk into. */}
        <form action={signOut}>
          <button
            type="submit"
            aria-label="Sign out"
            className="grid h-8 w-8 place-items-center rounded-control text-ink-faint transition-colors hover:bg-hover hover:text-ink-muted"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </form>

        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-full bg-ink text-[12px] font-medium text-white"
        >
          {initials}
        </span>
      </div>
      </nav>
    </>
  );
}
