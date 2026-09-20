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
import { anomalies, explain, linearParts } from "../lib/board/insight";
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

/** One model variable's series, in the shape `explain` reads. */
function resolveSeries(variableId: string) {
  const spec: TileSpec = {
    kind: "chart",
    title: variableId,
    form: "line",
    source: { kind: "model", variableIds: [variableId] },
  };
  const resolved = resolveTile(spec, { model: model!, tables });
  if (!resolved.ok || resolved.kind !== "chart") throw new Error(`could not resolve ${variableId}`);
  return { labels: resolved.labels, series: resolved.series };
}

/* ── Feature 2 — drivers and anomalies ────────────────────────────────────
 *
 * Hand-computed fixtures, because the point of this feature is that the numbers are
 * arithmetic rather than an opinion, and an assertion that only checks the *shape* of an
 * opinion is no assertion at all. Each expected figure below was worked out from the input
 * by hand; if the implementation changes what it means by a driver, these fail. */

{
  const labels = ["M1", "M2", "M3", "M4"];

  /**
   * Contributions must add up to the change exactly. This is the property that makes a
   * driver strip trustworthy: no residual, no interaction term, nothing rounded away.
   */
  const parts = explain(
    {
      kind: "chart",
      title: "Split",
      form: "stacked-bar",
      source: { kind: "model", variableIds: ["a", "b"] },
    },
    {
      labels,
      series: [
        { label: "A", values: [10, 10, 10, 40] },
        { label: "B", values: [10, 10, 10, 20] },
      ],
    },
    model!,
  );

  check("drivers are found in a stacked chart", parts?.drivers.length === 2, `${parts?.drivers.length}`);
  if (parts) {
    /* Halves: (10+40)+(10+20) = 80 against (10+10)+(10+10) = 40, so +40. */
    check("…comparing halves, not single periods", parts.comparison === "halves", parts.comparison);
    check("…with the right total", parts.total.change === 40, `${parts.total.change}`);
    const a = parts.drivers.find((d) => d.label === "A");
    check("…A contributed 30", a?.change === 30, `${a?.change}`);
    check("…which is 75% of it", a?.share !== null && Math.abs((a?.share ?? 0) - 0.75) < 1e-9, `${a?.share}`);
    const summed = parts.drivers.reduce((total, driver) => total + driver.change, 0);
    check("…and the parts add up to the whole", summed === parts.total.change, `${summed} vs ${parts.total.change}`);
  }

  /**
   * Offsetting movements must not produce a headline share.
   *
   * +4, −3, +1 nets to 2, and the honest percentages are 200%, −150% and 50% — every one
   * correct and every one nonsense on a board. The amounts still show; the shares do not.
   */
  const offsetting = explain(
    {
      kind: "chart",
      title: "Offsetting",
      form: "stacked-bar",
      source: { kind: "model", variableIds: ["a", "b", "c"] },
    },
    {
      labels: ["M1", "M2"],
      series: [
        { label: "Up", values: [0, 4] },
        { label: "Down", values: [4, 1] },
        { label: "Flat", values: [0, 1] },
      ],
    },
    model!,
  );
  check("a near-zero net change reports no shares", offsetting?.drivers.every((d) => d.share === null) === true, JSON.stringify(offsetting?.drivers));
  check("…but still reports the amounts", offsetting?.drivers.some((d) => d.change === 4) === true, JSON.stringify(offsetting?.drivers));
}

/**
 * A formula decomposes only when it is additive.
 *
 * `Opening × Churn Rate` cannot be split into "the change in Opening" and "the change in
 * the rate" without choosing where to put the cross term — so it is refused rather than
 * guessed at.
 */
{
  const closing = model.variables.find((v) => v.id === "v_closing_arr");
  const churn = model.variables.find((v) => v.id === "v_churn_arr");
  check("an additive formula decomposes", Boolean(closing?.formula && linearParts(closing.formula)));
  check("…and a multiplicative one does not", churn?.formula ? linearParts(churn.formula) === null : false);

  /**
   * The stock-and-flow case, which is the one that matters on a finance board.
   *
   * `Closing ARR` includes `Opening ARR`, which is last month's closing balance. Decomposed
   * end to end, it reports that 96% of two years of growth was "driven by" the balance
   * already being there — exact, and useless. Spotting the carry-forward turns it into the
   * bridge a finance team expects, and the flows still sum to the change exactly.
   */
  const bridge = explain(
    { kind: "chart", title: "Closing ARR", form: "line", source: { kind: "model", variableIds: ["v_closing_arr"] } },
    resolveSeries("v_closing_arr"),
    model!,
  );
  check("a balance is bridged by its flows", bridge?.basis === "flows", `${bridge?.basis}`);
  check(
    "…and the opening balance is not called a driver",
    bridge?.drivers.every((d) => !/opening/i.test(d.label)) === true,
    bridge?.drivers.map((d) => d.label).join(", "),
  );
  if (bridge) {
    const summed = bridge.drivers.reduce((total, driver) => total + driver.change, 0);
    check(
      "…and the flows add up to the change in the balance",
      Math.abs(summed - bridge.total.change) < 0.01,
      `${summed} vs ${bridge.total.change}`,
    );
  }
}

/**
 * Anomalies: detrended, so growth is not mistaken for a shock.
 *
 * A series that rises by a little more every month has larger changes at the end by
 * construction. Scoring the raw changes would flag the tail of every healthy forecast.
 */
{
  const at = (v: number[]) => anomalies(v.map(String), v);

  const steady = Array.from({ length: 14 }, (_, i) => i * i);
  check("an accelerating series has no anomalies", at(steady).length === 0);

  const spiked = [...steady];
  spiked[7] += 400;
  const found = at(spiked);
  check("…but a spike in one is caught", found.length > 0, `${found.length}`);
  check("…at the period it happened", found[0]?.index === 7, `${found[0]?.index}`);
  check("…and named as a rise", found[0]?.direction === "up", found[0]?.direction);

  /* Too short to say anything, and it says nothing rather than picking a number. */
  check("four periods are too few to call anything unusual", anomalies(["a", "b", "c", "d"], [1, 2, 30, 4]).length === 0);
  /* A flat series has no unusual month, and must not manufacture one out of rounding. */
  check("a flat series has no anomalies", at(Array(12).fill(5)).length === 0);

  /**
   * The single spike in a flat series — the case the feature most obviously exists for, and
   * the one that shipped silent.
   *
   * It was not a threshold to tune. The residuals are `[0,…,0,50,−50,0,…,0]`, so more than
   * half of them are identical, the median absolute deviation is exactly zero, and the guard
   * meant for "a perfectly regular series" swallowed the most irregular series there is.
   * There was no assertion here, which is why it shipped; there is one now.
   */
  const spike = at([10, 10, 10, 10, 10, 10, 60, 10, 10, 10, 10, 10, 10, 10]);
  check("a lone spike in a flat series is caught", spike.length > 0, `${spike.length}`);
  check("…at the period it spiked", spike[0]?.index === 6, `${spike[0]?.index}`);
  /* Both legs are unusual moves and saying so is honest — the top-three cap absorbs it. */
  check("…and the return to normal is called out too", spike[1]?.index === 7 && spike[1]?.direction === "down", `${spike[1]?.index}`);
  /* A step is one unusual move, not two: the level stays put afterwards. */
  check("a step change is one move, not two", at([10, 10, 10, 10, 10, 10, 60, 60, 60, 60, 60, 60, 60, 60]).length === 1);

  /**
   * The most recent period must still be reachable — an anomaly nobody can be told about
   * until next quarter is not worth computing.
   */
  check("a spike in the final period is caught", at([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 60])[0]?.index === 13);

  /**
   * …and the mirror of it, which is the bug that finding the one above uncovered.
   *
   * The neighbourhood used to look two periods *either side*, which has no "after" at the
   * end of the window. On a series that curves upward the truncated median sits below the
   * final change by construction, so the last period scored as an anomaly for a reason that
   * was entirely an artefact of the chart ending. It put "Dec '27 was unusual" on four of
   * the seeded model's headline series. Both fixtures below were flagged before the
   * neighbourhood was made backward-looking, and neither is unusual anywhere.
   */
  check("smooth cubic growth does not flag its last period", at(Array.from({ length: 14 }, (_, i) => i ** 3)).length === 0);
  check("…nor does smooth 20%-a-month growth", at(Array.from({ length: 18 }, (_, i) => Math.round(100 * 1.2 ** i))).length === 0);

  /**
   * The detrending fixture, chosen by measuring rather than by assuming.
   *
   * Repo convention is that an assertion has to be mutation-tested, and the obvious mutation
   * — drop the detrending, score the raw changes — was *not* caught by the `i * i` fixture
   * above, whose changes rise linearly and so score the same either way. This one bites:
   * raw scoring calls the −5 month unusual, because the median of an alternating series is
   * a poor centre for it, and detrending against the local level removes it.
   */
  check("ordinary noise around a flat level is not an anomaly", at([10, 12, 9, 11, 10, 13, 8, 11, 10, 12, 9, 11, 10, 12]).length === 0);

  /**
   * A known limit, pinned rather than papered over.
   *
   * Detrending against a local *level* handles linear, quadratic, cubic and 20%-a-month
   * growth. It does not handle doubling every month: with each change twice the last, the
   * trailing median is four times smaller than the change it is judging, so the tail is
   * flagged. No real finance series sustains that, and the alternative — detrending in log
   * space — would break every series that legitimately crosses zero. Documented in
   * `docs/board-plan.md` §4 as a limit, and asserted here so it stays a known one.
   */
  const doubling = at(Array.from({ length: 14 }, (_, i) => 2 ** i));
  check("known limit: a doubling series still flags its tail", doubling.length > 0, `${doubling.length}`);
}

/**
 * The boundary bug, against the real seeded model rather than a fixture.
 *
 * Fixtures are how it was diagnosed; this is the shape it was found in. Every one of these
 * is a growth series ending in Dec '27, and every one of them called that final month
 * unusual. If the neighbourhood ever goes back to being two-sided, this is what says so.
 */
{
  for (const variableId of ["v_closing_arr", "v_closing_accounts", "v_revenue"]) {
    const variable = model.variables.find((v) => v.id === variableId);
    if (!variable) {
      check(`model still has ${variableId}`, false, "fixture changed");
      continue;
    }
    const { labels, series } = resolveSeries(variableId);
    const last = labels.length - 1;
    const found = anomalies(labels, series[0].values);
    check(
      `${variable.name} does not call its final period unusual`,
      found.every((a) => a.index !== last),
      found.map((a) => a.period).join(", "),
    );
  }
}

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
