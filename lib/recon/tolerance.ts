import type { Paise } from "./money";

/**
 * Every number the matcher is allowed to be lenient about (`docs/recon-plan.md` R2.2).
 *
 * The task says it plainly: *tolerances are named config, not magic numbers scattered in
 * the code*. There is a specific failure this prevents. A `Math.abs(a - b) <= 3` buried in
 * a matching function is invisible — it never appears in a review, it never appears in the
 * scoreboard, and when the false-match rate moves nobody can say which allowance moved it.
 * Collected here, every act of leniency is one line you can read, change, and blame.
 *
 * The other reason is that these are **business facts, not tuning knobs**. T+2 settlement
 * and 1% TDS under s.194-O are things a controller could tell you; they belong in one
 * place where a controller could check them.
 */

export type Tolerances = {
  /** How the gateway's payout calendar works. */
  settlement: {
    /** Payments captured on day T are paid out on T+n. */
    delayDays: number;
    /** Banks do not move money at the weekend; the payout slides forward. */
    skipWeekends: boolean;
  };

  bank: {
    /**
     * Days between `settled_at` and the value date on the credit for the credit to be
     * considered on time. One, not zero — a split payout can land its second leg the
     * next morning.
     */
    onTimeDays: number;
    /**
     * The outer limit. Beyond this, a reference and an amount agreeing is not enough:
     * an unlimited window makes "same amount, some other week" look like a match, which
     * is exactly how a silent false match gets made.
     */
    lateDays: number;
    /** How far apart the legs of one split payout may sit. */
    splitSpanDays: number;
  };

  amount: {
    /**
     * Paise of slack on an amount whose reference already matched. Gateways and banks
     * round in different directions on fee components; this absorbs that and nothing
     * more. Five paise, not five rupees — the moment this is large enough to swallow a
     * real discrepancy it has stopped being a tolerance.
     */
    roundingPaise: Paise;
    /** TDS under s.194-O, as a percentage of gross. Withheld, so the credit is short. */
    tdsPercentOfGross: number;
  };

  reference: {
    /**
     * Edit distance allowed on a bank reference. One adjacent transposition is distance
     * 1 under Damerau–Levenshtein, which is the typo actually planted and the typo humans
     * actually make. Two is the ceiling; three starts matching unrelated UTRs.
     */
    maxEditDistance: number;
    /** Below this length a fuzzy comparison is meaningless, so it is not attempted. */
    minLength: number;
  };

  /**
   * The escalation packet handed to a judgement tier (§A1: *at most 5 candidates with their
   * evidence*).
   *
   * `slackPaise` is deliberately tiny. It is not a matching tolerance — nothing is matched
   * on it — it only decides which candidates are worth a human's or a model's attention. Set
   * it wide and every unexplained credit arrives with five irrelevant settlements attached,
   * which is how a review queue becomes noise.
   */
  escalation: {
    slackPaise: Paise;
    maxCandidates: number;
  };

  search: {
    /**
     * Nodes the bounded subset search may visit before it gives up. It reports that it
     * gave up (R2.3) rather than returning "no match", because those two answers mean
     * completely different things to whoever reads the exception list.
     */
    maxNodes: number;
    /** Largest set a structural pass will assemble. Two legs and a stray, no more. */
    maxSubsetSize: number;
    /**
     * A partition is only attempted when one side of it is this small. Choosing 40
     * payments out of 83 is 10^23 combinations: no node cap makes that finishable, so
     * the honest move is to decline before starting and say why.
     */
    maxCombinatorialSize: number;
  };

  /**
   * Confidence at or above which a match is applied without a human (§1.3).
   *
   * The asymmetry that sets this: a wrong auto-match silently corrupts the books, while
   * an unnecessary review costs a controller a minute. So the threshold sits above every
   * rule that guesses and below every rule that verifies arithmetic.
   */
  autoApply: number;
};

export const TOLERANCES: Tolerances = {
  settlement: { delayDays: 2, skipWeekends: true },
  bank: { onTimeDays: 1, lateDays: 7, splitSpanDays: 3 },
  amount: { roundingPaise: 5, tdsPercentOfGross: 1 },
  reference: { maxEditDistance: 2, minLength: 8 },
  escalation: { slackPaise: 10, maxCandidates: 5 },
  search: { maxNodes: 200_000, maxSubsetSize: 3, maxCombinatorialSize: 4 },
  autoApply: 0.85,
};

/**
 * What each rule is worth.
 *
 * Kept beside the tolerances for the same reason: a confidence is a claim about how often
 * a rule is right, and a claim like that should be somewhere you can argue with it.
 *
 * The ordering is the whole design. Anything that ties to the paisa against a reference
 * the bank itself wrote sits at the top. Anything that infers a link from an amount and a
 * date sits just above the auto-apply line, because two settlements of the same value in
 * the same week are not unusual. Anything that had to *choose* between candidates sits
 * below it, and becomes a proposal.
 */
export const CONFIDENCE = {
  /** Reference, amount and date all agree. There is nothing left to be wrong about. */
  REFERENCE_EXACT: 1,
  /** Reference and amount agree; the money simply arrived later than promised. */
  LATE_CREDIT: 0.98,
  /** Reference agrees, amount is off by paise. */
  ROUNDING: 0.96,
  /** Reference agrees, amount is short by exactly the statutory withholding. */
  TDS_WITHHELD: 0.96,
  /** Reference is one transposition away, amount and date agree exactly. */
  REFERENCE_NEAR_MISS: 0.94,
  /** No reference at all: a unique amount and date carry the whole match. */
  AMOUNT_AND_DATE: 0.9,
  /** Legs sharing one reference that sum to the settlement to the paisa. */
  SPLIT_CREDIT: 0.9,
  /** One credit, two settlements, arithmetic exact, one of them referenced. */
  COMBINED_CREDIT: 0.88,
  /**
   * A structural sum that ties exactly but has no reference anchoring it to either side.
   *
   * Below the auto-apply line on purpose. Two credits adding up to a settlement inside a
   * three-day window is suggestive; with nothing naming the settlement it is still a
   * coincidence you cannot rule out, and this is the shape a silent false match takes.
   */
  STRUCTURAL_UNANCHORED: 0.7,
  /** The only settlement paid out on a date whose payments tie out in full. */
  DATE_POOL_UNIQUE: 0.97,
  /** One set of exactly the claimed size, totalling the claimed gross, and no other. */
  PAYMENT_PARTITION: 0.9,
  /** The last unassigned set on a date that has already tied out in full. */
  BY_ELIMINATION: 0.9,
  /** Count and value tie for the whole date, but not per settlement. */
  DATE_POOL_TIED: 0.6,
  /** More than one candidate fits and nothing in the data separates them. */
  AMBIGUOUS: 0.4,
  /**
   * The reference was buried in the narration rather than in the reference field.
   *
   * Worth the same as a transposed reference: once the UTR is found the identification is
   * exact, and only the amount needed a rounding allowance.
   */
  NARRATION_REFERENCE: 0.94,
  /**
   * Ranked candidates, no decision. Sits far below the auto-apply line because the whole
   * point is that a rule wide enough to settle these is a rule wide enough to be dangerous.
   */
  ESCALATED: 0.3,
} as const;

/* ── The payout calendar ──────────────────────────────────────────────────*/

const DAY = 86_400_000;

const isWeekend = (time: number) => {
  const day = new Date(time).getUTCDay();
  return day === 0 || day === 6;
};

export const dayOf = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`);
export const isoOf = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Whole days from `from` to `to`. Signed: negative means `to` came first. */
export const daysBetween = (from: string, to: string) => Math.round((dayOf(to) - dayOf(from)) / DAY);

export const addDays = (isoDate: string, days: number) => isoOf(dayOf(isoDate) + days * DAY);

/**
 * When a payment captured on `capturedAt` should be paid out.
 *
 * This is the one piece of the gateway's behaviour the matcher is allowed to assume,
 * because it is published and a controller can confirm it. It is also the entire basis of
 * the payments-to-settlements lane: with no settlement id on the payments export, the
 * payout date is the only thing connecting the two files.
 */
export function expectedSettlementDate(
  capturedAt: string,
  config: Tolerances = TOLERANCES,
): string {
  let time = dayOf(capturedAt) + config.settlement.delayDays * DAY;
  if (config.settlement.skipWeekends) while (isWeekend(time)) time += DAY;
  return isoOf(time);
}
