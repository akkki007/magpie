import type { Draft } from "./artifacts";

/**
 * How a run learns what its tools are doing (`docs/agents-plan.md` A5).
 *
 * **Because the message stream cannot tell it.** The supervisor holds no read tools — that
 * is deliberate, and the reason it delegates at all — so every read happens inside a
 * subagent, which deep agents run as a *separate graph invocation inside the `task` tool*.
 * Those inner messages never reach the root state, so a run watching `streamMode: "values"`
 * sees "asked the data-analyst", then a minute of nothing, then a paragraph of conclusions.
 * All the actual work was invisible.
 *
 * So the tools report themselves. Each one is handed an observer when it is built, and calls
 * it with what it just did and — when it read something worth looking at — the card to put
 * on the canvas. Two things follow that were not true before:
 *
 * 1. The trail and the canvas show the *subagents'* work, not just the supervisor's.
 * 2. Nothing is parsed back out of tool output. The previous version scraped a slug out of
 *    the JSON `createTable` returned, and decided a write had failed by regex-matching the
 *    first word of its result — both of which are a tool's private prose being treated as an
 *    API. A tool now says what happened, because it is the only thing that knows.
 */

/** The run's answer, in the shape the schema forces it into. */
export type Finding = {
  answer: string;
  evidence: string[];
  next?: string;
};

export type Observer = {
  /** A tool ran to completion. `detail` is the one clause worth remembering about it. */
  ran(name: string, detail?: string): void;
  /** Put something on the canvas, keyed by what it is *of* so a second look updates it. */
  show(key: string, card: Draft): void;
  /** A write tool finished. Settles the card the approval gate recorded. */
  settled(name: string, status: "created" | "failed", detail?: { slug?: string; note?: string }): void;
  /** The agent submitted its answer. */
  finding(finding: Finding): void;
};

/** For scripts and tests: the tools still work, nothing is recorded. */
export const SILENT: Observer = {
  ran: () => {},
  show: () => {},
  settled: () => {},
  finding: () => {},
};

/**
 * A finding, as the markdown the panel renders.
 *
 * Assembled here rather than left to the model, so the shape of an answer is the same every
 * run — conclusion, evidence, what to do — and no run can decide to lead with its workings.
 */
export function renderFinding(finding: Finding): string {
  const lines = [finding.answer.trim()];
  if (finding.evidence.length > 0) {
    lines.push("", ...finding.evidence.map((item) => `- ${item.trim()}`));
  }
  if (finding.next?.trim()) lines.push("", finding.next.trim());
  return lines.join("\n");
}
