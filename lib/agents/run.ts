import type { Prisma } from "@/lib/generated/prisma/client";
import { Command } from "@langchain/langgraph";

import { listTables, readTable } from "@/lib/data/persist";
import type { Table } from "@/lib/data/types";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/model/changesets";
import { readModel } from "@/lib/model/persist";

import { createFinanceOpsAgent } from "./finance-ops";
import { makePlan } from "./planner";
import { recordProposed, settle, show, type Artifact, type Naming } from "./artifacts";
import type { Mode } from "./modes";
import { renderFinding, type Finding, type Observer } from "./observe";
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
 *
 * **The stream is not the whole story, though.** The supervisor holds no read tools, so every
 * read happens inside a subagent — which deep agents run as a separate graph invocation
 * inside the `task` tool, whose messages never reach the root state. Watching only the
 * stream, a run showed "asked the data-analyst", then nothing at all for a minute, then a
 * paragraph of conclusions. The tools report themselves through an `Observer` instead
 * (`lib/agents/observe.ts`), which is what makes both the trail and the canvas show the
 * work rather than the gaps between it.
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

/** Frequent and mostly unchanged; writing every snapshot would be a write per token. */
const WRITE_EVERY_MS = 500;

/**
 * How often progress is pushed while the graph is busy.
 *
 * A ticker rather than only writing when a snapshot arrives, because the root graph emits
 * *nothing* while a subagent runs — and a subagent is where a run spends most of its time.
 * Flushing only on snapshots meant the canvas froze for the whole of every delegation and
 * then jumped. This is what makes it live.
 */
const TICK_MS = 600;

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

  /* Declining settles only the cards for the tools that were actually declined. */
  let carriedArtifacts = artifactsOf(run);
  if (decision.type === "reject") {
    for (const action of pending) carriedArtifacts = settle(carriedArtifacts, "declined", { tool: action.name });
  }

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
    artifacts: carriedArtifacts,
    mode: (run.mode as Mode) ?? "do",
  });
}

const steps = (run: { steps: unknown }) => ((run.steps as Step[] | null) ?? []);

const artifactsOf = (run: { artifacts: unknown }) => ((run.artifacts as Artifact[] | null) ?? []);

/** The model and tables a run reads. Loaded twice per run — once to plan, once to work. */
async function loadContext() {
  const [model, summaries] = await Promise.all([readModel(db, MODEL_SLUG), listTables(db)]);
  const tables = (await Promise.all(summaries.map((s) => readTable(db, s.slug)))).filter(
    (t): t is Table => t !== null,
  );
  const modelRow = await db.model.findUnique({ where: { slug: MODEL_SLUG }, select: { id: true } });
  if (!model || !modelRow) return null;
  return { model, modelId: modelRow.id, tables };
}

export async function executeRun(runId: string, task: string, actor: Actor, mode: Mode = "do"): Promise<void> {
  const context = await loadContext();
  if (!context) {
    await fail(runId, "No model is seeded — run `bun run seed`.");
    return;
  }

  /**
   * Plan first, and write it down before the agent starts.
   *
   * This is what makes progress visible from the first second. The alternative — ask the
   * agent to plan and read whatever it wrote — was tried and produced runs whose plan was
   * empty from start to finish, which on screen is indistinguishable from a hang.
   */
  await db.agentRun.update({
    where: { id: runId },
    data: { activity: "Working out a plan" },
  });

  const plan = await makePlan(task, context.model, context.tables);
  const todos: Todo[] = plan.tasks.map((content, index) => ({
    content,
    // The first task starts in progress, because it does: the agent begins work the moment
    // this returns. Leaving everything pending would under-report by one step forever.
    status: index === 0 ? "in_progress" : "pending",
  }));

  await db.agentRun.update({
    where: { id: runId },
    data: {
      plan: asJson(todos),
      planTitle: plan.title,
      planNote: plan.description,
      activity: "Starting",
    },
  });

  await drive(
    runId,
    // The plan is seeded into the agent's own `todos` state, so `write_todos` becomes an
    // *update* to a list that already exists rather than a creation from nothing — a much
    // easier instruction to follow, and the ticks stay its own honest reporting.
    { messages: [{ role: "user", content: task }], todos },
    actor,
    { steps: [], todos, files: {}, declined: [], artifacts: [], mode },
  );
}

type Carry = {
  steps: Step[];
  todos: Todo[];
  files: Record<string, unknown>;
  declined: string[];
  artifacts: Artifact[];
  mode: Mode;
};

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
 * What to show as the live activity line.
 *
 * The step trail is a record; this is the one sentence that answers "what is happening right
 * now", which is the question someone staring at a running job actually has. Derived from
 * the newest step rather than announced by the agent, so it cannot drift from what is
 * really executing.
 */
const ACTIVITY: Record<string, string> = {
  write_todos: "Updating the plan",
  write_file: "Writing up findings",
  read_file: "Re-reading its notes",
  calculate: "Doing the arithmetic",
  getModelOutline: "Reading the model outline",
  getVariable: "Looking up a variable",
  getSeries: "Reading a series",
  runScenario: "Testing a scenario",
  listTables: "Listing the tables",
  sampleTable: "Sampling a table",
  aggregateTable: "Rolling records into periods",
  listBoards: "Looking at the boards",
  createTable: "Designing a table",
  proposeModelChanges: "Preparing a proposal",
  addBoardTile: "Preparing a board tile",
};

/**
 * Advance the plan pointer on milestones the agent actually reached.
 *
 * The agent has `write_todos` and its list is seeded, so it *can* tick items off — and
 * sometimes does. It cannot be relied on: a short run marked task one in progress and never
 * touched the list again, which on screen is a plan frozen at 1 of 4 while the trail plainly
 * shows work happening.
 *
 * So the pointer also follows **milestones**: a subagent returning, or a write being
 * prepared. Those are real, they are the natural boundaries between plan items, and they
 * only ever move forwards. Monotonic on purpose — progress that can go backwards is worse
 * than progress that is approximate, and this never claims more than the agent has done.
 *
 * The agent's own ticks still win where they exist; this only fills in the ones it left
 * behind.
 */
function advance(todos: Todo[], steps: Step[]): Todo[] {
  const milestones = steps.filter(
    (step) =>
      step.kind === "subagent" ||
      // A write counts once — when it is put to a person. Its later "created" step is the
      // same milestone reached, and counting both would tick two plan items for one act.
      (step.detail === "waiting for approval" &&
        WRITE_TOOLS.includes(step.name as (typeof WRITE_TOOLS)[number])),
  ).length;

  const reported = todos.filter((t) => t.status === "completed").length;
  const reached = Math.min(Math.max(reported, milestones), todos.length);

  return todos.map((todo, index) => {
    if (todo.status === "completed") return todo;
    if (index < reached) return { ...todo, status: "completed" as const };
    if (index === reached) return { ...todo, status: "in_progress" as const };
    return { ...todo, status: "pending" as const };
  });
}

function activityOf(step: Step | undefined): string {
  if (!step) return "Working";
  if (step.kind === "subagent") return `Asking the ${step.name}`;
  if (step.kind === "message") return "Writing the answer";
  return ACTIVITY[step.name] ?? `Running ${step.name}`;
}

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
  const context = await loadContext();
  if (!context) {
    await fail(runId, "No model is seeded — run `bun run seed`.");
    return;
  }

  const config = { configurable: { thread_id: runId }, recursionLimit: 60 };

  const steps = carry.steps;
  const declined = carry.declined;
  let artifacts = carry.artifacts;
  let todos = carry.todos;
  let files = carry.files;
  let seenMessages = 0;
  let lastWrite = 0;
  let autoRejects = 0;
  let dirty = false;
  let writing = false;
  let closed = false;
  let finding: Finding | null = null;
  let input: unknown = firstInput;

  /**
   * What the tools report into.
   *
   * Every tool call lands here — including the ones inside subagents, which the message
   * stream cannot see. That is the difference between a trail that reads "asked the
   * data-analyst" and one that reads "sampled 5 of 173 rows in Customers · rolled them into
   * periods · summed 6 values → 32".
   */
  const observer: Observer = {
    ran(name, detail) {
      steps.push({ at: new Date().toISOString(), kind: "tool", name, detail });
      dirty = true;
    },
    show(key, card) {
      artifacts = show(artifacts, key, card);
      dirty = true;
    },
    settled(name, status, detail) {
      const outcome =
        status === "created" ? (detail?.note ?? "done") : `refused: ${detail?.note ?? "rejected"}`;

      /**
       * The *same* step, updated — not a second one.
       *
       * A write already has a line in the trail from the moment it was put to a person, so
       * pushing its outcome as well gave every approved write two entries: "Asked to create
       * a table" followed by "Created the table". One act, two lines, and the second read
       * like a second attempt.
       */
      const asked = [...steps].reverse().find((step) => step.name === name && step.detail === "waiting for approval");
      if (asked) asked.detail = outcome;
      else steps.push({ at: new Date().toISOString(), kind: "tool", name, detail: outcome });

      artifacts = settle(artifacts, status, { tool: name, slug: detail?.slug });
      dirty = true;
    },
    finding(submitted) {
      finding = submitted;
      steps.push({ at: new Date().toISOString(), kind: "message", name: "finding", detail: submitted.answer });
      dirty = true;
    },
  };

  const agent = await createFinanceOpsAgent({ ...context, actor, observe: observer }, carry.mode);

  /** Ids and period indices are the wrong thing to show someone deciding on a change. */
  const naming: Naming = {
    variable: (id) => context.model.variables.find((v) => v.id === id)?.name ?? id,
    period: (index) => context.model.periods[index]?.label ?? `period ${index}`,
    scenario: (id) => context.model.scenarios.find((sc) => sc.id === id)?.name ?? id,
  };

  const flush = async (force = false) => {
    const now = Date.now();
    if (closed) return;
    if (!force && (!dirty || now - lastWrite < WRITE_EVERY_MS)) return;
    if (writing) return;

    writing = true;
    dirty = false;
    lastWrite = now;
    try {
      await db.agentRun.update({
        where: { id: runId },
        data: {
          plan: asJson(advance(todos, steps)),
          steps: asJson(steps),
          files: asJson(files),
          artifacts: asJson(artifacts),
          activity: activityOf(steps.at(-1)),
        },
      });
    } finally {
      writing = false;
    }
  };

  /* Progress is pushed on a clock, not only when the graph speaks — see TICK_MS. */
  const ticker = setInterval(() => void flush().catch(() => {}), TICK_MS);
  /** Stops the ticker before a terminal write, so nothing races DONE back to "running". */
  const close = () => {
    closed = true;
    clearInterval(ticker);
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

        /**
         * Every snapshot counts as a change.
         *
         * `dirty` exists so the *ticker* does not write an identical row every 600ms through
         * a quiet stretch. A snapshot is not a quiet stretch — the graph only emits one when
         * something moved — and gating on the observer alone was wrong: a plan updating or a
         * message arriving sets neither, so the todo list would have frozen mid-run while
         * the tool trail kept moving.
         */
        dirty = true;
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
        close();
        for (const step of steps) {
          if (step.detail === "waiting for approval") step.detail = "approved";
        }

        await db.agentRun.update({
          where: { id: runId },
          data: {
            status: "DONE",
            activity: null,
            // Every task complete: a finished run still showing pending work reads as
            // abandoned, and the run did in fact finish.
            plan: asJson(todos.map((todo) => ({ ...todo, status: "completed" as const }))),
            steps: asJson(steps),
            files: asJson(files),
            artifacts: asJson(artifacts),
            pending: asJson([]),
            declined: asJson(declined),
            /**
             * The submitted finding, when there is one.
             *
             * `finalText` — the last thing the model happened to say — is the fallback, not
             * the plan. A run that reports through a schema cannot pad, cannot list 24
             * periods, and cannot lead with its workings; one that reports through whatever
             * its last message contained did all three.
             */
            result: finding ? renderFinding(finding) : finalText(snapshot.values ?? {}),
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
        close();
        for (const step of steps) {
          if (step.detail === "waiting for approval") step.detail = "declined";
        }
        await db.agentRun.update({
          where: { id: runId },
          data: {
            status: "DONE",
            plan: asJson(advance(todos, steps)),
            steps: asJson(steps),
            files: asJson(files),
            pending: asJson([]),
            declined: asJson(declined),
            activity: null,
            result:
              "Stopped: the agent kept asking to make a change that was already declined, so the run was ended. Nothing was written.",
            finishedAt: new Date(),
          },
        });
        return;
      }

      /**
       * A genuinely new write. Record the artifact *before* asking, so the canvas has the
       * card whatever the person decides — and so it survives the approval that clears
       * `pending`.
       */
      close();
      artifacts = recordProposed(artifacts, pending, signature, naming);

      /* Mark the step and hand it to a human. */
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
          activity: null,
          plan: asJson(advance(todos, steps)),
          steps: asJson(steps),
          files: asJson(files),
          artifacts: asJson(artifacts),
          pending: asJson(pending),
          declined: asJson(declined),
          result: describeInterrupt(interrupts),
        },
      });
      return;
    }
  } catch (error) {
    await flush(true).catch(() => {});
    close();
    await fail(runId, error instanceof Error ? error.message : String(error));
  } finally {
    close();
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
    data: { status: "FAILED", error, activity: null, finishedAt: new Date() },
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
  tool_call_id?: string;
  _getType?: () => string;
  content?: unknown;
  name?: string;
  tool_calls?: { name?: string; args?: unknown }[];
};

/**
 * The two things only the message stream knows.
 *
 * Everything a *tool* did now arrives through the observer, including the tools inside
 * subagents that this stream never sees. What is left is the supervisor's own behaviour:
 * which subagent it delegated to, and what it wrote in prose. Tool calls are deliberately
 * not read here any more — they were the same events the observer reports, arriving twice.
 */
function stepsFrom(message: unknown): Step[] {
  const m = message as LooseMessage;
  const at = new Date().toISOString();
  const type = m.getType?.() ?? m._getType?.() ?? "";
  if (type === "tool") return [];

  const out: Step[] = [];

  for (const call of m.tool_calls ?? []) {
    // `task` is how a deep agent delegates; naming the subagent reads better than the tool.
    if (call.name !== "task") continue;
    const target =
      call.args && typeof call.args === "object"
        ? String((call.args as { subagent_type?: string }).subagent_type ?? "subagent")
        : "subagent";
    out.push({ at, kind: "subagent", name: target });
  }

  if (type === "ai" && out.length === 0 && (m.tool_calls?.length ?? 0) === 0) {
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
