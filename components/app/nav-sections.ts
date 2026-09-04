import { BookOpen, Bot, ChartColumn, Database, LayoutGrid, Scale, Table2 } from "lucide-react";

/**
 * The sections in the icon rail (`components/app/rail.tsx`) and the mobile drawer
 * (`components/app/mobile-nav.tsx`), kept in one place so the two navigations can never drift.
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
