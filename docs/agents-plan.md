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


## 7. The run screen

Two panes, because the work and the conversation about the work are different things.

**Left — the canvas.** What the run built, rendered as the thing itself: a table the agent
is designing appears as a grid with its real columns and types *before* anyone approves it.
That is the point — you approve by looking at the artefact, not by reading a sentence about
it. Derived from the run's own steps and pending action rather than stored separately, so
there is nothing that can disagree with what the agent actually did.

**Right — the conversation.** Live activity line, the plan card, the approval gate when one
is open, the finding rendered as markdown, then the trail. Polling at 900ms, not streaming:
progress here changes at the granularity of a todo flipping or a subagent returning, which
is seconds apart, not tokens apart.

### 7.1 Live progress is not asked for, it is produced

Three mechanisms, because the obvious one does not work on its own:

1. **The plan is generated before the run starts** (`lib/agents/planner.ts`), by one
   structured call, and written down immediately. The alternative was tried: the agent has
   `write_todos`, is told emphatically to use it first, and produced runs whose plan was
   empty from the first poll to the last — which on screen is indistinguishable from a hang.
   The plan is then *seeded* as the agent's `todos` state, so its own ticks become an update
   to a list that exists rather than a creation from nothing.
2. **The pointer advances on milestones** — a subagent returning, a write being prepared.
   Monotonic, and the agent's own ticks win where it bothers to make them. Progress that can
   go backwards is worse than progress that is approximate.
3. **An activity line derived from the newest step**, so "what is it doing right now" is
   answered from what is really executing rather than from anything the agent announced.

### 7.2 Modes gate tools

Ask · Plan · Do. `ask` and `plan` hold **no write tools at all**, so the difference is real
rather than a rephrased instruction — a mode selector that only changes the prompt is a
promise the graph does not keep.

That was necessary but not sufficient. In `ask` mode, with no write tools, the agent was
asked to create a table, wrote a *file* describing one, and reported **"I have successfully
created a database table"**. The gate held perfectly; the sentence lied, which is worse than
a refusal because a person reads the sentence and not the database. Both read-only modes now
carry an explicit "you did not do it" clause, and `ops:check` asserts the claim never
appears — the same failure the modelling agent had when it narrated a scenario it never
proposed.

### 7.3 Two planner bugs worth remembering

- **It copied the example title out of its own system prompt.** The prompt said the title
  should read like `"Onboarding vs Forecast", not "Task"` — so a marketing-spend task got the
  title "Onboarding vs Forecast". A concrete sample where a shape was meant.
- **It planned work no tool can do**, ending with "populate the table with initial data".
  The prompt now states what the agent cannot do as explicitly as what it can.


## 8. Two holes the first long run found

A deliberately demanding task — reconcile the 2026 new-accounts plan against the Customers
table, then propose a corrected forecast — exercised the whole architecture in one run:
`write_todos → model-analyst → write_file → data-analyst → write_file → calculate ×8 →
write_file → proposeModelChanges`, halting at the gate. It also found two real bugs, neither
of which a short run would have reached.

**1. `z.array(z.any())` let a non-command reach the approval screen.** The proposal tool's
schema accepted anything, and the run produced `{"setVariable": {"id":
"new_accounts_jul_2026", "value": 2}}` — not a command, naming a variable that does not
exist. Because `interruptOn` halts *before* the tool body, grounding never got to see it:
the person would have been shown that as the thing to approve, said yes, and only then would
it have been refused. The tool now takes the real `CommandSchema`, so a malformed batch fails
at the model boundary and gets corrected before any human is involved.

**2. `member` was never checked against the variable's dimension.** With the schema fixed the
next run produced a well-formed `SetInput` — carrying `member: "2026-07"`. `New Accounts` is
dimensioned by plan (starter/growth/enterprise), so that key belongs to no member, and
grounding accepted it. Approving would have written an input invisible in the grid, absent
from every rollup, and still sitting in `variable_input`. **Data that exists and cannot be
seen is worse than a rejected proposal.**

The agent had confused the member axis with the period axis, which is an easy mistake from
outside the model and exactly what grounding is for. `groundProposal` now checks the member
against the variable's dimension, requires `TOTAL` on an undimensioned row, and rejects a
period past the horizon — with an error that names the real members. Pinned in
`agent:check`, since the bug lives in the modelling module rather than here.


## 9. The canvas card has to outlive the decision

The first version derived the canvas from `run.pending`. That is correct right up until the
moment it matters: `pending` is cleared on approval, so the table card appeared *while*
permission was being asked and vanished the instant it was granted — the one point at which
a person most wants to look at what they just allowed. Reported from the screen, not caught
by a test, because every assertion was about the halted state.

Artifacts are now a durable column on the run, appended when a write is proposed and updated
in place afterwards. Four states, and the distinction between the last two is deliberate:

| | |
|---|---|
| `proposed` | halted, waiting for a person |
| `created` | the tool ran and returned success |
| `declined` | a person said no |
| `failed` | a person said yes and the tool refused it — grounding caught something |

`created` is set from the **tool's own result**, not from the approval, so a card marked
created means the write actually landed rather than that someone permitted it. A created
table carries its slug and the card links to the real thing. Collapsing `failed` into
`declined` would blame the wrong party.
