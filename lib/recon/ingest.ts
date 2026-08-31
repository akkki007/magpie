import {
  parseCsv,
  parseDate,
  parseEnum,
  parseInteger,
  parsePaise,
  parseText,
  type CsvRow,
  type DateFormat,
  type Decoded,
} from "./parse";
import type {
  BankCredit,
  Chargeback,
  LedgerAccount,
  LedgerEntry,
  Payment,
  PaymentMethod,
  ReconRow,
  Refund,
  Settlement,
} from "./types";

/**
 * Ingestion (`docs/recon-plan.md` R1.2, R1.3).
 *
 * The whole module is a pure function of file contents — no filesystem, no network — for
 * the same reason the calculation engine is (`docs/modelling-plan.md` §3): the thing you
 * most want to test is the thing least convenient to test through a directory.
 *
 * **The rule that shapes everything here: a row that cannot be parsed becomes a record,
 * not a warning.** Silently dropping four malformed bank lines removes them from the
 * denominator, and the match rate that comes out the far end is then a confident number
 * about a batch that was never fully read. Every rejection carries its file, its line, the
 * raw text and a reason a human can act on.
 */

export type RejectReason =
  | "SHORT_ROW"
  | "BAD_FIELD"
  | "DUPLICATE_ID"
  | "NO_AMOUNT";

export type Rejection = {
  file: string;
  line: number;
  reason: RejectReason;
  detail: string;
  raw: string;
};

export type FileStat = {
  file: string;
  rowsIn: number;
  recordsOut: number;
  rejected: number;
  /** Columns the schema needs and the file does not have. */
  missingColumns: string[];
};

export type IngestedBatch = {
  payments: Payment[];
  refunds: Refund[];
  chargebacks: Chargeback[];
  settlements: Settlement[];
  recon: ReconRow[];
  bank: BankCredit[];
  ledger: LedgerEntry[];
  rejections: Rejection[];
  files: FileStat[];
};

export type SourceName =
  | "payments.csv"
  | "refunds.csv"
  | "chargebacks.csv"
  | "settlements.csv"
  | "recon.csv"
  | "bank.csv"
  | "ledger.csv";

/* ── Reading one row ──────────────────────────────────────────────────────*/

type Reader = {
  text: (column: string, options?: { required?: boolean }) => string;
  paise: (column: string, options?: { required?: boolean }) => number;
  date: (column: string, format: DateFormat) => string;
  integer: (column: string) => number;
  choice: <T extends string>(column: string, allowed: readonly T[]) => T;
  /** Raw cell, for a field the decoder handles itself. */
  cell: (column: string) => string;
};

function reader(header: string[], row: CsvRow, errors: string[]): Reader {
  const index = new Map(header.map((name, i) => [name.trim().toLowerCase(), i]));
  const cell = (column: string) => row.cells[index.get(column.toLowerCase()) ?? -1] ?? "";

  const take = <T,>(column: string, decoded: Decoded<T>, fallback: T): T => {
    if (decoded.ok) return decoded.value;
    errors.push(`${column}: ${decoded.error}`);
    return fallback;
  };

  return {
    cell,
    text: (column, options) => take(column, parseText(cell(column), options), ""),
    paise: (column, options) => {
      const raw = cell(column);
      if (raw.trim() === "" && options?.required === false) return 0;
      return take(column, parsePaise(raw), 0);
    },
    date: (column, format) => take(column, parseDate(cell(column), format), ""),
    integer: (column) => take(column, parseInteger(cell(column)), 0),
    choice: <T extends string>(column: string, allowed: readonly T[]) =>
      take(column, parseEnum(cell(column), allowed), allowed[0]),
  };
}

function ingestFile<T extends { id: string }>(
  file: string,
  text: string | undefined,
  required: readonly string[],
  decode: (read: Reader, errors: string[]) => T,
): { records: T[]; rejections: Rejection[]; stat: FileStat } {
  const rejections: Rejection[] = [];

  if (text === undefined) {
    return {
      records: [],
      rejections,
      stat: { file, rowsIn: 0, recordsOut: 0, rejected: 0, missingColumns: [...required] },
    };
  }

  const { header, rows } = parseCsv(text);
  const present = new Set(header.map((name) => name.toLowerCase()));
  const missingColumns = required.filter((name) => !present.has(name.toLowerCase()));

  // A missing column is a failure of the *file*, not of its rows. Reporting 5,000
  // identical row errors buries the one fact that matters: the export changed shape.
  if (missingColumns.length > 0) {
    return {
      records: [],
      rejections,
      stat: { file, rowsIn: rows.length, recordsOut: 0, rejected: rows.length, missingColumns },
    };
  }

  const records: T[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (row.cells.every((value) => value.trim() === "")) continue;

    if (row.cells.length < header.length) {
      rejections.push({
        file,
        line: row.line,
        reason: "SHORT_ROW",
        detail: `expected ${header.length} columns, found ${row.cells.length}`,
        raw: row.raw,
      });
      continue;
    }

    const errors: string[] = [];
    const record = decode(reader(header, row, errors), errors);

    if (errors.length > 0) {
      rejections.push({
        file,
        line: row.line,
        reason: errors[0].startsWith("!") ? "NO_AMOUNT" : "BAD_FIELD",
        detail: errors.join("; ").replace(/^!/, ""),
        raw: row.raw,
      });
      continue;
    }

    if (seen.has(record.id)) {
      // Note this is an id collision, not the DUPLICATE_CREDIT failure class — that one
      // is a *different* id carrying identical content, and it has to survive ingestion
      // so the matcher can be the thing that catches it.
      rejections.push({
        file,
        line: row.line,
        reason: "DUPLICATE_ID",
        detail: `${record.id} already seen in this file`,
        raw: row.raw,
      });
      continue;
    }

    seen.add(record.id);
    records.push(record);
  }

  return {
    records,
    rejections,
    stat: {
      file,
      rowsIn: rows.length,
      recordsOut: records.length,
      rejected: rejections.length,
      missingColumns: [],
    },
  };
}

/* ── The six sources ──────────────────────────────────────────────────────*/

const METHODS = ["card", "upi", "netbanking", "wallet"] as const;
const ACCOUNTS = [
  "Bank",
  "Razorpay Clearing",
  "Payment Gateway Fees",
  "GST Input",
  "Refunds",
  "Chargebacks",
  "TDS Receivable",
] as const;

export function ingestSources(sources: Partial<Record<SourceName, string>>): IngestedBatch {
  const payments = ingestFile<Payment>(
    "payments.csv",
    sources["payments.csv"],
    ["payment_id", "order_id", "captured_at", "method", "amount", "fee", "tax", "net", "status"],
    (read) => ({
      id: read.text("payment_id"),
      orderId: read.text("order_id"),
      capturedAt: read.date("captured_at", "ISO"),
      method: read.choice<PaymentMethod>("method", METHODS),
      gross: read.paise("amount"),
      fee: read.paise("fee", { required: false }),
      tax: read.paise("tax", { required: false }),
      net: read.paise("net"),
      status: read.choice("status", ["captured", "refunded", "disputed"] as const),
    }),
  );

  const refunds = ingestFile<Refund>(
    "refunds.csv",
    sources["refunds.csv"],
    ["refund_id", "payment_id", "created_at", "amount", "speed"],
    (read) => ({
      id: read.text("refund_id"),
      paymentId: read.text("payment_id"),
      createdAt: read.date("created_at", "ISO"),
      amount: read.paise("amount"),
      speed: read.choice("speed", ["normal", "instant"] as const),
    }),
  );

  const chargebacks = ingestFile<Chargeback>(
    "chargebacks.csv",
    sources["chargebacks.csv"],
    ["dispute_id", "payment_id", "raised_at", "amount", "status"],
    (read) => ({
      id: read.text("dispute_id"),
      paymentId: read.text("payment_id"),
      raisedAt: read.date("raised_at", "ISO"),
      amount: read.paise("amount"),
      status: read.choice("status", ["open", "lost", "won"] as const),
    }),
  );

  const settlements = ingestFile<Settlement>(
    "settlements.csv",
    sources["settlements.csv"],
    ["settlement_id", "settled_at", "utr", "gross", "fees", "tax", "net", "payment_count"],
    (read) => ({
      id: read.text("settlement_id"),
      settledAt: read.date("settled_at", "ISO"),
      // The UTR is allowed to be blank here: MISSING_UTR is a case for the matcher, not a
      // reason to throw the settlement away.
      utr: read.text("utr", { required: false }),
      gross: read.paise("gross"),
      fees: read.paise("fees", { required: false }),
      tax: read.paise("tax", { required: false }),
      refunds: read.paise("refunds", { required: false }),
      chargebacks: read.paise("chargebacks", { required: false }),
      tds: read.paise("tds", { required: false }),
      net: read.paise("net"),
      paymentCount: read.integer("payment_count"),
    }),
  );

  /**
   * The settlement recon report. A gateway export, so it is clean — ISO dates, plain
   * decimals — and its only awkwardness is that `amount` is signed: a payment adds to the
   * payout and a refund or dispute comes out of it.
   */
  const recon = ingestFile<ReconRow>(
    "recon.csv",
    sources["recon.csv"],
    ["entry_id", "settlement_id", "settled_at", "type", "entity_id", "amount"],
    (read) => ({
      id: read.text("entry_id"),
      settlementId: read.text("settlement_id"),
      utr: read.text("settlement_utr", { required: false }),
      settledAt: read.date("settled_at", "ISO"),
      type: read.choice("type", ["payment", "refund", "chargeback"] as const),
      entityId: read.text("entity_id"),
      amount: read.paise("amount"),
      fee: read.paise("fee", { required: false }),
      tax: read.paise("tax", { required: false }),
    }),
  );

  /**
   * The bank statement, which is the only source that arrives in a bank's own format:
   * a BOM, `dd/mm/yyyy`, Indian digit grouping, commas inside the narration, and debits
   * and credits in separate columns. Normalising it to one signed integer is the whole
   * job of this decoder.
   */
  const bank = ingestFile<BankCredit>(
    "bank.csv",
    sources["bank.csv"],
    ["txn id", "value date", "narration", "ref no"],
    (read, errors) => {
      const debitRaw = read.cell("Debit").trim();
      const creditRaw = read.cell("Credit").trim();
      if (debitRaw === "" && creditRaw === "") errors.push("!Debit/Credit: both empty");

      return {
        id: read.text("Txn Id"),
        valueDate: read.date("Value Date", "DMY"),
        description: read.text("Narration", { required: false }),
        reference: read.text("Ref No", { required: false }),
        amount:
          (creditRaw === "" ? 0 : read.paise("Credit")) -
          (debitRaw === "" ? 0 : read.paise("Debit")),
      };
    },
  );

  const ledger = ingestFile<LedgerEntry>(
    "ledger.csv",
    sources["ledger.csv"],
    ["line_id", "journal_id", "posted_at", "account", "debit", "credit"],
    (read) => ({
      id: read.text("line_id"),
      journalId: read.text("journal_id"),
      postedAt: read.date("posted_at", "ISO"),
      account: read.choice<LedgerAccount>("account", ACCOUNTS),
      debit: read.paise("debit", { required: false }),
      credit: read.paise("credit", { required: false }),
      memo: read.text("memo", { required: false }),
    }),
  );

  const parts = [payments, refunds, chargebacks, settlements, recon, bank, ledger];

  return {
    payments: payments.records,
    refunds: refunds.records,
    chargebacks: chargebacks.records,
    settlements: settlements.records,
    recon: recon.records,
    bank: bank.records,
    ledger: ledger.records,
    rejections: parts.flatMap((part) => part.rejections),
    files: parts.map((part) => part.stat),
  };
}
