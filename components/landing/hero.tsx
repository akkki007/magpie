import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { AppShell } from "./app-shell";
import { ModelGrid, ProposalBar } from "./model-grid";
import { AgentPanel } from "./agent-panel";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Hairline grid, faded out. Nothing else in the background. */}
      <div
        aria-hidden
        className="grid-lines pointer-events-none absolute inset-x-0 top-0 h-[560px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]"
      />

      <div className="relative mx-auto max-w-[1200px] px-6 pt-20 pb-16 md:pt-28">
        <Reveal className="mx-auto max-w-[820px] text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-2 shadow-e1">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            Agents that build the model with you
          </span>

          {/*
            Hinato trial. It ships one 400 weight and carries its own generous
            sidebearings, so this heading drops the bold and the −0.035em tracking
            the Inter Tight version used — both fight the face.
          */}
          <h1 className="mt-6 font-heading text-[37px] leading-[1.08] font-normal tracking-[0.005em] text-ink sm:text-[52px] md:text-[64px]">
            Stop fixing spreadsheets.
            {/* Always break between the sentences — at mobile sizes Hinato runs
                them together mid-line and the two-beat headline stops reading. */}
            <br />
            <span className="text-ink-muted">Start shaping the plan.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-[58ch] text-[16px] leading-[1.6] text-ink-muted md:text-[17px]">
            Magpie is an AI-native finance workspace. Live data from every system,
            agents that build and update your models, and scenarios your whole team
            can actually trust.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/sign-up"
              className="btn-primary inline-flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-medium"
            >
              Start free
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </Link>
            <a
              href="#modelling"
              className="btn-secondary px-4 py-2.5 text-[14px] font-medium"
            >
              See the workspace
            </a>
          </div>

          <p className="mt-4 text-[12.5px] text-ink-faint">
            No credit card · Import a spreadsheet and model in minutes
          </p>
        </Reveal>

        {/* The product itself, as the proof. */}
        <Reveal delay={80} className="mt-16">
          <div className="relative">
            <AppShell
              panel={<AgentPanel />}
              className="h-[600px] md:h-[640px]"
            >
              <div className="relative h-full">
                <ModelGrid />
                <ProposalBar />
              </div>
            </AppShell>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-panel bg-gradient-to-t from-app to-transparent"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
