# Magpie — Finance-Ops Agents Plan

> Status: **built**, 3 Sep 2026. The last module before the 5 Sep deadline.

## 0. What this is — and what it is not

Not another chat window. Magpie already has one (`docs/modelling-plan.md` §5): a single-turn
tool loop that is good at *"add a churn variable and set it to 2%"* and wrong for *"work out
why gross margin slipped in Q3 and tell me what to do about it."*

A finance-ops agent is a **spawned worker**. You hand it a task and walk away. It plans, it
delegates, it reads the real model, the real tables and the real boards, and it comes back
with a written finding plus **proposals a human accepts or rejects**. The run is a durable
row you can open later, not a conversation you have to keep.

That is why the unit on screen is a *run*, not a thread.

## 1. Why LangGraph deep agents, and not the loop we already have

The AI SDK loop in `lib/model/openai-agent.ts` stays exactly where it is — it is the right
tool for a one-shot edit next to the grid. This module needs four things it does not have,
and all four are primitives in `deepagents` rather than things to hand-roll:

1. **Planning.** A deep agent maintains a todo list as it works. For a multi-step
   investigation that list *is* the progress bar — the human watching wants to see "read the
   margin waterfall ✓ / check the customer table ✗ / write the finding" and not a spinner.
2. **Subagents.** A specialist gets its own context window. A model-analyst reading 24 months
   of series across nine variables would otherwise fill the supervisor's window with numbers
   the writer never needs. Delegation here is context isolation, not org-chart cosplay.
3. **A filesystem.** Intermediate findings go in files. A long investigation that keeps
   everything in the message history runs out of window and starts forgetting its own
   evidence; a file it can re-read does not.
4. **`interruptOn`.** Human-in-the-loop *at the tool boundary*, as a graph primitive. This is
   the single most important fit: §1.4 of the modelling plan already says **AI changes are
   proposals, not writes**, and today that is upheld by the tool's implementation choosing to
   write a `PROPOSED` changeset. `interruptOn` makes it structural — the graph halts before
   the write and cannot proceed without a human resuming it.

## 2. Shape

```
supervisor (finance-ops)
├── model-analyst    reads the model: outline, variables, series, hypothetical scenarios
├── data-analyst     reads the database: tables, columns, rollups over the horizon
└── report-writer    turns files of findings into a memo and board tiles
```

Every tool wraps a module that **already exists and is already grounded** — `agent-tools.ts`
for the model, `lib/data/rollup.ts` for the tables, `lib/board/ask.ts` for the tiles. No
second path to the data, and no second definition of what a legal proposal is.

**Read tools run freely. Write tools interrupt.** `proposeModelChanges` and `addBoardTile`
are listed in `interruptOn`, so a run that wants to change something stops and waits.

## 3. Data model

```prisma
enum RunStatus { RUNNING WAITING DONE FAILED }

model AgentRun {
  id, actorId, task, status,
  plan   Json    // the agent's todos, as it maintains them
  steps  Json    // tool calls and subagent delegations, in order
  files  Json    // the virtual filesystem it wrote
  result String? // the final answer
  error  String?
  threadId String  // LangGraph thread, so a WAITING run can be resumed
}
```

The run is persisted **as it goes**, not at the end. A run whose progress only lands on
completion is a spinner with extra steps, and a crashed run leaves nothing to read.

## 4. Tasks

| | | Est |
|---|---|---|
| **A1** | `AgentRun` schema + migration | 0.5h |
| **A2** | Tools over the existing grounded modules | 1h |
| **A3** | `createDeepAgent` — supervisor, three subagents, `interruptOn` | 1h |
| **A4** | Run executor: stream events → persist plan/steps/files as they happen | 1.5h |
| **A5** | `/agents` — spawn, run list, run detail with plan + steps + files | 1.5h |
| **A6** | Approvals: a WAITING run shows the pending write and resumes on accept | 1h |
| **A7** | `bun run ops:check` — pure grounding + `--live` | 0.5h |

All built. `ops:check` is 13 assertions pure, 20 with `--live`.

**Cut line between A5 and A6.** If time runs out, a run that *stops* at a write and says so
is honest; a run that writes without asking is the one thing this module must never do. So
A6's resume can be missing, but the interrupt cannot.

## 5. Not building

Scheduled/recurring runs · multi-model routing (one model, as elsewhere) · agent-to-agent
messaging beyond the supervisor's delegation · a sandbox backend (the filesystem is the
in-state one) · streaming the run to the browser token-by-token (the run list polls; the
value here is the finished artefact, not watching it type).


## 6. What the live runs taught, in order

Every one of these was found by running the thing, not by reading it. They are recorded
because each was invisible to types and to the pure tests.

**1. `checkpointer: true` is subgraph-only.** A root graph is told so at runtime —
*"checkpointer: true cannot be used for root graphs"* — and the first run failed in 0s.

**2. The checkpointer's tables must not live in `public`.** `PostgresSaver` creates four
tables of its own; in `public` those are drift Prisma does not recognise, and the next
`prisma migrate dev` offered to **reset the database** — with the seeded model, tables and
boards in it. It now owns a `langgraph` schema and Prisma never sees it.

**3. A supervisor holding every tool never delegates.** Asked how many customers onboarded
in H1 2026, the first working run read the *model's* new-accounts forecast and answered
1,014 — for a question about 173 database records. Fluent, sourced from a real tool call,
and about the wrong thing. The supervisor now holds only the write tools and the calculator,
so delegating is the only way it can learn anything, and it has to choose between "ask the
plan" and "ask the records" — which is exactly the distinction it got wrong.

**4. LLMs cannot be trusted with arithmetic.** The next run read six correct monthly counts
— 6, 4, 5, 5, 6, 6 — and reported the total as 31. It is 32. Nothing hallucinated; it just
added six integers wrong. There is now a `calculate` tool and an instruction never to total
anything by hand, and `ops:check` asserts that exact sum.

**5. The planning tool is not on by default.** `createDeepAgent`'s own docs say "the
*optional* todo middleware adds `todos`", and it ships from `langchain`, not `deepagents`.
Three runs did good work and returned an empty plan — which read as the model ignoring the
prompt, when in fact `write_todos` did not exist. `middleware: [todoListMiddleware()]`.

**6. The interrupt payload is `HITLRequest`, not the Python shape.** The first
`describeInterrupt` read `value[0].action_request.action` — snake_case, from the Python
library — and silently produced "waiting for approval" with no tool named. It is
`{ actionRequests: [{ name, args, description }] }`.

**7. A rejected agent asks again.** Told no, it re-proposed the identical table twice more.
A firmer system prompt did not change that. So the refusal is **enforced in code**: declined
writes are recorded on the run as `name:args` signatures, an identical re-ask is auto-
rejected without troubling the person, and the second decline of a tool closes that tool.
Prompts are not a control surface; the graph is.
