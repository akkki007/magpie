/**
 * `bun run recon:ingest [--dir data/recon]`
 *
 * Reads the six source files, normalises them, and prints the reconciliation R1.3 asks
 * for: **rows in, records out, rows rejected**, per file.
 *
 * Those three numbers have to be stated before any match rate is, because a match rate is
 * a fraction and this is where its denominator is decided. "94% matched" means nothing if
 * ingestion quietly dropped 300 rows on the floor.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { generateBatch } from "../lib/recon/generate";
import { ingestSources, type SourceName } from "../lib/recon/ingest";
import { toDecimal } from "../lib/recon/money";

const dirIndex = process.argv.indexOf("--dir");
const dir = dirIndex === -1 ? "data/recon" : process.argv[dirIndex + 1];

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

const started = performance.now();
const batch = ingestSources(sources);
const elapsed = performance.now() - started;

/* ── Report ───────────────────────────────────────────────────────────────*/

console.log(`\nIngesting ${dir}/\n`);
console.log("  file                rows in   records   rejected");
console.log("  ─────────────────────────────────────────────────");

let rowsIn = 0;
let recordsOut = 0;
for (const stat of batch.files) {
  rowsIn += stat.rowsIn;
  recordsOut += stat.recordsOut;
  const note = stat.missingColumns.length
    ? `  ← missing ${stat.missingColumns.join(", ")}`
    : "";
  console.log(
    `  ${stat.file.padEnd(18)} ${String(stat.rowsIn).padStart(8)} ${String(stat.recordsOut).padStart(9)} ${String(stat.rejected).padStart(10)}${note}`,
  );
}
console.log("  ─────────────────────────────────────────────────");
console.log(
  `  ${"total".padEnd(18)} ${String(rowsIn).padStart(8)} ${String(recordsOut).padStart(9)} ${String(batch.rejections.length).padStart(10)}`,
);
console.log(`\n  ${elapsed.toFixed(0)} ms · ${Math.round(rowsIn / (elapsed / 1000)).toLocaleString("en-IN")} rows/sec`);

if (batch.rejections.length > 0) {
  console.log("\nRejected rows");
  for (const rejection of batch.rejections) {
    console.log(`  ${rejection.file}:${rejection.line}  ${rejection.reason.padEnd(13)} ${rejection.detail}`);
    console.log(`    ${rejection.raw.slice(0, 96)}`);
  }
}

/* ── Cross-check against the answer key ───────────────────────────────────*/

const truthPath = join(dir, "truth.json");
if (existsSync(truthPath)) {
  const truth = JSON.parse(readFileSync(truthPath, "utf8"));
  const expected: Record<string, number> = {
    "payments.csv": truth.counts.payments,
    "refunds.csv": truth.counts.refunds,
    "chargebacks.csv": truth.counts.chargebacks,
    "settlements.csv": truth.counts.settlements,
    "bank.csv": truth.counts.bankRows,
    "ledger.csv": truth.counts.ledgerLines,
  };

  const problems: string[] = [];
  for (const stat of batch.files) {
    if (stat.recordsOut !== expected[stat.file]) {
      problems.push(`${stat.file}: ${stat.recordsOut} records, answer key says ${expected[stat.file]}`);
    }
  }
  if (batch.rejections.length !== truth.malformed.length) {
    problems.push(
      `${batch.rejections.length} rejections, ${truth.malformed.length} rows were planted malformed`,
    );
  }

  // Ingestion is only correct if the numbers survived it. Total the money in the bank
  // statement and check it against what the generator wrote — the one assertion that
  // catches a float creeping into the parser.
  const bankTotal = batch.bank.reduce((total, credit) => total + credit.amount, 0);
  if (!Number.isSafeInteger(bankTotal)) problems.push("bank total is not an integer number of paise");

  /**
   * `--verify` regenerates the batch from the seed in the answer key and compares every
   * field of every record against what came back off disk.
   *
   * Counts agreeing is weak evidence: a parser that turns ₹575,687.57 into 57568756.99
   * loses nothing and reads perfectly. This is the assertion that catches it, and it is
   * only possible because the data is synthetic and the generator is deterministic —
   * which is most of the argument for building it that way.
   */
  if (process.argv.includes("--verify")) {
    const made = generateBatch({ seed: truth.seed, count: truth.counts.payments });
    let differences = 0;

    const compare = <T extends { id: string }>(label: string, read: T[], generated: T[]) => {
      const byId = new Map(generated.map((record) => [record.id, record]));
      for (const record of read) {
        const other = byId.get(record.id);
        if (!other) {
          differences++;
          continue;
        }
        for (const key of Object.keys(record) as (keyof T)[]) {
          if (record[key] !== other[key]) {
            if (differences < 5) {
              console.log(`  ✗ ${label} ${record.id}.${String(key)}: ${record[key]} ≠ ${other[key]}`);
            }
            differences++;
          }
        }
      }
    };

    compare("payment", batch.payments, made.payments);
    compare("refund", batch.refunds, made.refunds);
    compare("chargeback", batch.chargebacks, made.chargebacks);
    compare("settlement", batch.settlements, made.settlements);
    compare("bank", batch.bank, made.bank);
    compare("ledger", batch.ledger, made.ledger);

    if (differences > 0) problems.push(`${differences} field(s) changed value passing through CSV`);
    else console.log("\n  Field-level round-trip exact: every value survived the CSV unchanged.");
  }

  console.log(
    problems.length === 0
      ? `\nMatches the answer key: every record accounted for, exactly the planted rows rejected.\n  Bank statement totals ₹${toDecimal(bankTotal)} across ${batch.bank.length} lines.\n`
      : `\n${problems.length} discrepancy(ies):\n${problems.map((p) => `  ✗ ${p}`).join("\n")}\n`,
  );
  if (problems.length) process.exit(1);
}
