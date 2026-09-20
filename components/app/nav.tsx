import {
  BookOpen,
  Bot,
  ChartColumn,
  Database,
  LayoutGrid,
  Scale,
  Table2,
} from "lucide-react";

/**
 * The sections, once, for both navigations.
 *
 * The rail and the mobile bar are different shapes — a 68px column of icons against a row of
 * thumb-sized tabs — but they are the same list, and a list that lives in two files is a list
 * that will disagree about what the product contains. This module holds no markup for that
 * reason: it is data plus an icon reference, so a server rail and a client bar can each
 * import it without dragging the other's rendering along.
 *
 * `href` marks a section that actually exists. The rest are from the prototype and are inert
 * on purpose — a nav item that looks live and does nothing is worse than one that is visibly
 * not built yet, and adding a route here before the screen exists is how a dead link ships.
 */
export const SECTIONS = [
  { icon: Table2, label: "Models", href: "/models" },
  { icon: Scale, label: "Reconciliation", href: "/recon" },
  { icon: ChartColumn, label: "Boards", href: "/boards" },
  { icon: Database, label: "Data sources", href: "/databases" },
  { icon: Bot, label: "Agents", href: "/agents" },
  { icon: BookOpen, label: "Library" },
  { icon: LayoutGrid, label: "Templates" },
] as const satisfies readonly { icon: typeof Table2; label: string; href?: string }[];

export type SectionLabel = (typeof SECTIONS)[number]["label"];

/**
 * What the mobile bar puts on screen, as opposed to behind "More".
 *
 * Five, because a tab bar is sized by thumbs rather than by pixels: below about 64px a target
 * stops being reliably hittable, and five is what a 320px phone fits at that size. The two
 * that drop out are the two that do nothing yet — so the phone loses nothing real, and the
 * choice stops being arbitrary the day Library ships and has to be argued about properly.
 */
export const TAB_LABELS = [
  "Models",
  "Reconciliation",
  "Boards",
  "Data sources",
  "Agents",
] as const satisfies readonly SectionLabel[];

/** A tab bar has no room for "Reconciliation" or "Data sources" under a 24px icon. */
export const SHORT_LABEL: Partial<Record<SectionLabel, string>> = {
  Reconciliation: "Recon",
  "Data sources": "Data",
};
