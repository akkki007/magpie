/**
 * `bun run recon:agent [--dry-run] [--replay] [--dir data/recon] [--batch 8]`
 *
 * The adjudication tier (`docs/recon-plan.md` R4). It reads what the deterministic matcher
 * escalated, sends the ranked candidate packets to a model, puts every answer through the
 * validation gate, and writes the decisions to a cassette so the run is reproducible.
 *
 * Three modes, and the first is the one that runs on every machine:
 *
 * - `--dry-run` needs no key and no network. A scripted adjudicator returns one deliberately
 *   broken answer per failure mode, and this asserts the gate catches each. R1 plants
 *   malformed rows and R3 corrupts its own scoreboard for the same reason: **the safety half
 *   of this tier is the gate, and a gate you can only exercise by spending money is a gate
 *   nobody exercises.** It never writes a cassette, so it cannot contaminate a score.
 * - `--replay` re-gates the decisions already on disk. Free, deterministic, and the mode the
 *   ablation uses — `recon:eval --with-agent`.
 * - No flag: a live run. Needs `OPENAI_API_KEY`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  gate,
  packetsFrom,
  type Adjudicated,
  type Decision,
  type Packet,
} from "../lib/recon/adjudicate";
import { ingestSources, type SourceName } from "../lib/recon/ingest";
import { runMatch } from "../lib/recon/match";
import { toIndianDecimal } from "../lib/recon/money";
import { DEFAULT_MODEL, adjudicateWithOpenAI, percentile } from "../lib/recon/openai";
import { TOLERANCES } from "../lib/recon/tolerance";
import { FAILURE_LABEL } from "../lib/recon/types";

const argument = (flag: string, fallback?: string) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : process.argv[at + 1];
};

const dir = argument("--dir", "data/recon")!;
const dryRun = process.argv.includes("--dry-run");
const replay = process.argv.includes("--replay");
const batchSize = Number(argument("--batch", "8"));
export const CASSETTE = join(dir, "adjudications.json");

const SOURCES: SourceName[] = [
  "payments.csv",
  "refunds.csv",
  "chargebacks.csv",
  "settlements.csv",
  "recon.csv",
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
const packets = packetsFrom(run.results, batch.bank, batch.settlements);

const money = (paise: number) => `₹${toIndianDecimal(paise)}`;

console.log(
  `\nAdjudicating ${packets.length} escalated item(s) — ${dryRun ? "DRY RUN, no provider" : replay ? "replaying the cassette" : `live, ${DEFAULT_MODEL}`}\n`,
);

if (packets.length === 0) {
  console.log("  The deterministic tiers resolved everything. Nothing to adjudicate.\n");
  process.exit(0);
}

/* ── Scripted mode: prove the gate can reject ─────────────────────────────*/

/**
 * One deliberately wrong answer per gate branch, plus one right one.
 *
 * These are not simulated model output and this mode makes no accuracy claim — they exist to
 * drive the gate through every rejection path. Every branch listed here is a way a real model
 * can be wrong, and the point of the tier is that none of them can become a match.
 */
function scriptedDecisions(packets: Packet[]): {
  decisions: Decision[];
  synthetic: Packet[];
  expected: { label: string; reason: string }[];
} {
  const base = (packet: Packet, over: Partial<Decision>): Decision => ({
    itemId: packet.itemId,
    action: "match",
    settlementId: packet.candidates[0]?.settlementId ?? null,
    failureClass: "DISGUISED_COUNTERPARTY",
    amountGapPaise: packet.candidates[0]?.gapPaise ?? 0,
    evidence: "narration names the gateway under an abbreviated style",
    confidence: 0.95,
    ...over,
  });

  const decisions: Decision[] = [];
  const expected: { label: string; reason: string }[] = [];
  const synthetic: Packet[] = [];

  const cases: [string, string, (packet: Packet) => Decision | null][] = [
    ["a valid, grounded, arithmetically exact match", "accepted", (p) => base(p, {})],
    [
      "an invented settlement id",
      "UNGROUNDED_ID",
      (p) => base(p, { settlementId: "setl_invented" }),
    ],
    [
      "a stated gap that disagrees with the records",
      "ARITHMETIC",
      (p) => base(p, { amountGapPaise: (p.candidates[0]?.gapPaise ?? 0) + 1 }),
    ],
    [
      "a decline",
      "LOW_CONFIDENCE",
      (p) => base(p, { action: "decline", settlementId: null, evidence: "narration identifies nothing" }),
    ],
    [
      "a match with confidence below the threshold",
      "LOW_CONFIDENCE",
      (p) => base(p, { confidence: 0.5 }),
    ],
    ["an empty evidence line", "SCHEMA", (p) => base(p, { evidence: "   " })],
    [
      "a match that names no settlement",
      "INCOHERENT",
      (p) => base(p, { settlementId: null }),
    ],
    [
      "a decline that names one anyway",
      "INCOHERENT",
      (p) => base(p, { action: "decline" }),
    ],
    ["no answer at all", "SCHEMA", () => null],
  ];

  /**
   * One packet per case, always.
   *
   * The first version indexed into the real packets and broke out of the loop when it ran
   * out — so with six escalated items, the last three cases silently never ran and the check
   * still printed all green. That is the same silent-skip the eval self-check had, arriving
   * in the code written to prevent it. Cases beyond the available packets now get a clone
   * with its own item id, so the number of real escalations cannot change what is tested.
   */
  for (const [index, [label, reason, make]] of cases.entries()) {
    const real = packets[index];
    const packet: Packet =
      real ?? { ...packets[0], itemId: `${packets[0].itemId}-case-${index}` };
    if (!real) synthetic.push(packet);

    const decision = make(packet);
    if (decision) decisions.push(decision);
    expected.push({ label, reason });
  }

  /**
   * A candidate outside the tolerance the gate will absorb.
   *
   * Unreachable through the real pipeline — the ranking pass only offers candidates inside
   * `escalation.slackPaise`, so the recomputed gap is always small. The check stays because
   * **the gate must not trust the packet builder**: it is the last thing between a model and
   * the books, and an invariant that depends on an upstream pass having filtered correctly is
   * not an invariant. This synthetic packet is how that branch gets exercised.
   */
  const donor = packets[0];
  const farSettlement = batch.settlements.find(
    (settlement) => Math.abs(donor.amount - settlement.net) > TOLERANCES.escalation.slackPaise * 100,
  );
  if (farSettlement) {
    const packet: Packet = {
      ...donor,
      itemId: `${donor.itemId}-out-of-tolerance`,
      candidates: [
        {
          settlementId: farSettlement.id,
          net: farSettlement.net,
          settledAt: farSettlement.settledAt,
          utr: farSettlement.utr,
          gapPaise: donor.amount - farSettlement.net,
          daysEarlier: 0,
        },
      ],
    };
    synthetic.push(packet);
    decisions.push(
      base(packet, {
        settlementId: farSettlement.id,
        amountGapPaise: donor.amount - farSettlement.net,
      }),
    );
    expected.push({ label: "a candidate far outside tolerance", reason: "OUT_OF_TOLERANCE" });
  } else {
    // Not constructible means untested, and untested must be loud rather than absent.
    expected.push({ label: "a candidate far outside tolerance", reason: "OUT_OF_TOLERANCE" });
  }

  return { decisions, synthetic, expected };
}

/* ── Run ──────────────────────────────────────────────────────────────────*/

let adjudicated: Adjudicated[];
let usage: Awaited<ReturnType<typeof adjudicateWithOpenAI>>["usage"] | null = null;

if (dryRun) {
  const scripted = scriptedDecisions(packets);
  adjudicated = gate(
    [...packets, ...scripted.synthetic],
    { decisions: scripted.decisions },
    batch.settlements,
  );

  console.log("Gate check — one deliberately broken answer per rejection path\n");
  let failures = 0;
  for (const { label, reason } of scripted.expected) {
    const got = adjudicated.find((entry) =>
      reason === "accepted"
        ? entry.ok
        : !entry.ok && entry.reason === reason,
    );
    const ok = got !== undefined;
    if (!ok) failures++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(48)} → ${reason}`);
  }

  const accepted = adjudicated.filter((entry) => entry.ok).length;
  console.log(
    failures === 0
      ? `\n  Every rejection path fires, and ${accepted} of ${adjudicated.length} answers was accepted.\n  A wrong answer cannot become a match, which is the only property that matters here.\n`
      : `\n  ${failures} rejection path(s) did not fire. The gate has a hole.\n`,
  );
  console.log("  No cassette written: a dry run must never be able to reach a scoreboard.\n");
  if (failures > 0) process.exit(1);
  process.exit(0);
}

if (replay) {
  if (!existsSync(CASSETTE)) {
    console.error(`No cassette at ${CASSETTE} — run \`bun run recon:agent\` first.\n`);
    process.exit(1);
  }
  const recorded = JSON.parse(readFileSync(CASSETTE, "utf8"));
  adjudicated = gate(packets, { decisions: recorded.decisions }, batch.settlements);
  usage = recorded.usage ?? null;
  console.log(`  Replayed ${recorded.decisions.length} decision(s) recorded from ${recorded.model} at ${recorded.generatedAt}.\n`);
} else {
  const result = await adjudicateWithOpenAI(packets, batch.settlements, {
    batchSize,
    onBatch: (index, total, ms) =>
      console.log(`  batch ${index}/${total} — ${ms.toFixed(0)} ms`),
  });
  adjudicated = result.adjudicated;
  usage = result.usage;

  writeFileSync(
    CASSETTE,
    `${JSON.stringify(
      {
        model: usage.model,
        generatedAt: new Date().toISOString(),
        // Raw decisions, before the gate. Replaying re-runs the gate, so a change to the
        // gate shows up on the next replay instead of being frozen into the recording.
        decisions: adjudicated
          .map((entry) => entry.decision)
          .filter((decision): decision is Decision => decision !== undefined),
        usage,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\n  Cassette written to ${CASSETTE} — replay with --replay, free and identical.`);
}

/* ── Report ───────────────────────────────────────────────────────────────*/

const accepted = adjudicated.filter((entry) => entry.ok);
const rejected = adjudicated.filter((entry) => !entry.ok);

console.log(`\nDecisions — ${accepted.length} accepted, ${rejected.length} rejected by the gate`);
for (const entry of adjudicated) {
  if (entry.ok) {
    console.log(
      `\n  ACCEPTED  ${money(entry.packet.amount).padEnd(16)} ${entry.packet.creditId} → ${entry.settlement.id}  (confidence ${entry.decision.confidence})`,
    );
    console.log(`    class: ${entry.decision.failureClass ?? "(none)"}${entry.decision.failureClass ? ` — ${FAILURE_LABEL[entry.decision.failureClass]}` : ""}`);
    console.log(`    · ${entry.decision.evidence}`);
    console.log(`    · gap of ${entry.gapPaise} paise recomputed and confirmed in TypeScript`);
  } else {
    console.log(
      `\n  REJECTED  ${money(entry.packet.amount).padEnd(16)} ${entry.packet.creditId}  ${entry.reason}`,
    );
    console.log(`    · ${entry.detail}`);
    if (entry.decision?.evidence) console.log(`    · it said: ${entry.decision.evidence}`);
  }
}

if (usage) {
  const p50 = percentile(usage.latenciesMs, 50);
  const p95 = percentile(usage.latenciesMs, 95);
  console.log("\nCost and latency");
  console.log(`  model                     ${usage.model}`);
  console.log(`  calls                     ${usage.calls} for ${packets.length} item(s) — batched, never per record (§A6)`);
  console.log(`  input tokens              ${usage.inputTokens.toLocaleString("en-IN")} (${usage.cachedInputTokens.toLocaleString("en-IN")} served from cache)`);
  console.log(`  output tokens             ${usage.outputTokens.toLocaleString("en-IN")}`);
  console.log(`  p50 / p95 per batch       ${p50 === null ? "n/a" : `${p50.toFixed(0)} ms`} / ${p95 === null ? "n/a" : `${p95.toFixed(0)} ms`}`);
  console.log(
    `  cost                      ${usage.rupees === null ? "rates not configured — set OPENAI_INPUT_PER_MTOK, OPENAI_OUTPUT_PER_MTOK and USD_TO_INR" : `₹${usage.rupees.toFixed(2)} for this run`}`,
  );
}

console.log(
  `\nRun \`bun run recon:eval --with-agent\` for the ablation: the same batch scored with and\nwithout these decisions, which is the only thing that says whether the tier earned its place.\n`,
);
