import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import type { Table } from "@/lib/data/types";
import type { Model } from "@/lib/model/types";

/**
 * The planning pass (`docs/agents-plan.md` A4).
 *
 * **Why a separate deterministic call rather than trusting `write_todos`.** The agent has
 * that tool and is told, emphatically, to call it first. It sometimes does. Watching a live
 * run poll-by-poll, the plan stayed empty for the entire run and was still empty at the end
 * — the same lesson the rejection loop taught: an instruction in a prompt is a request, not
 * a guarantee, and the progress bar cannot be a request.
 *
 * So the plan is produced *before* the agent starts, by one structured call, and written to
 * the run immediately. Two things follow:
 *
 * 1. A run has a visible plan within a second or two of being spawned, always. There is no
 *    state where the UI has nothing to show and has to guess whether that means "thinking"
 *    or "ignored the instruction".
 * 2. The agent is then *seeded* with that list as its `todos` state, so `write_todos`
 *    becomes an update to something that already exists rather than a creation from nothing
 *    — a far easier instruction to follow, and the tick marks are its own honest reporting
 *    rather than progress we invented for it.
 *
 * `generateObject` on the AI SDK, not LangChain, purely because the board module already
 * proved that path in this codebase — including the `oneOf` constraint that makes a flat
 * schema necessary.
 */

const PlanShape = z.object({
  title: z.string().describe("A short name for this piece of work, as a person would head a memo"),
  description: z.string().describe("One or two sentences on what will be done and why"),
  tasks: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe("Concrete steps, each naming what will actually be done"),
});

export type Plan = { title: string; description: string; tasks: string[] };

const SYSTEM = `You break a finance-operations task into a short plan.

The work will be done by an agent with two specialists it can ask:
- a **model analyst** that reads the financial plan — variables, formulas, forecast series
- a **data analyst** that reads database tables — actual records, rolled up into periods

It can also propose changes to the model, create a database table, and put tiles on a board,
each of which needs a human's approval.

**What it cannot do, so never plan it:** add rows to a table (tables are created empty and
filled by people or by a CSV import), fetch anything from outside this workspace, email or
message anyone, or apply a change itself — approving is a person's job. A plan whose last
step is "populate the table with initial data" is a plan that ends in failure.

Write 3 to 5 tasks. Each one must name a concrete action rather than a posture — say which
thing will be read or built, not "analyse the situation". Order them so each depends only on
what came before.

**Plan the task you were given, and nothing else.** If it asks for something to be built,
most of the plan is building it: designing the thing, then proposing it. Do not prepend an
investigation nobody asked for. If it asks a question, the plan is reading what is needed and
answering. A plan that wanders into the model's forecast because the word "revenue" appeared
is a plan that wastes the run.

The title is a heading for the work in front of you — three or four words naming *this*
task's subject, taken from the task itself. Never reuse a title from another task.`;

/**
 * Falls back to a single task rather than failing the run.
 *
 * A planner outage should not cost the answer. The agent works fine without a good plan —
 * the plan is how a human follows along, so degrading it to one line is the right failure.
 */
export async function makePlan(task: string, model: Model, tables: Table[]): Promise<Plan> {
  try {
    const { object } = await generateObject({
      model: openai(process.env.OPENAI_MODEL ?? "gpt-5.6"),
      schema: PlanShape,
      system: SYSTEM,
      // The task goes last and is labelled as the thing to plan. An earlier version put the
      // catalogue last and included an example title in the system prompt — the model copied
      // that example verbatim onto an unrelated task ("Onboarding vs Forecast" for a
      // marketing-spend table), which is the classic failure of putting a concrete sample
      // where a shape was meant.
      prompt: [
        "Context you may draw on (do not plan around it unless the task needs it):",
        `  Model: ${model.name} — ${model.periods[0]?.label} to ${model.periods.at(-1)?.label}`,
        `  Variables: ${model.variables.map((v) => v.name).slice(0, 40).join(", ")}`,
        `  Tables: ${tables.map((t) => `${t.name} (${t.rows.length} rows)`).join(", ") || "none"}`,
        "",
        `Plan this task, and only this task:`,
        task,
      ].join("\n"),
    });

    return object;
  } catch {
    return {
      title: task.length > 60 ? `${task.slice(0, 60)}…` : task,
      description: "Planning the work up front failed, so the agent is working from the task directly.",
      tasks: [task],
    };
  }
}
