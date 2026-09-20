import { ChevronDown } from "lucide-react";

import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/cn";

import { Section, SectionHead } from "./sections";

/**
 * The architecture section — how Magpie is put together, drawn as real DOM.
 *
 * ── One data structure, two renderings ────────────────────────────────────
 * `LANES` is the only place a label lives. On `lg` and up it is laid out as an SVG (boxes
 * spaced evenly, an arrow between each linked pair); below that the same data renders as a
 * stacked list. Both, because SVG text scales with the viewBox — at phone width the diagram
 * would shrink to a size nobody can read, and a diagram that needs pinching is not one.
 *
 * ── The colour rule, applied ──────────────────────────────────────────────
 * Violet marks a step a *model* produced (see the token comment in `globals.css`); everything
 * deterministic stays a hairline box. That is the diagram's actual argument: the machine-
 * authored boxes are few, and each is followed by a box of ordinary code that checks it.
 * Blue is spent once, on the request path a visitor's browser actually takes. Dashed borders
 * mark supporting services — things around the app rather than steps in a flow.
 *
 * ── What is deliberately not here ─────────────────────────────────────────
 * No claims beyond what runs. The reconciliation figures are from the rules-only run on the
 * synthetic batch and say so, and the model is labelled as an API call rather than dressed as
 * part of the AWS footprint.
 */

type Step = {
  title: string;
  /** Up to three short lines — SVG text does not wrap, so each must fit its box. */
  sub: string[];
  /** A step a model produced. Everything else is deterministic code or infrastructure. */
  machine?: boolean;
  /** A supporting service rather than a step in a flow. */
  dashed?: boolean;
  /** Draw an arrow from this step to the next. */
  linkNext?: boolean;
  /** Steps sharing a group are enclosed in one labelled frame. */
  group?: string;
};

type Lane = {
  label: string;
  steps: Step[];
  caption?: string;
  /** The request path a visitor's browser takes — the one place blue is spent. */
  primary?: boolean;
};

const LANES: Lane[] = [
  {
    label: "01  Serving path",
    primary: true,
    steps: [
      {
        title: "Browser",
        sub: ["magpie.akkki.tech", "DNS on Vercel"],
        linkNext: true,
      },
      {
        title: "Caddy",
        sub: ["HTTPS 443, cert", "auto-renewed by", "Let's Encrypt"],
        linkNext: true,
        group: "EC2 · Docker, image from ECR",
      },
      {
        title: "Next.js 16 app",
        sub: ["server components,", "route handlers,", "Better Auth"],
        linkNext: true,
        group: "EC2 · Docker, image from ECR",
      },
      {
        title: "RDS Postgres",
        sub: ["private subnet,", "no public IP", "Prisma 7, SSL"],
        group: "AWS · private",
      },
    ],
  },
  {
    label: "02  Reconciliation, inside the app",
    caption:
      "Rules-only run on the synthetic batch: 11,269 records, 419 of 456 results auto-applied, 8.1% escalated. 100% precision, 0% false matches.",
    steps: [
      { title: "Statement files", sub: ["7 CSV sources:", "bank, settlements,", "ledger and more"], linkNext: true },
      { title: "Ingest", sub: ["pure function of", "file contents.", "Bad rows kept."], linkNext: true },
      { title: "Rule matcher", sub: ["exact, tolerance,", "structural tiers;", "explainable"], linkNext: true },
      {
        title: "Adjudicator",
        sub: ["LLM API call,", "structured output,", "ranked candidates"],
        machine: true,
        linkNext: true,
      },
      { title: "Validation gate", sub: ["recomputes every", "number; rejects", "ungrounded ids"], linkNext: true },
      { title: "Review queue", sub: ["a person confirms", "proposals and", "exceptions"] },
    ],
  },
  {
    label: "03  Finance-ops agent, inside the app",
    steps: [
      { title: "A question", sub: ["asked in plain", "English"], linkNext: true },
      {
        title: "Supervisor",
        sub: ["LangGraph deep agent,", "plans as a todo list,", "holds no read tools"],
        machine: true,
        linkNext: true,
      },
      {
        title: "Analyst subagents",
        sub: ["model-analyst and", "data-analyst: read-only,", "run in parallel"],
        machine: true,
        linkNext: true,
      },
      { title: "Approval gate", sub: ["the graph halts", "before any write", "tool runs"], linkNext: true },
      { title: "Proposals", sub: ["staged changes a", "person accepts", "or rejects"] },
    ],
  },
  {
    label: "04  Around it, on AWS",
    caption:
      "The instance role reaches one bucket and these log groups, nothing else. Secrets never appear in the launch config.",
    steps: [
      { title: "ECR", sub: ["container image,", "pulled at boot"], dashed: true },
      { title: "Secrets Manager", sub: ["runtime env, read", "by the instance role"], dashed: true },
      { title: "S3", sub: ["statement archive;", "private, versioned,", "encrypted"], dashed: true },
      {
        title: "CloudWatch",
        sub: ["container logs,", "6 alarms, dashboard"],
        dashed: true,
        linkNext: true,
      },
      { title: "SNS", sub: ["alarm emails"], dashed: true },
    ],
  },
];

/* ── Layout (desktop SVG) ────────────────────────────────────────────── */

const W = 1152;
const GAP = 44;
const BOX_H = 92;
const BOX_TOP = 46;
const LANE_PITCH = 196;
const FRAME_PAD = 12;
const H = LANE_PITCH * 3 + BOX_TOP + BOX_H + 40;

function boxWidth(count: number) {
  return (W - GAP * (count - 1)) / count;
}

function ArchitectureSvg() {
  return (
    <svg
      // Starts at -FRAME_PAD so a group frame's outer padding is inside the drawing; a frame
      // around the first or last box would otherwise be clipped at the viewBox edge.
      viewBox={`${-FRAME_PAD} 0 ${W + FRAME_PAD * 2} ${H}`}
      role="img"
      aria-labelledby="arch-title arch-desc"
      className="hidden h-auto w-full font-sans lg:block"
    >
      <title id="arch-title">Magpie architecture</title>
      <desc id="arch-desc">
        A request goes from the browser through Caddy to a Next.js app on EC2, backed by a private
        RDS Postgres. Inside the app, uploaded statements are ingested, matched by rules, and only
        what the rules cannot settle goes to a language model, whose answer is recomputed by a
        validation gate before a person reviews it. A finance-ops agent plans, delegates to
        read-only subagents, and halts for approval before any write. ECR, Secrets Manager, S3,
        CloudWatch and SNS support it.
      </desc>

      <defs>
        <marker id="arch-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0 0.8 L7 4 L0 7.2 z" className="fill-ink-faint" />
        </marker>
        <marker id="arch-arrow-blue" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
          <path d="M0 0.8 L7 4 L0 7.2 z" className="fill-blue-400" />
        </marker>
      </defs>

      {LANES.map((lane, li) => {
        const y0 = li * LANE_PITCH;
        const bw = boxWidth(lane.steps.length);
        const boxY = y0 + BOX_TOP;
        const midY = boxY + BOX_H / 2;
        const xOf = (i: number) => i * (bw + GAP);

        // Contiguous runs of the same group become one frame.
        const frames: { label: string; from: number; to: number }[] = [];
        lane.steps.forEach((step, i) => {
          if (!step.group) return;
          const last = frames[frames.length - 1];
          if (last && last.label === step.group && last.to === i - 1) last.to = i;
          else frames.push({ label: step.group, from: i, to: i });
        });

        return (
          <g key={lane.label}>
            <text
              x={0}
              y={y0 + 12}
              className="fill-ink-muted text-[11px] font-semibold uppercase tracking-[0.09em]"
            >
              {lane.label}
            </text>

            {frames.map((frame) => {
              const x = xOf(frame.from) - FRAME_PAD;
              const width = xOf(frame.to) + bw + FRAME_PAD - x;
              return (
                <g key={`${frame.label}-${frame.from}`}>
                  <rect
                    x={x}
                    y={y0 + 22}
                    width={width}
                    height={BOX_TOP - 22 + BOX_H + FRAME_PAD}
                    rx={16}
                    fill="none"
                    strokeDasharray="4 4"
                    className="stroke-line-strong"
                  />
                  <text x={x + 14} y={y0 + 38} className="fill-ink-muted text-[11px]">
                    {frame.label}
                  </text>
                </g>
              );
            })}

            {lane.steps.map((step, i) => {
              const x = xOf(i);
              return (
                <g key={step.title}>
                  <rect
                    x={x}
                    y={boxY}
                    width={bw}
                    height={BOX_H}
                    rx={12}
                    strokeDasharray={step.dashed ? "4 3" : undefined}
                    className={
                      step.machine
                        ? "fill-violet-50 stroke-violet-200"
                        : "fill-surface stroke-line-strong"
                    }
                  />
                  <text x={x + 14} y={boxY + 28} className="fill-ink text-[14px] font-semibold">
                    {step.title}
                  </text>
                  {step.sub.map((line, n) => (
                    <text
                      key={line}
                      x={x + 14}
                      y={boxY + 48 + n * 16}
                      className="fill-ink-muted text-[12px]"
                    >
                      {line}
                    </text>
                  ))}

                  {step.linkNext && i < lane.steps.length - 1 && (
                    <line
                      x1={x + bw + 3}
                      y1={midY}
                      x2={xOf(i + 1) - 3}
                      y2={midY}
                      strokeWidth={1.5}
                      markerEnd={lane.primary ? "url(#arch-arrow-blue)" : "url(#arch-arrow)"}
                      className={lane.primary ? "stroke-blue-400" : "stroke-ink-faint"}
                    />
                  )}
                </g>
              );
            })}

            {lane.caption && (
              <text x={0} y={boxY + BOX_H + 28} className="tnum fill-ink-muted text-[12px]">
                {lane.caption}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Stacked list (below lg) ─────────────────────────────────────────── */

function ArchitectureList() {
  return (
    <div className="space-y-8 lg:hidden">
      {LANES.map((lane) => (
        <div key={lane.label}>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-ink-muted">
            {lane.label}
          </h3>
          <ol className="mt-3 space-y-1.5">
            {lane.steps.map((step, i) => (
              <li key={step.title}>
                <div
                  className={cn(
                    "rounded-card border px-4 py-3",
                    step.machine ? "border-violet-200 bg-violet-50" : "border-line-strong bg-surface",
                    step.dashed && "border-dashed",
                  )}
                >
                  <p className="text-[14px] font-semibold text-ink">{step.title}</p>
                  <p className="mt-0.5 text-[12px] leading-[1.5] text-ink-muted">
                    {step.sub.join(" ")}
                  </p>
                </div>
                {step.linkNext && i < lane.steps.length - 1 && (
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "mx-auto mt-1.5 h-4 w-4",
                      lane.primary ? "text-blue-400" : "text-ink-faint",
                    )}
                    strokeWidth={1.75}
                  />
                )}
              </li>
            ))}
          </ol>
          {lane.caption && (
            <p className="mt-3 text-[12px] leading-[1.5] text-ink-muted">{lane.caption}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Section ─────────────────────────────────────────────────────────── */

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-ink-muted">
      <span aria-hidden className={cn("h-3 w-5 rounded-[4px] border", className)} />
      {label}
    </span>
  );
}

export function Architecture() {
  return (
    <Section id="architecture">
      <Reveal>
        <SectionHead
          eyebrow="Architecture"
          title="A model only sees what the rules could not settle."
          body="A Next.js app on EC2 behind Caddy, Postgres on RDS, and a reconciliation pipeline built so that every step a model takes is followed by plain code that checks it. Here is how the pieces fit, and the AWS services around them."
        />
      </Reveal>

      <Reveal delay={80}>
        <div className="mt-12 rounded-panel border border-line bg-surface p-5 md:p-8">
          <ArchitectureSvg />
          <ArchitectureList />

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-5">
            <LegendSwatch className="border-violet-200 bg-violet-50" label="A step a model produced" />
            <LegendSwatch className="border-line-strong bg-surface" label="Deterministic code" />
            <LegendSwatch
              className="border-dashed border-line-strong bg-surface"
              label="Supporting AWS service"
            />
            <LegendSwatch className="border-blue-400 bg-blue-50" label="The request path" />
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
