import Link from "next/link";
import { Logo } from "@/components/ui/logo";

const COLUMNS = [
  {
    title: "Product",
    links: ["Modelling", "Scenarios", "Agents", "Dashboards", "Data sources"],
  },
  {
    title: "Use cases",
    links: ["ARR planning", "Cash flow", "Headcount", "Runway", "Expenses"],
  },
  {
    title: "Company",
    links: ["About", "Careers", "Security", "Changelog", "Contact"],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-[1200px] px-6 py-14">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-[1.6fr_repeat(3,1fr)]">
          <div className="col-span-2 md:col-span-1">
            <Logo />
            <p className="mt-4 max-w-[32ch] text-[13.5px] leading-[1.6] text-ink-muted">
              The AI-native finance workspace. Live data, agentic modelling, and
              scenarios your team can trust.
            </p>
          </div>

          {COLUMNS.map((c) => (
            <div key={c.title}>
              <p className="text-[12px] font-semibold tracking-[0.06em] text-ink-faint uppercase">
                {c.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l}>
                    <Link
                      href="#"
                      className="text-[13.5px] text-ink-muted transition-colors duration-150 hover:text-ink"
                    >
                      {l}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center">
          <p className="text-[12.5px] text-ink-faint">
            © {new Date().getFullYear()} Magpie. All rights reserved.
          </p>
          <div className="flex gap-5 sm:ml-auto">
            {["Privacy", "Terms", "Status"].map((l) => (
              <Link
                key={l}
                href="#"
                className="text-[12.5px] text-ink-faint transition-colors duration-150 hover:text-ink"
              >
                {l}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
