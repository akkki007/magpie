import { pct, toIndianDecimal, type Paise } from "./money";
import {
  daysBetween,
  editDistance,
  findSubsets,
  groupJournals,
  groupPaymentsByPayoutDate,
  indexBank,
  indexSettlements,
  normaliseReference,
  partitionIsTractable,
  windowAround,
} from "./candidates";
import {
  CONFIDENCE,
  TOLERANCES,
  addDays,
  expectedSettlementDate,
  type Tolerances,
} from "./tolerance";
import type {
  BankCredit,
  Chargeback,
  FailureClass,
  Lane,
  LedgerEntry,
  Payment,
  ReconRow,
  Settlement,
} from "./types";

/**
 * The deterministic matcher (`docs/recon-plan.md` R2).
 *
 * **No model is involved anywhere in this file, and that is the design rather than a
 * shortcut** (§1.1). A rule that matches on reference plus amount plus a date window is
 * either right or wrong in a way you can debug; a model asked to compare five thousand
 * amounts is right almost always, which is the worst possible property for a system whose
 * job is deciding whether two numbers are equal.
 *
 * Three ideas hold the file together.
 *
 * **Tiers escalate, and each tier only sees what the last could not resolve** (§A1). By
 * the time the structural pass runs, the easy 70% is gone, so it can afford a search it
 * could never afford over the whole batch. This is also what leaves the eventual LLM tier
 * (R4) a few dozen ranked candidates instead of a dataset.
 *
 * **A match is never a boolean** (§1.2). Every result carries the rule that produced it,
 * what it compared, what it compared against, and the ids it considered and rejected —
 * because the exception list has to be reviewable in two seconds, and "unmatched" is not
 * reviewable.
 *
 * **Three outcomes, never two** (§1.3). `AUTO_MATCHED`, `PROPOSED`, `EXCEPTION`.
 * Abstention is a success state: a wrong match silently corrupts the books, an exception
 * costs a controller a minute. So every rule that had to *choose* between candidates
 * proposes rather than applies, and precision on the auto lane is the number to protect.
 */

export type Outcome = "AUTO_MATCHED" | "PROPOSED" | "EXCEPTION";

/**
 * Which pass produced a result.
 *
 * `T3` is missing on purpose — that is the LLM adjudication tier, and it does not exist
 * yet. Everything unresolved here lands in `T4`, which is exactly the queue R4 will read.
 */
export type Tier = "T0" | "T1" | "T2" | "T4";

export type MatchResult = {
  lane: Lane;
  tier: Tier;
  /** The named rule, so a scoreboard can break accuracy down by rule and not just tier. */
  rule: string;
  outcome: Outcome;
  confidence: number;
  /** Left-side ids: payments, or settlements. Empty when nothing on the left explains it. */
  left: string[];
  /** Right-side ids: settlements, bank credits, or ledger journals. */
  right: string[];
  /** Everything the rule looked at, including what it rejected (§1.2). */
  inputs: string[];
  /** One line each, written for a controller rather than for a log (§A5). */
  evidence: string[];
  /**
   * The failure class, where a deterministic rule can name it.
   *
   * Deliberately not always set. A narration that says `CHARGEBACK DEBIT` names its own
   * class and pretending otherwise would be false modesty; a settlement that simply has
   * no credit anywhere near it does not, and inventing a label for it is R4's job.
   */
  class: FailureClass | null;
  /** Cash at stake, so the review queue can sort by impact (R5.1). */
  amount: Paise;
  /** True when a bounded search gave up rather than finished (R2.3). */
  capHit?: boolean;
};

export type MatchRun = {
  results: MatchResult[];
  stats: {
    byTier: Record<Tier, number>;
    byOutcome: Record<Outcome, number>;
    byLane: Record<Lane, Record<Outcome, number>>;
    byRule: { rule: string; tier: Tier; outcome: Outcome; count: number }[];
    capHits: number;
    searchNodes: number;
    /** Match units considered: settlements, journals and bank lines needing an answer. */
    units: number;
    elapsedMs: number;
  };
};

export type MatchInput = {
  payments: Payment[];
  settlements: Settlement[];
  recon: ReconRow[];
  bank: BankCredit[];
  ledger: LedgerEntry[];
  chargebacks: Chargeback[];
};

const money = (paise: Paise) => `₹${toIndianDecimal(paise)}`;

/** Evidence reads better with a signed delta than with two amounts and a subtraction. */
const delta = (actual: Paise, expected: Paise) =>
  `${actual >= expected ? "over" : "short"} by ${money(Math.abs(actual - expected))}`;

/**
 * Long candidate lists are evidence, not payload — record the shape, cap the ids.
 *
 * **This applies to `inputs` and to nothing else.** Capping `left` or `right` was a bug
 * here first: a payment batch of forty truncated to twenty-five still looks like a match,
 * still prints a confident evidence line, and is simply the wrong link — the failure mode
 * §6 calls the worst in the system, arriving through the reporting code rather than through
 * a rule. `inputs` may be summarised because it is the audit trail; the link may not,
 * because it is the answer.
 */
const INPUT_CAP = 25;
const cappedInputs = (ids: string[]) => (ids.length <= INPUT_CAP ? ids : ids.slice(0, INPUT_CAP));

export function runMatch(input: MatchInput, config: Tolerances = TOLERANCES): MatchRun {
  const started = performance.now();
  const results: MatchResult[] = [];
  const counters = { nodes: 0 };

  const emit = (result: MatchResult) => {
    results.push(result);
    return result;
  };

  /**
   * One place decides `AUTO_MATCHED` vs `PROPOSED`, from the confidence and the threshold
   * in the config. Letting each rule declare its own outcome is how an auto-apply lane
   * quietly acquires a rule nobody agreed to.
   */
  const applied = (confidence: number): Outcome =>
    confidence >= config.autoApply ? "AUTO_MATCHED" : "PROPOSED";

  matchBankLane(input, config, emit, applied, counters);
  matchLedgerLane(input, config, emit, applied);
  matchPaymentLane(input, config, emit, applied, counters);

  return { results, stats: summarise(results, counters, input, performance.now() - started) };
}

/* ── Lane 1 of 3: settlements against the bank statement ──────────────────*/

/**
 * The lane the whole design is shaped around, because it is where the money actually
 * moved and where twelve of the thirteen planted failure classes live.
 *
 * Passes run in order of how much they assume:
 *
 * ```
 *   T0  the statement says which settlement it is, and the amount agrees
 *   T1  the statement says which settlement it is, and the amount is explainably off
 *   T1  the statement almost says which settlement it is (a transposed reference)
 *   T1  the statement says nothing, and a unique amount and date have to carry it
 *   T1  a debit no payout claimed, which is a deduction rather than a settlement
 *   T2  one settlement paid as several credits, or one credit covering several
 *   T4  nothing explains it, so say so with a reason
 * ```
 */
function matchBankLane(
  input: MatchInput,
  config: Tolerances,
  emit: (result: MatchResult) => MatchResult,
  applied: (confidence: number) => Outcome,
  counters: { nodes: number },
) {
  const lane: Lane = "SETTLEMENT_TO_BANK";
  const settlementIndex = indexSettlements(input.settlements);
  const bankIndex = indexBank(input.bank);

  const openSettlements = new Set(input.settlements.map((s) => s.id));
  const openCredits = new Set(input.bank.map((c) => c.id));

  const settle = (settlements: Settlement[], credits: BankCredit[]) => {
    for (const s of settlements) openSettlements.delete(s.id);
    for (const c of credits) openCredits.delete(c.id);
  };

  const isOpenCredit = (credit: BankCredit) => openCredits.has(credit.id);
  const isOpenSettlement = (settlement: Settlement) => openSettlements.has(settlement.id);

  /**
   * Does the settlement report explain its own bottom line?
   *
   * `gross - fees - tax - refunds - chargebacks - tds` should equal `net`. When it does
   * not, the *report* is wrong rather than the bank: money came out of the payout that the
   * report never itemised. `REFUND_NETTED` is exactly this shape, and it is worth catching
   * even on a settlement that matched perfectly at T0 — the credit ties, and the report
   * still cannot account for it.
   */
  const reportGap = (s: Settlement) =>
    s.gross - s.fees - s.tax - s.refunds - s.chargebacks - s.tds - s.net;

  const identityEvidence = (s: Settlement): { evidence: string[]; failure: FailureClass | null } => {
    const gap = reportGap(s);
    if (gap === 0) return { evidence: [], failure: null };
    return {
      evidence: [
        `the report does not explain its own net: gross less fees, tax and itemised deductions leaves ${money(gap)} unaccounted for — a refund or dispute was netted without being itemised`,
      ],
      failure: "REFUND_NETTED",
    };
  };

  /* ── T0, step 0: the same credit twice ──────────────────────────────────*/

  /**
   * Run before anything else, because a duplicated statement row is an ambiguity generator:
   * leave both in and every amount-based rule downstream sees two candidates and abstains,
   * turning one exception into several proposals.
   *
   * Which of the pair is "the duplicate" is genuinely undecidable — they are identical in
   * every field the statement carries — so this keeps the lower id by convention and says
   * so. A scorer has to treat the pair as unordered.
   */
  const duplicateGroups = new Map<string, BankCredit[]>();
  for (const credit of input.bank) {
    const key = [
      normaliseReference(credit.reference),
      credit.amount,
      credit.valueDate,
      credit.description.trim().toUpperCase(),
    ].join("|");
    const bucket = duplicateGroups.get(key);
    if (bucket) bucket.push(credit);
    else duplicateGroups.set(key, [credit]);
  }

  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => (a.id < b.id ? -1 : 1));
    const [kept, ...copies] = ordered;
    for (const copy of copies) {
      settle([], [copy]);
      emit({
        lane,
        tier: "T0",
        rule: "T0_DUPLICATE_STATEMENT_ROW",
        outcome: "EXCEPTION",
        confidence: CONFIDENCE.REFERENCE_EXACT,
        left: [],
        right: [copy.id],
        inputs: ordered.map((c) => c.id),
        evidence: [
          `identical to ${kept.id} in reference, amount, value date and narration — the statement was ingested twice`,
          `${money(copy.amount)} on ${copy.valueDate}`,
          `the pair is indistinguishable; kept the lower id (${kept.id}) by convention`,
        ],
        class: "DUPLICATE_CREDIT",
        amount: copy.amount,
      });
    }
  }

  /* ── T0, step 2: reference and amount both exact ────────────────────────*/

  /**
   * Candidates come from the reference index, so this is a hash lookup per settlement
   * rather than a scan — the difference between a matcher that reports throughput and one
   * that reports an excuse.
   */
  const referencedCredits = (settlement: Settlement) => {
    const key = normaliseReference(settlement.utr);
    if (key === "") return [];
    return (bankIndex.byReference.get(key) ?? []).filter(isOpenCredit);
  };

  /** Deterministic order, so two runs over the same batch produce the same answer. */
  const stable = (credits: BankCredit[]) =>
    [...credits].sort((a, b) =>
      a.valueDate === b.valueDate ? (a.id < b.id ? -1 : 1) : a.valueDate < b.valueDate ? -1 : 1,
    );

  type ReferenceRule = {
    rule: string;
    tier: Tier;
    confidence: number;
    class: FailureClass | null;
    /** Days after `settled_at` the credit may land. */
    maxLateDays: number;
    /** The amount this rule expects on the credit, or null if it decides for itself. */
    expected: (s: Settlement) => Paise | null;
    slack?: Paise;
    why: (s: Settlement, credit: BankCredit) => string;
  };

  const referenceRules: ReferenceRule[] = [
    {
      rule: "T0_REFERENCE_AND_AMOUNT",
      tier: "T0",
      confidence: CONFIDENCE.REFERENCE_EXACT,
      class: null,
      maxLateDays: config.bank.onTimeDays,
      expected: (s) => s.net,
      why: (s) => `amount is the settlement net ${money(s.net)} to the paisa`,
    },
    {
      rule: "T1_LATE_CREDIT",
      tier: "T1",
      confidence: CONFIDENCE.LATE_CREDIT,
      class: "TIMING_T_PLUS_N",
      maxLateDays: config.bank.lateDays,
      expected: (s) => s.net,
      why: (s, credit) =>
        `amount ties exactly at ${money(s.net)}; the credit landed ${daysBetween(s.settledAt, credit.valueDate)} days after the settlement date`,
    },
    {
      rule: "T1_TDS_WITHHELD",
      tier: "T1",
      confidence: CONFIDENCE.TDS_WITHHELD,
      class: "TDS_WITHHELD",
      maxLateDays: config.bank.lateDays,
      expected: (s) => s.net - pct(s.gross, config.amount.tdsPercentOfGross),
      why: (s) =>
        `credit is short by ${money(pct(s.gross, config.amount.tdsPercentOfGross))}, which is exactly ${config.amount.tdsPercentOfGross}% of gross ${money(s.gross)} — TDS withheld and not shown in the report`,
    },
    {
      rule: "T1_ROUNDING",
      tier: "T1",
      confidence: CONFIDENCE.ROUNDING,
      class: "ROUNDING_PAISE",
      maxLateDays: config.bank.lateDays,
      expected: (s) => s.net,
      slack: config.amount.roundingPaise,
      why: (s, credit) =>
        `credit is ${delta(credit.amount, s.net)} against net ${money(s.net)} — inside the ${config.amount.roundingPaise} paise rounding tolerance`,
    },
  ];

  for (const rule of referenceRules) {
    for (const settlement of input.settlements) {
      if (!isOpenSettlement(settlement)) continue;
      const candidates = stable(referencedCredits(settlement));
      if (candidates.length === 0) continue;

      const target = rule.expected(settlement);
      if (target === null) continue;
      const slack = rule.slack ?? 0;

      const fits = candidates.filter((credit) => {
        const gap = Math.abs(credit.amount - target);
        if (gap > slack) return false;
        // A rule with slack should not steal an exact match from the tier above it.
        if (slack > 0 && gap === 0) return false;
        const late = daysBetween(settlement.settledAt, credit.valueDate);
        return late >= 0 && late <= rule.maxLateDays;
      });

      if (fits.length !== 1) continue;
      const credit = fits[0];
      const identity = identityEvidence(settlement);

      settle([settlement], [credit]);
      emit({
        lane,
        tier: rule.tier,
        rule: rule.rule,
        outcome: applied(rule.confidence),
        confidence: rule.confidence,
        left: [settlement.id],
        right: [credit.id],
        inputs: [settlement.id, ...candidates.map((c) => c.id)],
        evidence: [
          `bank reference ${credit.reference} is the settlement UTR`,
          rule.why(settlement, credit),
          `value date ${credit.valueDate} against settled_at ${settlement.settledAt}`,
          ...identity.evidence,
        ],
        class: rule.class ?? identity.failure,
        amount: settlement.net,
      });
    }
  }

  /* ── T1, step 3: a reference one typo away ──────────────────────────────*/

  /**
   * Driven from the credit side, and gated on the amount *first*.
   *
   * That order is the safety property. Comparing every reference against every UTR is both
   * quadratic and reckless — fuzzy matching over 30,000 references will eventually find
   * two that differ by a character and mean entirely different payouts. Requiring the
   * amount to tie exactly before any character is compared reduces the fuzzy comparison to
   * a handful of candidates and makes a near-miss reference corroboration rather than
   * evidence.
   */
  for (const credit of input.bank) {
    // Not `> 0`: a payout whose refunds exceeded its takings is a negative settlement paid
    // out as a bank debit, and it can carry a transposed reference like any other. Filtering
    // on sign here hid exactly that case behind the debit pass below.
    if (!isOpenCredit(credit) || credit.amount === 0) continue;
    const reference = normaliseReference(credit.reference);
    if (reference.length < config.reference.minLength) continue;

    const window = { from: addDays(credit.valueDate, -config.bank.lateDays), to: credit.valueDate };
    const candidates = settlementIndex
      .withAmount(credit.amount, window)
      .filter(isOpenSettlement);

    const near = candidates
      .map((settlement) => ({
        settlement,
        distance: editDistance(
          reference,
          normaliseReference(settlement.utr),
          config.reference.maxEditDistance,
        ),
      }))
      .filter((row): row is { settlement: Settlement; distance: number } => row.distance !== null);

    if (near.length === 0) continue;
    near.sort((a, b) => a.distance - b.distance);

    const best = near[0];
    const ambiguous = near.length > 1 && near[1].distance === best.distance;
    const confidence = ambiguous ? CONFIDENCE.AMBIGUOUS : CONFIDENCE.REFERENCE_NEAR_MISS;
    const identity = identityEvidence(best.settlement);

    if (!ambiguous) settle([best.settlement], [credit]);
    emit({
      lane,
      tier: "T1",
      rule: "T1_REFERENCE_NEAR_MISS",
      outcome: ambiguous ? "PROPOSED" : applied(confidence),
      confidence,
      left: [best.settlement.id],
      right: [credit.id],
      inputs: [credit.id, ...candidates.map((s) => s.id)],
      evidence: [
        `bank reference ${credit.reference} is ${best.distance} edit from settlement UTR ${best.settlement.utr}`,
        `amount ${money(credit.amount)} ties exactly to net, and value date ${credit.valueDate} is within ${config.bank.lateDays} days of ${best.settlement.settledAt}`,
        ambiguous
          ? `${near.length} settlements are equally close on the reference — nothing here separates them`
          : `no other settlement in the window is within ${config.reference.maxEditDistance} edits`,
        ...identity.evidence,
      ],
      class: ambiguous ? null : "TYPO_UTR",
      amount: credit.amount,
    });
  }

  /* ── T1, step 4: no reference at all ────────────────────────────────────*/

  /**
   * The amount and the date are the entire case here, so uniqueness *is* the evidence.
   * Two open settlements of the same value inside the window means the honest answer is a
   * proposal — this is the rule most likely to produce a silent false match, and §6 names
   * that as the worst failure in the system.
   */
  for (const credit of input.bank) {
    if (!isOpenCredit(credit) || credit.amount === 0) continue;
    if (normaliseReference(credit.reference) !== "") continue;

    const window = { from: addDays(credit.valueDate, -config.bank.lateDays), to: credit.valueDate };
    const candidates = settlementIndex
      .withAmount(credit.amount, window)
      .filter(isOpenSettlement);
    if (candidates.length === 0) continue;

    const ordered = [...candidates].sort((a, b) =>
      daysBetween(a.settledAt, credit.valueDate) - daysBetween(b.settledAt, credit.valueDate),
    );
    const unique = ordered.length === 1;
    const confidence = unique ? CONFIDENCE.AMOUNT_AND_DATE : CONFIDENCE.AMBIGUOUS;
    const best = ordered[0];
    const identity = identityEvidence(best);

    if (unique) settle([best], [credit]);
    emit({
      lane,
      tier: "T1",
      rule: "T1_AMOUNT_AND_DATE",
      outcome: unique ? applied(confidence) : "PROPOSED",
      confidence,
      left: [best.id],
      right: [credit.id],
      inputs: [credit.id, ...ordered.map((s) => s.id)],
      evidence: [
        `the bank line carries no reference: "${credit.description}"`,
        `${money(credit.amount)} on ${credit.valueDate} ties to net ${money(best.net)} settled ${best.settledAt}`,
        unique
          ? `it is the only unmatched settlement of this value within ${config.bank.lateDays} days`
          : `${ordered.length} unmatched settlements of this value sit within ${config.bank.lateDays} days — a reference is needed to choose`,
        ...identity.evidence,
      ],
      class: unique ? "MISSING_UTR" : null,
      amount: credit.amount,
    });
  }

  /* ── T1, step 6: debits that no payout explains ─────────────────────────*/

  /**
   * Deliberately *after* the reference passes, and this order was a bug once.
   *
   * The obvious rule is "a settlement is money coming in, so a debit cannot be one". It is
   * wrong. When a day's refunds exceed its payout the gateway settles a **negative** amount
   * and the bank row is a debit — carrying the correct UTR, tying to the paisa. Claiming
   * every debit up front turned two perfectly matchable settlements into two exceptions
   * *and* two orphan bank rows, which is the exact shape of a matcher that looks accurate
   * because it never had to admit what it broke.
   *
   * So the sign of the amount is not evidence of anything on its own. What is left after
   * the reference passes have had their turn genuinely belongs to nothing.
   *
   * This bit twice, and the second time the fix was in the wrong place. Dropping the
   * `amount > 0` guard from the near-miss pass achieved nothing while this block still ran
   * *before* it — the debit was already claimed by the time the pass that could explain it
   * got a turn. So the rule is not just "sign is not evidence" but **"a catch-all runs
   * last"**: this now sits after every pass that could legitimately claim a debit, and the
   * only pass after it assumes positive amounts and says so.
   */

  const chargebackById = new Map(input.chargebacks.map((c) => [c.id.toUpperCase(), c]));

  for (const credit of input.bank) {
    if (!isOpenCredit(credit) || credit.amount >= 0) continue;
    const narration = credit.description.toUpperCase();
    const referenced = [...narration.matchAll(/DISP_[A-Z0-9]+/g)].map((m) => m[0]);
    const dispute = referenced.map((id) => chargebackById.get(id)).find(Boolean);
    const isChargeback = narration.includes("CHARGEBACK") || dispute !== undefined;

    settle([], [credit]);
    emit({
      lane,
      tier: "T0",
      rule: "T0_STANDALONE_DEBIT",
      outcome: "EXCEPTION",
      confidence: CONFIDENCE.REFERENCE_EXACT,
      left: [],
      right: [credit.id],
      inputs: dispute ? [credit.id, dispute.id] : [credit.id],
      evidence: [
        `${money(-credit.amount)} debited on ${credit.valueDate}, and no unmatched settlement was paid out as a debit of that value`,
        dispute
          ? `narration names dispute ${dispute.id}, raised ${dispute.raisedAt} for ${money(dispute.amount)}${dispute.amount === -credit.amount ? " — the amount ties exactly" : ` — ${delta(-credit.amount, dispute.amount)}`}`
          : `narration: ${credit.description}`,
      ],
      class: isChargeback ? "CHARGEBACK_DEDUCTION" : null,
      amount: credit.amount,
    });
  }

  /* ── T2, step 5: one settlement, several credits ────────────────────────*/

  for (const settlement of input.settlements) {
    if (!isOpenSettlement(settlement)) continue;

    const anchors = referencedCredits(settlement);
    // Unlike the passes above, the structural search is positive-only by construction:
    // subset-sum over mixed signs is a different (and unbounded) problem, and a negative
    // payout split across two debits is not a thing gateways do.
    const window = windowAround(settlement.settledAt, 0, config.bank.splitSpanDays);
    const pool = bankIndex
      .inWindow(window.from, window.to)
      .filter((credit) => isOpenCredit(credit) && credit.amount > 0 && !anchors.includes(credit));

    const search = findSubsets([...anchors, ...pool], (credit) => credit.amount, settlement.net, {
      maxSize: Math.max(config.search.maxSubsetSize, anchors.length),
      maxNodes: config.search.maxNodes,
      required: anchors,
    });
    counters.nodes += search.nodes;

    const viable = search.subsets.filter((subset) => subset.length > 1);
    if (viable.length === 0 && !search.capHit) continue;

    if (viable.length === 0) {
      // The cap was hit before anything tied. Worth saying, not worth acting on.
      continue;
    }

    const anchored = anchors.length > 0;
    const unique = viable.length === 1;
    const confidence = !unique
      ? CONFIDENCE.AMBIGUOUS
      : anchored
        ? CONFIDENCE.SPLIT_CREDIT
        : CONFIDENCE.STRUCTURAL_UNANCHORED;
    const subset = stable(viable[0]);
    const span = daysBetween(subset[0].valueDate, subset[subset.length - 1].valueDate);
    const identity = identityEvidence(settlement);

    if (unique && confidence >= config.autoApply) settle([settlement], subset);
    emit({
      lane,
      tier: "T2",
      rule: anchored ? "T2_SPLIT_CREDIT" : "T2_SPLIT_CREDIT_UNREFERENCED",
      outcome: unique ? applied(confidence) : "PROPOSED",
      confidence,
      left: [settlement.id],
      right: subset.map((c) => c.id),
      inputs: cappedInputs([settlement.id, ...anchors.map((c) => c.id), ...pool.map((c) => c.id)]),
      evidence: [
        `${subset.length} credits sum to ${money(settlement.net)} exactly: ${subset.map((c) => `${c.id} ${money(c.amount)}`).join(" + ")}`,
        anchored
          ? `all of them carry the settlement UTR ${settlement.utr}`
          : `none of them carries a usable reference, so the arithmetic is the only evidence`,
        `paid across ${span + 1} day(s) from ${subset[0].valueDate}, within the ${config.bank.splitSpanDays}-day split window`,
        ...(unique
          ? []
          : [`${viable.length} different combinations tie to the same total — a human has to choose`]),
        ...(search.capHit ? [`the search stopped at its ${config.search.maxNodes.toLocaleString("en-IN")}-node cap, so other combinations may exist`] : []),
        ...identity.evidence,
      ],
      class: unique && anchored ? "SPLIT_SETTLEMENT" : null,
      amount: settlement.net,
      capHit: search.capHit || undefined,
    });
  }

  /* ── T2, step 6: one credit, several settlements ────────────────────────*/

  /**
   * A consolidated payout. The anchor matters more here than the date window does: the
   * surviving reference names one of the settlements, and once that one is fixed the rest
   * of the credit is a single exact lookup for the remainder. That is a hash probe, not a
   * search — and it stays precise across dates, which a window would not.
   */
  for (const credit of input.bank) {
    if (!isOpenCredit(credit) || credit.amount <= 0) continue;

    const reference = normaliseReference(credit.reference);
    const anchors = (reference === ""
      ? []
      : (settlementIndex.byReference.get(reference) ?? [])
    ).filter(isOpenSettlement);

    let subset: Settlement[] | null = null;
    let ambiguity = 0;
    let capHit = false;
    let considered: string[] = [];

    if (anchors.length === 1) {
      const anchor = anchors[0];
      const remainder = credit.amount - anchor.net;
      if (remainder > 0) {
        const exact = settlementIndex.withAmount(remainder).filter(isOpenSettlement);
        considered = [anchor.id, ...exact.map((s) => s.id)];
        if (exact.length === 1) subset = [anchor, exact[0]];
        else if (exact.length > 1) {
          ambiguity = exact.length;
          subset = [anchor, exact[0]];
        } else {
          const pool = input.settlements.filter(
            (s) => isOpenSettlement(s) && s !== anchor && s.net > 0 && s.net <= remainder,
          );
          const search = findSubsets(pool, (s) => s.net, remainder, {
            maxSize: config.search.maxSubsetSize - 1,
            maxNodes: config.search.maxNodes,
          });
          counters.nodes += search.nodes;
          capHit = search.capHit;
          considered = [anchor.id, ...pool.map((s) => s.id)];
          if (search.subsets.length === 1) subset = [anchor, ...search.subsets[0]];
          else if (search.subsets.length > 1) {
            ambiguity = search.subsets.length;
            subset = [anchor, ...search.subsets[0]];
          }
        }
      }
    } else if (anchors.length === 0) {
      const window = windowAround(credit.valueDate, config.bank.lateDays, 0);
      const pool = settlementIndex
        .inWindow(window.from, window.to)
        .filter((s) => isOpenSettlement(s) && s.net > 0 && s.net < credit.amount);
      const search = findSubsets(pool, (s) => s.net, credit.amount, {
        maxSize: config.search.maxSubsetSize,
        maxNodes: config.search.maxNodes,
      });
      counters.nodes += search.nodes;
      capHit = search.capHit;
      considered = pool.map((s) => s.id);
      const viable = search.subsets.filter((candidate) => candidate.length > 1);
      if (viable.length === 1) subset = viable[0];
      else if (viable.length > 1) {
        ambiguity = viable.length;
        subset = viable[0];
      }
    }

    if (!subset || subset.length < 2) continue;

    const anchored = anchors.length === 1;
    const confidence = ambiguity
      ? CONFIDENCE.AMBIGUOUS
      : anchored
        ? CONFIDENCE.COMBINED_CREDIT
        : CONFIDENCE.STRUCTURAL_UNANCHORED;
    const ordered = [...subset].sort((a, b) => (a.id < b.id ? -1 : 1));

    if (!ambiguity && confidence >= config.autoApply) settle(ordered, [credit]);
    emit({
      lane,
      tier: "T2",
      rule: anchored ? "T2_COMBINED_CREDIT" : "T2_COMBINED_CREDIT_UNREFERENCED",
      outcome: ambiguity ? "PROPOSED" : applied(confidence),
      confidence,
      left: ordered.map((s) => s.id),
      right: [credit.id],
      inputs: cappedInputs([credit.id, ...considered]),
      evidence: [
        `one credit of ${money(credit.amount)} on ${credit.valueDate} equals ${ordered.length} settlement nets exactly: ${ordered.map((s) => `${s.id} ${money(s.net)}`).join(" + ")}`,
        anchored
          ? `reference ${credit.reference} names ${anchors[0].id}; the remainder ${money(credit.amount - anchors[0].net)} is a single unmatched settlement`
          : `no reference survived on the credit, so the arithmetic is the only evidence`,
        `narration: ${credit.description}`,
        ...(ambiguity ? [`${ambiguity} different settlement combinations tie to this credit`] : []),
        ...(capHit ? [`the search stopped at its node cap; other combinations may exist`] : []),
      ],
      class: !ambiguity && anchored ? "COMBINED_CREDIT" : null,
      amount: credit.amount,
      capHit: capHit || undefined,
    });
  }

  /* ── T4: everything left, with a reason ─────────────────────────────────*/

  for (const credit of input.bank) {
    if (!isOpenCredit(credit)) continue;
    const narration = credit.description.toUpperCase();
    const isGateway = narration.includes("RAZORPAY");
    emit({
      lane,
      tier: "T4",
      rule: "T4_UNEXPLAINED_CREDIT",
      outcome: "EXCEPTION",
      confidence: 0,
      left: [],
      right: [credit.id],
      inputs: [credit.id],
      evidence: [
        `${money(credit.amount)} credited ${credit.valueDate} with no settlement to explain it`,
        isGateway
          ? `narration names the gateway but no unmatched settlement ties on reference, amount or a combination: ${credit.description}`
          : `narration is a different counterparty entirely: ${credit.description}`,
        `reference ${credit.reference === "" ? "(none)" : credit.reference}`,
      ],
      class: isGateway ? null : "FOREIGN_CREDIT",
      amount: credit.amount,
    });
  }

  for (const settlement of input.settlements) {
    if (!isOpenSettlement(settlement)) continue;
    const window = windowAround(settlement.settledAt, 0, config.bank.lateDays);
    const near = bankIndex
      .nearAmount(settlement.net, config.amount.roundingPaise, window)
      .filter(isOpenCredit);
    emit({
      lane,
      tier: "T4",
      rule: "T4_SETTLEMENT_NOT_BANKED",
      outcome: "EXCEPTION",
      confidence: 0,
      left: [settlement.id],
      right: [],
      inputs: [settlement.id, ...near.map((c) => c.id)],
      evidence: [
        `${money(settlement.net)} settled ${settlement.settledAt} under UTR ${settlement.utr || "(none)"} never arrived`,
        near.length === 0
          ? `no unmatched credit of that value within ${config.bank.lateDays} days`
          : `${near.length} unmatched credit(s) are close on value but explain nothing: ${near.map((c) => `${c.id} ${money(c.amount)}`).join(", ")}`,
      ],
      class: null,
      amount: settlement.net,
    });
  }
}

/* ── Lane 2 of 3: settlements against the books ───────────────────────────*/

/**
 * The easy lane, because the books carry a reference the bank never does: the memo names
 * the settlement. So T0 is a lookup, and the interesting work is not finding the journal
 * but **checking it**.
 *
 * The check is deliberately narrow: the journal must balance, its bank debit must be the
 * settlement net, and its clearing credit must be the gross. It does *not* require the fee
 * and tax lines to agree with the report's columns, and that is the difference between
 * catching `FEE_NOT_BOOKED` and falsely rejecting `REFUND_NETTED` — where the books are
 * right and the settlement report is the thing that lies.
 */
function matchLedgerLane(
  input: MatchInput,
  _config: Tolerances,
  emit: (result: MatchResult) => MatchResult,
  applied: (confidence: number) => Outcome,
) {
  const lane: Lane = "SETTLEMENT_TO_LEDGER";
  const journals = groupJournals(input.ledger);

  /** settlementId → journalIds, read out of the memos. */
  const bySettlement = new Map<string, string[]>();
  const claimed = new Set<string>();

  for (const [journalId, lines] of journals) {
    const referenced = new Set<string>();
    for (const line of lines) {
      for (const match of line.memo.matchAll(/setl_[a-z0-9]+/g)) referenced.add(match[0]);
    }
    for (const settlementId of referenced) {
      const bucket = bySettlement.get(settlementId);
      if (bucket) bucket.push(journalId);
      else bySettlement.set(settlementId, [journalId]);
      claimed.add(journalId);
    }
  }

  const totals = (lines: LedgerEntry[]) => {
    const perAccount = new Map<string, Paise>();
    let debits = 0;
    let credits = 0;
    for (const line of lines) {
      debits += line.debit;
      credits += line.credit;
      perAccount.set(line.account, (perAccount.get(line.account) ?? 0) + line.debit - line.credit);
    }
    return { debits, credits, perAccount };
  };

  for (const settlement of input.settlements) {
    const journalIds = bySettlement.get(settlement.id) ?? [];

    if (journalIds.length === 0) {
      emit({
        lane,
        tier: "T4",
        rule: "T4_NOT_POSTED",
        outcome: "EXCEPTION",
        confidence: 0,
        left: [settlement.id],
        right: [],
        inputs: [settlement.id],
        evidence: [
          `settled ${settlement.settledAt} for ${money(settlement.net)} with no journal referencing it`,
          `nothing in the books moves ${money(settlement.gross)} out of Razorpay Clearing, so the clearing account is overstated by that much`,
        ],
        class: "MISSING_LEDGER_ENTRY",
        amount: settlement.net,
      });
      continue;
    }

    if (journalIds.length > 1) {
      emit({
        lane,
        tier: "T1",
        rule: "T1_MULTIPLE_JOURNALS",
        outcome: "PROPOSED",
        confidence: CONFIDENCE.AMBIGUOUS,
        left: [settlement.id],
        right: journalIds,
        inputs: [settlement.id, ...journalIds],
        evidence: [`${journalIds.length} journals reference this settlement: ${journalIds.join(", ")}`],
        class: null,
        amount: settlement.net,
      });
      continue;
    }

    const journalId = journalIds[0];
    const lines = journals.get(journalId)!;
    const { debits, credits, perAccount } = totals(lines);
    const bank = perAccount.get("Bank") ?? 0;
    const clearing = -(perAccount.get("Razorpay Clearing") ?? 0);
    const balanced = debits === credits;
    const expensed = (perAccount.get("Payment Gateway Fees") ?? 0) + (perAccount.get("GST Input") ?? 0);

    if (balanced && bank === settlement.net && clearing === settlement.gross) {
      const evidence = [
        `journal ${journalId} names the settlement in its memo`,
        `Bank debited ${money(bank)} — the settlement net — and Razorpay Clearing credited ${money(clearing)} — the gross`,
        `the journal balances: ${money(debits)} debits against ${money(credits)} credits`,
      ];
      if (expensed !== settlement.fees + settlement.tax) {
        evidence.push(
          `the books expense ${money(expensed)} of fees and GST where the report shows ${money(settlement.fees + settlement.tax)} — the link holds, the report does not`,
        );
      }
      emit({
        lane,
        tier: "T0",
        rule: "T0_JOURNAL_REFERENCE",
        outcome: applied(CONFIDENCE.REFERENCE_EXACT),
        confidence: CONFIDENCE.REFERENCE_EXACT,
        left: [settlement.id],
        right: [journalId],
        inputs: [settlement.id, journalId],
        evidence,
        class: null,
        amount: settlement.net,
      });
      continue;
    }

    const feesMissing =
      settlement.fees + settlement.tax > 0 &&
      expensed === 0 &&
      bank === settlement.net + settlement.fees + settlement.tax;

    emit({
      lane,
      tier: "T4",
      rule: feesMissing ? "T4_FEE_NOT_EXPENSED" : "T4_JOURNAL_DOES_NOT_TIE",
      outcome: "EXCEPTION",
      confidence: 0,
      left: [settlement.id],
      right: [journalId],
      inputs: [settlement.id, journalId],
      evidence: feesMissing
        ? [
            `journal ${journalId} debits Bank ${money(bank)}, which is the gross payout, not the net ${money(settlement.net)}`,
            `no Payment Gateway Fees or GST Input line exists, so ${money(settlement.fees + settlement.tax)} of cost was never expensed`,
            `the journal balances, which is why nothing else catches this: profit is overstated by ${money(settlement.fees)} and input credit of ${money(settlement.tax)} is unclaimed`,
          ]
        : [
            `journal ${journalId} does not tie to the settlement`,
            `Bank debited ${money(bank)} against net ${money(settlement.net)}${bank === settlement.net ? "" : ` — ${delta(bank, settlement.net)}`}`,
            `Razorpay Clearing credited ${money(clearing)} against gross ${money(settlement.gross)}`,
            balanced ? `the journal itself balances` : `the journal does not balance: ${money(debits)} debits against ${money(credits)} credits`,
          ],
      class: feesMissing ? "FEE_NOT_BOOKED" : null,
      amount: settlement.net,
    });
  }

  for (const [journalId, lines] of journals) {
    if (claimed.has(journalId)) continue;
    const { debits } = totals(lines);
    emit({
      lane,
      tier: "T4",
      rule: "T4_ORPHAN_JOURNAL",
      outcome: "EXCEPTION",
      confidence: 0,
      left: [],
      right: [journalId],
      inputs: [journalId],
      evidence: [
        `journal ${journalId} posts ${money(debits)} on ${lines[0].postedAt} but references no settlement`,
        `memo: ${lines[0].memo}`,
      ],
      class: null,
      amount: debits,
    });
  }
}

/* ── Lane 3 of 3: payments against settlements ────────────────────────────*/

/**
 * The lane that used to be a guess.
 *
 * Before the settlement recon report existed, the only thing joining payments to payouts
 * was the payout calendar — which proves a *date* ties out and can never say which of eight
 * same-day payouts a payment belongs to. The matcher recovered 12 of 147 links and honestly
 * reported the rest as undecidable. That was correct behaviour and a permanently capped
 * number, so R0 grew the file Razorpay actually publishes.
 *
 * Now the lane has a reference like the other two, and the calendar has a better job:
 *
 * ```
 *   T0  the recon report itemises the payout, and count, gross, fee and tax all tie
 *   T2  the report omits this payout, but every other payout that day is itemised,
 *       so its payments are the exact remainder — recovered by elimination
 *   T4  the report omits it and something else on the same day too, so nothing
 *       can tell them apart
 * ```
 *
 * The calendar is still computed on every match, as an *independent* second derivation. Two
 * different routes agreeing is much stronger evidence than either alone, and it costs a
 * hash lookup.
 */
function matchPaymentLane(
  input: MatchInput,
  config: Tolerances,
  emit: (result: MatchResult) => MatchResult,
  applied: (confidence: number) => Outcome,
  counters: { nodes: number },
) {
  const lane: Lane = "PAYMENT_TO_SETTLEMENT";
  const paymentById = new Map(input.payments.map((payment) => [payment.id, payment]));
  const pools = groupPaymentsByPayoutDate(input.payments, config);

  const rowsBySettlement = new Map<string, ReconRow[]>();
  for (const row of input.recon) {
    const bucket = rowsBySettlement.get(row.settlementId);
    if (bucket) bucket.push(row);
    else rowsBySettlement.set(row.settlementId, [row]);
  }

  /** Every payment the report attributes to *some* payout, for the elimination pass. */
  const itemised = new Set<string>();
  for (const row of input.recon) if (row.type === "payment") itemised.add(row.entityId);

  /**
   * How many of a payout's payments the payout calendar independently agrees with.
   *
   * Corroboration, never a filter. If T+2 and the report disagree, the report wins — it is
   * the authoritative document — but the disagreement is worth a line of evidence, because
   * a report that contradicts the calendar is a report worth a second look.
   */
  const calendarAgreement = (settlement: Settlement, batch: Payment[]) =>
    batch.filter(
      (payment) => expectedSettlementDate(payment.capturedAt, config) === settlement.settledAt,
    ).length;

  const unreported: Settlement[] = [];

  /* ── T0: the recon report itemises the payout ───────────────────────────*/

  for (const settlement of input.settlements) {
    const rows = rowsBySettlement.get(settlement.id) ?? [];
    if (rows.length === 0) {
      unreported.push(settlement);
      continue;
    }

    const paymentRows = rows.filter((row) => row.type === "payment");
    const batch: Payment[] = [];
    const unknown: ReconRow[] = [];
    for (const row of paymentRows) {
      const payment = paymentById.get(row.entityId);
      if (payment) batch.push(payment);
      else unknown.push(row);
    }

    const gross = batch.reduce((total, payment) => total + payment.gross, 0);
    const fees = batch.reduce((total, payment) => total + payment.fee, 0);
    const tax = batch.reduce((total, payment) => total + payment.tax, 0);
    const deductions = rows
      .filter((row) => row.type !== "payment")
      .reduce((total, row) => total - row.amount, 0);

    const countTies = batch.length === settlement.paymentCount;
    const grossTies = gross === settlement.gross;
    const feesTie = fees === settlement.fees;
    const taxTies = tax === settlement.tax;
    const utrDisagrees = rows.filter(
      (row) => normaliseReference(row.utr) !== normaliseReference(settlement.utr),
    ).length;
    const agreed = calendarAgreement(settlement, batch);

    if (countTies && grossTies && feesTie && taxTies && unknown.length === 0) {
      emit({
        lane,
        tier: "T0",
        rule: "T0_RECON_REPORT",
        outcome: applied(CONFIDENCE.REFERENCE_EXACT),
        confidence: CONFIDENCE.REFERENCE_EXACT,
        left: batch.map((payment) => payment.id),
        right: [settlement.id],
        inputs: cappedInputs([settlement.id, ...rows.map((row) => row.id)]),
        evidence: [
          `the recon report itemises ${paymentRows.length} payments against this payout under UTR ${settlement.utr}`,
          `count, gross ${money(gross)}, fees ${money(fees)} and GST ${money(tax)} all tie to the settlement report exactly`,
          agreed === batch.length
            ? `the T+${config.settlement.delayDays} payout calendar independently puts all ${batch.length} of them on ${settlement.settledAt}`
            : `the payout calendar puts only ${agreed} of ${batch.length} on ${settlement.settledAt} — the report is authoritative, but that disagreement is worth a look`,
          ...(deductions > 0
            ? [`${money(deductions)} of refunds and disputes are itemised against the same payout`]
            : []),
          ...(utrDisagrees > 0 ? [`${utrDisagrees} row(s) carry a different UTR than the settlement`] : []),
        ],
        class: null,
        amount: settlement.gross,
      });
      continue;
    }

    /**
     * The report mentions the payout and does not add up. Note the shape of the failure
     * precisely, because `MISATTRIBUTED_PAYMENT` is the dangerous one: the count still
     * ties, so a matcher that checks cardinality and not value accepts it silently.
     */
    const misattributed = countTies && unknown.length === 0 && !grossTies;
    emit({
      lane,
      tier: "T4",
      rule: misattributed ? "T4_RECON_VALUE_DOES_NOT_TIE" : "T4_RECON_DOES_NOT_TIE",
      outcome: "EXCEPTION",
      confidence: 0,
      left: [],
      right: [settlement.id],
      inputs: cappedInputs([settlement.id, ...rows.map((row) => row.id)]),
      evidence: misattributed
        ? [
            `the recon report itemises exactly the ${settlement.paymentCount} payments this payout claims, and they total ${money(gross)} against a reported gross of ${money(settlement.gross)} — ${delta(gross, settlement.gross)}`,
            `the count is right and the value is not, so a payment has been itemised against the wrong payout`,
            `every payment listed exists and settles on ${settlement.settledAt}, so nothing here is missing — only misfiled`,
          ]
        : [
            `the recon report does not reconcile to the settlement report`,
            `${batch.length} payments itemised against ${settlement.paymentCount} claimed, totalling ${money(gross)} against ${money(settlement.gross)}`,
            ...(unknown.length > 0
              ? [`${unknown.length} row(s) name a payment that is not in the payments export: ${unknown.slice(0, 3).map((row) => row.entityId).join(", ")}`]
              : []),
            ...(feesTie ? [] : [`fees ${money(fees)} against ${money(settlement.fees)}`]),
            ...(taxTies ? [] : [`GST ${money(tax)} against ${money(settlement.tax)}`]),
          ],
      class: misattributed ? "MISATTRIBUTED_PAYMENT" : null,
      amount: settlement.gross,
    });
  }

  /* ── The payouts the report never mentions ──────────────────────────────*/

  if (unreported.length === 0) return;

  const unreportedByDate = new Map<string, Settlement[]>();
  for (const settlement of unreported) {
    const bucket = unreportedByDate.get(settlement.settledAt);
    if (bucket) bucket.push(settlement);
    else unreportedByDate.set(settlement.settledAt, [settlement]);
  }

  for (const date of [...unreportedByDate.keys()].sort()) {
    const missing = [...unreportedByDate.get(date)!].sort(
      (a, b) => a.paymentCount - b.paymentCount || (a.id < b.id ? -1 : 1),
    );

    /* The remainder: payments due for payout that day that the report never placed. */
    let remaining = (pools.get(date) ?? []).filter((payment) => !itemised.has(payment.id));
    const claimedCount = missing.reduce((total, s) => total + s.paymentCount, 0);
    const claimedGross = missing.reduce((total, s) => total + s.gross, 0);
    const remainingGross = remaining.reduce((total, payment) => total + payment.gross, 0);
    const tiesOut = remaining.length === claimedCount && remainingGross === claimedGross;

    const tieEvidence = tiesOut
      ? `the remainder ties out: ${remaining.length} payments worth ${money(remainingGross)} are due for payout on ${date} and unplaced by the report, against ${claimedCount} worth ${money(claimedGross)} claimed`
      : `the remainder does NOT tie out: ${remaining.length} unplaced payments worth ${money(remainingGross)} against ${claimedCount} claimed worth ${money(claimedGross)}`;

    /* One omission on the date: the remainder is the answer, and nothing had to be chosen. */
    if (missing.length === 1 && tiesOut) {
      const settlement = missing[0];
      emit({
        lane,
        tier: "T2",
        rule: "T2_RECON_BY_ELIMINATION",
        outcome: applied(CONFIDENCE.BY_ELIMINATION),
        confidence: CONFIDENCE.BY_ELIMINATION,
        left: remaining.map((payment) => payment.id),
        right: [settlement.id],
        inputs: cappedInputs([settlement.id, ...remaining.map((payment) => payment.id)]),
        evidence: [
          `the recon report has no rows for this payout at all`,
          `every other payout on ${date} is itemised, so its payments are exactly what is left over`,
          tieEvidence,
          `count and gross both tie to the paisa, so no combination had to be chosen`,
        ],
        class: "MISSING_RECON_ROW",
        amount: settlement.gross,
      });
      continue;
    }

    /* Several omissions: try the arithmetic, and say plainly when it cannot decide. */
    const resolved = new Set<string>();
    for (const settlement of missing) {
      if (!partitionIsTractable(remaining.length, settlement.paymentCount, config)) continue;
      const search = findSubsets(remaining, (payment) => payment.gross, settlement.gross, {
        maxSize: settlement.paymentCount,
        exactSize: settlement.paymentCount,
        maxNodes: config.search.maxNodes,
      });
      counters.nodes += search.nodes;
      if (search.subsets.length !== 1) continue;

      const batch = search.subsets[0];
      emit({
        lane,
        tier: "T2",
        rule: "T2_RECON_SUBSET_SUM",
        outcome: applied(CONFIDENCE.PAYMENT_PARTITION),
        confidence: CONFIDENCE.PAYMENT_PARTITION,
        left: batch.map((payment) => payment.id),
        right: [settlement.id],
        inputs: cappedInputs([settlement.id, ...remaining.map((payment) => payment.id)]),
        evidence: [
          `the recon report has no rows for this payout`,
          `exactly one set of ${settlement.paymentCount} payments out of the ${remaining.length} unplaced on ${date} totals ${money(settlement.gross)}, and no other combination of that size does`,
          tieEvidence,
        ],
        class: "MISSING_RECON_ROW",
        amount: settlement.gross,
      });
      resolved.add(settlement.id);
      const taken = new Set(batch);
      remaining = remaining.filter((payment) => !taken.has(payment));
    }

    for (const settlement of missing) {
      if (resolved.has(settlement.id)) continue;
      emit({
        lane,
        tier: "T4",
        rule: "T4_NOT_ITEMISED",
        outcome: "EXCEPTION",
        confidence: 0,
        left: [],
        right: [settlement.id],
        inputs: cappedInputs([settlement.id, ...remaining.map((payment) => payment.id)]),
        evidence: [
          `the recon report has no rows for this payout, and ${missing.length - 1} other payout(s) on ${date} are missing from it too`,
          ...(resolved.size > 0
            ? [`${resolved.size} of them were recovered by exact subset-sum; this one was not`]
            : []),
          tieEvidence,
          `splitting ${remaining.length} unplaced payments across ${missing.length} payouts of ${missing.map((s) => s.paymentCount).join(" and ")} is not derivable from these sources — the report is the only document that says which is which`,
          `the money is accounted for; the attribution is not. Ask for a complete recon report.`,
        ],
        class: "MISSING_RECON_ROW",
        amount: settlement.gross,
      });
    }
  }
}

/* ── Stats ────────────────────────────────────────────────────────────────*/

function summarise(
  results: MatchResult[],
  counters: { nodes: number },
  input: MatchInput,
  elapsedMs: number,
): MatchRun["stats"] {
  const byTier: Record<Tier, number> = { T0: 0, T1: 0, T2: 0, T4: 0 };
  const byOutcome: Record<Outcome, number> = { AUTO_MATCHED: 0, PROPOSED: 0, EXCEPTION: 0 };
  const lanes: Lane[] = ["PAYMENT_TO_SETTLEMENT", "SETTLEMENT_TO_BANK", "SETTLEMENT_TO_LEDGER"];
  const byLane = Object.fromEntries(
    lanes.map((lane) => [lane, { AUTO_MATCHED: 0, PROPOSED: 0, EXCEPTION: 0 }]),
  ) as Record<Lane, Record<Outcome, number>>;

  const rules = new Map<string, { rule: string; tier: Tier; outcome: Outcome; count: number }>();
  let capHits = 0;

  for (const result of results) {
    byTier[result.tier]++;
    byOutcome[result.outcome]++;
    byLane[result.lane][result.outcome]++;
    if (result.capHit) capHits++;
    const key = `${result.rule}|${result.outcome}`;
    const row = rules.get(key);
    if (row) row.count++;
    else rules.set(key, { rule: result.rule, tier: result.tier, outcome: result.outcome, count: 1 });
  }

  return {
    byTier,
    byOutcome,
    byLane,
    byRule: [...rules.values()].sort(
      (a, b) => a.tier.localeCompare(b.tier) || b.count - a.count || a.rule.localeCompare(b.rule),
    ),
    capHits,
    searchNodes: counters.nodes,
    units: input.settlements.length * 2 + input.bank.length,
    elapsedMs,
  };
}
