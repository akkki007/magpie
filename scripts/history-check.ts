/**
 * The command log, end to end — `bun run history:check`.
 *
 * Two claims are made in comments elsewhere and are expensive to be wrong about:
 *
 * 1. **`inverseFromDb` agrees with `applyCommand`'s inverse**, for every command
 *    type. They are two implementations of the same idea — one reads the "before"
 *    state from an in-memory `Model`, the other from Postgres — and a disagreement
 *    does not show up at edit time. It shows up when somebody presses undo, much
 *    later, and puts the model somewhere nobody asked for.
 *
 * 2. **The server's stack walk agrees with the client's reducer.** `historyStacks`
 *    replays the log; `historyReducer` in `workbench.tsx` keeps the same stack in
 *    memory. If they diverge, the undo button and the database disagree about what
 *    the next undo does, and the user finds out by pressing it.
 *
 * Runs against a throwaway model on its own slug and deletes it afterwards, so it
 * never touches the seeded one.
 */
import { db } from "../lib/db";
import {
  acceptProposal,
  changesSince,
  commandsOf,
  historyStacks,
  inverseFromDb,
  proposeChangeSet,
  readHistory,
  readProposal,
  recordChangeSet,
  rejectProposal,
  rollback,
} from "../lib/model/changesets";
import { applyCommand, labelFor, type Command } from "../lib/model/commands";
import { applyCommandToDb } from "../lib/model/commands-db";
import { evaluate } from "../lib/model/engine";
import { lit, mul, ref } from "../lib/model/formula";
import { readModel, writeModel } from "../lib/model/persist";
import { driversFor, forecastScenarios } from "../lib/model/presets";
import { TOTAL, type Model } from "../lib/model/types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Where two models first differ, so a failure names the field instead of dumping both. */
function firstDifference(a: unknown, b: unknown, path = ""): string {
  const left = canonical(a) as Record<string, unknown>;
  const right = canonical(b) as Record<string, unknown>;
  if (JSON.stringify(left) === JSON.stringify(right)) return "";
  if (typeof left !== "object" || typeof right !== "object" || !left || !right) {
    return `${path}: ${JSON.stringify(left)} vs ${JSON.stringify(right)}`;
  }
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const deeper = firstDifference(left[key], right[key], path ? `${path}.${key}` : key);
    if (deeper) return deeper;
  }
  return path;
}

const SLUG = "history-check-scratch";
const ACTOR = { id: null, name: "history-check" };

const FIXTURE: Model = {
  id: "hc_model",
  name: "History check",
  baseGrain: "MONTH",
  periods: [
    { key: "2026-01", label: "Jan", year: 2026, month: 1 },
    { key: "2026-02", label: "Feb", year: 2026, month: 2 },
    { key: "2026-03", label: "Mar", year: 2026, month: 3 },
  ],
  groups: [{ id: "hc_g", name: "Sales", chip: "sky" }],
  dimensions: [],
  scenarios: [
    { id: "hc_base", name: "Base", isBase: true, overrides: [] },
    {
      id: "hc_up",
      name: "Upside",
      isBase: false,
      parentId: "hc_base",
      overrides: [{ variableId: "hc_units", value: { kind: "SCALE", factor: 2 } }],
    },
  ],
  inputs: {
    hc_units: { [TOTAL]: [10, 20, 30] },
    hc_price: { [TOTAL]: [5, 5, 5] },
  },
  variables: [
    { id: "hc_units", groupId: "hc_g", name: "Units", kind: "INPUT", format: "COUNT", aggregation: "SUM" },
    { id: "hc_price", groupId: "hc_g", name: "Price", kind: "INPUT", format: "CURRENCY", aggregation: "AVG" },
    {
      id: "hc_sales",
      groupId: "hc_g",
      name: "Sales",
      kind: "FORMULA",
      format: "CURRENCY",
      aggregation: "SUM",
      formula: mul(ref("hc_units"), ref("hc_price")),
    },
  ],
};

await writeModel(db, FIXTURE, SLUG);
const modelId = (await db.model.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })).id;

const load = async () => (await readModel(db, SLUG))!;

/** Apply through the log, exactly as `persistCommand` does. */
async function edit(command: Command) {
  const id = crypto.randomUUID();
  await db.$transaction(async (tx) => {
    const inverse = await inverseFromDb(tx, modelId, command);
    await recordChangeSet(tx, {
      id,
      modelId,
      kind: "EDIT",
      label: labelFor(command),
      actor: ACTOR,
      commands: [{ command, inverse }],
    });
  });
  return id;
}

/* ── 1. The two inverses agree ────────────────────────────────────────────*/

console.log("\nInverses: Postgres vs the in-memory model");
{
  const cases: Command[] = [
    { type: "SetInput", variableId: "hc_units", member: TOTAL, period: 1, value: 99 },
    // A cell that has never been written: the in-memory model reads zero, and so
    // must the database, or undo restores a number that was never there.
    { type: "SetInput", variableId: "hc_price", member: "nonexistent", period: 2, value: 7 },
    { type: "RenameVariable", variableId: "hc_units", name: "Unit Count" },
    { type: "SetFormula", variableId: "hc_sales", formula: ref("hc_units") },
    { type: "SetFormula", variableId: "hc_price", formula: ref("hc_units") },
    { type: "RemoveVariable", variableId: "hc_sales" },
    {
      type: "InsertVariable",
      index: 1,
      variable: { id: "hc_new", groupId: "hc_g", name: "New Row", kind: "INPUT", format: "COUNT", aggregation: "SUM" },
      inputs: { [TOTAL]: [1, 2, 3] },
    },
    {
      type: "CreateScenario",
      scenario: {
        id: "hc_down",
        name: "Downside",
        isBase: false,
        parentId: "hc_base",
        overrides: [{ variableId: "hc_units", value: { kind: "SCALE", factor: 0.5 } }],
      },
    },
    { type: "RenameScenario", scenarioId: "hc_up", name: "Best case" },
    { type: "DeleteScenario", scenarioId: "hc_up" },
    // Replacing an override that is already there — the inverse has to be the *old* one,
    // not "no override", or undoing an edit inside a scenario deletes the overlay.
    {
      type: "SetOverride",
      scenarioId: "hc_up",
      variableId: "hc_units",
      value: { kind: "VALUES", cells: { [TOTAL]: [1, null, null] } },
    },
  ];

  for (const command of cases) {
    const model = await load();
    const memory = applyCommand(model, command).inverse;
    const database = await db.$transaction((tx) => inverseFromDb(tx, modelId, command));
    check(
      `${command.type}${command.type === "SetFormula" ? ` on ${command.variableId}` : ""}`,
      same(memory, database),
      `memory ${JSON.stringify(memory)} vs db ${JSON.stringify(database)}`,
    );
  }
}

/* ── 2. Edits are recorded, and undo is a query over the stream ──────────*/

console.log("\nThe log");
{
  await writeModel(db, FIXTURE, SLUG);
  const fresh = (await db.model.findUniqueOrThrow({ where: { slug: SLUG }, select: { id: true } })).id;
  if (fresh !== modelId) throw new Error("fixture id changed between writes");

  const a = await edit({ type: "SetInput", variableId: "hc_units", member: TOTAL, period: 0, value: 11 });
  const b = await edit({ type: "SetInput", variableId: "hc_units", member: TOTAL, period: 1, value: 22 });
  const c = await edit({ type: "RenameVariable", variableId: "hc_price", name: "Unit Price" });

  let entries = await db.$transaction((tx) => readHistory(tx, modelId));
  check("three edits, three changesets", entries.length === 3, `${entries.length}`);
  check("seq is 1, 2, 3", same([...entries].map((e) => e.seq).sort((x, y) => (x ?? 0) - (y ?? 0)), [1, 2, 3]));
  check("the actor is recorded", entries.every((e) => e.actorName === "history-check"));
  check("labels come from labelFor", entries.some((e) => e.label === "Rename variable"));

  let stacks = historyStacks(entries);
  check("the undo stack is the three edits, oldest first", same(stacks.undo, [a, b, c]));
  check("nothing to redo", stacks.redo.length === 0);

  /** The undo the action performs, minus the session and slug plumbing. */
  async function move(kind: "UNDO" | "REDO") {
    const current = historyStacks(await db.$transaction((tx) => readHistory(tx, modelId)));
    const target = (kind === "UNDO" ? current.undo : current.redo).at(-1);
    if (!target) throw new Error(`nothing to ${kind}`);
    await db.$transaction(async (tx) => {
      const commands = await commandsOf(tx, target);
      await recordChangeSet(tx, {
        id: crypto.randomUUID(),
        modelId,
        kind,
        label: `${kind} target`,
        actor: ACTOR,
        targetId: target,
        commands:
          kind === "UNDO"
            ? [...commands].reverse().map(({ command, inverse }) => ({ command: inverse, inverse: command }))
            : commands,
      });
    });
    return target;
  }

  check("Unit Price was applied", (await load()).variables.find((v) => v.id === "hc_price")?.name === "Unit Price");
  const undone = await move("UNDO");
  check("undo targeted the newest edit", undone === c);
  check(
    "the rename is reverted in the database",
    (await load()).variables.find((v) => v.id === "hc_price")?.name === "Price",
  );

  stacks = historyStacks(await db.$transaction((tx) => readHistory(tx, modelId)));
  check("the undone edit moved to the redo stack", same(stacks.undo, [a, b]) && same(stacks.redo, [c]));

  await move("REDO");
  check(
    "redo reapplies it",
    (await load()).variables.find((v) => v.id === "hc_price")?.name === "Unit Price",
  );
  stacks = historyStacks(await db.$transaction((tx) => readHistory(tx, modelId)));
  check("and it is back on the undo stack", same(stacks.undo, [a, b, c]) && stacks.redo.length === 0);

  // The rule the client reducer applies, and the reason a redo branch is not a
  // tree: a new edit after an undo abandons what was undone.
  await move("UNDO");
  const d = await edit({ type: "SetInput", variableId: "hc_units", member: TOTAL, period: 2, value: 33 });
  stacks = historyStacks(await db.$transaction((tx) => readHistory(tx, modelId)));
  check("a new edit clears the redo branch", same(stacks.undo, [a, b, d]) && stacks.redo.length === 0);

  entries = await db.$transaction((tx) => readHistory(tx, modelId));
  check("nothing was deleted from the log", entries.length === 7, `${entries.length}`);
  check(
    "every undo names what it undid",
    entries.filter((e) => e.kind === "UNDO").every((e) => e.targetId !== null),
  );
}

/* ── 3. The server's state matches replaying the same commands in memory ──*/

console.log("\nServer state vs the client's own copy");
{
  await writeModel(db, FIXTURE, SLUG);
  let local = await load();

  const script: Command[] = [
    { type: "SetInput", variableId: "hc_units", member: TOTAL, period: 0, value: 7 },
    { type: "SetFormula", variableId: "hc_sales", formula: mul(mul(ref("hc_units"), ref("hc_price")), ref("hc_units")) },
    { type: "RenameVariable", variableId: "hc_units", name: "Volume" },
    { type: "SetInput", variableId: "hc_price", member: TOTAL, period: 2, value: 9 },
  ];

  const ids: string[] = [];
  for (const command of script) {
    local = applyCommand(local, command).model;
    ids.push(await edit(command));
  }

  const series = (model: Model) => evaluate(model, "hc_base").series("hc_sales");
  check(
    "the same four commands land on the same numbers",
    same(series(local), series(await load())),
    `${JSON.stringify(series(local))} vs ${JSON.stringify(series(await load()))}`,
  );
  check("the log agrees on the order", same(historyStacks(await db.$transaction((tx) => readHistory(tx, modelId))).undo, ids));
}

/* ── 4. Scenarios (M4) ───────────────────────────────────────────────────*/

console.log("\nScenarios as overlays");
{
  await writeModel(db, FIXTURE, SLUG);
  const model = await load();

  const base = evaluate(model, "hc_base");
  const up = evaluate(model, "hc_up");
  check("the base case is unchanged by an overlay", same(base.series("hc_units"), [10, 20, 30]));
  check("a SCALE override multiplies the base input", same(up.series("hc_units"), [20, 40, 60]));
  check(
    "an unoverridden variable falls through",
    same(base.series("hc_price"), up.series("hc_price")),
  );
  check(
    "formulas recompute from the overridden input",
    same(up.series("hc_sales"), [100, 200, 300]),
    JSON.stringify(up.series("hc_sales")),
  );

  // A VALUES override pins some periods and not others, which is the difference between
  // "edit March in the downside" and "freeze the whole row at today's numbers".
  await edit({
    type: "SetOverride",
    scenarioId: "hc_up",
    variableId: "hc_units",
    value: { kind: "VALUES", cells: { [TOTAL]: [null, 999, null] } },
  });
  const pinned = evaluate(await load(), "hc_up");
  check("a pinned cell wins", pinned.series("hc_units")[1] === 999);
  check(
    "an unpinned cell falls through to the base, not to the old SCALE",
    same(pinned.series("hc_units"), [10, 999, 30]),
    JSON.stringify(pinned.series("hc_units")),
  );
  check("the grid can tell which cells are held", pinned.isOverridden("hc_units", TOTAL, 1));
  check("and which are not", !pinned.isOverridden("hc_units", TOTAL, 0));
  check("and that another variable is not", !pinned.isOverridden("hc_price", TOTAL, 1));

  // Branching: a child inherits what it does not restate, and the nearest override wins
  // outright rather than composing with its parent.
  await edit({
    type: "CreateScenario",
    scenario: { id: "hc_deep", name: "Deeper", isBase: false, parentId: "hc_up", overrides: [] },
  });
  const inherited = evaluate(await load(), "hc_deep");
  check("a branch inherits its parent's overrides", same(inherited.series("hc_units"), [10, 999, 30]));

  await edit({
    type: "SetOverride",
    scenarioId: "hc_deep",
    variableId: "hc_units",
    value: { kind: "SCALE", factor: 3 },
  });
  const restated = evaluate(await load(), "hc_deep");
  check(
    "a restated override replaces the parent's rather than compounding it",
    same(restated.series("hc_units"), [30, 60, 90]),
    JSON.stringify(restated.series("hc_units")),
  );

  // A formula override changes the shape of the calculation, not only its inputs (§4).
  await edit({
    type: "SetOverride",
    scenarioId: "hc_up",
    variableId: "hc_sales",
    value: { kind: "FORMULA", formula: mul(ref("hc_units"), lit(100)) },
  });
  const reshaped = evaluate(await load(), "hc_up");
  check("a FORMULA override replaces the variable's own", same(reshaped.series("hc_sales"), [1000, 99900, 3000]));
  check("and the base case still uses the original", same(evaluate(await load(), "hc_base").series("hc_sales"), [50, 100, 150]));

  const refuses = async (command: Parameters<typeof edit>[0]) =>
    edit(command).then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

  check(
    "the base case cannot be deleted",
    (await refuses({ type: "DeleteScenario", scenarioId: "hc_base" })).includes("base case"),
  );
  check(
    "a scenario with branches cannot be deleted",
    (await refuses({ type: "DeleteScenario", scenarioId: "hc_up" })).includes("branches"),
  );
  check(
    "the base case does not take overrides",
    (await refuses({
      type: "SetOverride",
      scenarioId: "hc_base",
      variableId: "hc_units",
      value: { kind: "SCALE", factor: 2 },
    })).includes("values, not overrides"),
  );
}

/* ── 5. A batch changeset (M4.4's write path, §1.4's) ────────────────────*/

console.log("\nBatches");
{
  await writeModel(db, FIXTURE, SLUG);

  // Two commands where the second's before-state is what the first left behind. Computing
  // both inverses up front would invert the batch to the wrong starting point — the second
  // inverse would say "back to Units" when the value it actually replaced was "Volume".
  const batch: Command[] = [
    { type: "RenameVariable", variableId: "hc_units", name: "Volume" },
    { type: "RenameVariable", variableId: "hc_units", name: "Quantity" },
  ];

  const id = crypto.randomUUID();
  await db.$transaction(async (tx) => {
    const applied: { command: Command; inverse: Command }[] = [];
    for (const command of batch) {
      const inverse = await inverseFromDb(tx, modelId, command);
      await applyCommandToDb(tx, modelId, command);
      applied.push({ command, inverse });
    }
    await recordChangeSet(tx, {
      id,
      modelId,
      kind: "EDIT",
      label: "Two renames",
      actor: ACTOR,
      commands: applied,
      alreadyApplied: true,
    });
  });

  check("the batch applied in order", (await load()).variables.find((v) => v.id === "hc_units")?.name === "Quantity");

  const entries = await db.$transaction((tx) => readHistory(tx, modelId));
  check("two commands, one changeset", entries.length === 1 && entries[0].commandCount === 2,
    `${entries.length} changesets, ${entries[0]?.commandCount} commands`);

  const stored = await db.$transaction((tx) => commandsOf(tx, id));
  check(
    "the second inverse points at what the first command left, not the original",
    (stored[1].inverse as { name: string }).name === "Volume",
    JSON.stringify(stored[1].inverse),
  );

  // Undoing a batch replays its inverses backwards, which is the only order that lands back
  // where it started: "back to Volume" then "back to Units".
  await db.$transaction(async (tx) => {
    const commands = await commandsOf(tx, id);
    await recordChangeSet(tx, {
      id: crypto.randomUUID(),
      modelId,
      kind: "UNDO",
      label: "Undo two renames",
      actor: ACTOR,
      targetId: id,
      commands: [...commands].reverse().map(({ command, inverse }) => ({ command: inverse, inverse: command })),
    });
  });
  check(
    "undoing the batch returns the original name",
    (await load()).variables.find((v) => v.id === "hc_units")?.name === "Units",
    (await load()).variables.find((v) => v.id === "hc_units")?.name,
  );
}

/* ── 6. Forecast presets (M4.4) ──────────────────────────────────────────*/

console.log("\nForecast presets");
{
  // Against the *real* model, not the fixture: the claim is that direction is worked out
  // rather than guessed, and only a model with a churn rate in it can test that.
  const revenue = (await readModel(db, "revenue-model-2026"))!;
  const closingArr = revenue.variables.find((v) => v.name === "Closing ARR")!;
  const drivers = driversFor(revenue, closingArr.id);

  check("it found the drivers Closing ARR responds to", drivers.length > 0, `${drivers.length}`);
  check(
    "every driver is an input",
    drivers.every((d) => revenue.variables.find((v) => v.id === d.variableId)?.kind === "INPUT"),
  );

  const by = (name: string) => drivers.find((d) => d.name === name);
  check("more new accounts is better", (by("New Accounts")?.sensitivity ?? 0) > 0, JSON.stringify(by("New Accounts")));
  check("more churn is worse", (by("Gross Churn Rate")?.sensitivity ?? 0) < 0, JSON.stringify(by("Gross Churn Rate")));
  check("more expansion is better", (by("Expansion Rate")?.sensitivity ?? 0) > 0);
  check(
    "an input Closing ARR does not depend on is left out",
    !by("Collected In Month"),
    JSON.stringify(by("Collected In Month")),
  );

  const { upside, downside } = forecastScenarios(revenue, closingArr.id, 0.15, {
    upside: "Best case",
    downside: "Worst case",
  });

  const factorOf = (scenario: typeof upside, name: string) => {
    const id = drivers.find((d) => d.name === name)?.variableId;
    const value = scenario.overrides.find((o) => o.variableId === id)?.value;
    return value?.kind === "SCALE" ? value.factor : NaN;
  };
  check("the upside raises new accounts", factorOf(upside, "New Accounts") > 1);
  check(
    "the upside LOWERS churn — the whole point of measuring direction",
    factorOf(upside, "Gross Churn Rate") < 1,
    `${factorOf(upside, "Gross Churn Rate")}`,
  );
  check("the downside does the opposite", factorOf(downside, "Gross Churn Rate") > 1);

  const withBoth = { ...revenue, scenarios: [...revenue.scenarios, upside, downside] };
  const best = evaluate(withBoth, upside.id).series(closingArr.id).at(-1)!;
  const worst = evaluate(withBoth, downside.id).series(closingArr.id).at(-1)!;
  const base = evaluate(revenue, revenue.scenarios.find((s) => s.isBase)!.id)
    .series(closingArr.id)
    .at(-1)!;
  check(
    "worst < base < best at the horizon",
    worst < base && base < best,
    `${Math.round(worst)} / ${Math.round(base)} / ${Math.round(best)}`,
  );
}

/* ── 7. Proposals (§1.4, M5.3) ────────────────────────────────────────────*/

console.log("\nProposals");
{
  await writeModel(db, FIXTURE, SLUG);
  const proposalId = crypto.randomUUID();

  await db.$transaction((tx) =>
    proposeChangeSet(tx, {
      id: proposalId,
      modelId,
      label: "Set units to 500 and rename",
      actor: ACTOR,
      commands: [
        { type: "SetInput", variableId: "hc_units", member: TOTAL, period: 0, value: 500 },
        { type: "RenameVariable", variableId: "hc_units", name: "Volume" },
      ],
    }),
  );

  check("nothing changed yet", (await load()).variables.find((v) => v.id === "hc_units")?.name === "Units");

  let log = await db.$transaction((tx) => readHistory(tx, modelId));
  check("a pending proposal does not appear in the ordered log", log.length === 0, `${log.length}`);

  await edit({ type: "SetInput", variableId: "hc_price", member: TOTAL, period: 0, value: 42 });
  check("a real edit still gets seq 1 — the pending proposal took no slot", (await db.$transaction((tx) => readHistory(tx, modelId)))[0]?.seq === 1);

  const read = await db.$transaction((tx) => readProposal(tx, modelId, proposalId));
  check("the proposal reads back with its commands", read?.commands.length === 2, `${read?.commands.length}`);

  const accepted = await db.$transaction((tx) =>
    acceptProposal(tx, { id: proposalId, modelId }),
  );
  check("accepting reported success", accepted.ok, accepted.ok ? "" : accepted.error);
  check(
    "accepting actually applies both commands",
    (await load()).variables.find((v) => v.id === "hc_units")?.name === "Volume" &&
      (await load()).inputs.hc_units[TOTAL][0] === 500,
  );

  log = await db.$transaction((tx) => readHistory(tx, modelId));
  check("the accepted proposal now has a seq and is in the log", log.length === 2, `${log.length}`);
  check("it took the next slot rather than the one it would have had if proposed = applied", log.some((e) => e.seq === 2));

  const stored = await db.$transaction((tx) => commandsOf(tx, proposalId));
  check(
    "its inverses were computed at accept time, not left null",
    stored.every((c) => c.inverse !== null && c.inverse !== undefined),
  );
  check(
    "the rename inverse reflects the name at accept time",
    (stored[1].inverse as { name: string }).name === "Units",
    JSON.stringify(stored[1].inverse),
  );

  const stacks = historyStacks(log);
  check("an accepted proposal can be undone like any other changeset", stacks.undo.at(-1) === proposalId);

  // Reject: a second proposal that never touches the model.
  const rejectedId = crypto.randomUUID();
  await db.$transaction((tx) =>
    proposeChangeSet(tx, {
      id: rejectedId,
      modelId,
      label: "A proposal nobody wants",
      actor: ACTOR,
      commands: [{ type: "RemoveVariable", variableId: "hc_sales" }],
    }),
  );
  await db.$transaction((tx) => rejectProposal(tx, { id: rejectedId, modelId }));
  check(
    "rejecting leaves the model untouched",
    (await load()).variables.some((v) => v.id === "hc_sales"),
  );
  log = await db.$transaction((tx) => readHistory(tx, modelId));
  check("a rejected proposal never enters the ordered log", log.length === 2, `${log.length}`);

  const acceptTwice = await db.$transaction((tx) => acceptProposal(tx, { id: proposalId, modelId }));
  check("accepting an already-accepted proposal is refused, not reapplied", !acceptTwice.ok);
}

/* ── 8. Versions and rollback (M3.3) ─────────────────────────────────────*/

console.log("\nRollback");
{
  await writeModel(db, FIXTURE, SLUG);

  const before = await load();
  const head = await db.changeSet.findFirst({ where: { modelId }, orderBy: { seq: "desc" }, select: { seq: true } });
  const version = await db.modelVersion.create({
    data: {
      modelId,
      seq: head?.seq ?? 0,
      label: "Before the mess",
      snapshot: before as never,
      actorId: null,
      actorName: "history-check",
    },
  });

  // A deliberately awkward sequence: an edit, a formula change, a delete, and an
  // undo in the middle of it. The undo is the interesting one — a rollback that
  // only reversed "edits" would leave it applied and land somewhere nobody named.
  await edit({ type: "SetInput", variableId: "hc_units", member: TOTAL, period: 0, value: 500 });
  const swapped = await edit({ type: "SetFormula", variableId: "hc_sales", formula: ref("hc_units") });
  await db.$transaction(async (tx) => {
    const commands = await commandsOf(tx, swapped);
    await recordChangeSet(tx, {
      id: crypto.randomUUID(),
      modelId,
      kind: "UNDO",
      label: "Undo edit formula",
      actor: ACTOR,
      targetId: swapped,
      commands: [...commands].reverse().map(({ command, inverse }) => ({ command: inverse, inverse: command })),
    });
  });
  await edit({ type: "RemoveVariable", variableId: "hc_price" });
  await edit({ type: "RenameVariable", variableId: "hc_units", name: "Quantity" });

  // An undone *delete*, which is what makes this scenario able to tell a correct
  // rollback from a plausible one. Every other command sets an absolute value, so
  // replaying it twice lands in the same place and a rollback that skipped the
  // undos would still look right. Insert and remove are not idempotent: skip the
  // undo below and the replay tries to insert a row that is already there.
  const deleted = await edit({ type: "RemoveVariable", variableId: "hc_sales" });
  await db.$transaction(async (tx) => {
    const commands = await commandsOf(tx, deleted);
    await recordChangeSet(tx, {
      id: crypto.randomUUID(),
      modelId,
      kind: "UNDO",
      label: "Undo delete variable",
      actor: ACTOR,
      targetId: deleted,
      commands: [...commands].reverse().map(({ command, inverse }) => ({ command: inverse, inverse: command })),
    });
  });

  const messy = await load();
  check("the model really did move", !same(messy, before));
  check("a variable was deleted along the way", messy.variables.length === 2, `${messy.variables.length}`);

  const changes = await db.$transaction((tx) => changesSince(tx, modelId, version.seq));
  check("seven changesets since the version, both undos included", changes.length === 7, `${changes.length}`);

  const rolled = await db.$transaction((tx) =>
    rollback(tx, {
      modelId,
      slug: SLUG,
      changeSetId: crypto.randomUUID(),
      actor: ACTOR,
      version: { seq: version.seq, label: version.label, snapshot: before },
    }),
  );
  check("the rollback reported success", rolled.ok, rolled.ok ? "" : rolled.error);

  const restored = await load();
  check(
    "replaying the inverses reproduces the snapshot exactly",
    same(restored, before),
    firstDifference(restored, before),
  );
  check("the deleted variable came back with its inputs", same(restored.inputs.hc_price, before.inputs.hc_price));

  const log = await db.$transaction((tx) => readHistory(tx, modelId));
  check("the rollback is in the log with an actor", log[0]?.kind === "ROLLBACK" && log[0]?.actorName === "history-check");
  check("nothing was deleted to achieve it", log.length === 8, `${log.length}`);

  const stacks = historyStacks(log);
  check("the rollback itself can be undone", stacks.undo.at(-1) === log[0]?.id);

  // The snapshot is the check, so a snapshot that does not match what the replay produces
  // has to be refused rather than accepted quietly. Nothing in the product can produce a
  // wrong snapshot today — which is exactly why the refusal needs testing here.
  await edit({ type: "SetInput", variableId: "hc_units", member: TOTAL, period: 0, value: 4242 });
  const lied = await db
    .$transaction(async (tx) =>
      rollback(tx, {
        modelId,
        slug: SLUG,
        changeSetId: crypto.randomUUID(),
        actor: ACTOR,
        version: {
          seq: version.seq,
          label: "A snapshot that never was",
          snapshot: { ...before, name: "Something else entirely" },
        },
      }),
    )
    .catch((error: unknown) => ({ ok: false as const, error: String(error) }));
  check("a replay that does not reproduce the snapshot is refused", !lied.ok, lied.ok ? "accepted" : "");
}

await db.model.delete({ where: { slug: SLUG } });

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
