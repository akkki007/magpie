/**
 * `bun run board:check` — the board module's safety layer (`docs/board-plan.md` feature 1).
 *
 * Two halves. The grounding assertions are pure and always run: they are what stops a
 * generated tile from referencing something that does not exist or drawing a shape the data
 * cannot carry. The live half runs only with `OPENAI_API_KEY` set, and asks the real model
 * real questions — a grounding gate nobody has fired a live model at is a gate you are
 * hoping about.
 *
 *   bun run board:check          # pure only
 *   bun run board:check --live   # + real questions through the provider
 */
import { db } from "../lib/db";
import { groundTile } from "../lib/board/ask";
import { askForTile } from "../lib/board/openai-board";
import { resolveTile, type TileSpec } from "../lib/board/spec";
import { listTables, readTable } from "../lib/data/persist";
import type { Table } from "../lib/data/types";
import { readModel } from "../lib/model/persist";

const problems: string[] = [];
let assertions = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  assertions++;
  if (!ok) problems.push(detail ? `${label} — ${detail}` : label);
};

const model = await readModel(db, "revenue-model-2026");
const summaries = await listTables(db);
const tables = (await Promise.all(summaries.map((s) => readTable(db, s.slug)))).filter(
  (t): t is Table => t !== null,
);

if (!model || tables.length === 0) {
  console.error("\n  ✗ needs `bun run seed` and `bun run seed:database`\n");
  process.exit(1);
}

const customers = tables.find((t) => t.slug === "customers")!;
const field = (name: string) => customers.fields.find((f) => f.name === name)!;
const dateId = field("Onboarding Date").id;
const limitId = field("Credit Limit").id;
const statusId = field("Status").id;
const nameId = field("Customer Name").id;

const chart = (source: object, extra: object = {}): TileSpec =>
  ({ kind: "chart", title: "T", form: "stacked-bar", source, ...extra }) as TileSpec;

/* ── Grounding rejects what it must ───────────────────────────────────────*/

const invented = groundTile(
  chart({ kind: "model", variableIds: ["v_does_not_exist"] }),
  model,
  tables,
);
check("an invented variable id is rejected", !invented.ok);
check(
  "…and the error names the id so the model can correct it",
  !invented.ok && invented.error.includes("v_does_not_exist"),
  invented.ok ? "" : invented.error,
);

const badTable = groundTile(
  chart({ kind: "database", tableSlug: "nope", dateFieldId: dateId, valueFieldId: null, aggregation: "COUNT", breakdownFieldId: null }),
  model,
  tables,
);
check("an unknown table slug is rejected", !badTable.ok);
check("…and the error lists the tables that exist", !badTable.ok && badTable.error.includes("customers"));

const textAsDate = groundTile(
  chart({ kind: "database", tableSlug: "customers", dateFieldId: nameId, valueFieldId: null, aggregation: "COUNT", breakdownFieldId: null }),
  model,
  tables,
);
check("a TEXT column cannot bucket periods", !textAsDate.ok, textAsDate.ok ? "accepted!" : "");
check("…and the error offers the date columns", !textAsDate.ok && textAsDate.error.includes("Onboarding Date"));

const sumOfText = groundTile(
  chart({ kind: "database", tableSlug: "customers", dateFieldId: dateId, valueFieldId: nameId, aggregation: "SUM", breakdownFieldId: null }),
  model,
  tables,
);
check("SUM of a TEXT column is rejected", !sumOfText.ok);

const kpiWithBreakdown = groundTile(
  { kind: "kpi", label: "K", source: { kind: "database", tableSlug: "customers", dateFieldId: dateId, valueFieldId: null, aggregation: "COUNT", breakdownFieldId: statusId } } as TileSpec,
  model,
  tables,
);
check("a KPI cannot carry a breakdown", !kpiWithBreakdown.ok, kpiWithBreakdown.ok ? "accepted!" : "");

/**
 * Mixed units on one axis is the dual-axis chart under another name — the single most
 * common charting mistake, and the one the reference mock itself makes.
 */
const currencyVar = model.variables.find((v) => v.format === "CURRENCY");
const percentVar = model.variables.find((v) => v.format === "PERCENT");
if (currencyVar && percentVar) {
  const mixed = groundTile(
    chart({ kind: "model", variableIds: [currencyVar.id, percentVar.id] }, { form: "line" }),
    model,
    tables,
  );
  check("currency and percent on one axis is refused", !mixed.ok, mixed.ok ? "accepted!" : "");
} else {
  check("model has a currency and a percent variable to test with", false, "fixture changed");
}

/* ── …and accepts what it must ────────────────────────────────────────────*/

const good = groundTile(
  chart({ kind: "database", tableSlug: "customers", dateFieldId: dateId, valueFieldId: null, aggregation: "COUNT", breakdownFieldId: statusId }),
  model,
  tables,
);
check("a well-formed breakdown is accepted", good.ok, good.ok ? "" : good.error);

if (good.ok) {
  const resolved = resolveTile(good.spec, { model, tables });
  check("…and it resolves", resolved.ok, resolved.ok ? "" : resolved.error);
  if (resolved.ok && resolved.kind === "chart") {
    check("…to one series per status", resolved.series.length >= 2, `${resolved.series.length}`);
    check("…across the model's periods", resolved.series[0].values.length === model.periods.length);
    /* A stacked bar's parts must sum to the column total — the arithmetic the form promises. */
    const first = resolved.series.reduce((sum, s) => sum + s.values[0], 0);
    check("…and the stack sums to something", first > 0, `${first}`);
  }
}

const sumTile = groundTile(
  chart({ kind: "database", tableSlug: "customers", dateFieldId: dateId, valueFieldId: limitId, aggregation: "SUM", breakdownFieldId: null }, { form: "line" }),
  model,
  tables,
);
check("a currency sum is accepted", sumTile.ok, sumTile.ok ? "" : sumTile.error);
if (sumTile.ok) {
  const resolved = resolveTile(sumTile.spec, { model, tables });
  check("…and carries the currency format through", resolved.ok && resolved.kind === "chart" && resolved.format === "CURRENCY");
}

/* ── Live ─────────────────────────────────────────────────────────────────*/

if (process.argv.includes("--live") && process.env.OPENAI_API_KEY) {
  const questions: { question: string; expect: TileSpec["kind"] }[] = [
    { question: "Show customers onboarded each month, broken down by status", expect: "chart" },
    { question: "How many customers do we have?", expect: "kpi" },
  ];

  for (const { question, expect } of questions) {
    const started = Date.now();
    const answer = await askForTile(question, model, tables);
    const took = Date.now() - started;

    check(`live: "${question.slice(0, 40)}…" produced a tile`, answer.ok, answer.ok ? "" : answer.error);
    if (answer.ok) {
      check(`live: …and chose ${expect}`, answer.spec.kind === expect, `chose ${answer.spec.kind}`);
      const resolved = resolveTile(answer.spec, { model, tables });
      check("live: …that resolves against real data", resolved.ok, resolved.ok ? "" : resolved.error);
      console.log(`  ${took}ms · ${answer.spec.kind} · ${"title" in answer.spec ? answer.spec.title : answer.spec.label}`);
    }
  }
} else {
  console.log("  (live half skipped — pass --live with OPENAI_API_KEY set)");
}

console.log(`\n  ${assertions} assertions`);

if (problems.length > 0) {
  console.log(`\n${problems.length} failure(s):`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log();
  process.exit(1);
}

console.log("\n  All checks passed.\n");
