/**
 * `bun run recon:s3 push  [--dir data/recon] [--batch <id>]`
 * `bun run recon:s3 match --batch <id>`
 *
 * The S3 archive end to end (`lib/recon/s3.ts`).
 *
 * **`push`** uploads a batch directory — the seven source files, plus `eval-report.json` when
 * one exists — under `batches/<id>/`. **`match`** reads that prefix back, ingests it and runs
 * the deterministic matcher, printing the same summary `recon:match` prints for a directory.
 *
 * That pairing is the check that the archive is faithful: `recon:match` over the files on disk
 * and `recon:s3 match` over the same files after a round trip through S3 must report identical
 * counts, because ingestion is a pure function of file contents. If they ever differ, the
 * archive changed the bytes.
 *
 * Needs `RECON_BUCKET`, and AWS credentials from the environment (`AWS_PROFILE=magpie-dev` on a
 * laptop). Like `recon:match`, it never opens `truth.json`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ingestSources } from "../lib/recon/ingest";
import { runMatch } from "../lib/recon/match";
import { toIndianDecimal } from "../lib/recon/money";
import { SOURCE_NAMES, archiveEnabled, putText, readBatch } from "../lib/recon/s3";
import { TOLERANCES } from "../lib/recon/tolerance";

const argument = (flag: string, fallback?: string) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : process.argv[at + 1];
};

const command = process.argv[2];

if (!archiveEnabled()) {
  console.error("\nRECON_BUCKET is not set — there is no bucket to talk to.\n");
  process.exit(1);
}

const money = (paise: number) => `₹${toIndianDecimal(paise)}`;

if (command === "push") {
  const dir = argument("--dir", "data/recon")!;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const batch = argument("--batch", `local-${stamp}`)!;

  if (!existsSync(join(dir, "bank.csv"))) {
    console.error(`\nNo batch at ${dir}/ — run \`bun run recon:seed\` first.\n`);
    process.exit(1);
  }

  console.log(`\nPushing ${dir}/ → s3://${process.env.RECON_BUCKET}/batches/${batch}/\n`);
  for (const name of SOURCE_NAMES) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const body = readFileSync(path, "utf8");
    await putText(`batches/${batch}/${name}`, body);
    console.log(`  ${name.padEnd(18)} ${String(body.length).padStart(9)} bytes`);
  }

  const report = join(dir, "eval-report.json");
  if (existsSync(report)) {
    await putText(`batches/${batch}/eval-report.json`, readFileSync(report, "utf8"), "application/json");
    console.log(`  ${"eval-report.json".padEnd(18)} (run artifact)`);
  }

  console.log(`\nBatch id: ${batch}\n`);
} else if (command === "match") {
  const batch = argument("--batch");
  if (!batch) {
    console.error("\nPass --batch <id>. `recon:s3 push` prints the id it used.\n");
    process.exit(1);
  }

  const sources = await readBatch(`batches/${batch}`);
  if (Object.keys(sources).length === 0) {
    console.error(`\nNothing under batches/${batch}/ in s3://${process.env.RECON_BUCKET}.\n`);
    process.exit(1);
  }

  const ingested = ingestSources(sources);
  const run = runMatch(ingested);
  const { stats } = run;

  console.log(`\nMatching s3://${process.env.RECON_BUCKET}/batches/${batch}/ — deterministic only\n`);
  console.log(
    `  ingested ${ingested.files.reduce((n, f) => n + f.recordsOut, 0)} records from ${ingested.files.length} files, ${ingested.rejections.length} rows rejected`,
  );

  const auto = stats.byOutcome.AUTO_MATCHED;
  const total = auto + stats.byOutcome.PROPOSED + stats.byOutcome.EXCEPTION;
  const unresolved = run.results
    .filter((result) => result.outcome !== "AUTO_MATCHED")
    .reduce((sum, result) => sum + Math.abs(result.amount), 0);

  console.log(
    [
      "",
      `Auto-applied ${auto} of ${total} results at or above the ${TOLERANCES.autoApply} confidence threshold.`,
      `${stats.byOutcome.PROPOSED} need a human, ${stats.byOutcome.EXCEPTION} are exceptions, and ${money(unresolved)} of cash is unresolved.`,
      "",
    ].join("\n"),
  );
} else {
  console.error("\nUsage: recon:s3 push [--dir data/recon] [--batch <id>]\n       recon:s3 match --batch <id>\n");
  process.exit(1);
}
