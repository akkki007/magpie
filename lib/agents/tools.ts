import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { groundTile } from "@/lib/board/ask";
import { addTile, listBoards, readBoard } from "@/lib/board/persist";
import { resolveTile, TileSpec } from "@/lib/board/spec";
import { rollupByBreakdown, rollupToSeries } from "@/lib/data/rollup";
import type { Table } from "@/lib/data/types";
import { db } from "@/lib/db";
import {
  getModelOutline,
  getSeries,
  getVariable,
  groundProposal,
  runScenario,
} from "@/lib/model/agent-tools";
import { proposeChangeSet } from "@/lib/model/changesets";
import { CommandSchema } from "@/lib/model/command-schema";
import type { Actor } from "@/lib/model/changesets";
import type { Model } from "@/lib/model/types";

import type { Draft } from "./artifacts";
import type { Mode } from "./modes";
import { SILENT, type Observer } from "./observe";

/**
 * The finance-ops agent's tools (`docs/agents-plan.md` A2).
 *
 * **Every one of these wraps something that already exists.** `getModelOutline`, `getSeries`,
 * `runScenario` and `groundProposal` are the modelling agent's tools; `rollupToSeries` is
 * the database module's; `groundTile` is the board module's. Nothing here re-derives what a
 * legal proposal is, or how a record buckets into a period.
 *
 * That is not tidiness. A second definition of "legal" is a second thing to keep correct,
 * and the one that drifts is always the newer one — so the day the modelling agent's
 * grounding learns a new rule (as it did when `SetOverride` on the base scenario turned out
 * to pass grounding and fail at accept), this agent learns it too, for free.
 *
 * Read tools run freely. The two write tools are named in `interruptOn`, so the graph halts
 * before either of them and cannot proceed without a human.
 */

export const WRITE_TOOLS = ["proposeModelChanges", "addBoardTile", "createTable"] as const;

export type ToolContext = {
  model: Model;
  modelId: string;
  tables: Table[];
  actor: Actor;
  /**
   * Where a tool reports what it just did. Optional so scripts can build the tool surface
   * without a run behind it; `SILENT` keeps every tool working and records nothing.
   */
  observe?: Observer;
  /**
   * Which mode the run is in, so `submitFinding` can refuse an answer that claims a write
   * the mode made impossible. Defaults to `do`, where any such claim may well be true.
   */
  mode?: Mode;
};

export function buildOpsTools(ctx: ToolContext) {
  const { model, modelId, tables, actor } = ctx;
  const observe = ctx.observe ?? SILENT;
  const mode = ctx.mode ?? "do";

  /**
   * The charts this run has actually drawn, so `submitFinding` can be grounded against them.
   *
   * The supervisor and every subagent are built from this one call, so a chart a *subagent*
   * drew is citable by the supervisor that never saw the tool return — which is the case that
   * matters, since the supervisor holds no read tools at all and delegation is the only way
   * anything gets read.
   */
  const charts = new Map<string, string>();
  const show = (key: string, card: Draft) => {
    if (card.kind === "series") charts.set(key, card.title);
    observe.show(key, card);
  };

  const modelOutline = tool(
    async () => {
      const outline = getModelOutline(model);
      observe.ran("getModelOutline", `${outline.variables.length} variables`);
      show("outline", outlineCard(outline));
      return JSON.stringify(outline);
    },
    {
      name: "getModelOutline",
      description:
        "The model's groups, variables, periods and scenarios. Start here — every variable id you use must come from this.",
      schema: z.object({}),
    },
  );

  const variable = tool(
    async ({ variableId }) => {
      const found = getVariable(model, { variableId });
      observe.ran("getVariable", "error" in found ? found.error : found.name);
      return JSON.stringify(found);
    },
    {
      name: "getVariable",
      description: "Full detail on one variable, by id: kind, unit, formula, note.",
      schema: z.object({ variableId: z.string() }),
    },
  );

  const series = tool(
    async ({ variableId, scenarioId, member }) => {
      const read = getSeries(model, { variableId, scenarioId, member });
      if ("error" in read) {
        observe.ran("getSeries", read.error);
        return JSON.stringify(read);
      }

      observe.ran("getSeries", read.name);
      const chartKey = `series:${variableId}:${scenarioId ?? "base"}:${member ?? "TOTAL"}`;
      show(chartKey, {
        kind: "series",
        status: "read",
        title: member ? `${read.name} · ${member}` : read.name,
        source: "model",
        format: read.format,
        periods: read.periods.map((p) => p.period),
        series: [{ label: read.name, values: read.periods.map((p) => finite(p.value)) }],
        note: scenarioId ? `Under scenario ${scenarioId}` : undefined,
        /**
         * Pinnable only as the plain variable. A board tile carries no scenario and no
         * dimension member, so a card for either is a different quantity from anything a
         * tile could reference — offering a pin there would put a chart on the wall that
         * quietly resolves to something else.
         */
        ref: scenarioId || member ? undefined : { kind: "model", variableIds: [variableId] },
      });
      return JSON.stringify({ ...read, chartKey });
    },
    {
      name: "getSeries",
      description:
        "One variable's value in every period, optionally under a scenario or for one dimension member.",
      schema: z.object({
        variableId: z.string(),
        scenarioId: z.string().optional(),
        member: z.string().optional(),
      }),
    },
  );

  const scenario = tool(
    async ({ commands, scenarioId }) => {
      const rehearsal = runScenario(model, { commands, scenarioId });
      observe.ran(
        "runScenario",
        "error" in rehearsal
          ? rehearsal.error
          : `${commands.length} command${commands.length === 1 ? "" : "s"}, nothing saved`,
      );
      return JSON.stringify(rehearsal);
    },
    {
      name: "runScenario",
      description:
        "Try a batch of commands in memory and see what they would do. Nothing is saved — this is a rehearsal, never the deliverable.",
      // Same schema as the real proposal, so a rehearsal that would not be legal fails here
      // rather than looking fine and then being refused at the gate.
      schema: z.object({
        commands: z.array(CommandSchema).max(50),
        scenarioId: z.string().optional(),
      }),
    },
  );

  const tableList = tool(
    async () => {
      observe.ran("listTables", `${tables.length} table${tables.length === 1 ? "" : "s"}`);
      return JSON.stringify(
        tables.map((t) => ({
          slug: t.slug,
          name: t.name,
          rows: t.rows.length,
          fields: t.fields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
        })),
      );
    },
    {
      name: "listTables",
      description: "The database tables and their typed columns. Field ids come from here.",
      schema: z.object({}),
    },
  );

  /**
   * Rows are returned as a *sample*, never wholesale. A table is unbounded and a model's
   * context window is not; the aggregate below is what answers questions about a whole
   * table, and this exists so the agent can see what the data actually looks like.
   */
  const sample = tool(
    async ({ tableSlug, limit }) => {
      const table = tables.find((t) => t.slug === tableSlug);
      if (!table) {
        observe.ran("sampleTable", `no table "${tableSlug}"`);
        return `No table "${tableSlug}". Available: ${tables.map((t) => t.slug).join(", ")}.`;
      }

      const names = new Map(table.fields.map((f) => [f.id, f.name]));
      const rows = table.rows.slice(0, Math.min(limit ?? 5, 20));

      observe.ran("sampleTable", `${rows.length} of ${table.rows.length} rows in ${table.name}`);
      /* The same rows the agent is reading, drawn as the grid they came out of. */
      show(`records:${table.slug}`, {
        kind: "records",
        status: "read",
        slug: table.slug,
        name: table.name,
        columns: table.fields.map((f) => ({ name: f.name, type: f.type })),
        rows: rows.map((row) => table.fields.map((f) => cellOf(row.cells[f.id]))),
        showing: rows.length,
        total: table.rows.length,
      });

      return JSON.stringify(
        rows.map((row) =>
          Object.fromEntries(
            Object.entries(row.cells).map(([id, value]) => [names.get(id) ?? id, value]),
          ),
        ),
      );
    },
    {
      name: "sampleTable",
      description:
        "A handful of rows from a table, keyed by column name, so you can see the shape of the data. Never the whole table — use aggregateTable for that.",
      schema: z.object({ tableSlug: z.string(), limit: z.number().int().min(1).max(20).optional() }),
    },
  );

  const aggregate = tool(
    async ({ tableSlug, dateFieldId, valueFieldId, aggregation, breakdownFieldId }) => {
      const table = tables.find((t) => t.slug === tableSlug);
      if (!table) {
        observe.ran("aggregateTable", `no table "${tableSlug}"`);
        return `No table "${tableSlug}".`;
      }

      const spec = {
        dateFieldId,
        valueFieldId: valueFieldId ?? null,
        aggregation,
      };

      const result = breakdownFieldId
        ? rollupByBreakdown(table, model, { ...spec, breakdownFieldId })
        : rollupToSeries(table, model, spec);

      if (!result.ok) {
        observe.ran("aggregateTable", result.error);
        return `Could not aggregate: ${result.error}`;
      }

      // The two rollups return the same fields but a different `series` shape — one series
      // per category, or one bare array. Branched rather than probed, so the difference is
      // visible here instead of inferred from a property test.
      const series = breakdownFieldId
        ? (result as Extract<ReturnType<typeof rollupByBreakdown>, { ok: true }>).series
        : [
            {
              label: table.name,
              values: (result as Extract<ReturnType<typeof rollupToSeries>, { ok: true }>).series,
            },
          ];

      const outside = result.unmatched.length;
      const counted = result.total - outside;
      const label = `${aggregation} over ${table.name}`;

      observe.ran(
        "aggregateTable",
        `${label} · ${counted} record${counted === 1 ? "" : "s"}${outside > 0 ? `, ${outside} outside the horizon` : ""}`,
      );
      const chartKey = `rollup:${table.slug}:${dateFieldId}:${valueFieldId ?? "count"}:${breakdownFieldId ?? "none"}`;
      show(chartKey, {
        kind: "series",
        status: "read",
        title: label,
        source: "records",
        /* The rollup's own arguments are already a board source — see `SeriesRef`. */
        ref: {
          kind: "database",
          tableSlug: table.slug,
          dateFieldId,
          valueFieldId: valueFieldId ?? null,
          aggregation,
          breakdownFieldId: breakdownFieldId ?? null,
        },
        // A COUNT is a count of records whatever the column was. SUM and AVG inherit the
        // column's meaning, so the format comes from the column's own type rather than a
        // guess — summing a NUMBER column and drawing it as money is a lie in the axis.
        format: formatOf(aggregation, table.fields.find((f) => f.id === valueFieldId)?.type),
        periods: model.periods.map((p) => p.label),
        series: series.map((s) => ({ label: s.label, values: s.values.map(finite) })),
        note:
          outside > 0
            ? `${outside} record${outside === 1 ? "" : "s"} fall outside the model's horizon and are not counted here.`
            : undefined,
      });

      /**
       * **`recordsCounted` is the point of this block, and it used to be missing.**
       *
       * The rollup has always computed the record total; this tool dropped it and returned
       * only the per-period series. So an agent asked "how many customers are there?" had no
       * figure to cite and two ways to proceed: add up 24 numbers itself (which it is told
       * not to do, and which needs a second tool call), or fill the gap. A live run filled
       * the gap with **0** — and then, three sentences later, correctly described onboarding
       * peaking at 8 in Apr '27. An answer that contradicts itself inside one paragraph, out
       * of a tool that knew the right number the whole time and did not pass it on.
       */
      return JSON.stringify({
        periods: model.periods.map((p) => p.label),
        series,
        recordsCounted: counted,
        recordsOutsideHorizon: outside,
        datedRecords: result.total,
        periodsCovered: result.matched,
        chartKey,
      });
    },
    {
      name: "aggregateTable",
      description:
        "Roll a table's records up into the model's periods: COUNT of records, or SUM/AVG of a numeric column, optionally split by a SELECT column. This is how you turn records into a series. The result also carries recordsCounted — the number of records that went into it — so use that figure directly when asked how many there are, rather than adding the series up yourself. recordsOutsideHorizon are records the model's periods do not span; say so when it matters.",
      schema: z.object({
        tableSlug: z.string(),
        dateFieldId: z.string(),
        valueFieldId: z.string().nullable().optional(),
        aggregation: z.enum(["SUM", "COUNT", "AVG"]),
        breakdownFieldId: z.string().nullable().optional(),
      }),
    },
  );

  /**
   * Arithmetic the model must not do in its head.
   *
   * The first correct live run read six monthly counts — 6, 4, 5, 5, 6, 6, every one right —
   * and reported the total as 31. It is 32. Nothing was hallucinated: an LLM added six
   * integers and got one wrong, which is a thing they do, and a finance tool cannot report a
   * total that is off by one.
   *
   * Cheaper and more reliable than telling the model to be careful.
   */
  const arithmetic = tool(
    async ({ values, operation }) => {
      if (values.length === 0) return "No values given.";
      const sum = values.reduce((a, b) => a + b, 0);
      /* The inputs and the answer, both, so a reader can check the sum that ends up in the
         memo without rerunning anything. */
      const said = (answer: string) => {
        observe.ran("calculate", `${operation} of ${values.length} values → ${answer}`);
        return answer;
      };
      switch (operation) {
        case "sum":
          return said(String(sum));
        case "mean":
          return said(String(sum / values.length));
        case "min":
          return said(String(Math.min(...values)));
        case "max":
          return said(String(Math.max(...values)));
        case "change": {
          if (values.length < 2) return "Change needs at least two values.";
          const [first, last] = [values[0], values[values.length - 1]];
          const pct = first === 0 ? null : ((last - first) / Math.abs(first)) * 100;
          return said(
            JSON.stringify({
              absolute: last - first,
              percent: pct === null ? "undefined (first value is zero)" : Number(pct.toFixed(2)),
            }),
          );
        }
      }
    },
    {
      name: "calculate",
      description:
        "Add up, average, or compare numbers. ALWAYS use this instead of doing arithmetic yourself — a total you compute in your head can be wrong, and a wrong total in a finance report is the worst kind of error.",
      schema: z.object({
        values: z.array(z.number()).min(1).max(200),
        operation: z.enum(["sum", "mean", "min", "max", "change"]),
      }),
    },
  );

  /**
   * How a run says what it found.
   *
   * **A schema, because the instruction did not hold.** The prompt asked for under 150 words
   * and no per-period lists; runs answered with a bullet for all 24 months anyway —
   * transcribing in prose the exact chart drawn beside them, and burying the finding in it.
   * One opened with "0 customers are recorded" and three sentences later described
   * onboarding peaking at 8 in Apr '27: an answer arguing with itself.
   *
   * Asking more firmly was tried. This is the same move the repo already makes everywhere
   * else — the proposal tool takes the real `CommandSchema` rather than `z.any()`, and the
   * grid's commands are typed rather than described. A limit a model is asked to respect is
   * a suggestion; a limit in a schema is refused and retried. So the shape of an answer is
   * now `answer / evidence / next`, with lengths that make a 24-item list impossible to
   * submit rather than merely discouraged.
   */
  /**
   * A claim to have written something, in a mode that cannot write.
   *
   * Deliberately narrow. It needs the agent as the subject, one of the verbs that assert a
   * finished write, and **a thing this agent's write tools actually persist** — so "I have
   * created a database table" is caught and "I have set out a plan" is not. Getting that
   * wrong in the permissive direction reinstates the bug; getting it wrong in the strict
   * direction costs one retry and a rephrased sentence, which is the cheaper mistake.
   */
  const CLAIMS_A_WRITE =
    /\b(?:i|we)\b[^.!?]{0,40}?\b(?:created|added|built|set up|inserted|saved|updated|populated)\b[^.!?]{0,80}?\b(?:table|column|field|variable|scenario|tile|board|row|record|dataset)s?\b/i;

  const claimed = (finding: { answer: string; evidence: string[]; next?: string }) =>
    [finding.answer, ...finding.evidence, finding.next ?? ""].find((line) => CLAIMS_A_WRITE.test(line));

  /** Sentences that assert a write, removed — the last resort below. */
  const strip = (text: string) =>
    text
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !CLAIMS_A_WRITE.test(sentence))
      .join(" ")
      .trim();

  /**
   * Two rejections, then the sentence is cut.
   *
   * Unbounded rejection is its own failure mode — a run that will not finish is no better on
   * screen than one that lies. The model gets two chances to say it correctly itself, and
   * after that the claim is removed rather than stored, so the guarantee does not depend on
   * the model ever cooperating.
   */
  const MAX_REFUSALS = 2;
  let refusals = 0;

  const submit = tool(
    async ({ answer, evidence, next, chart }) => {
      /**
       * **The cited chart is grounded, like every other reference this repo lets a model
       * make.**
       *
       * The agent chooses which chart carries its point — that is an editorial judgement and
       * exactly the kind this architecture gives a model. What it cannot do is cite one it
       * never drew: the key has to be among the charts this run actually produced, or the
       * conversation would render a chart that says nothing about the answer beside it, or
       * nothing at all.
       *
       * The message lists the keys that *are* available, the same correction channel
       * `lib/board/ask.ts` uses — an error a model can act on is worth more than a tidy one.
       */
      if (chart && !charts.has(chart)) {
        return charts.size === 0
          ? `No chart to cite: this run has not drawn one. Submit again without \`chart\`.`
          : `"${chart}" is not a chart this run drew. Available: ${[...charts]
              .map(([key, title]) => `${key} (${title})`)
              .join("; ")}. Copy one exactly, or omit \`chart\`.`;
      }
      /**
       * **The mode gate, enforced here rather than asked for in the prompt.**
       *
       * `lib/agents/modes.ts` opens by saying a mode selector that only rephrases an
       * instruction is decoration, and then mitigated exactly this bug with prose — the
       * `NOT_DONE` clause, spelling out that writing a file describing a table is not
       * creating a table. It did not hold: a live run in ask mode, with no write tools at
       * all, still answered "I have created a database table for tracking office expenses
       * with columns for date, category, amount…". The gate held; the sentence lied, and a
       * person reads the sentence and not the database.
       *
       * This is the move `submitFinding` already documents for answer *length* — a limit a
       * model is asked to respect is a suggestion, a limit in the schema is refused and
       * retried. In a read-only mode nothing was written, so a claim that something was is
       * false by construction and can be refused without judging it.
       */
      if (mode !== "do") {
        const offending = claimed({ answer, evidence, next });
        if (offending && refusals < MAX_REFUSALS) {
          refusals++;
          return (
            `Rejected, and not recorded: "${offending.trim().slice(0, 120)}" says you ${""}` +
            `created something. You are in ${mode} mode and hold no tools that write, so ` +
            `nothing was created — the sentence is false whatever else the answer gets right. ` +
            `Writing a file describing a table is not creating a table. Resubmit with what you ` +
            `found and what you *would* build, e.g. "here is the table I would create — switch ` +
            `to Do mode and I will propose it".`
          );
        }
        if (offending) {
          // Out of retries. The claim is cut rather than stored: the one thing that must not
          // happen is a saved answer asserting a write that never occurred.
          answer = strip(answer) || `This mode cannot make changes. ${strip(next ?? "")}`.trim();
          evidence = evidence.filter((line) => !CLAIMS_A_WRITE.test(line));
          next = next && CLAIMS_A_WRITE.test(next) ? strip(next) || undefined : next;
          if (evidence.length === 0) evidence = ["Nothing was written — this mode holds no write tools."];
        }
      }

      observe.finding({ answer, evidence, next, chart });
      return "Recorded — that is your answer. Stop now; do not write it out again in prose.";
    },
    {
      name: "submitFinding",
      description:
        "Submit your answer. This is how a run finishes: call it once, last, and stop. Everything you read is already drawn beside your answer, so do not list periods, rows or columns here — cite the figures that carry the point and nothing else.",
      schema: z.object({
        answer: z
          .string()
          .min(1)
          .max(320)
          .describe("The answer itself, in one or two sentences. Lead with the number if the question had one."),
        evidence: z
          .array(z.string().min(1).max(160))
          .min(1)
          .max(4)
          .describe("At most four lines. Each is one figure and where it came from — a variable, a table, the periods."),
        next: z
          .string()
          .max(200)
          .optional()
          .describe("One sentence: what you would do about it, or what you built."),
        chart: z
          .string()
          .optional()
          .describe(
            "The `chartKey` of the one chart that carries your point, copied exactly from a getSeries or aggregateTable result. It is drawn beside your answer. Omit it if no chart makes the point.",
          ),
      }),
    },
  );

  const boards = tool(
    async () => {
      const found = await listBoards(db);
      observe.ran("listBoards", `${found.length} board${found.length === 1 ? "" : "s"}`);
      return JSON.stringify(found);
    },
    {
      name: "listBoards",
      description: "The boards a tile can be added to, with their slugs.",
      schema: z.object({}),
    },
  );

  /* ── Writes. Both are in interruptOn — the graph halts before either runs. ──*/

  const propose = tool(
    async ({ label, commands }) => {
      const grounded = groundProposal(model, { label, commands });
      if (!grounded.ok) {
        observe.settled("proposeModelChanges", "failed", { note: grounded.error });
        return `Rejected: ${grounded.error}`;
      }

      // The caller mints the id, the same way the grid does (M3.2) — so the proposal can
      // be named in the run's steps without waiting to be told what it was called.
      const changeSetId = crypto.randomUUID();
      await db.$transaction((tx) =>
        proposeChangeSet(tx, {
          id: changeSetId,
          modelId,
          label: grounded.label,
          commands: grounded.commands,
          actor,
        }),
      );

      observe.settled("proposeModelChanges", "created", { note: grounded.label });
      return `Proposed "${grounded.label}" as changeset ${changeSetId} — staged for a human to accept or reject. It has NOT been applied.`;
    },
    {
      name: "proposeModelChanges",
      description:
        "Stage a batch of commands against the model for a human to accept or reject. Nothing is applied. Ground every id in getModelOutline first.",
      /**
       * The real `CommandSchema`, not `z.array(z.any())`.
       *
       * This mattered more than it looks. With `any`, a command of *any* shape reached the
       * approval gate — and a live run produced `{"setVariable": {"id":
       * "new_accounts_jul_2026", "value": 2}}`, which is not a command and names a variable
       * that does not exist. The person would have been shown that as the thing to approve,
       * approved it, and only then would grounding have refused it.
       *
       * `interruptOn` halts *before* the tool body runs, so grounding cannot vet the args
       * first — which makes the schema the only thing standing between a malformed proposal
       * and a human's approval screen. Handing the model the real union also tells it the
       * shape up front, so it stops guessing: the same reasoning M5.1 gives for deriving the
       * agent's tool definitions from the command schema rather than describing them in prose.
       */
      schema: z.object({
        label: z.string().min(1).max(80),
        commands: z.array(CommandSchema).min(1).max(50),
      }),
    },
  );

  const boardTile = tool(
    async ({ boardSlug, spec }) => {
      const refuse = (why: string) => {
        observe.settled("addBoardTile", "failed", { note: why });
        return `Rejected: ${why}`;
      };

      const board = await readBoard(db, boardSlug);
      if (!board) return refuse(`No board "${boardSlug}".`);

      const parsed = TileSpec.safeParse(spec);
      if (!parsed.success) {
        return refuse(
          `that tile is not well-formed — ${parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      }

      const grounded = groundTile(parsed.data, model, tables);
      if (!grounded.ok) return refuse(grounded.error);

      const resolved = resolveTile(grounded.spec, { model, tables });
      if (!resolved.ok) return refuse(resolved.error);

      const tile = await addTile(db, board.id, grounded.spec, null);
      /* No slug: a tile card is identified by the board it went on, which it already has. */
      observe.settled("addBoardTile", "created", { note: board.title });
      return `Added tile ${tile.id} to ${board.title}.`;
    },
    {
      name: "addBoardTile",
      description:
        "Put a chart, KPI or text tile on a board. The spec is the same shape the board's own ask produces: {kind, title|label, form, source, note} or {kind:'text', title, body}.",
      schema: z.object({
        boardSlug: z.string(),
        spec: z.any(),
      }),
    },
  );

  /**
   * A new database table, designed from a description.
   *
   * The agent picks the columns and their types, which is the interesting part: "a table for
   * vendor contracts" has to become a DATE for the renewal, a CURRENCY for the value, and a
   * SELECT with real options for the status. `FieldType` is deliberately small (five types,
   * all of which the grid draws — `docs/database-plan.md` §1.3), so this cannot invent a
   * column the product cannot render.
   *
   * Created empty. Rows come from a CSV paste or from people using the table; an agent
   * inventing plausible vendor names would be manufacturing data that looks like records,
   * which is the one thing a finance tool must never have in it.
   *
   * In `interruptOn`, so it never runs without a person seeing the schema first.
   */
  const createTable = tool(
    async ({ name, description, fields }) => {
      const slug = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const refuse = (why: string) => {
        observe.settled("createTable", "failed", { note: why });
        return why;
      };

      if (!slug) return refuse("That name does not produce a usable URL slug.");

      const existing = await db.dataTable.findUnique({ where: { slug }, select: { id: true } });
      if (existing) return refuse(`A table already lives at "${slug}". Pick a different name.`);

      const dates = fields.filter((f) => f.type === "DATE").length;
      if (dates === 0) {
        return refuse(
          "Every table needs at least one DATE column, or its records can never be rolled up into the model's periods — which is the whole point of a table here.",
        );
      }

      const table = await db.dataTable.create({
        data: {
          name: name.trim(),
          slug,
          icon: "🗂️",
          fields: {
            create: fields.map((field, order) => ({
              name: field.name.trim(),
              type: field.type,
              order,
              options:
                field.type === "SELECT" && field.options?.length
                  ? {
                      options: field.options.map((value, i) => ({
                        value,
                        tone: (["blue", "sky", "amber", "rose", "graphite"] as const)[i % 5],
                      })),
                    }
                  : undefined,
            })),
          },
        },
        include: { fields: true },
      });

      observe.settled("createTable", "created", { slug, note: table.name });
      return JSON.stringify({
        created: table.name,
        url: `/databases/${slug}`,
        note: description ? `Described as: ${description}` : undefined,
        fields: table.fields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
        rows: 0,
        next: "The table is empty. Its field ids are above if you want to reference them.",
      });
    },
    {
      name: "createTable",
      description:
        "Create a new, empty database table with typed columns. Use this when the task asks for somewhere to track something that has no table yet. Choose columns a finance team would actually need, and give every SELECT column its options. At least one DATE column is required, since that is what lets records roll up into the model's periods.",
      schema: z.object({
        name: z.string().min(1).max(60).describe("Display name, e.g. \"Vendor Contracts\""),
        description: z.string().max(300).optional().describe("What the table is for"),
        fields: z
          .array(
            z.object({
              name: z.string().min(1).max(60),
              type: z.enum(["TEXT", "NUMBER", "CURRENCY", "DATE", "SELECT"]),
              options: z
                .array(z.string())
                .max(10)
                .optional()
                .describe("SELECT only: the allowed values"),
            }),
          )
          .min(2)
          .max(12),
      }),
    },
  );

  return [
    submit,
    modelOutline,
    variable,
    series,
    scenario,
    tableList,
    sample,
    aggregate,
    arithmetic,
    boards,
    createTable,
    propose,
    boardTile,
  ];
}

/* ── Turning a tool's own result into a card ──────────────────────────────
 *
 * Built from the value the tool just computed, never re-parsed out of the JSON it returned.
 * The previous version scraped a slug back out of `createTable`'s response with a regex,
 * which made a tool's prose an API that nobody knew they were maintaining. */

/**
 * Chart values are `number[]`, so a period a variable has no value in becomes 0 rather than
 * a hole. Honest for these two callers: the model evaluates every period, and a rollup emits
 * a bucket per period, so a missing value here means "nothing in this period", which 0 is
 * the correct drawing of.
 */
/** What a rolled-up series is measured in, from the column it came out of. */
function formatOf(aggregation: string, fieldType: string | undefined): "CURRENCY" | "COUNT" {
  if (aggregation === "COUNT") return "COUNT";
  return fieldType === "CURRENCY" ? "CURRENCY" : "COUNT";
}

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Cells arrive as whatever the column's type stores; the canvas draws text and numbers. */
function cellOf(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return String(value);
}

function outlineCard(outline: ReturnType<typeof getModelOutline>): Draft {
  const { first, last, count } = outline.periods;
  return {
    kind: "outline",
    status: "read",
    name: outline.name,
    horizon: `${first ?? "?"} – ${last ?? "?"} · ${count} periods`,
    groups: outline.groups.map((group) => ({
      name: group.name,
      variables: outline.variables
        .filter((v) => v.groupId === group.id)
        .map((v) => ({ name: v.name, kind: v.kind, formula: v.formula })),
    })),
  };
}
