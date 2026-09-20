/**
 * `bun run recon:ablate [--dir data/recon] [--chunk 40]`
 *
 * The three bars (`docs/recon-plan.md` R4.5, §A8) — the same batch, the same scorer, three
 * architectures:
 *
 * ```
 *   rules only              what deterministic passes achieve alone
 *   rules + adjudication    the hybrid, replayed from the cassette
 *   LLM only                a model handed the lane with no index, tolerance or gate
 * ```
 *
 * The third arm costs real money and real time, which is itself part of the finding. It is
 * also the arm the plan says to cut first if the clock runs out — the two that decide whether
 * the adjudication tier earns its place are the two that replay for free.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { applyAdjudications, gate, packetsFrom } from "../lib/recon/adjudicate";
import { ingestSources, type SourceName } from "../lib/recon/ingest";
import { reconcileWithLlmOnly } from "../lib/recon/llm-only";
import { runMatch } from "../lib/recon/match";
import { score } from "../lib/recon/score";
import { percentile } from "../lib/recon/openai";
import type { Truth } from "../lib/recon/types";

const argument = (flag: string, fallback: string) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : process.argv[at + 1];
};

const dir = argument("--dir", "data/recon");
const chunk = Number(argument("--chunk", "40"));

const SOURCES: SourceName[] = [
  "payments.csv",
  "refunds.csv",
  "chargebacks.csv",
  "settlements.csv",
  "recon.csv",
  "bank.csv",
  "ledger.csv",
];

if (!existsSync(join(dir, "truth.json"))) {
  console.error(`\nNo batch at ${dir}/ — run \`bun run recon:seed\` first.\n`);
  process.exit(1);
}

const sources = Object.fromEntries(
  SOURCES.map((name) => {
    const path = join(dir, name);
    return [name, existsSync(path) ? readFileSync(path, "utf8") : undefined];
  }),
) as Partial<Record<SourceName, string>>;

const truth = JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")) as Truth;
const batch = ingestSources(sources);

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const pad = (value: string | number, width: number) => String(value).padStart(width);

console.log(`\nAblation — the same batch, the same scorer, three architectures\n`);

/* ── Arm 1: rules only ────────────────────────────────────────────────────*/

const deterministicStart = performance.now();
const run = runMatch(batch);
const deterministicMs = performance.now() - deterministicStart;
const rulesOnly = score(run.results, truth, batch.bank);

/* ── Arm 2: the hybrid, replayed ──────────────────────────────────────────*/

const cassettePath = join(dir, "adjudications.json");
let hybrid: ReturnType<typeof score> | null = null;
let hybridMs = 0;

if (existsSync(cassettePath)) {
  const recorded = JSON.parse(readFileSync(cassettePath, "utf8"));
  hybridMs = deterministicMs + (recorded.usage?.latenciesMs ?? []).reduce((a: number, b: number) => a + b, 0);
  const packets = packetsFrom(run.results, batch.bank, batch.settlements);
  const adjudicated = gate(packets, { decisions: recorded.decisions }, batch.settlements);
  hybrid = score(applyAdjudications(run.results, adjudicated), truth, batch.bank);
}

/* ── Arm 3: LLM only ──────────────────────────────────────────────────────*/

const llmStart = performance.now();
const llm = await reconcileWithLlmOnly(batch.settlements, batch.bank, { chunk });
const llmMs = performance.now() - llmStart;
const llmOnly = score(llm.results, truth, batch.bank);

/* ── The bars ─────────────────────────────────────────────────────────────*/

const row = (label: string, card: ReturnType<typeof score>, ms: number, calls: number) => {
  const o = card.overall;
  const classAccuracy = o.classCorrect / Math.max(1, o.classCorrect + o.classWrong.length);
  console.log(
    `  ${label.padEnd(22)} ${pad(percent(o.precision), 10)} ${pad(percent(o.falseMatchRate), 12)} ${pad(percent(o.matchRate), 11)} ${pad(percent(classAccuracy), 8)} ${pad(`${(ms / 1000).toFixed(1)}s`, 8)} ${pad(calls, 7)}`,
  );
};

console.log("  arm                     precision  false-match  match rate  class     time   calls");
console.log("  " + "─".repeat(80));
row("rules only", rulesOnly, deterministicMs, 0);
if (hybrid) row("rules + adjudication", hybrid, hybridMs, 1);
row("LLM only", llmOnly, llmMs, llm.usage.calls);
console.log("  " + "─".repeat(80));

console.log(
  `\n  LLM-only detail — ${llm.results.length} pairings returned, ${llm.hallucinated} naming an id that does not exist,`,
);
console.log(
  `  ${llmOnly.overall.falseMatches.length} of them contradicted by the answer key. ${llm.usage.inputTokens.toLocaleString("en-IN")} input tokens across ${llm.usage.calls} calls,`,
);
console.log(
  `  p50 ${percentile(llm.usage.latenciesMs, 50)?.toFixed(0) ?? "n/a"} ms per call, against ${deterministicMs.toFixed(0)} ms for the entire deterministic run.`,
);

const verdict =
  llmOnly.overall.falseMatchRate > rulesOnly.overall.falseMatchRate
    ? `LLM-only makes ${llmOnly.overall.falseMatches.length} silent false match(es) where the rules make ${rulesOnly.overall.falseMatches.length}.`
    : `LLM-only made no false matches on this batch, but reached ${percent(llmOnly.overall.matchRate)} against the rules' ${percent(rulesOnly.overall.matchRate)}.`;

console.log(
  [
    "",
    `  ${verdict}`,
    "  That is the argument for the tiering: rules are fast and exact, a model alone is slow and",
    "  unverifiable, and the hybrid buys the model's judgement only where rules cannot reach —",
    "  behind a gate that recomputes every number it returns.",
    "",
  ].join("\n"),
);
