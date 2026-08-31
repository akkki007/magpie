/**
 * `bun run recon:eval [--dir data/recon] [--out data/recon/eval-report.json]`
 *
 * The scoreboard (`docs/recon-plan.md` R3.3). One command, and the numbers that go on the
 * submission slide come out of it: match rate, precision, **false-match rate**, per-class
 * accuracy, throughput, and cost.
 *
 * This is the only command in the module allowed to open `truth.json`. §1.5 is the reason
 * it exists at all — *a beautiful workspace with no numbers about its own accuracy loses to
 * an ugly CLI that prints a confusion matrix* — and §3's ordering is the reason it was
 * built before the agent: everything after R3 is tuning, and tuning without a scoreboard is
 * guessing.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { applyAdjudications, gate, packetsFrom } from "../lib/recon/adjudicate";
import { buildCashSeries } from "../lib/recon/cash";
import { ingestSources, type SourceName } from "../lib/recon/ingest";
import { runMatch } from "../lib/recon/match";
import { toIndianDecimal } from "../lib/recon/money";
import { score } from "../lib/recon/score";
import { TOLERANCES } from "../lib/recon/tolerance";
import { FAILURE_LABEL, type Truth } from "../lib/recon/types";

const argument = (flag: string, fallback?: string) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : process.argv[at + 1];
};

const dir = argument("--dir", "data/recon")!;
const out = argument("--out", join(dir, "eval-report.json"))!;

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
  console.error(`\nNo answer key at ${dir}/truth.json — run \`bun run recon:seed\` first.\n`);
  process.exit(1);
}

const sources = Object.fromEntries(
  SOURCES.map((name) => {
    const path = join(dir, name);
    return [name, existsSync(path) ? readFileSync(path, "utf8") : undefined];
  }),
) as Partial<Record<SourceName, string>>;

const truth = JSON.parse(readFileSync(join(dir, "truth.json"), "utf8")) as Truth;

const ingestStarted = performance.now();
const batch = ingestSources(sources);
const ingestMs = performance.now() - ingestStarted;

const run = runMatch(batch);
const card = score(run.results, truth, batch.bank);

/* ── Formatting ───────────────────────────────────────────────────────────*/

const money = (paise: number) => `₹${toIndianDecimal(paise)}`;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const pad = (value: string | number, width: number) => String(value).padStart(width);
const rule = (width = 74) => "  " + "─".repeat(width);

const rowsIn = batch.files.reduce((total, file) => total + file.rowsIn, 0);
const records = batch.files.reduce((total, file) => total + file.recordsOut, 0);

console.log(`\nEvaluating ${dir}/ against its answer key\n`);

/* ── The headline ─────────────────────────────────────────────────────────*/

const { overall } = card;
const wrong = overall.falseMatches.length;

console.log("Headline");
console.log(rule());
console.log(`  Auto-apply precision      ${pad(percent(overall.precision), 8)}   of ${overall.produced.AUTO_MATCHED} auto-applied matches, ${overall.produced.AUTO_MATCHED - wrong} are backed by the key`);
console.log(`  False-match rate          ${pad(percent(overall.falseMatchRate), 8)}   ${wrong} wrong match(es) applied without a human`);
console.log(`  Match rate                ${pad(percent(overall.matchRate), 8)}   ${overall.autoCorrect} of ${overall.truthMatches} links the key says should match`);
console.log(`  Coverage incl. proposals  ${pad(percent(overall.coverage), 8)}   ${overall.autoCorrect + overall.proposedCorrect} of ${overall.truthMatches}, counting links a human would confirm in one click`);
console.log(`  Exception recall          ${pad(percent(overall.exceptionRecall), 8)}   ${overall.exceptionCorrect} of ${overall.truthExceptions} exceptions the key expects`);
console.log(`  Class accuracy            ${pad(percent(overall.classCorrect / Math.max(1, overall.classCorrect + overall.classWrong.length)), 8)}   ${overall.classCorrect} of ${overall.classCorrect + overall.classWrong.length} labelled links carry the right failure class`);
console.log(rule());

/* ── Per lane, because one blended number hides the whole story ───────────*/

console.log("\nPer lane — match rate is reported per lane, never as one blur");
console.log("  lane                      key   auto  precision  match  cover  false");
console.log(rule(70));
for (const lane of card.lanes) {
  console.log(
    `  ${lane.lane.padEnd(24)} ${pad(lane.truthMatches + lane.truthExceptions, 4)} ${pad(lane.produced.AUTO_MATCHED, 6)} ${pad(percent(lane.precision), 10)} ${pad(percent(lane.matchRate), 6)} ${pad(percent(lane.coverage), 6)} ${pad(lane.falseMatches.length, 6)}`,
  );
}
console.log(rule(70));

/* ── The confusion matrix ─────────────────────────────────────────────────*/

console.log("\nConfusion matrix — rows are what the key expected, columns what the matcher did");
console.log("  expected      auto-matched   proposed   exception   silent");
console.log(rule(60));
for (const row of card.confusion.rows) {
  console.log(
    `  ${row.expected.padEnd(12)} ${pad(row.auto, 12)} ${pad(row.proposed, 10)} ${pad(row.exception, 11)} ${pad(row.silent, 8)}`,
  );
}
console.log(rule(60));
console.log("  Reading it: row MATCH column exception is a missed match, which costs recall.");
console.log("  Row EXCEPTION column auto-matched is a false match, which corrupts the books.");
console.log("  Row NOT IN KEY column auto-matched is the same failure seen from the other side.");

/* ── Every false match, in full ───────────────────────────────────────────*/

console.log(`\nFalse matches — ${wrong === 0 ? "none" : `${wrong}, listed in full because this is the number that matters`}`);
if (wrong > 0) {
  for (const entry of overall.falseMatches) {
    console.log(
      `\n  ${entry.reason}  ${entry.result.rule}  (${entry.result.tier}, confidence ${entry.result.confidence})`,
    );
    console.log(`    ${entry.result.left.join(", ") || "—"} → ${entry.result.right.join(", ") || "—"}`);
    for (const line of entry.result.evidence) console.log(`    · ${line}`);
  }
} else {
  console.log("  Nothing was auto-applied that the answer key contradicts.");
}

if (overall.classWrong.length > 0) {
  console.log("\nClass disagreements — the link is right, the label is not");
  for (const entry of overall.classWrong) {
    console.log(`  ${entry.rule.padEnd(34)} expected ${entry.expected}, said ${entry.said ?? "(none)"}`);
  }
}

/* ── Per planted failure class ────────────────────────────────────────────*/

console.log("\nPer planted failure class");
console.log("  class                    planted   resolved   labelled   what it is");
console.log(rule(78));
for (const entry of card.classes) {
  console.log(
    `  ${entry.failure.padEnd(22)} ${pad(entry.planted, 8)} ${pad(entry.resolved, 10)} ${pad(entry.labelled, 10)}   ${FAILURE_LABEL[entry.failure]}`,
  );
}
console.log(rule(78));
console.log("  resolved = the key's outcome was produced · labelled = and with the right class.");

/* ── Throughput and cost (R3.2) ───────────────────────────────────────────*/

const totalMs = ingestMs + run.stats.elapsedMs;
const escalated = overall.produced.PROPOSED + overall.produced.EXCEPTION;
const decided = escalated + overall.produced.AUTO_MATCHED;
console.log("\nThroughput and cost");
console.log(rule());
console.log(`  Wall clock                ${pad(totalMs.toFixed(0) + " ms", 10)}   ${ingestMs.toFixed(0)} ms ingest + ${run.stats.elapsedMs.toFixed(0)} ms match`);
console.log(`  Records                   ${pad(records.toLocaleString("en-IN"), 10)}   from ${rowsIn.toLocaleString("en-IN")} rows, ${batch.rejections.length} rejected`);
console.log(`  Throughput                ${pad(Math.round(records / (totalMs / 1000)).toLocaleString("en-IN"), 10)}   records/sec, end to end`);
console.log(`  Search nodes              ${pad(run.stats.searchNodes.toLocaleString("en-IN"), 10)}   ${run.stats.capHits} result(s) hit the ${TOLERANCES.search.maxNodes.toLocaleString("en-IN")}-node cap`);
console.log(`  LLM calls                 ${pad(0, 10)}   R4 is not built; this run is rules only`);
console.log(`  Tokens                    ${pad(0, 10)}   ₹0.00 per 1,000 records`);
console.log(`  p50 / p95 escalated       ${pad("n/a", 10)}   no escalation tier yet, so there is no latency to report`);
console.log(rule());

console.log(`\n  Escalation rate ${percent(escalated / decided)} — ${escalated} of ${decided} results would reach an LLM tier.`);
console.log(`  §6 wants that near 5%, so the tiering is sound: ${overall.produced.PROPOSED} proposal(s) and ${overall.produced.EXCEPTION} exception(s).`);

/**
 * The warning §1.6 asks for, pointed at ourselves.
 *
 * *If the matcher scores 100%, the dataset is too easy — not the matcher good.* A perfect
 * board with nothing left in the proposal lane means the deterministic rules resolve every
 * case the data contains, which is a fine result for R2 and a problem for R4: an
 * adjudication tier with nothing ambiguous to adjudicate cannot beat rules-only, and the
 * ablation in §A8 would show three identical bars.
 *
 * Printing it here rather than in a plan nobody re-reads is the point.
 */
/**
 * What an adjudication tier could actually win, stated as a number before it is built.
 *
 * This is the R4 baseline and the §A8 ablation's left-hand bar. Every escalated link whose
 * *correct* settlement the deterministic ranking already put first is a link a judgement tier
 * can close without searching for anything — and the two figures either side of it are the
 * ones that must both hold: match rate should rise, precision must not fall.
 */
const escalatedCorrect = card.scored.filter(
  (row) => row.verdict === "PROPOSED_CORRECT" && row.link.expect === "MATCH",
).length;

if (overall.produced.PROPOSED > 0) {
  console.log(
    [
      "",
      `  Headroom for R4 — ${overall.produced.PROPOSED} link(s) escalated rather than auto-applied, and the ranking put the`,
      `  correct settlement first in ${escalatedCorrect} of them. Closing those lifts the match rate from`,
      `  ${percent(overall.matchRate)} to ${percent((overall.autoCorrect + escalatedCorrect) / overall.truthMatches)} and the class accuracy from ${percent(overall.classCorrect / Math.max(1, overall.classCorrect + overall.classWrong.length))} to 100%, and it is only a win if`,
      `  precision stays at ${percent(overall.precision)}. That is the ablation, and it is measurable before a model exists.`,
    ].join("\n"),
  );
}

if (overall.precision === 1 && overall.matchRate === 1 && overall.produced.PROPOSED === 0) {
  console.log(
    [
      "",
      "  Note — every lane is at 100% and the proposal lane is empty. Per §1.6 that is a statement",
      "  about the dataset, not a compliment to the matcher: nothing in this batch needs judgement,",
      "  so an LLM tier has no work to do and the §A8 ablation would show three identical bars.",
      "  The next dataset increment should plant genuine ambiguity — cases where the rules must",
      "  abstain and only reading the narration could decide.",
    ].join("\n"),
  );
}

/* ── Proving the scoreboard can fail ──────────────────────────────────────*/

/**
 * `--self-check` deliberately corrupts the matcher's output and asserts the scoreboard
 * notices.
 *
 * R1 plants five malformed rows on every run because *a rejection path that never executes
 * is a rejection path nobody has tested*. The same argument applies here with more force: a
 * scorer that reports 100% precision and 0 false matches is either measuring a good matcher
 * or measuring nothing, and those two look identical from the outside. §1.6 says an
 * exception list that comes back empty is evidence of a bad dataset rather than a good
 * agent — an all-green scoreboard deserves exactly the same suspicion.
 *
 * So: three mutations, three assertions that the number moves.
 */
if (process.argv.includes("--self-check")) {
  console.log("Self-check — corrupting the matcher's output to prove the scoreboard reacts\n");
  const failures: string[] = [];

  const check = (label: string, condition: boolean, detail: string) => {
    console.log(`  ${condition ? "ok  " : "FAIL"} ${label} — ${detail}`);
    if (!condition) failures.push(label);
  };

  /**
   * 1 — An auto-applied match pointed at the wrong record.
   *
   * This assertion used to promote a specific PROPOSED rule to auto-apply, and when R0.4
   * emptied the proposal lane it stopped being constructible and skipped in silence — the
   * self-check acquiring the exact blind spot it exists to rule out. So it is built from any
   * auto-applied result now, and a mutation that cannot be constructed is a failure rather
   * than a shrug.
   */
  const applied = run.results.find((result) => result.outcome === "AUTO_MATCHED" && result.right.length === 1);
  const otherId = batch.bank.find((credit) => credit.id !== applied?.right[0])?.id;
  if (!applied || !otherId) {
    check("a wrong link applied without a human", false, "could not construct the mutation");
  } else {
    const mutated = run.results.map((result) =>
      result === applied ? { ...result, right: [otherId] } : result,
    );
    const after = score(mutated, truth, batch.bank);
    check(
      "a wrong link applied without a human",
      after.overall.falseMatches.length > overall.falseMatches.length,
      `false matches ${overall.falseMatches.length} → ${after.overall.falseMatches.length}, match rate ${percent(overall.matchRate)} → ${percent(after.overall.matchRate)}`,
    );
  }

  /* 2 — An exception the key expects, resolved instead. The dangerous direction. */
  const raised = run.results.find((result) => result.outcome === "EXCEPTION");
  if (!raised) check("an exception resolved instead of raised", false, "no exception to mutate");
  else {
    const mutated = run.results.map((result) =>
      result === raised
        ? { ...result, outcome: "AUTO_MATCHED" as const, left: [batch.settlements[0].id] }
        : result,
    );
    const after = score(mutated, truth, batch.bank);
    check(
      "an exception resolved instead of raised",
      after.overall.falseMatches.some((entry) => entry.reason === "SHOULD_BE_EXCEPTION") ||
        after.overall.falseMatches.length > overall.falseMatches.length,
      `${after.overall.falseMatches.length} false match(es), exception recall ${percent(overall.exceptionRecall)} → ${percent(after.overall.exceptionRecall)}`,
    );
  }

  /* 3 — The right link with the wrong label on it. */
  const labelled = run.results.find((result) => result.class !== null);
  if (!labelled) check("a correct link carrying the wrong class", false, "no classified result to mutate");
  else {
    const mutated = run.results.map((result) =>
      result === labelled
        ? { ...result, class: labelled.class === "FOREIGN_CREDIT" ? ("TDS_WITHHELD" as const) : ("FOREIGN_CREDIT" as const) }
        : result,
    );
    const after = score(mutated, truth, batch.bank);
    check(
      "a correct link carrying the wrong class",
      after.overall.classWrong.length > overall.classWrong.length,
      `class disagreements ${overall.classWrong.length} → ${after.overall.classWrong.length}`,
    );
  }

  console.log(
    failures.length === 0
      ? "\n  The scoreboard moves when the matcher is wrong, so its all-green run means something.\n"
      : `\n  ${failures.length} assertion(s) failed: the scoreboard cannot see its own blind spot.\n`,
  );
  if (failures.length > 0) process.exit(1);
}

/* ── The ablation (R4.5, §A8) ─────────────────────────────────────────────*/

/**
 * The same batch, scored with and without the adjudication tier, by the same scorer.
 *
 * §A8 calls this the money slide, and the reason it works is that a `MatchResult` carries no
 * hint of which tier produced it — so the scoreboard cannot tell a rule's match from a
 * model's, and the comparison is a comparison rather than two reports that happen to sit next
 * to each other.
 *
 * The verdict has two halves and both must hold. Match rate has to rise, **and the
 * false-match rate must not.** A tier that closes the gap by becoming willing to guess has
 * failed even when the headline number improves, which is exactly the trade §6 warns about
 * and exactly what a single-metric slide would hide.
 */
let ablation: Record<string, unknown> | null = null;

if (process.argv.includes("--with-agent")) {
  const cassette = join(dir, "adjudications.json");
  if (!existsSync(cassette)) {
    console.log(
      [
        "",
        "Ablation — no cassette.",
        `  ${cassette} does not exist, so there is nothing to compare against and this prints no`,
        "  numbers. Record one with `bun run recon:agent` (needs OPENAI_API_KEY), then re-run with",
        "  --with-agent. `bun run recon:agent --dry-run` checks the validation gate without a",
        "  provider, but deliberately writes no cassette: scripted answers must never reach a score.",
      ].join("\n"),
    );
  } else {
    const recorded = JSON.parse(readFileSync(cassette, "utf8"));
    const packets = packetsFrom(run.results, batch.bank, batch.settlements);
    // Re-gated on every replay rather than trusting what was recorded, so tightening the gate
    // shows up here immediately instead of being frozen into an old recording.
    const adjudicated = gate(packets, { decisions: recorded.decisions }, batch.settlements);
    const hybridResults = applyAdjudications(run.results, adjudicated);
    const hybrid = score(hybridResults, truth, batch.bank);

    const row = (label: string, card: typeof hybrid) => {
      const o = card.overall;
      const classAccuracy = o.classCorrect / Math.max(1, o.classCorrect + o.classWrong.length);
      console.log(
        `  ${label.padEnd(24)} ${pad(percent(o.precision), 9)} ${pad(percent(o.falseMatchRate), 11)} ${pad(percent(o.matchRate), 10)} ${pad(percent(classAccuracy), 8)} ${pad(o.produced.PROPOSED, 10)}`,
      );
      return { precision: o.precision, falseMatchRate: o.falseMatchRate, matchRate: o.matchRate, classAccuracy, proposed: o.produced.PROPOSED };
    };

    console.log(`\nAblation — the same batch, scored by the same scorer, ${recorded.model}`);
    console.log("  arm                      precision  false-match  match rate  class    escalated");
    console.log(rule(74));
    const rulesOnly = row("rules only", card);
    const withAgent = row("rules + adjudication", hybrid);
    console.log(rule(74));

    const accepted = adjudicated.filter((entry) => entry.ok).length;
    const gated = adjudicated.length - accepted;
    console.log(
      `\n  ${accepted} decision(s) accepted, ${gated} rejected by the validation gate before they could become matches.`,
    );

    const better = withAgent.matchRate > rulesOnly.matchRate;
    const safe = withAgent.falseMatchRate <= rulesOnly.falseMatchRate;
    console.log(
      better && safe
        ? `  Verdict: the tier earned its place — match rate ${percent(rulesOnly.matchRate)} → ${percent(withAgent.matchRate)} with the false-match rate still at ${percent(withAgent.falseMatchRate)}.`
        : !safe
          ? `  Verdict: REJECT. Match rate went ${percent(rulesOnly.matchRate)} → ${percent(withAgent.matchRate)} but the false-match rate rose ${percent(rulesOnly.falseMatchRate)} → ${percent(withAgent.falseMatchRate)}. That is not a win; it is a matcher that learned to guess.`
          : `  Verdict: no gain. Match rate did not move (${percent(withAgent.matchRate)}), so the tier is cost without benefit on this batch.`,
    );

    ablation = { model: recorded.model, accepted, gatedOut: gated, rulesOnly, withAgent, verdict: better && safe ? "EARNED" : safe ? "NO_GAIN" : "REJECT" };
  }
}

/* ── The report on disk ───────────────────────────────────────────────────*/

/**
 * The queue and the cash series, built once and in that order.
 *
 * `buildCashSeries` is handed the very array the report will publish, so the per-entry month
 * it returns is aligned index-for-index with the queue by construction. Deriving the same
 * sort in two places and trusting them to agree is how a cash line ends up attributing a
 * ₹14 lakh exception to the wrong month.
 */
const queue = run.results
  .filter((result) => result.outcome !== "AUTO_MATCHED")
  .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  .map((result) => ({
    lane: result.lane,
    outcome: result.outcome,
    rule: result.rule,
    class: result.class,
    amount: result.amount,
    left:
      result.left.length > 8
        ? [...result.left.slice(0, 8), `+${result.left.length - 8} more`]
        : result.left,
    right: result.right,
    evidence: result.evidence,
  }));

const cash = buildCashSeries(batch, run.results, queue);

const report = {
  generatedAt: new Date().toISOString(),
  batch: { dir, seed: truth.seed, rowsIn, records, rejected: batch.rejections.length },
  tolerances: TOLERANCES,
  timing: { ingestMs, matchMs: run.stats.elapsedMs, totalMs, recordsPerSecond: records / (totalMs / 1000) },
  cost: { llmCalls: 0, promptTokens: 0, completionTokens: 0, rupeesPerThousandRecords: 0 },
  headline: {
    precision: overall.precision,
    escalatedWithCorrectTopCandidate: escalatedCorrect,
    falseMatchRate: overall.falseMatchRate,
    matchRate: overall.matchRate,
    coverage: overall.coverage,
    exceptionRecall: overall.exceptionRecall,
    escalationRate: escalated / decided,
  },
  tiers: run.stats.byTier,
  rules: run.stats.byRule,
  lanes: card.lanes.map((lane) => ({ ...lane, falseMatches: lane.falseMatches.length })),
  classes: card.classes,
  confusion: card.confusion.rows,
  falseMatches: overall.falseMatches.map((entry) => ({
    reason: entry.reason,
    rule: entry.result.rule,
    left: entry.result.left,
    right: entry.result.right,
    evidence: entry.result.evidence,
  })),
  ablation,
  queue,
  cash,
};

writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

const unresolvedValue = run.results
  .filter((result) => result.outcome !== "AUTO_MATCHED")
  .reduce((total, result) => total + Math.abs(result.amount), 0);

console.log(
  [
    "",
    `Report written to ${out} — ${report.queue.length} queue entries with their evidence, for R5 to render.`,
    `${money(unresolvedValue)} of cash is unresolved and ${wrong === 0 ? "no match was applied that the key contradicts" : `${wrong} match(es) were applied wrongly`}.`,
    "",
  ].join("\n"),
);
