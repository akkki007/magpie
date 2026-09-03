import type { Model } from "./types";

/**
 * CSV import into a `LINKED` variable (`docs/modelling-plan.md` §6, §7 M7.1).
 *
 * "CSV upload is the honest v1 connector and covers demos" — honest because it makes no
 * claim of syncing: it reads a pasted file once and produces a normal `InsertVariable`
 * command, the same one typing "Add variable" produces. That is deliberate. §6 says a real
 * connector's sync "writes commands to the audit log — a number changing under a user's
 * feet has to be explainable", and the cheapest way to make that true on day one is for
 * this path to go through the command bus too, rather than writing rows directly and
 * inventing a second way for a variable's numbers to change.
 *
 * Pure and isomorphic — no DB, no fetch — so the browser can parse a paste before anything
 * is sent, and the same function is what a script or a future real connector's importer
 * would call.
 */

export type CsvImportResult =
  | { ok: true; series: number[]; matched: number; total: number; unmatched: string[] }
  | { ok: false; error: string };

/** `"Jan '26"` and `"jan-2026"` are the same period once punctuation and case are gone. */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Exported because the database rollup (`docs/database-plan.md` §3) buckets records into the
 * same periods from the same messy inputs. Two period matchers would drift, and the drift
 * would show up as "the CSV found January and the database didn't".
 */
export function matchPeriod(model: Model, raw: string): number {
  const text = raw.trim();

  // YYYY-MM or YYYY-MM-DD, the two shapes every spreadsheet export actually produces.
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(text);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    return model.periods.findIndex((p) => p.year === year && p.month === month);
  }

  const normalised = normalise(text);
  return model.periods.findIndex(
    (p) => normalise(p.label) === normalised || normalise(p.key) === normalised,
  );
}

/** Splits on commas or tabs, tolerating either — a paste from a spreadsheet is tab-separated. */
function splitRow(line: string): string[] {
  return line.includes("\t") ? line.split("\t") : line.split(",");
}

export function parseCsv(text: string, model: Model): CsvImportResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { ok: false, error: "Paste some rows first." };

  const series = Array(model.periods.length).fill(0) as number[];
  const covered = new Set<number>();
  const unmatched: string[] = [];
  let total = 0;

  for (const line of lines) {
    const [rawPeriod, rawValue] = splitRow(line).map((c) => c.trim());
    if (rawPeriod === undefined || rawValue === undefined) continue;

    const value = Number(rawValue.replace(/[,$]/g, ""));
    const index = matchPeriod(model, rawPeriod);

    // A header row ("Period, Value") fails both checks and is silently skipped — the one
    // case where "no match" is not worth reporting as one.
    if (index === -1 && !Number.isFinite(value)) continue;

    total++;
    if (index === -1) {
      unmatched.push(rawPeriod);
      continue;
    }
    if (!Number.isFinite(value)) {
      unmatched.push(`${rawPeriod} (value "${rawValue}" is not a number)`);
      continue;
    }

    series[index] = value;
    covered.add(index);
  }

  if (covered.size === 0) {
    return {
      ok: false,
      error:
        unmatched.length > 0
          ? `No row matched a period in this model's horizon (tried: ${unmatched.slice(0, 3).join(", ")}${unmatched.length > 3 ? "…" : ""}).`
          : "No usable rows — expected \"period, value\" per line.",
    };
  }

  return { ok: true, series, matched: covered.size, total, unmatched };
}
