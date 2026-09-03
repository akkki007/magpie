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
};

export function buildOpsTools(ctx: ToolContext) {
  const { model, modelId, tables, actor } = ctx;

  const modelOutline = tool(
    async () => JSON.stringify(getModelOutline(model)),
    {
      name: "getModelOutline",
      description:
        "The model's groups, variables, periods and scenarios. Start here — every variable id you use must come from this.",
      schema: z.object({}),
    },
  );

  const variable = tool(
    async ({ variableId }) => JSON.stringify(getVariable(model, { variableId })),
    {
      name: "getVariable",
      description: "Full detail on one variable, by id: kind, unit, formula, note.",
      schema: z.object({ variableId: z.string() }),
    },
  );

  const series = tool(
    async ({ variableId, scenarioId, member }) =>
      JSON.stringify(getSeries(model, { variableId, scenarioId, member })),
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
    async ({ commands, scenarioId }) =>
      JSON.stringify(runScenario(model, { commands, scenarioId })),
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
    async () =>
      JSON.stringify(
        tables.map((t) => ({
          slug: t.slug,
          name: t.name,
          rows: t.rows.length,
          fields: t.fields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
        })),
      ),
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
      if (!table) return `No table "${tableSlug}". Available: ${tables.map((t) => t.slug).join(", ")}.`;
      const names = new Map(table.fields.map((f) => [f.id, f.name]));
      return JSON.stringify(
        table.rows.slice(0, Math.min(limit ?? 5, 20)).map((row) =>
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
      if (!table) return `No table "${tableSlug}".`;

      const spec = {
        dateFieldId,
        valueFieldId: valueFieldId ?? null,
        aggregation,
      };

      const result = breakdownFieldId
        ? rollupByBreakdown(table, model, { ...spec, breakdownFieldId })
        : rollupToSeries(table, model, spec);

      if (!result.ok) return `Could not aggregate: ${result.error}`;

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

      return JSON.stringify({
        periods: model.periods.map((p) => p.label),
        series,
        periodsCovered: result.matched,
        recordsOutsideHorizon: result.unmatched.length,
      });
    },
    {
      name: "aggregateTable",
      description:
        "Roll a table's records up into the model's periods: COUNT of records, or SUM/AVG of a numeric column, optionally split by a SELECT column. This is how you turn records into a series.",
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
      switch (operation) {
        case "sum":
          return String(sum);
        case "mean":
          return String(sum / values.length);
        case "min":
          return String(Math.min(...values));
        case "max":
          return String(Math.max(...values));
        case "change": {
          if (values.length < 2) return "Change needs at least two values.";
          const [first, last] = [values[0], values[values.length - 1]];
          const pct = first === 0 ? null : ((last - first) / Math.abs(first)) * 100;
          return JSON.stringify({
            absolute: last - first,
            percent: pct === null ? "undefined (first value is zero)" : Number(pct.toFixed(2)),
          });
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

  const boards = tool(
    async () => JSON.stringify(await listBoards(db)),
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
      if (!grounded.ok) return `Rejected: ${grounded.error}`;

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
      const board = await readBoard(db, boardSlug);
      if (!board) return `No board "${boardSlug}".`;

      const parsed = TileSpec.safeParse(spec);
      if (!parsed.success) {
        return `That tile is not well-formed: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`;
      }

      const grounded = groundTile(parsed.data, model, tables);
      if (!grounded.ok) return `Rejected: ${grounded.error}`;

      const resolved = resolveTile(grounded.spec, { model, tables });
      if (!resolved.ok) return `Rejected: ${resolved.error}`;

      const tile = await addTile(db, board.id, grounded.spec, null);
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
      if (!slug) return "That name does not produce a usable URL slug.";

      const existing = await db.dataTable.findUnique({ where: { slug }, select: { id: true } });
      if (existing) return `A table already lives at "${slug}". Pick a different name.`;

      const dates = fields.filter((f) => f.type === "DATE").length;
      if (dates === 0) {
        return "Every table needs at least one DATE column, or its records can never be rolled up into the model's periods — which is the whole point of a table here.";
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
