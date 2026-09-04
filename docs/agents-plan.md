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

## 10. The canvas was blind to nine-tenths of the run

Section 9 made the card outlive the decision. It did not fix the larger problem: cards only
existed *at* the decision. A run that read four tables, rolled 157 records into 24 periods
and answered a question built nothing — so the canvas said "nothing built yet" for the whole
minute of work, then flashed a table if the run happened to want one, and went quiet again.
The pane meant to show the work showed the receipt.

**The cause was structural, not cosmetic.** The supervisor holds no read tools — that is
deliberate (§6), and the reason it delegates at all. But deep agents run a subagent as a
separate graph invocation inside the `task` tool, and those messages never reach the root
state. So the run's own `streamMode: "values"` loop could see *only* the supervisor: "asked
the data-analyst", a minute of silence, a paragraph of conclusions. Every read that produced
a number in the answer was invisible to the thing whose job was to display it.

### 10.1 Tools report themselves

`lib/agents/observe.ts`. Each tool is handed an `Observer` when it is built and calls it with
what it just did, plus a card when it read something worth looking at. Two consequences:

- The trail and the canvas show the *subagents'* work. A line now reads `aggregateTable —
  COUNT over Customers · 16 records outside the horizon`, which is checkable, where before
  there was nothing between the delegation and the answer.
- **Nothing is parsed back out of tool output any more.** The previous version scraped the
  new table's slug out of `createTable`'s JSON with a regex, and decided a write had failed
  by matching the first word of its result against `/^(Rejected|No table|A table already…)/`.
  Both made a tool's private prose an API nobody knew they were maintaining. A tool now says
  what happened, because it is the only thing that knows.

Progress is also pushed on a **clock** (`TICK_MS`), not only when the graph speaks. The root
graph emits nothing while a subagent runs, which is where a run spends most of its time, so
flushing on snapshots alone froze the canvas through every delegation and then jumped.

### 10.2 Views and builds

One column, in the order things happened. **Views** (`outline`, `records`, `series`) are
reads: quiet, no status, evicted oldest-first once the canvas is full. **Builds** (`table`,
`proposal`, `tile`) are writes: they carry a status, they are never evicted. A series is
drawn by the board's own `BoardChart` rather than a second chart implementation, and a
proposal is rendered as sentences with real variable and period names — "Set New Accounts ·
Jul 2026 to 2", not `{"variableId":"v_new_accounts","period":6}` — with the raw arguments one
disclosure away, because an approval screen must never *hide* what it is asking about.

`settle()` is scoped to the tool that settled. An interrupt carries `actionRequests` as an
array, so a run can halt on two writes at once, and the first to return would otherwise have
marked the other created too.

### 10.3 A door in the approval gate

Found while wiring the above, and the most serious thing in this document.
`createDeepAgent` **auto-adds a `general-purpose` subagent**, built from the *supervisor's*
tool list — in `do` mode, all three write tools. Subagents do not get the human-in-the-loop
middleware: `interruptOn` applies to the main agent's tool calls, and the subagent middleware
in deepagents 1.13.2 is assembled from filesystem, summarization, patch-tool-calls and skills
with no HITL. A supervisor that delegated "create the table" to general-purpose would have
had it created, with no approval, and reported success. The gate looked airtight from the
outside and had a door in it.

It is suppressed by declaring a subagent of that name ourselves — the factory checks for
exactly that — with no tools and a description that sends the supervisor to the analyst that
can actually answer. `ops:check` now asserts the property rather than the fix: **no subagent
holds a write tool.**

### 10.4 Conciseness, asserted

Asked when customers onboarded, a run answered with a bullet for all 24 months — writing out
in prose the exact chart sitting beside it, and burying the finding in it. The prompt now
says never to list a figure per period, and `ops:check` fails a run whose answer exceeds 200
words or eight bullets. The canvas carries the series; the answer carries the point.

### 10.5 The answer's shape is a schema, not a request

The prompt asked for under 150 words, and said not to list a figure per period because the
chart is drawn beside the answer. Runs did it anyway — one answered "when did they onboard?"
with a bullet for all 24 months, reproducing in prose the exact picture next to it. Another
opened with **"0 customers are recorded"** and three sentences later described onboarding
peaking at 8 in Apr '27: a paragraph arguing with itself.

The zero had a cause worth naming. `aggregateTable` computed the record total and **did not
return it** — it passed back only the per-period series. So an agent asked "how many
customers are there?" had no figure to cite and two ways forward: add up 24 numbers itself
(which it is told not to do) or fill the gap. It filled the gap. The tool now returns
`recordsCounted`, `recordsOutsideHorizon` and `datedRecords`, and `ops:check` asserts the
three add up against the rows.

Asking more firmly was tried and did not hold, so the shape moved into a schema. A run now
finishes by calling **`submitFinding`** — `answer` capped at 320 characters, `evidence` at
four lines of 160, an optional one-sentence `next` — and the run's result is rendered from
that, with the last-message text kept only as a fallback. This is the same move the module
already makes elsewhere: the proposal tool takes the real `CommandSchema` rather than
`z.any()`, for the same reason. A limit a model is asked to respect is a suggestion; a limit
in a schema is refused and retried.

The question above now answers in 62 words and two bullets, with the right number in it.

### 10.6 Assertions that watch, instead of inspecting

Every check in `ops:check` used to read the run row *after* the run finished, and that blind
spot is where both of this section's bugs lived: a canvas and a plan that are correct at the
end and frozen throughout look perfect in the final row. Two of them, one after the other —
progress written only on graph snapshots stalled for the whole of every subagent, and then a
`dirty` gate meant to spare the database a write per tick stopped the plan updating at all
while the tool trail kept moving.

So the read-only run is now **watched while it runs**: `executeRun` is started without being
awaited and the row polled beside it. Two assertions come out of that, and they are the ones
this whole section is for:

- the row reaches at least three distinct states, or "live" is a spinner;
- **at least one card exists before the final step**, because a card that only appears once
  the answer is written is a receipt, not a canvas.

One more test lesson, from a failure that was not a bug: an assertion demanding the run had
used `calculate` failed a correct run. `listTables` reports each table's row count, so "how
many customers" needs no arithmetic — one run summed 24 monthly buckets, another read the
count directly, and both were right. Asserting a route the model is free to choose is a
flaky test dressed as a safety property. It now asserts the checkable thing instead: any
arithmetic that *does* happen is recorded with its answer.
