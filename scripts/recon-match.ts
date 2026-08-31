/**
 * `bun run recon:match [--dir data/recon] [--exceptions N] [--lane SETTLEMENT_TO_BANK]`
 *
 * Runs the deterministic matcher over an ingested batch and prints what R2 asks for:
 * **per-tier counts and timing**.
 *
 * It deliberately does **not** read `truth.json`. Scoring is R3, and keeping the two
 * commands apart is the point: a matcher that can see the answer key while it runs is a
 * matcher nobody can trust, and the temptation to "just check one thing" against the truth
 * inside the matching loop is exactly how an eval quietly becomes a fit.
 *
 * So this command answers "what did it do, and how fast". The next one answers "was it
 * right", and it is the only one allowed to open the answer key.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ingestSources, type SourceName } from "../lib/recon/ingest";
import { runMatch } from "../lib/recon/match";
import { toIndianDecimal } from "../lib/recon/money";
import { TOLERANCES } from "../lib/recon/tolerance";
import { FAILURE_LABEL, type Lane } from "../lib/recon/types";

const argument = (flag: string, fallback?: string) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : process.argv[at + 1];
};

const dir = argument("--dir", "data/recon")!;
const exceptionsToShow = Number(argument("--exceptions", "8"));
const laneFilter = argument("--lane");

const SOURCES: SourceName[] = [
  "payments.csv",
  "refunds.csv",
  "chargebacks.csv",
  "settlements.csv",
  "bank.csv",
  "ledger.csv",
];

if (!existsSync(join(dir, "payments.csv"))) {
  console.error(`\nNo batch at ${dir}/ — run \`bun run recon:seed\` first.\n`);
  process.exit(1);
}

const sources = Object.fromEntries(
  SOURCES.map((name) => {
    const path = join(dir, name);
    return [name, existsSync(path) ? readFileSync(path, "utf8") : undefined];
  }),
) as Partial<Record<SourceName, string>>;

const batch = ingestSources(sources);
const run = runMatch(batch);
const { stats } = run;

const money = (paise: number) => `₹${toIndianDecimal(paise)}`;
const pad = (value: string | number, width: number) => String(value).padStart(width);

/* ── Tiers ────────────────────────────────────────────────────────────────*/

const TIER_LABEL: Record<string, string> = {
  T0: "exact — reference and amount agree",
  T1: "tolerance — fees, TDS, rounding, timing, typos",
  T2: "structural — splits, combinations, partitions",
  T4: "exception — nothing explains it",
};

console.log(`\nMatching ${dir}/ — deterministic only, no model involved\n`);
console.log("  tier   results   what it is");
console.log("  ───────────────────────────────────────────────────────────────");
for (const [tier, count] of Object.entries(stats.byTier)) {
  console.log(`  ${tier}   ${pad(count, 7)}   ${TIER_LABEL[tier]}`);
}
console.log("  ───────────────────────────────────────────────────────────────");
console.log(`  ${"total".padEnd(6)} ${pad(run.results.length, 7)}`);

const perSecond = Math.round(stats.units / (stats.elapsedMs / 1000));
console.log(
  `\n  ${stats.elapsedMs.toFixed(0)} ms · ${stats.units.toLocaleString("en-IN")} match units · ${perSecond.toLocaleString("en-IN")} units/sec`,
);
console.log(
  `  ${stats.searchNodes.toLocaleString("en-IN")} search nodes visited · ${stats.capHits} result(s) hit the search cap`,
);

/* ── Outcomes, per lane ───────────────────────────────────────────────────*/

console.log("\nOutcomes by lane");
console.log("  lane                        auto   proposed   exception");
console.log("  ────────────────────────────────────────────────────────");
for (const [lane, counts] of Object.entries(stats.byLane) as [Lane, Record<string, number>][]) {
  console.log(
    `  ${lane.padEnd(24)} ${pad(counts.AUTO_MATCHED, 6)} ${pad(counts.PROPOSED, 10)} ${pad(counts.EXCEPTION, 11)}`,
  );
}
console.log("  ────────────────────────────────────────────────────────");
console.log(
  `  ${"total".padEnd(24)} ${pad(stats.byOutcome.AUTO_MATCHED, 6)} ${pad(stats.byOutcome.PROPOSED, 10)} ${pad(stats.byOutcome.EXCEPTION, 11)}`,
);

/* ── Rules ────────────────────────────────────────────────────────────────*/

console.log("\nRules that fired");
for (const row of stats.byRule) {
  console.log(`  ${pad(row.count, 5)}  ${row.rule.padEnd(38)} ${row.outcome}`);
}

/* ── What it thinks it found ──────────────────────────────────────────────*/

const classified = new Map<string, number>();
for (const result of run.results) {
  if (!result.class) continue;
  classified.set(result.class, (classified.get(result.class) ?? 0) + 1);
}

if (classified.size > 0) {
  console.log("\nFailure classes the rules could name themselves");
  for (const [failure, count] of [...classified].sort((a, b) => b[1] - a[1])) {
    console.log(
      `  ${pad(count, 5)}  ${failure.padEnd(22)} ${FAILURE_LABEL[failure as keyof typeof FAILURE_LABEL]}`,
    );
  }
  const unlabelled = run.results.filter((r) => r.outcome === "EXCEPTION" && !r.class).length;
  console.log(
    `  ${pad(unlabelled, 5)}  ${"(unlabelled)".padEnd(22)} raised without a class — this is the queue R4 reads`,
  );
}

/* ── The exception list ───────────────────────────────────────────────────*/

/**
 * Sorted by cash impact, because that is the order a controller works a queue in
 * (R5.1). The evidence line under each one is the whole point of §1.2: a reviewer should
 * be able to accept or reject without opening a second file.
 */
const queue = run.results
  .filter((result) => result.outcome !== "AUTO_MATCHED")
  .filter((result) => !laneFilter || result.lane === laneFilter)
  .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

console.log(
  `\nExceptions and proposals, by cash impact — showing ${Math.min(exceptionsToShow, queue.length)} of ${queue.length}`,
);
for (const result of queue.slice(0, exceptionsToShow)) {
  const link = `${result.left.join(", ") || "—"} → ${result.right.join(", ") || "—"}`;
  console.log(
    `\n  ${result.outcome}  ${money(Math.abs(result.amount)).padEnd(16)} ${result.rule}  (${result.tier}, confidence ${result.confidence})`,
  );
  console.log(`    ${link.length > 96 ? `${link.slice(0, 93)}…` : link}`);
  if (result.class) console.log(`    class: ${result.class} — ${FAILURE_LABEL[result.class]}`);
  for (const line of result.evidence) console.log(`    · ${line}`);
}

/* ── The honest footer ────────────────────────────────────────────────────*/

const auto = stats.byOutcome.AUTO_MATCHED;
const total = auto + stats.byOutcome.PROPOSED + stats.byOutcome.EXCEPTION;
const unresolvedValue = run.results
  .filter((result) => result.outcome !== "AUTO_MATCHED")
  .reduce((sum, result) => sum + Math.abs(result.amount), 0);

console.log(
  [
    "",
    `Auto-applied ${auto} of ${total} results at or above the ${TOLERANCES.autoApply} confidence threshold.`,
    `${stats.byOutcome.PROPOSED} need a human, ${stats.byOutcome.EXCEPTION} are exceptions, and ${money(unresolvedValue)} of cash is unresolved.`,
    "",
    "No accuracy claim is made here: this command cannot see truth.json. Run `bun run recon:eval` (R3) for the",
    "match rate, the precision, and the false-match rate — which is the number that actually matters.",
    "",
  ].join("\n"),
);
