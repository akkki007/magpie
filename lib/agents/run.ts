import type { Prisma } from "@/lib/generated/prisma/client";
import { Command } from "@langchain/langgraph";

import { listTables, readTable } from "@/lib/data/persist";
import type { Table } from "@/lib/data/types";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/model/changesets";
import { readModel } from "@/lib/model/persist";

import { createFinanceOpsAgent } from "./finance-ops";
import { WRITE_TOOLS } from "./tools";

/**
 * Executing a finance-ops run (`docs/agents-plan.md` A4).
 *
 * **Progress is persisted as it happens, not at the end.** A run whose plan and steps only
 * land on completion is a spinner with extra steps — and a crashed run leaves nothing to
 * read, which is the case you most want a record of. So this streams state snapshots and
 * writes each one through.
 *
 * `.stream({ streamMode: "values" })` rather than the v3 projection API: the projections are
 * marked experimental in the package's own types ("its API may change in future releases"),
 * and everything needed here — the todo list, the filesystem, the message history — is
 * already in the state snapshot. Stable API, same information.
 */

export type Step = {
  at: string;
  kind: "tool" | "subagent" | "message";
  name: string;
  detail?: string;
};

export type Todo = { content: string; status: string };

/**
 * `getState` is inherited from the compiled LangGraph graph, and the generic chain through
 * `createDeepAgent` collapses its return type to `never` at this call site. Narrowed to the
 * two fields actually read rather than fought with generics — the shape is stable LangGraph
 * (`values` and `tasks[].interrupts`) and asserting only what is used keeps the lie small.
 */
type Snapshot = {
  values?: State;
  tasks?: { interrupts?: { value?: unknown }[] }[];
};

/** Prisma's Json columns will not take a bare `Record<string, unknown>`. */
const asJson = (value: unknown) => value as Prisma.InputJsonValue;

/** The model a run reads. One for now, like the board. */
const MODEL_SLUG = "revenue-model-2026";

/** Snapshots are frequent and mostly unchanged; writing every one would be a write per token. */
const WRITE_EVERY_MS = 1200;

type State = {
  messages?: unknown[];
  todos?: Todo[];
  files?: Record<string, unknown>;
};

export async function resumeRun(
  runId: string,
  decision: { type: "approve" } | { type: "reject"; message?: string },
  actor: Actor,
): Promise<void> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "WAITING") return;

  await db.agentRun.update({
    where: { id: runId },
    data: { status: "RUNNING", pending: asJson([]) },
  });

  // One decision per pending action — the middleware pairs them positionally.
  const pending = (run.pending as PendingAction[] | null) ?? [];
  const decisions = pending.length > 0 ? pending.map(() => decision) : [decision];

  const declined = (run.declined as string[] | null) ?? [];
  const carriedSteps = steps(run);

  if (decision.type === "reject") {
    for (const step of carriedSteps) {
      if (step.detail === "waiting for approval") step.detail = "declined";
    }
    // Remembered in the row, because the agent demonstrably does not remember. Told "no",
    // it re-proposed the identical table twice more — a firmer prompt did not change that,
    // so the refusal is enforced here instead of asked for.
    for (const action of pending) {
      const key = signature(action);
      if (!declined.includes(key)) declined.push(key);
    }
  }

  await drive(runId, new Command({ resume: { decisions } }), actor, {
    steps: carriedSteps,
    todos: ((run.plan as Todo[] | null) ?? []),
    files: ((run.files as Record<string, unknown> | null) ?? {}),
    declined,
  });
}

const steps = (run: { steps: unknown }) => ((run.steps as Step[] | null) ?? []);

export async function executeRun(runId: string, task: string, actor: Actor): Promise<void> {
  await drive(runId, { messages: [{ role: "user", content: task }] }, actor, {
    steps: [],
    todos: [],
    files: {},
    declined: [],
  });
}

type Carry = { steps: Step[]; todos: Todo[]; files: Record<string, unknown>; declined: string[] };

/**
 * What a write *is*, for the purpose of "you already asked me that".
 *
 * Tool name plus its arguments, key-order-independent. Two proposals that differ only in
 * how the JSON was serialised are the same proposal, and a signature that said otherwise
 * would let the loop below through on a whitespace change.
 */
function signature(action: PendingAction): string {
  return `${action.name}:${stable(action.args)}`;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * How many times a run may re-ask for something already declined before we stop asking the
 * human and end the run.
 *
 * Two, not zero: the first re-ask might be a genuinely different attempt at the same goal,
 * which is fine. Beyond that it is a loop, and the person has already answered.
 */
const MAX_REDECLINES = 2;

/**
 * One driver for both entry points.
 *
 * Starting a run and resuming a halted one differ only in what is handed to the graph — a
 * message, or a `Command` carrying the human's decision. Everything after that (stream,
 * persist as you go, work out whether it finished or halted again) is identical, and a
 * resume that took a second copy of this logic would be the copy that drifts. A resumed run
 * can halt a *second* time, at the next write, and that has to behave exactly as the first.
 */
async function drive(
  runId: string,
  firstInput: unknown,
  actor: Actor,
  carry: Carry,
): Promise<void> {
  const [model, summaries] = await Promise.all([readModel(db, MODEL_SLUG), listTables(db)]);
  const tables = (await Promise.all(summaries.map((s) => readTable(db, s.slug)))).filter(
    (t): t is Table => t !== null,
  );

  const modelRow = await db.model.findUnique({ where: { slug: MODEL_SLUG }, select: { id: true } });
  if (!model || !modelRow) {
    await fail(runId, "No model is seeded — run `bun run seed`.");
    return;
  }

  const agent = await createFinanceOpsAgent({ model, modelId: modelRow.id, tables, actor });
  const config = { configurable: { thread_id: runId }, recursionLimit: 60 };

  const steps = carry.steps;
  const declined = carry.declined;
  let todos = carry.todos;
  let files = carry.files;
  let seenMessages = 0;
  let lastWrite = 0;
  let autoRejects = 0;
  let input: unknown = firstInput;

  const flush = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < WRITE_EVERY_MS) return;
    lastWrite = now;
    await db.agentRun.update({
      where: { id: runId },
      data: { plan: asJson(todos), steps: asJson(steps), files: asJson(files) },
    });
  };

  try {
    /**
     * A loop, because one pass through the graph is not always one decision.
     *
     * `interruptOn` halts before a write; a human answers; the graph resumes. But an agent
     * told "no" may simply ask again — verified live, twice, and a firmer system prompt did
     * not stop it. So when the thing it is asking for has *already* been declined on this
     * run, this rejects it again without troubling the person, and after
     * MAX_REDECLINES gives up and ends the run. The human's answer is enforced here rather
     * than requested in a prompt.
     */
    for (;;) {
      const stream = await agent.stream(input as Parameters<typeof agent.stream>[0], {
        ...config,
        streamMode: "values",
      });

      for await (const snapshot of stream) {
        const state = snapshot as State;

        if (Array.isArray(state.todos)) todos = state.todos;
        if (state.files && typeof state.files === "object") files = state.files;

        // Only the messages not yet turned into steps — a "values" snapshot carries the
        // whole history every time.
        const messages = Array.isArray(state.messages) ? state.messages : [];
        if (messages.length > seenMessages) {
          const fresh = messages.slice(Math.max(seenMessages, resumeFloor(seenMessages, messages.length)));
          for (const message of fresh) steps.push(...stepsFrom(message));
        }
        seenMessages = messages.length;

        await flush();
      }

      /**
       * A finished stream is not a finished run. With `interruptOn` the graph stops *before*
       * the write tool and the stream simply ends — so the state has to be asked whether
       * anything is pending, or a halted run reports as complete and the write never happens.
       */
      const snapshot = (await agent.getState(config)) as Snapshot;
      const interrupts = snapshot.tasks?.flatMap((t) => t.interrupts ?? []) ?? [];

      if (interrupts.length === 0) {
        for (const step of steps) {
          if (step.detail === "waiting for approval") step.detail = "approved";
        }

        await db.agentRun.update({
          where: { id: runId },
          data: {
            status: "DONE",
            plan: asJson(todos),
            steps: asJson(steps),
            files: asJson(files),
            pending: asJson([]),
            declined: asJson(declined),
            result: finalText(snapshot.values ?? {}),
            finishedAt: new Date(),
          },
        });
        return;
      }

      const pending = pendingActions(interrupts);

      /**
       * Already answered? Answer it the same way, without asking again.
       *
       * Two tiers, because there are two different situations:
       *
       * - **The identical write** (same tool, same arguments) is settled. Asking again is
       *   noise, and this is what the agent actually did when told no in prose.
       * - **A different write through the same tool** is a new decision the first time —
       *   a person who declined one table may well allow another. But after they have
       *   declined that tool twice, they have answered the *category*, and a third variation
       *   is the agent negotiating. So the second decline of a tool closes the tool.
       */
      const declinedNames = declined.map((key) => key.slice(0, key.indexOf(":")));
      const timesDeclined = (name: string) => declinedNames.filter((n) => n === name).length;

      const repeat = pending.every(
        (action) => declined.includes(signature(action)) || timesDeclined(action.name) >= 2,
      );
      if (repeat && pending.length > 0 && autoRejects < MAX_REDECLINES) {
        autoRejects++;
        input = new Command({
          resume: {
            decisions: pending.map(() => ({
              type: "reject" as const,
              message:
                "This was already declined on this run. Do not ask again. Report that it was declined and finish your answer now.",
            })),
          },
        });
        seenMessages = 0;
        continue;
      }

      if (repeat && pending.length > 0) {
        for (const step of steps) {
          if (step.detail === "waiting for approval") step.detail = "declined";
        }
        await db.agentRun.update({
          where: { id: runId },
          data: {
            status: "DONE",
            plan: asJson(todos),
            steps: asJson(steps),
            files: asJson(files),
            pending: asJson([]),
            declined: asJson(declined),
            result:
              "Stopped: the agent kept asking to make a change that was already declined, so the run was ended. Nothing was written.",
            finishedAt: new Date(),
          },
        });
        return;
      }

      /* A genuinely new write. Mark the step and hand it to a human. */
      const halted = pending[0]?.name;
      const last = [...steps].reverse().find((step) => step.name === halted);
      if (last) last.detail = "waiting for approval";
      else if (halted) {
        steps.push({ at: new Date().toISOString(), kind: "tool", name: halted, detail: "waiting for approval" });
      }

      await db.agentRun.update({
        where: { id: runId },
        data: {
          status: "WAITING",
          plan: asJson(todos),
          steps: asJson(steps),
          files: asJson(files),
          pending: asJson(pending),
          declined: asJson(declined),
          result: describeInterrupt(interrupts),
        },
      });
      return;
    }
  } catch (error) {
    await flush(true).catch(() => {});
    await fail(runId, error instanceof Error ? error.message : String(error));
  }
}

/**
 * On the first snapshot of a *resumed* run, the whole prior history arrives at once. Those
 * messages already became steps on the original pass, so replaying them would double the
 * timeline. Everything from the first snapshot of a resume is skipped; only what the graph
 * produces afterwards is new.
 */
function resumeFloor(seen: number, total: number): number {
  return seen === 0 ? total : seen;
}

async function fail(runId: string, error: string) {
  await db.agentRun.update({
    where: { id: runId },
    data: { status: "FAILED", error, finishedAt: new Date() },
  });
}

/* ── Reading LangChain messages without importing its class hierarchy ──────
 *
 * Snapshots carry message *instances*, and their shape differs between an AI message with
 * tool calls, a tool result, and plain text. Narrowed structurally rather than with
 * `instanceof`, because the same run has to be readable when it comes back out of a
 * checkpoint as plain JSON. */

type LooseMessage = {
  getType?: () => string;
  _getType?: () => string;
  content?: unknown;
  name?: string;
  tool_calls?: { name?: string; args?: unknown }[];
};

function stepsFrom(message: unknown): Step[] {
  const m = message as LooseMessage;
  const at = new Date().toISOString();
  const type = m.getType?.() ?? m._getType?.() ?? "";
  const out: Step[] = [];

  for (const call of m.tool_calls ?? []) {
    if (!call.name) continue;
    // `task` is how a deep agent delegates; naming the subagent reads better than the tool.
    const isDelegation = call.name === "task";
    const target =
      isDelegation && call.args && typeof call.args === "object"
        ? String((call.args as { subagent_type?: string }).subagent_type ?? "subagent")
        : call.name;

    out.push({
      at,
      kind: isDelegation ? "subagent" : "tool",
      name: target,
      detail: WRITE_TOOLS.includes(call.name as (typeof WRITE_TOOLS)[number])
        ? "waiting for approval"
        : undefined,
    });
  }

  if (type === "ai" && out.length === 0) {
    const text = textOf(m.content);
    if (text.trim()) out.push({ at, kind: "message", name: "thinking", detail: truncate(text) });
  }

  return out;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "",
      )
      .join("");
  }
  return "";
}

const truncate = (text: string, n = 240) => (text.length > n ? `${text.slice(0, n)}…` : text);

function finalText(state: State): string {
  const messages = Array.isArray(state?.messages) ? state.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as LooseMessage;
    const type = m.getType?.() ?? m._getType?.() ?? "";
    if (type !== "ai") continue;
    const text = textOf(m.content);
    if (text.trim()) return text;
  }
  return "The run finished without a written answer.";
}

/**
 * What the run is waiting on.
 *
 * The interrupt payload is LangChain's `HITLRequest` — `{ actionRequests: [{ name, args,
 * description }], reviewConfigs }`. Worth stating because the first version of this guessed
 * at `value[0].action_request.action`, which is the *Python* library's snake_case shape and
 * silently produced "Paused, waiting for approval" with no tool named.
 */
export type PendingAction = { name: string; args: Record<string, unknown>; description?: string };

export function pendingActions(interrupts: { value?: unknown }[]): PendingAction[] {
  return interrupts.flatMap((interrupt) => {
    const value = interrupt.value as { actionRequests?: PendingAction[] } | undefined;
    return value?.actionRequests ?? [];
  });
}

function describeInterrupt(interrupts: { value?: unknown }[]): string {
  const names = pendingActions(interrupts).map((a) => a.name);
  return names.length > 0
    ? `Paused before ${names.join(", ")} — waiting for your approval.`
    : "Paused, waiting for approval.";
}
