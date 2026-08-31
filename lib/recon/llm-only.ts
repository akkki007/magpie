import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import type { MatchResult } from "./match";
import { toIndianDecimal } from "./money";
import { DEFAULT_MODEL, type Usage } from "./openai";
import type { BankCredit, Settlement } from "./types";

/**
 * The LLM-only arm of the ablation (`docs/recon-plan.md` R4.5, §A8).
 *
 * The third bar exists to be *lost*. It hands a model the whole settlement↔bank lane with no
 * index, no tolerance, no candidate generation and no arithmetic check, and asks it to
 * reconcile — which is the architecture a reasonable person proposes on day one and the one
 * §1.1 argues against. Building it is how that argument stops being an assertion.
 *
 * Two constraints keep it honest rather than a straw man. It gets the *same* data the
 * deterministic tiers get, formatted as clearly as the escalation packets are. And it is
 * scored by the same scorer, so the comparison is a comparison.
 *
 * What it does not get is the thing that actually matters: nothing recomputes its arithmetic,
 * nothing checks its ids exist, and nothing stops it matching a credit to a settlement it
 * invented. Those are the gate's jobs, and the gate belongs to the hybrid.
 */

const MatchSchema = z.object({
  matches: z.array(
    z.object({
      settlementId: z.string(),
      creditId: z.string(),
      confidence: z.number(),
    }),
  ),
});

const money = (paise: number) => `₹${toIndianDecimal(paise)}`;

const SYSTEM = `You are reconciling a payment gateway's settlement report against a bank statement.

Each settlement was paid out to the bank; find the bank credit that paid it. A credit's reference is usually the settlement's UTR, and its amount is usually the settlement's net — but references go missing or get transposed, amounts are sometimes short by fees or tax or a few paise, payouts sometimes land days late, one settlement can arrive as two credits, and one credit can cover two settlements. Some bank lines are not gateway payouts at all.

Return every settlement-to-credit pairing you are confident about. Omit a settlement rather than guess at it.`;

export type LlmOnlyRun = {
  results: MatchResult[];
  usage: Usage;
  /** Ids the model returned that do not exist in the sources. */
  hallucinated: number;
};

export async function reconcileWithLlmOnly(
  settlements: Settlement[],
  bank: BankCredit[],
  options: { model?: string; chunk?: number } = {},
): Promise<LlmOnlyRun> {
  const model = options.model ?? DEFAULT_MODEL;
  const chunk = options.chunk ?? 40;
  const usage: Usage = {
    model,
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    latenciesMs: [],
    rupees: null,
  };

  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set.");
  const client = new OpenAI();

  /* The whole settlement side goes up with every chunk — a stable prefix, so it caches. */
  const settlementBlock = settlements
    .map((s) => `${s.id} | UTR ${s.utr || "(none)"} | net ${money(s.net)} | settled ${s.settledAt} | gross ${money(s.gross)}`)
    .join("\n");

  const settlementIds = new Set(settlements.map((s) => s.id));
  const creditIds = new Set(bank.map((c) => c.id));
  const seen = new Set<string>();
  const results: MatchResult[] = [];
  let hallucinated = 0;

  for (let i = 0; i < bank.length; i += chunk) {
    const slice = bank.slice(i, i + chunk);
    const creditBlock = slice
      .map((c) => `${c.id} | ref ${c.reference || "(none)"} | ${money(c.amount)} | ${c.valueDate} | "${c.description}"`)
      .join("\n");

    const started = performance.now();
    const response = await client.responses.parse({
      model,
      input: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `All ${settlements.length} settlements:\n${settlementBlock}\n\nBank statement lines ${i + 1}–${i + slice.length} of ${bank.length}:\n${creditBlock}\n\nWhich of these bank lines pays which settlement?`,
        },
      ],
      text: { format: zodTextFormat(MatchSchema, "reconciliation") },
    });

    usage.calls++;
    usage.latenciesMs.push(performance.now() - started);
    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.cachedInputTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;

    for (const match of response.output_parsed?.matches ?? []) {
      /**
       * Ungrounded ids are *counted*, not dropped, and never silently repaired.
       *
       * This is the arm without a gate. Recording how often a model invents an id when
       * nothing checks is most of the point of running it at all.
       */
      if (!settlementIds.has(match.settlementId) || !creditIds.has(match.creditId)) {
        hallucinated++;
        continue;
      }
      const key = `${match.settlementId}|${match.creditId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const settlement = settlements.find((s) => s.id === match.settlementId)!;
      results.push({
        lane: "SETTLEMENT_TO_BANK",
        tier: "T3",
        rule: "LLM_ONLY",
        outcome: "AUTO_MATCHED",
        confidence: match.confidence,
        left: [match.settlementId],
        right: [match.creditId],
        inputs: [],
        evidence: ["matched by a model with no deterministic candidate generation"],
        class: null,
        amount: settlement.net,
      });
    }
  }

  return { results, usage, hallucinated };
}
