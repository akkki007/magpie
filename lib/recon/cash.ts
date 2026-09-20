import type { MatchResult } from "./match";
import type { Paise } from "./money";
import { expectedSettlementDate, TOLERANCES, type Tolerances } from "./tolerance";
import type { BankCredit, Payment, Settlement } from "./types";

/**
 * Cash position, derived from the reconciliation (`docs/recon-plan.md` R6).
 *
 * This is the last step of the loop and the reason the loop was worth closing: a forward cash
 * position built on **money the bank has actually confirmed**, rather than on what the
 * gateway's report claims. The three lines are deliberately separate, because a controller
 * needs to know which is which:
 *
 * - **Reconciled** — a bank credit matched to a settlement. This money exists.
 * - **In flight** — captured payments whose payout has not landed yet, projected onto their
 *   T+n credit date. This money is expected.
 * - **At risk** — the value the matcher could not resolve. This money is *claimed*, and
 *   until someone works the queue nobody can say which of the other two lines it belongs in.
 *
 * §6's honesty rule, made structural: an unqualified forecast that silently folds the third
 * line into the second is exactly the forecast a finance team stops trusting the first time
 * it is wrong. The band is the point.
 *
 * Months, not days, because `Period` in the modelling engine is month-shaped
 * (`docs/modelling-plan.md` §2). Bending it here to get a daily cash curve would be shaping
 * the engine around one screen; a finer grain is an engine change, deliberately taken later.
 */

export type CashSeries = {
  /** `YYYY-MM`, ascending, covering everything the batch touches. */
  periodKeys: string[];
  /** Bank credits matched to a settlement, by value-date month. */
  reconciled: Paise[];
  /** Expected payouts not yet confirmed by the bank, by expected credit month. */
  inFlight: Paise[];
  /** Unresolved value, by month. Recomputed client-side as the queue is worked. */
  atRisk: Paise[];
  /**
   * Which month each queue entry lands in, aligned index-for-index with the report's queue.
   *
   * Aligned *by construction* — the caller passes the same sorted array it writes to the
   * report — rather than by re-deriving the sort in two places and hoping they agree.
   */
  entryPeriods: number[];
};

const monthOf = (isoDate: string) => isoDate.slice(0, 7);

/** Every month from the earliest date in the batch to the latest, with no gaps. */
function monthsBetween(earliest: string, latest: string): string[] {
  const keys: string[] = [];
  let [year, month] = earliest.split("-").map(Number);
  const [lastYear, lastMonth] = latest.split("-").map(Number);
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

export function buildCashSeries(
  batch: { payments: Payment[]; settlements: Settlement[]; bank: BankCredit[] },
  results: MatchResult[],
  /** The queue exactly as the report will list it, so indices line up. */
  queue: { left: string[]; right: string[]; lane: string; amount: Paise }[],
  config: Tolerances = TOLERANCES,
): CashSeries {
  const creditById = new Map(batch.bank.map((credit) => [credit.id, credit]));
  const settlementById = new Map(batch.settlements.map((s) => [s.id, s]));

  const dates = [
    ...batch.bank.map((credit) => credit.valueDate),
    ...batch.settlements.map((settlement) => settlement.settledAt),
    ...batch.payments.map((payment) => expectedSettlementDate(payment.capturedAt, config)),
  ].sort();

  const periodKeys = monthsBetween(monthOf(dates[0]), monthOf(dates[dates.length - 1]));
  const indexOf = new Map(periodKeys.map((key, index) => [key, index]));
  const blank = () => new Array<Paise>(periodKeys.length).fill(0);

  const reconciled = blank();
  const inFlight = blank();
  const atRisk = blank();

  /* ── Reconciled: bank credits the matcher tied to a settlement ──────────*/

  /**
   * Driven off `AUTO_MATCHED` results rather than off the bank statement, so this line can
   * never disagree with the scoreboard. A credit the matcher declined to explain does not
   * count as cash, however clearly it sits in the statement — which is the entire difference
   * between a reconciled position and a bank balance.
   */
  const confirmedSettlements = new Set<string>();
  for (const result of results) {
    if (result.lane !== "SETTLEMENT_TO_BANK" || result.outcome !== "AUTO_MATCHED") continue;
    for (const id of result.left) confirmedSettlements.add(id);
    for (const creditId of result.right) {
      const credit = creditById.get(creditId);
      if (!credit) continue;
      const at = indexOf.get(monthOf(credit.valueDate));
      if (at !== undefined) reconciled[at] += credit.amount;
    }
  }

  /* ── In flight: payouts the bank has not confirmed ──────────────────────*/

  /**
   * Two shapes, and both are genuinely in flight:
   *
   * 1. A settlement the gateway reported that no confirmed credit explains. The gateway says
   *    it paid; the bank has not agreed yet.
   * 2. Payments captured so late in the window that their T+n payout falls past the end of
   *    the bank statement — money that has not been settled at all yet. This is the forward
   *    half of the forecast, and it is the part a bank balance cannot tell you.
   */
  const lastStatementDate = batch.bank.reduce(
    (latest, credit) => (credit.valueDate > latest ? credit.valueDate : latest),
    "",
  );

  for (const settlement of batch.settlements) {
    if (confirmedSettlements.has(settlement.id)) continue;
    const at = indexOf.get(monthOf(settlement.settledAt));
    if (at !== undefined) inFlight[at] += settlement.net;
  }

  const settledPayments = new Set<string>();
  for (const result of results) {
    if (result.lane !== "PAYMENT_TO_SETTLEMENT") continue;
    for (const id of result.left) settledPayments.add(id);
  }
  for (const payment of batch.payments) {
    if (settledPayments.has(payment.id)) continue;
    const payoutDate = expectedSettlementDate(payment.capturedAt, config);
    if (payoutDate <= lastStatementDate) continue;
    const at = indexOf.get(monthOf(payoutDate));
    if (at !== undefined) inFlight[at] += payment.net;
  }

  /* ── At risk: everything the queue still holds ──────────────────────────*/

  const entryPeriods = queue.map((entry) => {
    const date =
      entry.right.map((id) => creditById.get(id)?.valueDate).find(Boolean) ??
      entry.left.map((id) => settlementById.get(id)?.settledAt).find(Boolean) ??
      entry.right.map((id) => settlementById.get(id)?.settledAt).find(Boolean);

    const at = date ? indexOf.get(monthOf(date)) : undefined;
    if (at === undefined) return 0;
    atRisk[at] += Math.abs(entry.amount);
    return at;
  });

  return { periodKeys, reconciled, inFlight, atRisk, entryPeriods };
}
