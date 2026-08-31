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
import { CONFIDENCE, TOLERANCES, addDays, type Tolerances } from "./tolerance";
import type {
  BankCredit,
  Chargeback,
  FailureClass,
  Lane,
  LedgerEntry,
  Payment,
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
 *   T0  a debit that no payout claimed, which is a deduction rather than a settlement
 *   T1  the statement almost says which settlement it is (a transposed reference)
 *   T1  the statement says nothing, and a unique amount and date have to carry it
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

  /* ── T0, step 3: debits that no payout explains ─────────────────────────*/

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
    if (!isOpenCredit(credit) || credit.amount <= 0) continue;
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
    if (!isOpenCredit(credit) || credit.amount <= 0) continue;
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

  /* ── T2, step 5: one settlement, several credits ────────────────────────*/

  for (const settlement of input.settlements) {
    if (!isOpenSettlement(settlement)) continue;

    const anchors = referencedCredits(settlement);
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
 * The lane with no reference anywhere, and the one worth being honest about.
 *
 * The payments export carries no settlement id — deliberately, because that is how the two
 * files arrive in real life. So the only thing connecting them is the payout calendar:
 * every payment captured on T should appear in a payout on T+2, weekends skipped.
 *
 * That gets you a **tie-out**, which is genuinely valuable: for each payout date, the
 * count and the value of the payments must equal the count and value the settlements
 * claim, to the paisa. What it does not get you is an **assignment**. When one date carries
 * three settlements of 40, 40 and 3 payments, the small one can be recovered by exact
 * cardinality-constrained subset-sum and the last one by elimination, but choosing which
 * 40 of the remaining 80 payments belong to which of two identical-sized batches is
 * information that simply is not in these files — about 10^23 combinations, all of which
 * the arithmetic accepts.
 *
 * So this lane proposes rather than asserts, and says why. That is §1.3 working as
 * intended: an unresolvable assignment reported as an ambiguity costs a controller a
 * click, and reported as a match corrupts every downstream number silently.
 */
function matchPaymentLane(
  input: MatchInput,
  config: Tolerances,
  emit: (result: MatchResult) => MatchResult,
  applied: (confidence: number) => Outcome,
  counters: { nodes: number },
) {
  const lane: Lane = "PAYMENT_TO_SETTLEMENT";
  const pools = groupPaymentsByPayoutDate(input.payments, config);

  const settlementsByDate = new Map<string, Settlement[]>();
  for (const settlement of input.settlements) {
    const bucket = settlementsByDate.get(settlement.settledAt);
    if (bucket) bucket.push(settlement);
    else settlementsByDate.set(settlement.settledAt, [settlement]);
  }

  const dates = [...new Set([...pools.keys(), ...settlementsByDate.keys()])].sort();

  for (const date of dates) {
    const pool = pools.get(date) ?? [];
    const settlements = [...(settlementsByDate.get(date) ?? [])].sort(
      (a, b) => a.paymentCount - b.paymentCount || (a.id < b.id ? -1 : 1),
    );

    if (settlements.length === 0) {
      emit({
        lane,
        tier: "T4",
        rule: "T4_PAYMENTS_NEVER_SETTLED",
        outcome: "EXCEPTION",
        confidence: 0,
        left: pool.map((p) => p.id),
        right: [],
        inputs: cappedInputs(pool.map((p) => p.id)),
        evidence: [
          `${pool.length} payments worth ${money(pool.reduce((t, p) => t + p.gross, 0))} were due for payout on ${date} and no settlement was reported that day`,
        ],
        class: null,
        amount: pool.reduce((total, payment) => total + payment.gross, 0),
      });
      continue;
    }

    const poolGross = pool.reduce((total, payment) => total + payment.gross, 0);
    const poolFees = pool.reduce((total, payment) => total + payment.fee, 0);
    const poolTax = pool.reduce((total, payment) => total + payment.tax, 0);
    const claimedGross = settlements.reduce((total, s) => total + s.gross, 0);
    const claimedCount = settlements.reduce((total, s) => total + s.paymentCount, 0);
    const tiesOut =
      poolGross === claimedGross &&
      pool.length === claimedCount &&
      poolFees === settlements.reduce((total, s) => total + s.fees, 0) &&
      poolTax === settlements.reduce((total, s) => total + s.tax, 0);

    const tieEvidence = tiesOut
      ? `the payout date ties out in full: ${pool.length} payments, gross ${money(poolGross)}, fees ${money(poolFees)}, GST ${money(poolTax)} — all four agree with what the settlements claim`
      : `the payout date does NOT tie out: ${pool.length} payments worth ${money(poolGross)} against ${claimedCount} claimed worth ${money(claimedGross)}`;

    /* One settlement on the date: the pool is the answer, no search needed. */
    if (settlements.length === 1) {
      const settlement = settlements[0];
      emit({
        lane,
        tier: "T0",
        rule: "T0_SOLE_PAYOUT_OF_DAY",
        outcome: tiesOut ? applied(CONFIDENCE.DATE_POOL_UNIQUE) : "PROPOSED",
        confidence: tiesOut ? CONFIDENCE.DATE_POOL_UNIQUE : CONFIDENCE.AMBIGUOUS,
        left: pool.map((p) => p.id),
        right: [settlement.id],
        inputs: cappedInputs(pool.map((p) => p.id)),
        evidence: [
          `${pool.length} payments captured on ${[...new Set(pool.map((p) => p.capturedAt))].sort().join(", ")} are due for payout on ${date} under T+${config.settlement.delayDays}`,
          tieEvidence,
          `it is the only settlement paid that day, so no assignment is needed`,
        ],
        class: null,
        amount: poolGross,
      });
      continue;
    }

    /* Several settlements: recover what the arithmetic can, and abstain on the rest. */
    let remaining = [...pool];
    const unresolved: Settlement[] = [];
    let capHitOnDate = false;

    for (let i = 0; i < settlements.length; i++) {
      const settlement = settlements[i];
      const others = settlements.length - unresolved.length - i;

      /* Last one standing: whatever is left is its batch, if the totals agree. */
      if (others === 1 && unresolved.length === 0) {
        if (
          remaining.length === settlement.paymentCount &&
          remaining.reduce((total, p) => total + p.gross, 0) === settlement.gross
        ) {
          emit({
            lane,
            tier: "T2",
            rule: "T2_PAYMENT_BATCH_BY_ELIMINATION",
            outcome: applied(CONFIDENCE.BY_ELIMINATION),
            confidence: CONFIDENCE.BY_ELIMINATION,
            left: remaining.map((p) => p.id),
            right: [settlement.id],
            inputs: cappedInputs(remaining.map((p) => p.id)),
            evidence: [
              `every other settlement paid on ${date} has been assigned, leaving ${remaining.length} payments`,
              `they number exactly ${settlement.paymentCount} and total ${money(settlement.gross)} — count and value both tie`,
              tieEvidence,
            ],
            class: null,
            amount: settlement.gross,
          });
          remaining = [];
          continue;
        }
      }

      if (!partitionIsTractable(remaining.length, settlement.paymentCount, config)) {
        unresolved.push(settlement);
        capHitOnDate = true;
        continue;
      }

      const search = findSubsets(remaining, (payment) => payment.gross, settlement.gross, {
        maxSize: settlement.paymentCount,
        exactSize: settlement.paymentCount,
        maxNodes: config.search.maxNodes,
      });
      counters.nodes += search.nodes;
      capHitOnDate = capHitOnDate || search.capHit;

      if (search.subsets.length === 1) {
        const batch = search.subsets[0];
        emit({
          lane,
          tier: "T2",
          rule: "T2_PAYMENT_BATCH_SUBSET_SUM",
          outcome: applied(CONFIDENCE.PAYMENT_PARTITION),
          confidence: CONFIDENCE.PAYMENT_PARTITION,
          left: batch.map((p) => p.id),
          right: [settlement.id],
          inputs: cappedInputs(remaining.map((p) => p.id)),
          evidence: [
            `exactly one set of ${settlement.paymentCount} payments out of the ${remaining.length} due on ${date} totals ${money(settlement.gross)}`,
            `count and value both tie to the paisa, and no other combination of that size does`,
            tieEvidence,
          ],
          class: null,
          amount: settlement.gross,
        });
        const taken = new Set(batch);
        remaining = remaining.filter((payment) => !taken.has(payment));
        continue;
      }

      unresolved.push(settlement);
    }

    for (const settlement of unresolved) {
      emit({
        lane,
        tier: "T2",
        rule: "T2_PAYMENT_BATCH_AMBIGUOUS",
        outcome: "PROPOSED",
        confidence: CONFIDENCE.DATE_POOL_TIED,
        left: remaining.map((p) => p.id),
        right: [settlement.id],
        inputs: cappedInputs(remaining.map((p) => p.id)),
        evidence: [
          tieEvidence,
          `${unresolved.length} settlements paid on ${date} share ${remaining.length} candidate payments, and this one claims ${settlement.paymentCount} of them worth ${money(settlement.gross)}`,
          capHitOnDate
            ? `choosing ${settlement.paymentCount} of ${remaining.length} is beyond the search cap, and the sources carry no settlement id on a payment — the assignment is not derivable from this data`
            : `no unique set of ${settlement.paymentCount} payments totals ${money(settlement.gross)}`,
        ],
        class: null,
        amount: settlement.gross,
        capHit: capHitOnDate || undefined,
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
