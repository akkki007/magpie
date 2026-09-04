import { MobileNav } from "@/components/app/mobile-nav";
import type { SectionLabel } from "@/components/app/nav";
import { Rail } from "@/components/app/rail";

/**
 * The signed-in shell: navigation, and a canvas to put a surface on.
 *
 * This existed as seven identical copies of the same two elements — one per surface — which
 * was survivable while the only thing they said was "rail on the left, white card on the
 * right". It stopped being survivable when the layout had to answer to a phone: a breakpoint
 * copy-pasted seven times is a breakpoint that will be wrong in three of them by next month,
 * and the failure is invisible until someone opens that one screen on a phone.
 *
 * ── Why the mobile nav is here rather than in `Topbar` ────────────────────────
 * A trigger in the header would have been less code, and it would have had a hole in it:
 * `/agents/[id]` renders its own back-arrow header instead of `Topbar`, so that surface —
 * and any future one that wants its own chrome — would have shipped with no navigation at
 * all on a phone. Navigation belongs to the shell, which every surface has by definition.
 *
 * ── The axis flip ────────────────────────────────────────────────────────────
 * `flex-col` on a phone, `sm:flex-row` above it. That single change is what makes the
 * mobile bar sit under the canvas and the rail sit beside it, without either of them being
 * positioned or the canvas needing padding to avoid something floating over it. The bar is a
 * flex sibling, so the canvas's `flex-1` already stops short of it.
 */
export function AppShell({
  active,
  initials,
  email,
  children,
}: {
  active?: SectionLabel;
  initials: string;
  email?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-surface="app" className="flex h-dvh flex-col overflow-hidden bg-app sm:flex-row">
      <Rail active={active} initials={initials} />

      {/*
        The canvas: a white document floating on the desk, not a full-bleed page.
        Hairline border, no shadow.

        Full-bleed *is* right on a phone, though — the desk metaphor costs 8px of margin and
        two hairlines on each side, and on a 390px screen that is real estate a number column
        needs more than the metaphor does. So the document reads as a document from `sm` up,
        and as the whole screen below it.
      */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line bg-surface sm:my-2 sm:rounded-card sm:border">
        {children}
      </main>

      <MobileNav active={active} initials={initials} email={email} />
    </div>
  );
}
