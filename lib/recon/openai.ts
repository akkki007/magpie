import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  BatchDecisionSchema,
  SYSTEM_PROMPT,
  gate,
  userPromptFor,
  type Adjudicated,
  type Packet,
} from "./adjudicate";
import { TOLERANCES, type Tolerances } from "./tolerance";
import type { Settlement } from "./types";

/**
 * The adjudication tier's provider (`docs/recon-plan.md` R4.2).
 *
 * **This is the only file in the module that knows which vendor answers.** Everything that
 * decides whether the tier is *safe* — the schema, the prompt, the validation gate — lives in
 * `adjudicate.ts` with no SDK import, so swapping providers cannot quietly change what counts
 * as an acceptable match. That boundary already paid for itself once: the plan specified
 * Claude, the keys available are OpenAI's, and the swap touched this file and nothing else.
 *
 * Two things §A6 asks for and this does:
 *
 * **Batch, never call per record.** Escalated items go up in groups, so a run is a handful of
 * requests rather than one per credit. The system prompt is identical across every call,
 * which is also what makes it cacheable.
 *
 * **Measure what it cost.** Tokens, cached tokens, wall clock per batch and p50/p95 per
 * escalated record, all returned rather than logged, so R3's scoreboard can report them
 * beside the accuracy numbers instead of alongside a claim that it was "fast".
 */

/** `gpt-5.6` is what the current API docs use; override for a different one. */
export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.6";

export type Usage = {
  model: string;
  calls: number;
  inputTokens: number;
  /** Served from the provider's prompt cache — the stable system prompt, mostly. */
  cachedInputTokens: number;
  outputTokens: number;
  /** One entry per batch, in call order. */
  latenciesMs: number[];
  /**
   * Cost in rupees, or `null` when the per-token rates are not configured.
   *
   * Deliberately not a guess. A fabricated figure on a slide claiming measured cost is worse
   * than an empty cell, so this stays null unless `OPENAI_INPUT_PER_MTOK`,
   * `OPENAI_OUTPUT_PER_MTOK` and `USD_TO_INR` are set.
   */
  rupees: number | null;
};

export type AdjudicationRun = {
  adjudicated: Adjudicated[];
  usage: Usage;
};

const emptyUsage = (model: string): Usage => ({
  model,
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  latenciesMs: [],
  rupees: null,
});

function priceRun(usage: Usage): number | null {
  const inputRate = Number(process.env.OPENAI_INPUT_PER_MTOK);
  const outputRate = Number(process.env.OPENAI_OUTPUT_PER_MTOK);
  const rate = Number(process.env.USD_TO_INR);
  if (!inputRate || !outputRate || !rate) return null;

  // Cached input is billed differently by every provider and the discount is not something to
  // assume, so cached tokens are priced at the full input rate here. That overstates cost,
  // which is the safe direction for a number that goes on a slide.
  const dollars =
    (usage.inputTokens / 1_000_000) * inputRate + (usage.outputTokens / 1_000_000) * outputRate;
  return dollars * rate;
}

export const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export type AdjudicateOptions = {
  model?: string;
  /** Items per request (§A6). */
  batchSize?: number;
  config?: Tolerances;
  /** Called after each batch, for a progress line on a long run. */
  onBatch?: (index: number, total: number, ms: number) => void;
};

/**
 * Send the escalation packets up and gate everything that comes back.
 *
 * The gate runs per batch rather than at the end, so a single malformed reply rejects only
 * its own batch. A whole run failing because one request came back wrong is the kind of
 * all-or-nothing behaviour that makes people stop trusting the tier and turn it off.
 */
export async function adjudicateWithOpenAI(
  packets: Packet[],
  settlements: Settlement[],
  options: AdjudicateOptions = {},
): Promise<AdjudicationRun> {
  const model = options.model ?? DEFAULT_MODEL;
  const config = options.config ?? TOLERANCES;
  const usage = emptyUsage(model);

  if (packets.length === 0) return { adjudicated: [], usage };

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env, or run `bun run recon:agent --dry-run` to exercise the validation gate without a provider.",
    );
  }

  const client = new OpenAI();
  const batches = chunk(packets, options.batchSize ?? 8);
  const adjudicated: Adjudicated[] = [];

  for (const [index, batch] of batches.entries()) {
    const started = performance.now();

    const response = await client.responses.parse({
      model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPromptFor(batch) },
      ],
      text: { format: zodTextFormat(BatchDecisionSchema, "adjudications") },
    });

    const ms = performance.now() - started;
    usage.calls++;
    usage.latenciesMs.push(ms);
    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.cachedInputTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;
    options.onBatch?.(index + 1, batches.length, ms);

    /**
     * `output_parsed` is null when the reply could not be parsed at all. Passing that
     * straight to the gate is correct and intentional: the gate turns it into one
     * `SCHEMA` rejection per item in the batch, which keeps every escalated item in the
     * denominator. A `continue` here would make them disappear.
     */
    adjudicated.push(...gate(batch, response.output_parsed, settlements, config));
  }

  usage.rupees = priceRun(usage);
  return { adjudicated, usage };
}
