import type { Paise } from "./money";

/**
 * The canonical records for the reconciliation loop (`docs/recon-plan.md` R0.1).
 *
 * Four sources have to be reconciled against each other:
 *
 * ```
 *   payments ─┐
 *   refunds   ├─► settlement ──► bank credit ──► ledger
 *   chargebacks┘
 * ```
 *
 * Two rules hold across all of them:
 *
 * 1. **Every amount is `Paise`** — an integer. See `money.ts`.
 * 2. **A source never carries the answer.** The payments export has no `settlementId`,
 *    because in the real world the two files come from different places and rediscovering
 *    that link is the *work*. The mapping lives in `truth.json`, which the matcher never
 *    sees and only the scorer reads.
 */

export type PaymentMethod = "card" | "upi" | "netbanking" | "wallet";

export type Payment = {
  id: string;
  orderId: string;
  /** ISO date, `YYYY-MM-DD`. */
  capturedAt: string;
  method: PaymentMethod;
  /** What the customer paid. */
  gross: Paise;
  /** Gateway fee. */
  fee: Paise;
  /** GST on the fee. */
  tax: Paise;
  /** `gross - fee - tax`. Stored, so a wrong arithmetic assumption is visible. */
  net: Paise;
  status: "captured" | "refunded" | "disputed";
};

export type Refund = {
  id: string;
  paymentId: string;
  createdAt: string;
  amount: Paise;
  speed: "normal" | "instant";
};

export type Chargeback = {
  id: string;
  paymentId: string;
  raisedAt: string;
  amount: Paise;
  status: "open" | "lost" | "won";
};

/**
 * A settlement batch as the gateway reports it.
 *
 * The report is a *claim*, not a fact: several planted failure classes work by making the
 * report internally inconsistent (a refund netted out of `net` but missing from the
 * `refunds` column), which is what "the report does not explain the credit" looks like in
 * real life.
 */
export type Settlement = {
  id: string;
  /** ISO date the gateway says it paid out. */
  settledAt: string;
  /** The bank reference the credit should carry. */
  utr: string;
  gross: Paise;
  fees: Paise;
  tax: Paise;
  refunds: Paise;
  chargebacks: Paise;
  tds: Paise;
  /** What should land in the bank. */
  net: Paise;
  paymentCount: number;
};

export type BankCredit = {
  id: string;
  /** ISO date the money moved. */
  valueDate: string;
  /** Free text, as a bank writes it — commas and all. */
  description: string;
  /** The UTR, when the bank bothered to include one. */
  reference: string;
  /** Signed: positive is a credit, negative a debit (chargebacks, fees). */
  amount: Paise;
};

export type LedgerAccount =
  | "Bank"
  | "Razorpay Clearing"
  | "Payment Gateway Fees"
  | "GST Input"
  | "Refunds"
  | "Chargebacks"
  | "TDS Receivable";

export type LedgerEntry = {
  id: string;
  /** The journal this line belongs to — lines sharing one must balance. */
  journalId: string;
  postedAt: string;
  account: LedgerAccount;
  debit: Paise;
  credit: Paise;
  memo: string;
};

/* ── The answer key ───────────────────────────────────────────────────────*/

/**
 * The planted failure modes (`docs/recon-plan.md` R0.3).
 *
 * Eight of these are **hard but resolvable** — a good matcher should still produce the
 * link, using a tolerance or a structural pass. Five are **genuine exceptions** that no
 * amount of cleverness should "resolve", and a matcher that claims to have matched them is
 * producing a false match, which is the worst failure in the system because it is silent.
 */
export type FailureClass =
  | "MISSING_UTR"
  | "TYPO_UTR"
  | "SPLIT_SETTLEMENT"
  | "COMBINED_CREDIT"
  | "FEE_NOT_BOOKED"
  | "TDS_WITHHELD"
  | "TIMING_T_PLUS_N"
  | "REFUND_NETTED"
  | "CHARGEBACK_DEDUCTION"
  | "DUPLICATE_CREDIT"
  | "FOREIGN_CREDIT"
  | "ROUNDING_PAISE"
  | "MISSING_LEDGER_ENTRY";

/** Which lane a link belongs to. Match rate is reported per lane, never as one blur. */
export type Lane =
  | "PAYMENT_TO_SETTLEMENT"
  | "SETTLEMENT_TO_BANK"
  | "SETTLEMENT_TO_LEDGER";

export type TruthLink = {
  lane: Lane;
  /** Ids on the left source (payments, settlements). */
  left: string[];
  /** Ids on the right source (settlements, bank credits, ledger journals). */
  right: string[];
  /**
   * `MATCH` — a correct matcher produces this link.
   * `EXCEPTION` — a correct matcher raises `class` and matches nothing.
   */
  expect: "MATCH" | "EXCEPTION";
  /** The planted difficulty, if this link was tampered with. */
  class: FailureClass | null;
  note?: string;
};

export type Truth = {
  seed: number;
  generatedAt: string;
  counts: Record<string, number>;
  planted: Record<FailureClass, number>;
  /**
   * Rows written deliberately unparseable, so R1's rejection path is exercised on every
   * run rather than on a hand-made fixture. Ingestion must reject exactly these.
   */
  malformed: { file: string; line: string; reason: string }[];
  links: TruthLink[];
};

export type Batch = {
  payments: Payment[];
  refunds: Refund[];
  chargebacks: Chargeback[];
  settlements: Settlement[];
  bank: BankCredit[];
  ledger: LedgerEntry[];
  truth: Truth;
};

/** Human copy for the exception list and the eval report. */
export const FAILURE_LABEL: Record<FailureClass, string> = {
  MISSING_UTR: "Bank line carries no reference",
  TYPO_UTR: "Reference transposed",
  SPLIT_SETTLEMENT: "One settlement, two credits",
  COMBINED_CREDIT: "One credit, two settlements",
  FEE_NOT_BOOKED: "Fee and GST never posted",
  TDS_WITHHELD: "Credit short by TDS",
  TIMING_T_PLUS_N: "Credit landed late",
  REFUND_NETTED: "Refund missing from the report",
  CHARGEBACK_DEDUCTION: "Standalone chargeback debit",
  DUPLICATE_CREDIT: "Same credit ingested twice",
  FOREIGN_CREDIT: "Not a gateway credit",
  ROUNDING_PAISE: "Off by paise",
  MISSING_LEDGER_ENTRY: "Settled but never posted",
};
