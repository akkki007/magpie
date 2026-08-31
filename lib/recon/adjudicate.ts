import { z } from "zod";

import { toIndianDecimal, type Paise } from "./money";
import type { MatchResult } from "./match";
import { TOLERANCES, type Tolerances } from "./tolerance";
import type { BankCredit, FailureClass, Settlement } from "./types";

/**
 * The adjudication contract (`docs/recon-plan.md` R4.1, R4.3, R4.4).
 *
 * This file holds everything about the LLM tier **except the call itself**, which lives in
 * `claude.ts`. The split is deliberate: the schemas, the prompt and the validation gate are
 * the parts that decide whether the tier is safe, and they are testable with no API key, no
 * network and no cost. A gate you can only exercise by spending money is a gate nobody
 * exercises.
 *
 * Three rules from §2 shape it.
 *
 * **§A3 — structured output, validated, or it is an exception.** The model does not reply in
 * prose. It fills a schema, the schema is parsed, and anything that fails parsing goes to
 * the exception lane. A malformed proposal must never become a silent pass.
 *
 * **§A4 — arithmetic in code, judgement in the model.** The model may say *"this credit is
 * that payout under a mangled name"*. Whether the paise tie is then recomputed here, in
 * TypeScript, against the records the deterministic tiers already read. If it does not tie,
 * the proposal is rejected regardless of how confident the model sounded.
 *
 * **§A7 — grounding.** The model may only name ids that were in the candidate set it was
 * given. There is no lookup tool and no way to reach the rest of the dataset, so an invented
 * `setl_…` cannot become a link; it becomes a rejection with a reason.
 */

/* ── The schema the model fills ───────────────────────────────────────────*/

/**
 * Failure classes the model is allowed to assign.
 *
 * Deliberately the full list rather than only the two it is expected to meet: constraining
 * it to the answer would be teaching the test. It has to pick the right one.
 */
export const FAILURE_CLASSES = [
  "MISSING_UTR",
  "TYPO_UTR",
  "SPLIT_SETTLEMENT",
  "COMBINED_CREDIT",
  "FEE_NOT_BOOKED",
  "TDS_WITHHELD",
  "TIMING_T_PLUS_N",
  "REFUND_NETTED",
  "CHARGEBACK_DEDUCTION",
  "DUPLICATE_CREDIT",
  "FOREIGN_CREDIT",
  "ROUNDING_PAISE",
  "MISSING_LEDGER_ENTRY",
  "MISSING_RECON_ROW",
  "MISATTRIBUTED_PAYMENT",
  "UTR_IN_NARRATION",
  "DISGUISED_COUNTERPARTY",
  "NARRATED_PAYOUT",
] as const satisfies readonly FailureClass[];

/**
 * One decision about one escalated item.
 *
 * `decline` is a first-class answer, not a failure. §1.3 makes abstention a success state,
 * and a model that is willing to say "I cannot tell" is worth far more here than one that
 * always produces a link — because the thing being protected is the false-match rate.
 */
export const DecisionSchema = z.object({
  /** Echoes the packet id, so a batched reply cannot be silently misaligned. */
  itemId: z.string(),
  action: z.enum(["match", "decline"]),
  /**
   * The settlement chosen, when matching. Must be one of the candidates offered — there is
   * no other way to learn an id, and the gate checks it anyway.
   */
  settlementId: z.string().nullable(),
  /**
   * The class, from R0.3's list. **Not nullable, and that is the enforcement.**
   *
   * R4.4 requires a class on every adjudicated item. The first live run returned `null` on
   * every single one — the prompt asked for a label, the schema made omitting it free, and
   * free won. Strict structured output means the provider now rejects a reply without one, so
   * the model has to choose and the scoreboard can mark it right or wrong. An abstention that
   * costs nothing is not judgement, it is a shrug.
   *
   * The fix is the *schema*, deliberately, and not the prompt. A first attempt also rewrote
   * this rule to name the two classes this batch happens to contain, which lifted class
   * accuracy to 100% by telling the model the answer — teaching the test, exactly what R0.5
   * warns against. The enum is the whole hint the model gets.
   */
  failureClass: z.enum(FAILURE_CLASSES),
  /**
   * The model's own arithmetic, in paise, which the gate recomputes.
   *
   * Asking for it is not redundant. A model that has to state the gap has to look at the
   * numbers, and a stated gap that disagrees with the recomputed one is the clearest
   * possible signal that the reasoning was decorative.
   */
  amountGapPaise: z.number().int(),
  /** One line for a controller, per §A5 — not a transcript. */
  evidence: z.string(),
  confidence: z.number(),
});

/**
 * Note what is *not* in the schema above: no string lengths, no numeric ranges.
 *
 * Strict structured output turns this into a JSON schema the provider enforces, and the
 * subset it accepts is narrower than Zod's. More importantly, a bound expressed in the wire
 * schema is a bound checked by the provider — outside this codebase, silently, with no
 * evidence line when it fails. Ranges belong to the gate, where a violation becomes a typed
 * rejection a controller can read. The wire schema's only job is shape.
 */

export type Decision = z.infer<typeof DecisionSchema>;

export const BatchDecisionSchema = z.object({
  decisions: z.array(DecisionSchema),
});

/* ── The packet the model receives ────────────────────────────────────────*/

export type Candidate = {
  settlementId: string;
  net: Paise;
  settledAt: string;
  utr: string;
  gapPaise: Paise;
  daysEarlier: number;
};

export type Packet = {
  /** Stable id: the escalated credit. Also the cassette key. */
  itemId: string;
  creditId: string;
  amount: Paise;
  valueDate: string;
  narration: string;
  reference: string;
  candidates: Candidate[];
};

/**
 * Turn the deterministic tier's proposals into packets.
 *
 * The packet contains exactly what the ranking pass already found and nothing else. That is
 * §A1's constraint restated as a data structure: *T3 never searches the whole dataset*. It
 * is also what keeps cost and latency in range — five candidates is a few hundred tokens,
 * and the alternative is the whole statement.
 */
export function packetsFrom(
  results: MatchResult[],
  bank: BankCredit[],
  settlements: Settlement[],
  config: Tolerances = TOLERANCES,
): Packet[] {
  const creditById = new Map(bank.map((credit) => [credit.id, credit]));
  const settlementById = new Map(settlements.map((settlement) => [settlement.id, settlement]));

  return results
    .filter((result) => result.rule === "T2_ESCALATION_CANDIDATES")
    .map((result) => {
      const credit = creditById.get(result.right[0]);
      if (!credit) return null;

      const candidates = result.inputs
        .map((id) => settlementById.get(id))
        .filter((settlement): settlement is Settlement => settlement !== undefined)
        .slice(0, config.escalation.maxCandidates)
        .map((settlement) => ({
          settlementId: settlement.id,
          net: settlement.net,
          settledAt: settlement.settledAt,
          utr: settlement.utr,
          gapPaise: credit.amount - settlement.net,
          daysEarlier: Math.round(
            (Date.parse(`${credit.valueDate}T00:00:00Z`) -
              Date.parse(`${settlement.settledAt}T00:00:00Z`)) /
              86_400_000,
          ),
        }));

      return {
        itemId: credit.id,
        creditId: credit.id,
        amount: credit.amount,
        valueDate: credit.valueDate,
        narration: credit.description,
        reference: credit.reference,
        candidates,
      } satisfies Packet;
    })
    .filter((packet): packet is Packet => packet !== null);
}

/* ── The prompt ───────────────────────────────────────────────────────────*/

const money = (paise: Paise) => `₹${toIndianDecimal(paise)}`;

/**
 * The system prompt: stable, so it caches (§A6), and specific about what the model is *for*.
 *
 * It states the asymmetry explicitly, because that is the single most important thing to get
 * across. A model that treats this as a matching puzzle will match everything; a model that
 * understands a wrong match corrupts the books and an abstention costs a minute will decline
 * when it should.
 */
export const SYSTEM_PROMPT = `You are adjudicating bank credits that a deterministic reconciliation engine could not resolve.

The engine has already done every check that can be made safely: exact reference matches, reference near-misses, fee/TDS/rounding tolerances, split and combined payouts, and a settlement recon report. What reaches you has real evidence pointing at a payout and nothing that identifies it — typically an amount a few paise out with no usable reference. A rule wide enough to settle these would also, on a real month's statement, marry two unrelated payouts of similar value.

Your job is judgement over the candidates you are given. Specifically:
- Read the bank narration. Indian banks write the same company a dozen ways: RZPSPL, R P SOFTWARE PVT LTD, RAZOR PAY SW, RAZORPY SOFTWRE are all Razorpay Software Pvt Ltd. A narration may also describe a payout instead of referencing it — "PAYOUT FOR 40 TXNS DATED 29JUN26", or the count spelled out in words.
- Weigh that against the numbers already computed for you: the gap in paise and how many days earlier each candidate settled.

Rules you must follow:
1. You may only name a settlement id that appears in that item's candidate list. There is no way to look anything up, and an id that was not offered will be rejected.
2. Do not do arithmetic. The gap in paise is given per candidate; report the one you chose. It is recomputed and checked before your decision is used.
3. Prefer declining. A wrong match silently corrupts a company's books and nobody ever sees it; an item you decline costs a controller one minute of review. If the narration does not actually identify the payout, decline — an amount a few paise out is not on its own enough.
4. Give one line of evidence a finance controller can act on. State what identified it. No reasoning transcript.
5. Every item needs a failure class describing why the deterministic engine could not resolve it — on a decline as much as on a match. Pick the class that explains the failure, not the one that describes your decision.

Answer for every item you are given, echoing its id.`;

export function userPromptFor(packets: Packet[]): string {
  const lines: string[] = [
    `${packets.length} item(s) need adjudication.`,
    "",
  ];

  for (const packet of packets) {
    lines.push(`Item ${packet.itemId}`);
    lines.push(`  Bank credit ${packet.creditId}: ${money(packet.amount)} on ${packet.valueDate}`);
    lines.push(`  Narration: "${packet.narration}"`);
    lines.push(`  Reference column: ${packet.reference === "" ? "(empty)" : packet.reference}`);
    lines.push(`  Candidates:`);
    for (const candidate of packet.candidates) {
      lines.push(
        `    ${candidate.settlementId}: net ${money(candidate.net)}, gap ${candidate.gapPaise} paise, settled ${candidate.settledAt} (${candidate.daysEarlier} day(s) before the credit), UTR ${candidate.utr || "(none)"}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/* ── The validation gate ──────────────────────────────────────────────────*/

export type GateRejection =
  /** Not valid against the schema, or an item id nobody asked about. */
  | "SCHEMA"
  /** Named a settlement that was not in this item's candidate list (§A7). */
  | "UNGROUNDED_ID"
  /** The stated gap disagrees with the recomputed one (§A4). */
  | "ARITHMETIC"
  /** The recomputed gap is outside anything a match could justify. */
  | "OUT_OF_TOLERANCE"
  /** Said `match` with no settlement, or `decline` with one. */
  | "INCOHERENT"
  /** Below the threshold at which a proposal is worth showing. */
  | "LOW_CONFIDENCE";

export type Adjudicated =
  | { ok: true; packet: Packet; decision: Decision; settlement: Settlement; gapPaise: Paise }
  | { ok: false; packet: Packet; decision?: Decision; reason: GateRejection; detail: string };

/**
 * The gate. Everything the model said, checked against the data it was shown.
 *
 * Ordered cheapest-and-most-fundamental first, so the reason reported is the *root* problem
 * rather than a downstream symptom: a decision naming an invented id has an ungrounded id,
 * not an arithmetic error.
 */
export function gate(
  packets: Packet[],
  raw: unknown,
  settlements: Settlement[],
  config: Tolerances = TOLERANCES,
): Adjudicated[] {
  const byId = new Map(packets.map((packet) => [packet.itemId, packet]));
  const settlementById = new Map(settlements.map((settlement) => [settlement.id, settlement]));

  const parsed = BatchDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    // The whole reply is unusable, so every item in the batch is rejected rather than
    // silently dropped — an escalated item that produces no result at all would vanish
    // from the queue and from the denominator.
    return packets.map((packet) => ({
      ok: false as const,
      packet,
      reason: "SCHEMA" as const,
      detail: parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    }));
  }

  const seen = new Set<string>();
  const out: Adjudicated[] = [];

  for (const decision of parsed.data.decisions) {
    const packet = byId.get(decision.itemId);
    if (!packet) continue; // A decision about an item nobody escalated. Ignored, not applied.
    if (seen.has(decision.itemId)) continue;
    seen.add(decision.itemId);

    /* Bounds the wire schema deliberately does not carry. */
    if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
      out.push({
        ok: false,
        packet,
        decision,
        reason: "SCHEMA",
        detail: `confidence ${decision.confidence} is not a probability`,
      });
      continue;
    }
    if (decision.evidence.trim() === "" || decision.evidence.length > 400) {
      out.push({
        ok: false,
        packet,
        decision,
        reason: "SCHEMA",
        detail:
          decision.evidence.trim() === ""
            ? "no evidence line, which is the only part a controller reads"
            : `evidence is ${decision.evidence.length} characters; §A5 wants one line, not a transcript`,
      });
      continue;
    }

    if (decision.action === "decline") {
      if (decision.settlementId !== null) {
        out.push({
          ok: false,
          packet,
          decision,
          reason: "INCOHERENT",
          detail: `declined but still named ${decision.settlementId}`,
        });
        continue;
      }
      out.push({
        ok: false,
        packet,
        decision,
        reason: "LOW_CONFIDENCE",
        detail: "the model declined to match this item",
      });
      continue;
    }

    if (decision.settlementId === null) {
      out.push({ ok: false, packet, decision, reason: "INCOHERENT", detail: "matched nothing" });
      continue;
    }

    const offered = packet.candidates.some(
      (candidate) => candidate.settlementId === decision.settlementId,
    );
    const settlement = settlementById.get(decision.settlementId);
    if (!offered || !settlement) {
      out.push({
        ok: false,
        packet,
        decision,
        reason: "UNGROUNDED_ID",
        detail: `${decision.settlementId} was not among the ${packet.candidates.length} candidate(s) offered`,
      });
      continue;
    }

    /* §A4: recompute, never trust. */
    const gapPaise = packet.amount - settlement.net;
    if (gapPaise !== decision.amountGapPaise) {
      out.push({
        ok: false,
        packet,
        decision,
        reason: "ARITHMETIC",
        detail: `stated a gap of ${decision.amountGapPaise} paise; the records give ${gapPaise}`,
      });
      continue;
    }
    if (Math.abs(gapPaise) > config.escalation.slackPaise) {
      out.push({
        ok: false,
        packet,
        decision,
        reason: "OUT_OF_TOLERANCE",
        detail: `${Math.abs(gapPaise)} paise is beyond the ${config.escalation.slackPaise} paise an adjudicated match may absorb`,
      });
      continue;
    }
    if (decision.confidence < config.autoApply) {
      out.push({
        ok: false,
        packet,
        decision,
        reason: "LOW_CONFIDENCE",
        detail: `confidence ${decision.confidence} is below the ${config.autoApply} auto-apply threshold`,
      });
      continue;
    }

    out.push({ ok: true, packet, decision, settlement, gapPaise });
  }

  /* An item the model never answered is still an escalated item. */
  for (const packet of packets) {
    if (seen.has(packet.itemId)) continue;
    out.push({
      ok: false,
      packet,
      reason: "SCHEMA",
      detail: "the model returned no decision for this item",
    });
  }

  return out;
}

/**
 * The adjudicated batch, folded back into the deterministic results.
 *
 * An accepted decision *replaces* the proposal with an auto-matched result carrying the
 * model's evidence and class; a rejected one becomes a typed exception that says why. Either
 * way the item leaves the queue with an answer, and the scoreboard can score both arms of
 * the ablation with the same code (§A8).
 */
export function applyAdjudications(
  results: MatchResult[],
  adjudicated: Adjudicated[],
): MatchResult[] {
  const byCredit = new Map(adjudicated.map((entry) => [entry.packet.creditId, entry]));

  return results.map((result) => {
    if (result.rule !== "T2_ESCALATION_CANDIDATES") return result;
    const entry = byCredit.get(result.right[0]);
    if (!entry) return result;

    if (entry.ok) {
      return {
        ...result,
        tier: "T3" as const,
        rule: "T3_ADJUDICATED",
        outcome: "AUTO_MATCHED" as const,
        confidence: entry.decision.confidence,
        left: [entry.settlement.id],
        class: entry.decision.failureClass,
        evidence: [
          entry.decision.evidence,
          `gap of ${entry.gapPaise} paise recomputed and confirmed against ${entry.settlement.id} (net ${money(entry.settlement.net)})`,
          `chosen from ${entry.packet.candidates.length} candidate(s) the deterministic tiers offered; no other id was reachable`,
        ],
      };
    }

    return {
      ...result,
      tier: "T4" as const,
      rule: `T4_${entry.reason}`,
      outcome: "EXCEPTION" as const,
      confidence: 0,
      class: entry.decision?.failureClass ?? null,
      evidence: [
        ...result.evidence.slice(0, 2),
        entry.reason === "LOW_CONFIDENCE" && entry.decision?.action === "decline"
          ? `the adjudicator declined: ${entry.decision.evidence}`
          : `the adjudicator's answer was rejected by the validation gate — ${entry.detail}`,
      ],
    };
  });
}
