import { openai } from "@ai-sdk/openai";
import { tool, type ToolSet } from "ai";

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
} from "./agent-tools";
import { db } from "@/lib/db";

import { proposeChangeSet } from "./changesets";
import type { Actor } from "./changesets";
import type { Model } from "./types";

/**
 * The run loop's provider (`docs/modelling-plan.md` M5.2), on the AI SDK.
 *
 * **This is the only file in the module that knows which vendor answers.** Everything that
 * decides whether a proposal is *safe* — grounding, validation, the cycle check — lives in
 * `agent-tools.ts` with no SDK import, exactly the boundary `lib/recon/adjudicate.ts` draws
 * for reconciliation. Rebuilding the transport on the AI SDK (M5's "make the UI more
 * robust" follow-up) touched only this file and the route handler that calls it — the same
 * property that let the plan's original vendor swap (Claude → OpenAI) touch one file.
 *
 * Previously a hand-rolled Chat Completions loop; now `streamText` with real tool-call
 * streaming, so a client using `useChat` sees a tool's input appear as the model writes it
 * rather than only once the call is complete.
 */

export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.6";
export function agentModel() {
  return openai(DEFAULT_MODEL);
}

export const SYSTEM_PROMPT = `You are an analyst working inside a financial model.

You can read the model's outline, look up a variable, read a series, and try a hypothetical
batch of commands without saving it (runScenario). runScenario shows you what a change *would* do; it makes nothing real. If the user asks you
to propose, create, add, set up, or change anything, you MUST call proposeChanges with the
final batch before you answer — trying it in runScenario is a rehearsal, not the deliverable.
Your final answer must never describe a scenario, variable, or edit as created, added, or
set unless proposeChanges actually returned ok:true earlier in this conversation. If you are
only asked a question with no request to change anything, answer in words and call no write
tool. When asked for "a scenario", create one with CreateScenario rather than overriding the
base case directly — the base case never takes an override, and SetOverride on it is refused.

A successful proposeChanges is staged for a human to accept or reject — say what you
proposed, in one sentence, and then stop. You do not know whether it has been accepted yet;
never claim it has been applied.

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

/**
 * The tool set, bound to one loaded model and one actor.
 *
 * Built fresh per request rather than as a module-level singleton (the shape a
 * `ToolLoopAgent` invites): every call is scoped to a specific model's data and a specific
 * signed-in user, and closing over those here is what lets `proposeChanges`'s `execute`
 * write a `ChangeSet` under the right `modelId` and the right actor without threading them
 * through every tool call by hand.
 */
export function buildAgentTools(args: { model: Model; modelId: string; actor: Actor }): ToolSet {
  const { model, modelId, actor } = args;

  return {
    getModelOutline: tool({
      description:
        "The model's groups, variables (with printed formulas), dimensions and scenarios. No series values — call getSeries for those. Always call this first.",
      inputSchema: GetVariableInput.omit({ variableId: true }),
      execute: async () => getModelOutline(model),
    }),

    getVariable: tool({
      description: "Full detail on one variable, by id.",
      inputSchema: GetVariableInput,
      execute: async (input) => getVariable(model, input),
    }),

    getSeries: tool({
      description:
        "The evaluated monthly series for one variable, optionally under a scenario or a dimension member.",
      inputSchema: GetSeriesInput,
      execute: async (input) => getSeries(model, input),
    }),

    runScenario: tool({
      description:
        "Try a batch of commands in memory and see what moves, WITHOUT saving anything. Use this to check your arithmetic before proposing.",
      inputSchema: RunScenarioInput,
      execute: async (input) => runScenario(model, input),
    }),

    /**
     * The one real write — but "real" still means "staged", never "applied" (§1.4).
     *
     * A grounded proposal is persisted as a `ChangeSet` with status `PROPOSED`, exactly
     * what `askAgent` did before the transport moved to `streamText` — that persistence,
     * and the accept/reject actions that resolve it, are untouched by this rewrite.
     */
    proposeChanges: tool({
      description:
        "The one real write. A batch of commands, staged for a human to accept or reject. Call this at most once.",
      inputSchema: ProposeChangesInput,
      execute: async (input) => {
        const grounded = groundProposal(model, input);
        if (!grounded.ok) return grounded;

        const proposalId = crypto.randomUUID();
        await db.$transaction((tx) =>
          proposeChangeSet(tx, {
            id: proposalId,
            modelId,
            label: grounded.label,
            actor,
            commands: grounded.commands,
          }),
        );
        return { ok: true, proposalId, label: grounded.label, commandCount: grounded.commands.length };
      },
    }),
  };
}
