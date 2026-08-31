/**
 * CSV parsing and field decoding (`docs/recon-plan.md` R1.1).
 *
 * Every function here returns a value **or an error string**, never a silently coerced
 * fallback. `Number("1,23,456.78")` is `NaN`, `parseFloat` of it is `1`, and both of those
 * are worse than refusing: a reconciliation whose inputs were quietly mangled reports a
 * confident match rate over numbers that were never right.
 */

export type CsvRow = {
  /** 1-based line in the file, so a rejection can be looked up by eye. */
  line: number;
  cells: string[];
  /** The original text, kept for the rejection report. */
  raw: string;
};

/**
 * RFC 4180, plus the two things real files do: a UTF-8 BOM in front of the header, and
 * CRLF line endings. Quoted fields may contain commas, newlines and doubled quotes.
 *
 * Hand-written rather than pulled in, because the whole parser is forty lines and the
 * failure modes are exactly the ones this project has to be right about.
 */
export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const input = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");

  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  let rowRaw = "";

  const endField = () => {
    cells.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline produces one empty cell; that is not a row.
    if (!(cells.length === 1 && cells[0] === "")) {
      rows.push({ line: rowStart, cells, raw: rowRaw });
    }
    cells = [];
    rowRaw = "";
    rowStart = line + 1;
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char !== "\n" || quoted) rowRaw += char;

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
          rowRaw += '"';
        } else {
          quoted = false;
        }
      } else {
        if (char === "\n") line++;
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") quoted = true;
    else if (char === ",") endField();
    else if (char === "\n") {
      endRow();
      line++;
    } else field += char;
  }
  if (field !== "" || cells.length > 0 || rowRaw !== "") endRow();

  const header = rows.shift()?.cells.map((cell) => cell.trim()) ?? [];
  return { header, rows };
}

/* ── Field decoders ───────────────────────────────────────────────────────*/

export type Decoded<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T,>(value: T): Decoded<T> => ({ ok: true, value });
const fail = (error: string): Decoded<never> => ({ ok: false, error });

/**
 * `"11,57,147.71"` → `115714771` paise.
 *
 * Accepts Indian *and* Western grouping (the separators carry no information once the
 * decimal point is located), a currency symbol, spaces, a leading sign, and accounting
 * parentheses. Rejects more than two decimal places, because a third decimal in a money
 * column means the file is not what we think it is.
 *
 * The conversion is **integer arithmetic on the two halves of the string** — never
 * `parseFloat(x) * 100`, which turns ₹575,687.57 into 57568756.99999999.
 */
export function parsePaise(raw: string): Decoded<number> {
  let text = raw.trim();
  if (text === "") return fail("empty");

  let sign = 1;
  if (text.startsWith("(") && text.endsWith(")")) {
    sign = -1;
    text = text.slice(1, -1);
  }
  text = text.replace(/[₹$\s,]/g, "");
  if (text.startsWith("-")) {
    sign *= -1;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return fail(`not a money amount: "${raw.trim()}"`);

  const [, whole, fraction = ""] = match;
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) return fail(`amount out of range: "${raw.trim()}"`);
  return ok(sign * paise);
}

export type DateFormat = "ISO" | "DMY";

/**
 * Returns an ISO `YYYY-MM-DD` date, or an error.
 *
 * **The format is declared per source, never sniffed per row.** `03/06/2026` is the 3rd of
 * June in Mumbai and the 6th of March in New York, and there is nothing in the row to tell
 * you which. Sniffing appears to work — it is unambiguous for any day past the 12th — and
 * then silently transposes the first twelve days of every month. A settlement dated four
 * days early is a reconciliation break nobody can explain.
 */
export function parseDate(raw: string, format: DateFormat): Decoded<string> {
  const text = raw.trim();
  if (text === "") return fail("empty");

  let year: number, month: number, day: number;

  if (format === "ISO") {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
    if (!match) return fail(`not an ISO date: "${text}"`);
    [, year, month, day] = match.map(Number) as [number, number, number, number];
  } else {
    const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (!match) return fail(`not a dd/mm/yyyy date: "${text}"`);
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }

  // Round-trip through UTC so 31/02 fails instead of rolling into March.
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return fail(`not a real calendar date: "${text}"`);
  }

  return ok(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}

export function parseEnum<T extends string>(
  raw: string,
  allowed: readonly T[],
): Decoded<T> {
  const text = raw.trim().toLowerCase();
  const match = allowed.find((value) => value.toLowerCase() === text);
  return match ? ok(match) : fail(`expected one of ${allowed.join(" | ")}, got "${raw.trim()}"`);
}

export function parseText(raw: string, { required = true } = {}): Decoded<string> {
  const text = raw.trim();
  if (text === "" && required) return fail("empty");
  return ok(text);
}

export function parseInteger(raw: string): Decoded<number> {
  const text = raw.trim().replace(/,/g, "");
  if (text === "") return fail("empty");
  if (!/^-?\d+$/.test(text)) return fail(`not a whole number: "${raw.trim()}"`);
  return ok(Number(text));
}
