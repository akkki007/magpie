import OpenAI from "openai";
import { z } from "zod";

import {
  GetSeriesInput,
  GetVariableInput,
  ProposeChangesInput,
  RunScenarioInput,
  getModelOutline,
  getSeries,
  getVariable,
  groundProposal,
  runScenario,
  type GroundedProposal,
} from "./agent-tools";
import type { Model } from "./types";

/**
 * The run loop's provider (`docs/modelling-plan.md` M5.2).
 *
 * **This is the only file in the module that knows which vendor answers.** Everything that
 * decides whether a proposal is *safe* — grounding, validation, the cycle check — lives in
 * `agent-tools.ts` with no SDK import, exactly the boundary `lib/recon/adjudicate.ts` draws
 * for reconciliation. That boundary already paid for itself once this session, when the plan
 * specified Claude and the keys available were OpenAI's: the swap touched one file.
 *
 * Chat Completions' tool calling, not the Responses API structured-output helper recon
 * uses — this is a multi-turn loop (read, read again, propose), not one shot at one schema.
 */

export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.6";
const MAX_TURNS = 12;

const SYSTEM_PROMPT = `You are an analyst working inside a financial model.

You can read the model's outline, look up a variable, read a series, and try a hypothetical
batch of commands without saving it (runScenario). runScenario shows you what a change *would* do; it makes nothing real. If the user asks you
to propose, create, add, set up, or change anything, you MUST call proposeChanges with the
final batch before you answer — trying it in runScenario is a rehearsal, not the deliverable.
Your final answer must never describe a scenario, variable, or edit as created, added, or
set unless proposeChanges actually returned ok:true earlier in this conversation. If you are
only asked a question with no request to change anything, answer in words and call no write
tool. When asked for "a scenario", create one with CreateScenario rather than overriding the
base case directly — the base case never takes an override, and SetOverride on it is refused.

Ground every reference in what getModelOutline actually returned. Never invent a variable id.
If a variable you need does not exist, create it with InsertVariable in the same batch that
uses it. If the user asked a question that needs no change to the model, answer in words and
call no write tool at all.

Command shapes worth getting right the first time:
- "member" is the empty string "" for an undimensioned variable's total. For a dimensioned
  one it is a member KEY from getModelOutline's dimensions[].members (never the member's
  display name, and never the variable's own name).
- A VALUES override's "cells" is an object keyed by member ("" for the total), where each
  value is an array with one entry per period in the model's horizon — index 0 is the first
  period getModelOutline reported, not a label. Use "null" for a period you are not
  overriding; do not omit it or use a bare array without the member key.
- A SCALE override is a single { kind: "SCALE", factor } — a multiplier on the base input,
  not a value.

If a tool call comes back with an "error" describing a path and expectation, that is the
exact field to fix — do not repeat the same shape a second time.

Keep your final answer short — a sentence or two a finance person would actually read.`;

export type AgentStep =
  | { kind: "tool"; name: string; args: unknown; result: unknown }
  | { kind: "answer"; text: string };

export type AgentResult = {
  steps: AgentStep[];
  answer: string | null;
  proposal: GroundedProposal | null;
};

const READ_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "getModelOutline",
      description: "The model's groups, variables (with printed formulas), dimensions and scenarios. No series values — call getSeries for those. Always call this first.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getVariable",
      description: "Full detail on one variable, by id.",
      parameters: z.toJSONSchema(GetVariableInput),
    },
  },
  {
    type: "function" as const,
    function: {
      name: "getSeries",
      description: "The evaluated monthly series for one variable, optionally under a scenario or a dimension member.",
      parameters: z.toJSONSchema(GetSeriesInput),
    },
  },
  {
    type: "function" as const,
    function: {
      name: "runScenario",
      description: "Try a batch of commands in memory and see what moves, WITHOUT saving anything. Use this to check your arithmetic before proposing.",
      parameters: z.toJSONSchema(RunScenarioInput),
    },
  },
  {
    type: "function" as const,
    function: {
      name: "proposeChanges",
      description: "The one real write. A batch of commands, applied together as one changeset once a human accepts it. Call this at most once.",
      parameters: z.toJSONSchema(ProposeChangesInput),
    },
  },
];

export async function runAgent(model: Model, prompt: string): Promise<AgentResult> {
  const client = new OpenAI();
  const steps: AgentStep[] = [];
  let proposal: GroundedProposal | null = null;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages,
      tools: READ_TOOLS,
      // Once a proposal exists there is nothing left to do — forcing "none" here is what
      // keeps "call this at most once" a guarantee rather than a request the model can
      // ignore on the next turn.
      tool_choice: proposal ? "none" : "auto",
    });

    const message = response.choices[0]?.message;
    if (!message) break;
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      const text = message.content ?? "";
      steps.push({ kind: "answer", text });
      return { steps, answer: text, proposal };
    }

    for (const call of calls) {
      // The SDK's tool-call type is a union with a "custom" (non-function) variant this
      // loop never asks for — every tool above is declared `type: "function"`, so a call
      // that is anything else would be the SDK responding to a request we did not make.
      if (call.type !== "function") continue;

      const args: unknown = safeParseJson(call.function.arguments);
      const result = runTool(model, call.function.name, args);
      // Only a *successful* grounding stops the loop — see the `tool_choice` comment
      // above. A failed attempt is fed back as tool output below so the model can
      // correct a bad id or a bad formula and try again within the turn budget.
      if (call.function.name === "proposeChanges" && isGroundedProposal(result) && result.ok) {
        proposal = result;
      }
      steps.push({ kind: "tool", name: call.function.name, args, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        // Grounding failures go back to the model as tool output, not as an exception —
        // the whole point is giving it a chance to correct a hallucinated id, not ending
        // the run the first time it gets something wrong.
        content: JSON.stringify(result),
      });
    }
  }

  return { steps, answer: null, proposal };
}

function runTool(model: Model, name: string, args: unknown): unknown {
  try {
    switch (name) {
      case "getModelOutline":
        return getModelOutline(model);
      case "getVariable":
        return getVariable(model, GetVariableInput.parse(args));
      case "getSeries":
        return getSeries(model, GetSeriesInput.parse(args));
      case "runScenario":
        return runScenario(model, RunScenarioInput.parse(args));
      case "proposeChanges":
        return groundProposal(model, ProposeChangesInput.parse(args));
      default:
        return { error: `Unknown tool ${name}` };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "That call failed." };
  }
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: "The arguments were not valid JSON." };
  }
}

function isGroundedProposal(value: unknown): value is GroundedProposal {
  return typeof value === "object" && value !== null && "ok" in value;
}
