import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import type { Table } from "@/lib/data/types";
import type { Model } from "@/lib/model/types";

import { catalogue, groundTile } from "./ask";
import { TileSpec } from "./spec";

/**
 * The wire schema, flat — and *not* `TileSpec` itself.
 *
 * `TileSpec` is a discriminated union, which is the right shape for storage and for the
 * grounding gate: a chart cannot accidentally carry a `body`, and a text tile cannot carry
 * an aggregation. But a union compiles to `oneOf`, and OpenAI's structured outputs reject
 * that at the root — verbatim: *"Invalid schema for response_format 'response': In
 * context=(), 'oneOf' is not permitted."* Found by the live half of `board:check`, which is
 * exactly the failure a pure test cannot see.
 *
 * So the model fills in one flat object with every field nullable (structured outputs also
 * want every property present rather than optional), and `fold` turns it back into the union
 * before anything else touches it. The accommodation is confined to this file — the vendor's
 * constraint does not get to reshape the type the rest of the module reasons about.
 */
const TileDraft = z.object({
  kind: z.enum(["chart", "kpi", "text"]),
  /** The chart's title, the KPI's label, or the text tile's heading. */
  title: z.string(),
  note: z.string().nullable(),
  /** text only. */
  body: z.string().nullable(),
  /** chart only. */
  form: z.enum(["stacked-bar", "grouped-bar", "line"]).nullable(),
  sourceKind: z.enum(["model", "database"]).nullable(),
  variableIds: z.array(z.string()).nullable(),
  tableSlug: z.string().nullable(),
  dateFieldId: z.string().nullable(),
  valueFieldId: z.string().nullable(),
  aggregation: z.enum(["SUM", "COUNT", "AVG"]).nullable(),
  breakdownFieldId: z.string().nullable(),
});

type TileDraft = z.infer<typeof TileDraft>;

/** Flat draft → the real union, or a message the model can correct from. */
function fold(draft: TileDraft): { ok: true; spec: TileSpec } | { ok: false; error: string } {
  if (draft.kind === "text") {
    if (!draft.body) return { ok: false, error: "A text tile needs a body." };
    const parsed = TileSpec.safeParse({ kind: "text", title: draft.title, body: draft.body });
    return parsed.success
      ? { ok: true, spec: parsed.data }
      : { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }

  if (draft.sourceKind === "model") {
    if (!draft.variableIds?.length) return { ok: false, error: "A model source needs at least one variableId." };
  } else if (draft.sourceKind === "database") {
    if (!draft.tableSlug || !draft.dateFieldId || !draft.aggregation) {
      return { ok: false, error: "A database source needs tableSlug, dateFieldId and aggregation." };
    }
  } else {
    return { ok: false, error: "A chart or KPI needs sourceKind to be \"model\" or \"database\"." };
  }

  const source =
    draft.sourceKind === "model"
      ? { kind: "model" as const, variableIds: draft.variableIds! }
      : {
          kind: "database" as const,
          tableSlug: draft.tableSlug!,
          dateFieldId: draft.dateFieldId!,
          valueFieldId: draft.valueFieldId,
          aggregation: draft.aggregation!,
          breakdownFieldId: draft.breakdownFieldId,
        };

  const candidate =
    draft.kind === "kpi"
      ? { kind: "kpi", label: draft.title, source, note: draft.note ?? undefined }
      : { kind: "chart", title: draft.title, form: draft.form ?? "line", source, note: draft.note ?? undefined };

  const parsed = TileSpec.safeParse(candidate);
  return parsed.success
    ? { ok: true, spec: parsed.data }
    : { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

/**
 * Question → tile (`docs/board-plan.md` feature 1). The only file here that names a vendor.
 *
 * `generateObject`, not a tool-calling loop. The modelling agent needs a loop because it
 * reads, reads again, and then proposes; this reads nothing — the whole catalogue fits in
 * the prompt — and produces exactly one artefact. A loop would be machinery around a single
 * structured answer.
 *
 * The retry is the part that matters. A first attempt routinely invents an id, and a
 * generic failure would leave the user with "something went wrong"; handing the grounding
 * error back verbatim is the same correction channel `agent-tools.ts` gives the modelling
 * agent, and for the same reason — an error a model can act on is worth more than a tidy one.
 */

const ATTEMPTS = 3;

const SYSTEM = `You turn a question about a company's numbers into ONE board tile.

You may only reference ids that appear in the catalogue, copied exactly. Never invent an id,
a table slug, or a field id. If the catalogue cannot answer the question, say so by
returning a "text" tile that explains what is missing — do not approximate with the wrong
data.

Choosing the form is most of the job:

- "kpi" when the answer is a single number — "what is our ARR", "how many customers".
  A KPI shows the latest period against the one before it. One series only.
- "chart" with form "line" for a trend over time in one unit.
- "chart" with form "stacked-bar" ONLY when the parts genuinely sum to a meaningful whole
  (pipeline by stage sums to total pipeline; revenue and margin do not sum to anything).
- "chart" with form "grouped-bar" to compare categories side by side.
- "text" when the honest answer is words, or when the data cannot support a chart.

Rules that are not negotiable:
- Never put two different units on one chart. Percentages and currency need separate tiles.
- A breakdown must be a SELECT or TEXT column, and the date column must be a DATE column.
- Aggregation COUNT needs no value column; SUM and AVG need a NUMBER or CURRENCY one.
- Prefer the model's variables when the question is about the plan, and a database table
  when it is about records (customers, deals, invoices).

Fill every field. Use null for the ones that do not apply — a "text" tile has a null form
and null source fields; a "kpi" or "chart" has a null body; COUNT has a null valueFieldId.
"title" is the chart's title or the KPI's label.

Title the tile the way an analyst would head a slide: what it shows, not what was asked.
The note is one sentence on what the reader should take from it, or null.`;

export type AskResult = { ok: true; spec: TileSpec } | { ok: false; error: string };

export function boardModel() {
  return openai(process.env.OPENAI_MODEL ?? "gpt-5.6");
}

export async function askForTile(
  question: string,
  model: Model,
  tables: Table[],
): Promise<AskResult> {
  const context = JSON.stringify(catalogue(model, tables));
  let correction: string | null = null;
  let lastError = "The model could not produce a tile for that question.";

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let draft: TileDraft;
    try {
      const result = await generateObject({
        model: boardModel(),
        schema: TileDraft,
        system: SYSTEM,
        prompt: [
          `Catalogue:\n${context}`,
          `Question: ${question}`,
          correction ? `Your previous answer was rejected: ${correction}\nFix exactly that.` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      draft = result.object;
    } catch (error) {
      // A schema violation is not a crash — it is another thing to correct, and the last
      // attempt's message is what the user finally sees.
      lastError = error instanceof Error ? error.message : String(error);
      correction = lastError;
      continue;
    }

    const folded = fold(draft);
    if (!folded.ok) {
      lastError = folded.error;
      correction = folded.error;
      continue;
    }

    const grounded = groundTile(folded.spec, model, tables);
    if (grounded.ok) return { ok: true, spec: grounded.spec };

    lastError = grounded.error;
    correction = grounded.error;
  }

  return { ok: false, error: lastError };
}
