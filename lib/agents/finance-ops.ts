import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import { todoListMiddleware } from "langchain";

import { buildOpsTools, WRITE_TOOLS, type ToolContext } from "./tools";
import { modeGuidance, toolsFor, type Mode } from "./modes";
import { checkpointer } from "./checkpointer";

/**
 * The finance-ops agent (`docs/agents-plan.md` A3), on LangGraph deep agents.
 *
 * **Why this and not the AI SDK loop next to the grid.** That loop stays where it is — it is
 * right for "add a churn variable and set it to 2%". This module exists for the other kind
 * of request, "work out why gross margin slipped in Q3 and tell me what to do", and needs
 * four things the loop does not have. All four are primitives here rather than machinery to
 * hand-roll:
 *
 * 1. **A plan.** The agent maintains todos as it works, and that list *is* the progress bar.
 *    A multi-step investigation behind a spinner is indistinguishable from a hung one.
 * 2. **Subagents, for context isolation.** A model-analyst reading 24 months across nine
 *    variables would otherwise fill the supervisor's window with numbers the writer never
 *    needs. Delegation here is about whose context holds what, not an org chart.
 * 3. **A filesystem.** Findings go in files. An investigation that keeps every intermediate
 *    in the message history runs out of window and starts forgetting its own evidence.
 * 4. **`interruptOn`.** This is the important one. §1.4 of the modelling plan says AI changes
 *    are proposals, not writes — and today that holds because the tool *chooses* to write a
 *    PROPOSED changeset. Here the graph halts before the write tool runs at all. The
 *    difference matters: one is a convention a future tool can forget, the other is a state
 *    the run cannot leave without a human.
 */

/** Deep agents default to Anthropic; this repo's key is OpenAI's, so the model is explicit. */
export function opsModel() {
  return new ChatOpenAI({ model: process.env.OPENAI_MODEL ?? "gpt-5.6" });
}

const SUPERVISOR_PROMPT = `You are a finance operations analyst inside Magpie, a financial
modelling workspace. You are given a task and you work it to completion on your own.

How to work:

1. **Call write_todos before anything else, always.** Not "if the task seems complex" — every
   run, without exception. Break the task into 3–6 concrete steps, each one naming what you
   will actually do ("Read enterprise ARR and its drivers from the plan", not "Analyse").
   Then call write_todos again each time a step changes state — one in_progress at a time,
   completed the moment it is done. Send the whole list every time; the tool replaces it.
   By your final message every item must be completed, because a finished run still showing
   pending work tells the reader you gave up.

   A person is watching that list to know where the run has got to. A run with no todos looks
   identical to a hung one, and the list is the only progress this interface has.
2. **You cannot read anything yourself.** You have no data tools. Every fact you use comes
   from delegating to a subagent with the task tool, and you must delegate before you answer.

   Choosing between them is the first real decision of any task:
   - **model-analyst** reads the *plan* — the forecast, its variables, its formulas. Ask it
     when the question is about what the business projects or assumes.
   - **data-analyst** reads the *database* — actual records in tables, rolled up into
     periods. Ask it when the question is about what has actually happened: customers,
     deals, invoices, counts of real things.

   "How many customers onboarded in H1?" is a records question and belongs to data-analyst;
   answering it from the model's planned new-accounts line is a wrong answer that will look
   right. When a question could be either, ask both and say which is which.
3. Write findings to files as you go with write_file (findings.md, and whatever else helps).
   Do not carry evidence in your head — you will need to cite it at the end.
4. Finish with a short, direct answer in your final message: what you found, the numbers that
   show it, and what you would do. Lead with the conclusion.

Rules that are not negotiable:

- **Ground every number.** Only cite figures a tool actually returned. Never estimate, never
  fill a gap with a plausible-looking value, and never describe a trend you did not read.
- **Never do arithmetic yourself.** Any total, average or percentage change goes through the
  calculate tool, including "just adding up" six numbers you already have. A run has already
  added 6+4+5+5+6+6 and reported 31.
- **Every id comes from a tool.** Variable ids from getModelOutline, field ids from
  listTables. Never invent one, never guess at one from a name.
- **You can build things, but only through the write tools.** createTable makes a new
  database table with typed columns — reach for it when the task asks to track something
  that has no table yet, and choose the columns a finance team would actually need.
  proposeModelChanges adds or edits variables in the plan. addBoardTile puts a chart on a
  board. Each one stops for a person's approval before it runs, so say what you are going to
  do and then do it; do not ask permission in prose first.
- **You do not change anything silently.** proposeModelChanges and addBoardTile stage work for a human
  to accept or reject, and a person has to approve each one before it even runs. Never say a
  change has been made, applied, or added — say you have proposed it.
- **A rejection is final.** If a person rejects one of your writes, do not call that tool
  again with the same arguments, and do not try to get the same change through another way.
  Say what you were going to do, say it was declined, and stop. Re-proposing something a
  human just refused is the fastest way to make an agent untrustworthy — and the person is
  not obliged to explain themselves.
- If the data cannot answer the question, say so plainly and say what is missing. An honest
  "the tables do not carry cost data, so margin cannot be decomposed" is worth more than a
  confident answer built on the wrong column.`;

const MODEL_ANALYST_PROMPT = `You read the financial model and report back.

Use getModelOutline first, then getVariable and getSeries for the specific rows you need.
runScenario lets you test a hypothetical in memory — it changes nothing.

Use calculate for every total, average and change — never add numbers up yourself.

Report the numbers you actually read, with the periods they came from. If a variable does not
exist, say so rather than substituting the nearest name; the difference between "Gross Churn
Rate" and "Churn Rate" has already caused one wrong answer in this codebase.`;

const DATA_ANALYST_PROMPT = `You read the database tables and report back.

listTables gives you the tables and their column ids. sampleTable shows you what the rows
look like. aggregateTable is how you turn records into a series over the model's periods —
COUNT of records, or SUM/AVG of a numeric column, optionally split by a SELECT column.

Use calculate for every total, average and change — never add numbers up yourself.

Records outside the model's horizon are reported to you separately. Say so when it matters: a
total that looks low is usually history the model does not span, and that is an answer, not
an error.`;

const WRITER_PROMPT = `You turn findings into something a person reads.

You are given files of evidence. Write a short memo: the conclusion first, then the numbers
that support it, then what to do. No preamble, no restating the question.

Cite only figures that appear in the files you were given. If the evidence does not support a
claim, drop the claim.`;

export async function createFinanceOpsAgent(ctx: ToolContext, mode: Mode = "do") {
  const tools = buildOpsTools(ctx);
  const byName = (names: readonly string[]) => tools.filter((t) => names.includes(t.name));

  /**
   * **The supervisor gets the write tools and nothing else.**
   *
   * The first version handed it every tool, and the first live run showed exactly why that
   * is wrong: asked how many customers onboarded in H1 2026, it never planned and never
   * delegated — it called `getSeries` on the *model's* new-accounts variable and answered
   * 1,014 from a plan, for a question about 173 database records. Fluent, sourced from a
   * real tool call, and about the wrong thing entirely.
   *
   * A supervisor holding every tool has no reason to delegate, so the subagents were
   * decoration. Withholding the read tools makes delegation the only way to learn anything,
   * which is what actually buys the context isolation the architecture is for — and it
   * forces the supervisor to *choose* between "ask the plan" and "ask the records", which is
   * the distinction it got wrong.
   */
  return createDeepAgent({
    model: opsModel(),
    systemPrompt: `${SUPERVISOR_PROMPT}\n\n${modeGuidance(mode)}`,
    // The mode decides which writes exist at all — see `lib/agents/modes.ts`. In `ask`
    // and `plan` this list is just the calculator.
    tools: byName([...toolsFor(mode, WRITE_TOOLS), "calculate"]),
    subagents: [
      {
        name: "model-analyst",
        description:
          "Reads the financial model — variables, formulas, series over the horizon, and hypothetical scenarios. Ask it narrow questions about the plan's numbers.",
        systemPrompt: MODEL_ANALYST_PROMPT,
        tools: byName(["getModelOutline", "getVariable", "getSeries", "runScenario", "calculate"]),
      },
      {
        name: "data-analyst",
        description:
          "Reads the database tables — columns, sample rows, and rollups of records into the model's periods. Ask it questions about records rather than about the plan.",
        systemPrompt: DATA_ANALYST_PROMPT,
        tools: byName(["listTables", "sampleTable", "aggregateTable", "calculate"]),
      },
      {
        name: "report-writer",
        description:
          "Turns files of findings into a short memo. Give it the file names and the question that was asked.",
        systemPrompt: WRITER_PROMPT,
        tools: [],
      },
    ],
    /**
     * The planning tool, added explicitly.
     *
     * It is *not* on by default — `createDeepAgent`'s own docs say "the **optional** todo
     * middleware adds `todos`", and it ships from `langchain` rather than `deepagents`.
     * Without it the agent has no `write_todos` tool at all, so a system prompt ordering it
     * to plan is an instruction to use something that does not exist: three live runs did
     * good work and returned an empty plan, which read as the model ignoring the prompt
     * rather than as a missing tool.
     */
    middleware: [todoListMiddleware()],

    /**
     * The whole point. Both write tools halt the graph before they run, so a run that wants
     * to change something enters WAITING and stays there until a person resumes it. Read
     * tools are deliberately absent from this list — an agent that needs approval to *look*
     * at a number is an agent nobody will use.
     */
    interruptOn: Object.fromEntries(toolsFor(mode, WRITE_TOOLS).map((name) => [name, true])),
    /** Durable, so a WAITING run survives the gap between halting and being approved. */
    checkpointer: await checkpointer(),
  });
}
