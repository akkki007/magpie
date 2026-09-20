import {
  ChevronDown,
  ChevronRight,
  Filter,
  GitCompare,
  Plus,
  Search,
  Eye,
} from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { Sparkline } from "@/components/ui/charts";
import { cn } from "@/lib/cn";

type Row = {
  name: string;
  glyph: "#" | "$" | "%";
  formula: string;
  values: number[];
  accent?: boolean;
};

type Group = {
  label: string;
  tone: "amber" | "rose" | "graphite" | "sky";
  rows: Row[];
};

const MONTHS = ["Jan '24", "Feb '24", "Mar '24", "Apr '24", "May '24", "Jun '24"];

const GROUPS: Group[] = [
  {
    label: "ARR & Summary",
    tone: "graphite",
    rows: [
      {
        name: "Opening ARR",
        glyph: "#",
        formula: "Closing ARR by Subscription plan",
        values: [20123, 21234, 22345, 23456, 24567, 25678],
      },
      {
        name: "New ARR",
        glyph: "$",
        formula: "Booking · High touch by Subscription",
        values: [13342, 14567, 15678, 16789, 17890, 18901],
      },
    ],
  },
  {
    label: "Account Summary",
    tone: "amber",
    rows: [
      {
        name: "Churn ARR",
        glyph: "#",
        formula: "Opening ARR by Subscription Plan",
        values: [48901, 49012, 50123, 51234, 52345, 53456],
      },
      {
        name: "Expansion ARR",
        glyph: "$",
        formula: "Closing ARR by Subscription Plan",
        values: [41234, 42345, 43456, 44567, 45678, 46789],
      },
      {
        name: "Closing ARR",
        glyph: "#",
        formula: "Opening ARR + New ARR − Churn ARR",
        values: [34567, 35678, 36789, 37890, 38901, 39012],
        accent: true,
      },
      {
        name: "Revenue",
        glyph: "$",
        formula: "Closing ARR by Subscription Plan",
        values: [27890, 28901, 29012, 30123, 31234, 32345],
      },
      {
        name: "Revenue (Cash Flow)",
        glyph: "$",
        formula: "New ARR by Subscription Plan",
        values: [20123, 21234, 22345, 23456, 24567, 25678],
        accent: true,
      },
      {
        name: "Opening Accounts",
        glyph: "#",
        formula: "Closing Accounts by Subscription",
        values: [69012, 70123, 71234, 72345, 73456, 75678],
      },
    ],
  },
  {
    label: "Churn Build",
    tone: "rose",
    rows: [
      {
        name: "New Accounts",
        glyph: "#",
        formula: "Inbound Leads · This Month",
        values: [55678, 56789, 57890, 58901, 59012, 60123],
      },
      {
        name: "Churned ARR",
        glyph: "%",
        formula: "Opening ARR by Subscription Plan",
        values: [13342, 14567, 15678, 16789, 17890, 18901],
      },
    ],
  },
];

const fmt = new Intl.NumberFormat("en-US");

function GlyphCell({ glyph }: { glyph: Row["glyph"] }) {
  return (
    <span className="w-2.5 shrink-0 text-center text-[11px] font-medium text-ink-faint">
      {glyph}
    </span>
  );
}

export function ModelGrid({ compact = false }: { compact?: boolean }) {
  const months = compact ? MONTHS.slice(0, 3) : MONTHS;

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      {/* Breadcrumb */}
      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="text-[12.5px] text-ink-muted">Models</span>
        <span className="text-ink-faint">/</span>
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
          <span
            aria-hidden
            className="grid h-[15px] w-[15px] place-items-center rounded-[3px] border border-line-strong text-[8px] text-ink-muted"
          >
            ▦
          </span>
          Revenue Model 2026
        </span>
        <span className="ml-auto hidden text-[11.5px] text-ink-faint sm:inline">
          Edited 2d ago
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex h-[44px] shrink-0 items-center gap-3 border-b border-line px-4">
        <div className="flex h-[28px] min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-surface px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} />
          <span className="truncate text-[12px] text-ink-faint">Search</span>
        </div>
        <button className="hidden shrink-0 items-center gap-1.5 text-[12px] text-ink-2 sm:flex">
          <GitCompare className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
          Scenario
        </button>
        <button className="hidden shrink-0 items-center gap-1.5 text-[12px] text-ink-2 sm:flex">
          <Eye className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
          View
        </button>
        <Filter className="hidden h-3.5 w-3.5 shrink-0 text-ink-muted sm:block" strokeWidth={1.75} />
      </div>

      {/* Column headers */}
      <div className="flex h-[30px] shrink-0 items-center border-b border-line bg-surface text-[11.5px] text-ink-muted">
        <div className="flex w-[190px] shrink-0 items-center gap-1.5 border-r border-line px-3">
          <span aria-hidden className="text-ink-faint">↗</span>
          Variable Name
        </div>
        <div className="w-[86px] shrink-0 border-r border-line px-3">Trend</div>
        <div className="hidden w-[176px] shrink-0 border-r border-line px-3 md:block">
          Formula
        </div>
        {months.map((m) => (
          <div key={m} className="w-[74px] shrink-0 px-3 text-right">
            {m}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <div className="flex h-[30px] items-center gap-2 border-b border-line px-3">
              <ChevronDown className="h-3 w-3 text-ink-muted" strokeWidth={2} />
              <Chip tone={g.tone}>{g.label}</Chip>
            </div>

            {g.rows.map((r, i) => (
              <div
                key={r.name}
                className={cn(
                  "group flex h-[30px] items-center border-b border-line text-[12px] transition-colors duration-150",
                  r.accent ? "bg-hover" : "hover:bg-subtle",
                )}
              >
                <div className="flex w-[190px] shrink-0 items-center gap-1.5 border-r border-line px-3">
                  <ChevronRight
                    className="h-3 w-3 shrink-0 text-ink-faint"
                    strokeWidth={2}
                  />
                  <GlyphCell glyph={r.glyph} />
                  <span
                    className={cn(
                      "truncate",
                      r.accent ? "text-blue-600" : "text-ink-2",
                    )}
                  >
                    {r.name}
                  </span>
                </div>

                <div className="flex w-[86px] shrink-0 items-center border-r border-line px-3">
                  <Sparkline seed={(i + 1) * 9173 + g.label.length * 31} />
                </div>

                <div className="hidden w-[176px] shrink-0 border-r border-line px-3 md:block">
                  <span className="formula-pill inline-block max-w-full truncate px-1.5 py-[2px] text-[11px]">
                    <span className="text-blue-600">{r.glyph}</span> {r.formula}
                  </span>
                </div>

                {r.values.slice(0, months.length).map((v, vi) => (
                  <div
                    key={vi}
                    className="tnum w-[74px] shrink-0 px-3 text-right text-ink-2"
                  >
                    {fmt.format(v)}
                  </div>
                ))}
              </div>
            ))}

            <div className="flex h-[26px] items-center gap-1.5 border-b border-line px-3 text-[11.5px] text-ink-faint">
              <Plus className="h-3 w-3" strokeWidth={2} />
              New variable
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The AI-proposal diff bar — changes are staged, never written directly. */
export function ProposalBar() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 hidden justify-center px-4 sm:flex">
      <div className="flex items-center gap-2 whitespace-nowrap rounded-control border border-line bg-surface px-2 py-1.5 shadow-e2">
        <span className="tnum px-1 text-[11.5px] text-ink-muted">2/3</span>
        <span className="text-[11.5px] font-medium text-ink-2">AI Suggestions</span>
        <span className="text-[11.5px] text-ink-muted">Undo all</span>
        <span className="rounded-button bg-blue-600 px-2 py-[3px] text-[11.5px] font-medium text-white">
          Compare
        </span>
        <span className="rounded-button border border-line-strong bg-muted px-2 py-[3px] text-[11.5px] font-medium text-ink">
          Accept All
        </span>
      </div>
    </div>
  );
}
