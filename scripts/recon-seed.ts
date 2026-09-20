/**
 * `bun run recon:seed [--count 5000] [--seed 42] [--days 60] [--out data/recon]`
 *
 * Writes the synthetic batch (`docs/recon-plan.md` R0.2) and its answer key, then checks
 * its own work and prints what it planted.
 *
 * The self-check at the end is not ceremony. The whole evaluation rests on `truth.json`
 * being right, and a generator bug that silently mislabels twenty links would show up
 * later as a matcher that "cannot get past 94%" — days lost to debugging the wrong file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { toCsv, toDdMmYyyy } from "../lib/recon/csv";
import { generateBatch, DEFAULTS } from "../lib/recon/generate";
import { toDecimal, toIndianDecimal } from "../lib/recon/money";
import { FAILURE_LABEL, type Batch, type FailureClass } from "../lib/recon/types";

function arg(name: string, fallback: number | string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return typeof fallback === "number" ? Number(value) : value;
}

const options = {
  count: arg("count", DEFAULTS.count) as number,
  seed: arg("seed", DEFAULTS.seed) as number,
  days: arg("days", DEFAULTS.days) as number,
  start: arg("start", DEFAULTS.start) as string,
};
const outDir = arg("out", "data/recon") as string;

console.log(`\nGenerating ${options.count} payments over ${options.days} days, seed ${options.seed}…`);
const batch = generateBatch(options);

/* ── Write ────────────────────────────────────────────────────────────────*/

mkdirSync(outDir, { recursive: true });
const write = (name: string, contents: string) => {
  writeFileSync(join(outDir, name), contents);
  return `${name} (${(contents.length / 1024).toFixed(0)} KB)`;
};

const files = [
  write(
    "payments.csv",
    toCsv(batch.payments, [
      ["payment_id", (p) => p.id],
      ["order_id", (p) => p.orderId],
      ["captured_at", (p) => p.capturedAt],
      ["method", (p) => p.method],
      ["amount", (p) => toDecimal(p.gross)],
      ["fee", (p) => toDecimal(p.fee)],
      ["tax", (p) => toDecimal(p.tax)],
      ["net", (p) => toDecimal(p.net)],
      ["status", (p) => p.status],
    ]),
  ),
  write(
    "refunds.csv",
    toCsv(batch.refunds, [
      ["refund_id", (r) => r.id],
      ["payment_id", (r) => r.paymentId],
      ["created_at", (r) => r.createdAt],
      ["amount", (r) => toDecimal(r.amount)],
      ["speed", (r) => r.speed],
    ]),
  ),
  write(
    "chargebacks.csv",
    toCsv(batch.chargebacks, [
      ["dispute_id", (c) => c.id],
      ["payment_id", (c) => c.paymentId],
      ["raised_at", (c) => c.raisedAt],
      ["amount", (c) => toDecimal(c.amount)],
      ["status", (c) => c.status],
    ]),
  ),
  write(
    "settlements.csv",
    toCsv(batch.settlements, [
      ["settlement_id", (s) => s.id],
      ["settled_at", (s) => s.settledAt],
      ["utr", (s) => s.utr],
      ["gross", (s) => toDecimal(s.gross)],
      ["fees", (s) => toDecimal(s.fees)],
      ["tax", (s) => toDecimal(s.tax)],
      ["refunds", (s) => toDecimal(s.refunds)],
      ["chargebacks", (s) => toDecimal(s.chargebacks)],
      ["tds", (s) => toDecimal(s.tds)],
      ["net", (s) => toDecimal(s.net)],
      ["payment_count", (s) => s.paymentCount],
    ]),
  ),
  // The file that makes the payments lane a matching problem rather than a guess: one row
  // per settled entity, naming the payout it landed in.
  write(
    "recon.csv",
    toCsv(batch.recon, [
      ["entry_id", (row) => row.id],
      ["settlement_id", (row) => row.settlementId],
      ["settlement_utr", (row) => row.utr],
      ["settled_at", (row) => row.settledAt],
      ["type", (row) => row.type],
      ["entity_id", (row) => row.entityId],
      ["amount", (row) => toDecimal(row.amount)],
      ["fee", (row) => toDecimal(row.fee)],
      ["tax", (row) => toDecimal(row.tax)],
    ]),
  ),
  // The awkward one, on purpose: BOM, dd/mm/yyyy, Indian grouping, commas in the text,
  // and a handful of rows no parser should accept.
  write("bank.csv", corrupt(
    toCsv(
      batch.bank,
      [
        ["Txn Id", (b) => b.id],
        ["Value Date", (b) => toDdMmYyyy(b.valueDate)],
        ["Narration", (b) => b.description],
        ["Ref No", (b) => b.reference],
        ["Debit", (b) => (b.amount < 0 ? toIndianDecimal(-b.amount) : "")],
        ["Credit", (b) => (b.amount > 0 ? toIndianDecimal(b.amount) : "")],
      ],
      { bom: true },
    ),
  )),
  write(
    "ledger.csv",
    toCsv(batch.ledger, [
      ["line_id", (l) => l.id],
      ["journal_id", (l) => l.journalId],
      ["posted_at", (l) => l.postedAt],
      ["account", (l) => l.account],
      ["debit", (l) => toDecimal(l.debit)],
      ["credit", (l) => toDecimal(l.credit)],
      ["memo", (l) => l.memo],
    ]),
  ),
  write("truth.json", `${JSON.stringify(batch.truth, null, 2)}\n`),
];

/**
 * Bank statements arrive with junk in them: a footer line, a cell the export mangled, a
 * date nobody validated. Planting a few here means R1's rejection path is exercised on
 * every run and its count can be checked against the answer key, instead of being a code
 * path nobody has ever seen execute.
 */
function corrupt(csv: string): string {
  const lines = csv.split("\n");
  const bad: [line: string, reason: string][] = [
    ['bnk_truncated,05/06/2026,"NEFT INWARD, RAZORPAY"', "short row: four columns of six"],
    ["bnk_baddate,31/02/2026,NEFT INWARD RAZORPAY,RZPX000000001,,\"1,00,000.00\"", "31 February is not a date"],
    ["bnk_thirddp,06/06/2026,NEFT INWARD RAZORPAY,RZPX000000002,,\"1,23,456.789\"", "three decimal places in a money column"],
    ["bnk_noamount,07/06/2026,NEFT INWARD RAZORPAY,RZPX000000003,,", "neither debit nor credit"],
    ["bnk_notanumber,08/06/2026,NEFT INWARD RAZORPAY,RZPX000000004,,N/A", "amount is not a number"],
  ];

  // Spread through the file rather than bunched at the end, so a parser that gives up on
  // the first failure is caught immediately.
  const step = Math.max(1, Math.floor((lines.length - 2) / (bad.length + 1)));
  bad.forEach(([line, reason], i) => {
    lines.splice(1 + step * (i + 1) + i, 0, line);
    batch.truth.malformed.push({ file: "bank.csv", line, reason });
  });

  return lines.join("\n");
}

/* ── Check ────────────────────────────────────────────────────────────────*/

const problems = check(batch);

/* ── Report ───────────────────────────────────────────────────────────────*/

const { counts, planted, links } = batch.truth;

console.log(`\nSources → ${outDir}/`);
for (const file of files) console.log(`  ${file}`);

console.log("\nRecords");
for (const [name, value] of Object.entries(counts)) {
  console.log(`  ${name.padEnd(14)} ${value.toLocaleString("en-IN").padStart(9)}`);
}

console.log("\nLinks to score");
const lanes = ["PAYMENT_TO_SETTLEMENT", "SETTLEMENT_TO_BANK", "SETTLEMENT_TO_LEDGER"] as const;
for (const lane of lanes) {
  const inLane = links.filter((link) => link.lane === lane);
  const matches = inLane.filter((link) => link.expect === "MATCH").length;
  const exceptions = inLane.length - matches;
  console.log(
    `  ${lane.padEnd(22)} ${String(matches).padStart(5)} match  ${String(exceptions).padStart(4)} exception`,
  );
}

console.log("\nPlanted failures");
const order = Object.entries(planted).sort((a, b) => b[1] - a[1]) as [FailureClass, number][];
for (const [failure, count] of order) {
  // A class can be planted in two shapes with two different right answers -- see
  // MISSING_RECON_ROW in R0.4 -- so showing only the first link's expectation would print a
  // half-truth about the very thing this table exists to state.
  const expectations = [...new Set(links.filter((link) => link.class === failure).map((link) => link.expect))];
  const expect = expectations.length === 0 ? "—" : expectations.sort().join("/");
  console.log(
    `  ${String(count).padStart(4)}  ${failure.padEnd(22)} ${expect.padEnd(16)} ${FAILURE_LABEL[failure]}`,
  );
}
const plantedTotal = order.reduce((total, [, count]) => total + count, 0);
console.log(`  ${String(plantedTotal).padStart(4)}  total`);

console.log("\nMalformed rows (ingestion must reject exactly these)");
for (const row of batch.truth.malformed) console.log(`  ${row.file}  ${row.reason}`);

if (problems.length) {
  console.log(`\n${problems.length} integrity problem(s):`);
  for (const problem of problems.slice(0, 10)) console.log(`  ✗ ${problem}`);
  process.exit(1);
}
console.log("\nIntegrity: every journal balances, every link resolves, no record is double-labelled.\n");

/**
 * Three things have to hold, or the answer key is lying:
 *
 * 1. Every journal balances — except the ones deliberately unbalanced by FEE_NOT_BOOKED.
 * 2. Every id in `truth.json` exists in a source file.
 * 3. No settlement carries two contradictory answers for the same lane.
 */
function check(batch: Batch): string[] {
  const problems: string[] = [];

  const unbalanced = new Set(
    batch.truth.links
      .filter((link) => link.class === "FEE_NOT_BOOKED")
      .flatMap((link) => link.right),
  );
  const journals = new Map<string, { debit: number; credit: number }>();
  for (const line of batch.ledger) {
    const totals = journals.get(line.journalId) ?? { debit: 0, credit: 0 };
    totals.debit += line.debit;
    totals.credit += line.credit;
    journals.set(line.journalId, totals);
  }
  for (const [journalId, totals] of journals) {
    if (totals.debit !== totals.credit && !unbalanced.has(journalId)) {
      problems.push(`journal ${journalId} is out by ${totals.debit - totals.credit} paise`);
    }
  }

  const known = new Set<string>([
    ...batch.payments.map((p) => p.id),
    ...batch.settlements.map((s) => s.id),
    ...batch.bank.map((b) => b.id),
    ...batch.recon.map((row) => row.id),
    ...journals.keys(),
  ]);
  for (const link of batch.truth.links) {
    for (const id of [...link.left, ...link.right]) {
      if (!known.has(id)) problems.push(`link references unknown id ${id}`);
    }
  }

  const seen = new Set<string>();
  for (const link of batch.truth.links) {
    for (const id of link.left) {
      const key = `${link.lane}:${id}`;
      if (seen.has(key)) problems.push(`${id} has two answers in ${link.lane}`);
      seen.add(key);
    }
  }

  /**
   * The payments lane now has two link shapes — `left` is the payment set on a match and
   * empty on an exception — so checking `left` alone stopped being enough. A settlement
   * holding both a MATCH and an EXCEPTION in that lane would silently mis-score every run,
   * and it is the exact mistake the new planting could make.
   */
  const answered = new Set<string>();
  for (const link of batch.truth.links) {
    if (link.lane !== "PAYMENT_TO_SETTLEMENT") continue;
    for (const id of link.right) {
      if (answered.has(id)) problems.push(`${id} has two answers in PAYMENT_TO_SETTLEMENT`);
      answered.add(id);
    }
  }
  for (const settlement of batch.settlements) {
    if (!answered.has(settlement.id)) {
      problems.push(`${settlement.id} has no answer in PAYMENT_TO_SETTLEMENT`);
    }
  }

  /* Every recon row must point at a settlement and an entity that exist. */
  const settlementIds = new Set(batch.settlements.map((s) => s.id));
  const entityIds = new Set<string>([
    ...batch.payments.map((p) => p.id),
    ...batch.refunds.map((r) => r.id),
    ...batch.chargebacks.map((c) => c.id),
  ]);
  for (const row of batch.recon) {
    if (!settlementIds.has(row.settlementId)) problems.push(`recon row ${row.id} names unknown settlement ${row.settlementId}`);
    if (!entityIds.has(row.entityId)) problems.push(`recon row ${row.id} names unknown entity ${row.entityId}`);
  }

  return problems;
}
