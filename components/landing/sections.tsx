import Link from "next/link";
import {
  ArrowRight,
  RefreshCcw,
  Layers,
  Boxes,
  GitCompare,
  Bot,
  Users,
} from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { Eyebrow, Chip } from "@/components/ui/chip";
import { AppShell } from "./app-shell";
import { DashboardSurface } from "./dashboard";
import { vizColors } from "@/components/ui/charts";

/* ── Section scaffolding ─────────────────────────────────────────────── */

function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mx-auto max-w-[1200px] px-6 py-20 md:py-28 ${className}`}>
      {children}
    </section>
  );
}

function SectionHead({
  eyebrow,
  title,
  body,
  center = false,
}: {
  eyebrow: string;
  title: React.ReactNode;
  body?: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-[640px] text-center" : "max-w-[640px]"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 font-heading text-[29px] leading-[1.14] font-normal tracking-[0.005em] text-ink md:text-[38px]">
        {title}
      </h2>
      {body ? (
        <p className="mt-4 text-[16px] leading-[1.6] text-ink-muted">{body}</p>
      ) : null}
    </div>
  );
}

/* ── Trust strip ─────────────────────────────────────────────────────── */

export function TrustStrip() {
  const stats = [
    { value: "100+", label: "prebuilt metrics" },
    { value: "6", label: "systems synced live" },
    { value: "<50ms", label: "full model recalculation" },
    { value: "100%", label: "of changes audited" },
  ];
  return (
    <div className="border-y border-line bg-surface">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 divide-x divide-line px-6 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-7 first:pl-0 last:pr-0">
            <p className="font-heading text-[26px] font-normal tracking-[0.005em] text-ink">
              {s.value}
            </p>
            <p className="mt-1 text-[13px] text-ink-muted">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Use cases ───────────────────────────────────────────────────────── */

const USE_CASES = [
  {
    n: "01",
    title: "ARR Planning",
    body: "Forecast recurring revenue, track churn and expansion, and model growth scenarios so GTM and finance stay aligned on targets.",
  },
  {
    n: "02",
    title: "Cash Flow Forecasting",
    body: "Build real-time cash flow views that combine revenue timing, expenses, and collections to reveal your true liquidity picture.",
  },
  {
    n: "03",
    title: "Headcount Planning",
    body: "Plan hiring by function, level, and location, layering in costs and timelines to see how headcount impacts runway and margins.",
  },
  {
    n: "04",
    title: "Capacity Planning",
    body: "Integrate operational and financial data to understand capacity constraints, model utilization, and decide when to add resources.",
  },
  {
    n: "05",
    title: "Runway Forecasting",
    body: "Project runway under different growth and spend scenarios so you know exactly how plans affect your next raise or profitability date.",
  },
  {
    n: "06",
    title: "Expense Management",
    body: "Analyze expenses by team and vendor, flag overspend, and test cost-saving ideas before you commit to changes in the real world.",
  },
];

export function UseCases() {
  return (
    <Section id="use-cases">
      <Reveal>
        <SectionHead
          eyebrow="Use cases"
          title="One workspace, from revenue to runway."
          body="Use Magpie Modelling across your entire planning workflow — the same engine, the same numbers, six different questions."
        />
      </Reveal>

      <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {USE_CASES.map((u, i) => (
          <Reveal key={u.n} delay={(i % 3) * 60}>
            <div className="group h-full bg-surface p-6 transition-colors duration-150 hover:bg-subtle">
              <span className="tnum text-[11px] font-semibold tracking-[0.08em] text-ink-faint">
                {u.n}
              </span>
              <h3 className="mt-3 text-[17px] font-semibold tracking-[-0.015em] text-ink">
                {u.title}
              </h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-ink-muted">{u.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ── Modelling surface showcase ──────────────────────────────────────── */

export function ModellingShowcase() {
  return (
    <Section id="modelling">
      <Reveal>
        <SectionHead
          center
          eyebrow="The workspace"
          title="Every number, and where it came from."
          body="Variables, not cells. Each row carries its own formula, its own trend, and its own history — so nobody has to reverse-engineer a spreadsheet at quarter end."
        />
      </Reveal>

      <Reveal delay={80} className="mt-12">
        <AppShell className="h-[560px] md:h-[620px]">
          <DashboardSurface />
        </AppShell>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3">
        {[
          {
            title: "Typed variables",
            body: "Currency, count, percent — each with its own aggregation rule, so quarterly and yearly rollups are correct by construction.",
          },
          {
            title: "Formulas as structure",
            body: "Formulas reference variables, not coordinates. Rename anything and nothing breaks.",
          },
          {
            title: "Trends in place",
            body: "A sparkline on every row means you see the shape of a number before you read the number.",
          },
        ].map((f, i) => (
          <Reveal key={f.title} delay={i * 60}>
            <h4 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
              {f.title}
            </h4>
            <p className="mt-2 text-[14px] leading-[1.6] text-ink-muted">{f.body}</p>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ── Features ────────────────────────────────────────────────────────── */

const FEATURES = [
  {
    icon: RefreshCcw,
    title: "Always-on sync from every system",
    body: "Connect ERP, CRM, billing, HRIS, and the rest, then let Magpie keep every model current with real-time sync and a detailed audit log for every change.",
  },
  {
    icon: Layers,
    title: "Prebuilt metrics and reusable logic",
    body: "Start planning in minutes with 100+ prebuilt metrics, reusable components, and model patterns instead of rebuilding the basics from scratch.",
  },
  {
    icon: Boxes,
    title: "Multi-dimensional, no-code modelling",
    body: "Model by product, region, channel, or any custom dimension using a drag-and-drop, formula-light interface that still handles complex structures.",
  },
  {
    icon: GitCompare,
    title: "See every what-if in one place",
    body: "Create and compare scenarios, switch between daily, monthly, and yearly views, and apply AI forecasting to explore best, base, and worst cases side by side.",
  },
  {
    icon: Bot,
    title: "Let agents build with you",
    body: "Ask agents to generate models, link data sources, update drivers, and surface insights so your team spends its time on decisions, not setup.",
  },
  {
    icon: Users,
    title: "Plan together, stay in control",
    body: "Comments, notifications, approvals, and version history — including rollback — so collaboration never costs you the audit trail.",
  },
];

export function Features() {
  return (
    <div className="border-y border-line bg-surface">
      <Section id="features">
        <Reveal>
          <SectionHead
            eyebrow="Features"
            title="Built like an instrument, not a spreadsheet."
          />
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 60}>
              <div className="grid h-9 w-9 place-items-center rounded-control border border-line bg-app">
                <f.icon className="h-4 w-4 text-ink" strokeWidth={1.75} />
              </div>
              <h3 className="mt-4 text-[16px] font-semibold tracking-[-0.015em] text-ink">
                {f.title}
              </h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-ink-muted">{f.body}</p>
            </Reveal>
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ── Agents ──────────────────────────────────────────────────────────── */

export function Agents() {
  return (
    <Section id="agents">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <Reveal>
          <SectionHead
            eyebrow="Agents"
            title="AI proposes. You decide."
            body="Agents never write to your model directly. Every change arrives as a reviewable set — see the diff, compare it against the base case, then accept or undo the whole thing in one action."
          />
          <ul className="mt-8 space-y-4">
            {[
              ["Staged changes", "Proposals render as ghost values next to the live ones."],
              ["Compare before accept", "Diff any proposal against the base case or another scenario."],
              ["Reversible by design", "Every accepted change is a command in the audit log — and every command has an inverse."],
            ].map(([t, b]) => (
              <li key={t} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400"
                />
                <span>
                  <span className="text-[15px] font-medium text-ink">{t}</span>
                  <span className="block text-[14px] leading-[1.6] text-ink-muted">{b}</span>
                </span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={80}>
          <div className="rounded-panel border border-line bg-surface p-5 shadow-e2">
            <div className="flex items-center gap-2 border-b border-line pb-3">
              <span className="text-[12.5px] font-medium text-ink">
                Revenue Model 2026
              </span>
              <Chip tone="blue" className="ml-auto">
                3 proposed changes
              </Chip>
            </div>

            <div className="space-y-2.5 pt-4">
              {[
                { name: "New ARR", from: "13,342", to: "17,345", accepted: true },
                { name: "Closing ARR", from: "34,567", to: "38,912", accepted: true },
                { name: "Churn Rate", from: "2.4%", to: "2.4%", accepted: false },
              ].map((c) => (
                <div
                  key={c.name}
                  className="flex items-center gap-3 rounded-control border border-line px-3 py-2.5"
                >
                  <span className="w-[104px] shrink-0 truncate text-[12.5px] text-ink-2">
                    {c.name}
                  </span>
                  <span className="tnum text-[12.5px] text-ink-faint line-through">
                    {c.from}
                  </span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-ink-faint" strokeWidth={2} />
                  <span
                    className={
                      c.accepted
                        ? "tnum text-[12.5px] font-medium text-blue-600"
                        : "tnum text-[12.5px] text-ink-faint"
                    }
                  >
                    {c.to}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] font-medium text-ink-faint">
                    {c.accepted ? "Accepted" : "Unchanged"}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
              <span className="text-[11.5px] text-ink-muted">
                Reverting restores the prior version
              </span>
              <span className="ml-auto rounded-button border border-line-strong bg-muted px-2.5 py-1.5 text-[12px] font-medium text-ink">
                Undo all
              </span>
              <span className="rounded-button bg-blue-600 px-2.5 py-1.5 text-[12px] font-medium text-white">
                Accept all
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── Integrations ────────────────────────────────────────────────────── */

const SOURCES = [
  "NetSuite", "Salesforce", "Stripe", "HubSpot", "QuickBooks", "Workday",
  "Xero", "Rippling", "Snowflake", "BigQuery", "Gusto", "CSV",
];

export function Integrations() {
  return (
    <div className="border-y border-line bg-surface">
      <Section>
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-20">
          <Reveal>
            <SectionHead
              eyebrow="Data sources"
              title="Your model is only as fresh as its inputs."
              body="Connect the systems that already hold the truth. Magpie syncs continuously and writes every change to the audit log, so a number moving overnight is always explainable."
            />
          </Reveal>

          <Reveal delay={80}>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3 lg:grid-cols-4">
              {SOURCES.map((s, i) => (
                <div
                  key={s}
                  className="flex items-center gap-2.5 bg-surface px-4 py-4 text-[13px] text-ink-2"
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                    style={{ background: vizColors[i % vizColors.length] }}
                  />
                  {s}
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </Section>
    </div>
  );
}

/* ── CTA ─────────────────────────────────────────────────────────────── */

export function CTA() {
  return (
    <Section>
      <Reveal>
        <div className="grid-lines relative overflow-hidden rounded-panel border border-line bg-surface px-6 py-16 text-center shadow-e2 md:px-16 md:py-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,var(--color-surface)_78%)]"
          />
          <div className="relative">
            <h2 className="mx-auto max-w-[20ch] font-heading text-[31px] leading-[1.12] font-normal tracking-[0.005em] text-ink md:text-[43px]">
              Close the books on spreadsheet planning.
            </h2>
            <p className="mx-auto mt-5 max-w-[54ch] text-[16px] leading-[1.6] text-ink-muted">
              Bring your data, your drivers, and your team into one workspace — and let
              the agents handle the setup.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/sign-up"
                className="btn-primary inline-flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-medium"
              >
                Start free
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </Link>
              <Link href="/sign-in" className="btn-secondary px-4 py-2.5 text-[14px] font-medium">
                Book a walkthrough
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
