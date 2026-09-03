/**
 * The agent's safety boundary, without a network call — `bun run agent:check`.
 *
 * `openai-agent.ts` decides *how to talk to a model*; `agent-tools.ts` decides *what a
 * proposal is allowed to be*, and that second file has no SDK import so it can be tested
 * without one. This script is the proof that groundProposal actually enforces §5's rule —
 * "a proposal that does not compile never reaches the UI" — against the cases an LLM is
 * most likely to produce: a hallucinated id, a cycle, a reference to a row it is creating
 * in the same breath.
 */
import { evaluate } from "../lib/model/engine";
import { getModelOutline, getSeries, getVariable, groundProposal, runScenario } from "../lib/model/agent-tools";
import { readModel } from "../lib/model/persist";
import { db } from "../lib/db";
import { TOTAL } from "../lib/model/types";
import { V } from "../prisma/seed-data";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const model = await readModel(db, "revenue-model-2026");
if (!model) {
  console.error("\nNo seeded model — run `bun run seed` first.\n");
  process.exit(1);
}

console.log("\nReads");
{
  const outline = getModelOutline(model);
  check("the outline lists every variable", outline.variables.length === model.variables.length);
  check(
    "the outline carries printed formulas, not trees",
    typeof outline.variables.find((v) => v.id === V.closingArr)?.formula === "string",
  );
  check(
    "the outline holds no series values",
    !JSON.stringify(outline).includes("\"periods\":[") || !("value" in (outline as never)),
  );

  const variable = getVariable(model, { variableId: V.closingArr });
  check("getVariable resolves a real id", "id" in variable && variable.id === V.closingArr);
  const missing = getVariable(model, { variableId: "nonexistent" });
  check("getVariable reports a missing id rather than throwing", "error" in missing);

  const series = getSeries(model, { variableId: V.closingArr });
  const periodCount = "periods" in series ? series.periods?.length : undefined;
  check("getSeries matches the engine directly", periodCount === model.periods.length);
}

console.log("\nrunScenario is a sandbox");
{
  const before = evaluate(model, "s_base").series(V.closingArr)[0];
  const preview = runScenario(model, {
    commands: [{ type: "SetInput", variableId: V.startingArr, member: "", period: 0, value: 999_999_999 }],
  });
  check("it reports a moved series", "affected" in preview && (preview.affected?.length ?? 0) > 0);
  const after = evaluate(model, "s_base").series(V.closingArr)[0];
  check("and never touches the model it was called with", before === after);
}

console.log("\ngroundProposal — the gate before a human sees anything");
{
  const ok = groundProposal(model, {
    label: "Raise churn tolerance",
    commands: [{ type: "SetInput", variableId: V.churnRate, member: "", period: 0, value: 0.02 }],
  });
  check("a real command against a real variable is accepted", ok.ok, ok.ok ? "" : ok.error);

  const hallucinated = groundProposal(model, {
    label: "Nonsense",
    commands: [{ type: "SetInput", variableId: "v_does_not_exist", member: "", period: 0, value: 1 }],
  });
  check("a hallucinated variable id is refused", !hallucinated.ok);

  const cyclic = groundProposal(model, {
    label: "Break the waterfall",
    commands: [{ type: "SetFormula", variableId: V.openingArr, formula: { type: "ref", variableId: V.closingArr } }],
  });
  check(
    "a formula that creates a cycle is refused before it reaches the UI",
    !cyclic.ok && cyclic.error.includes("Circular"),
    cyclic.ok ? "accepted" : cyclic.error,
  );

  // Creating a variable and using it in the same batch — the case §5 names explicitly.
  const created = groundProposal(model, {
    label: "Add a driver and reference it",
    commands: [
      {
        type: "InsertVariable",
        index: 0,
        variable: { id: "v_new_driver", groupId: model.groups[0].id, name: "New Driver", kind: "INPUT", format: "COUNT", aggregation: "SUM" },
      },
      { type: "SetFormula", variableId: V.newArr, formula: { type: "ref", variableId: "v_new_driver" } },
    ],
  });
  check(
    "a variable created earlier in the batch can be referenced later in it",
    created.ok,
    created.ok ? "" : created.error,
  );

  const backwards = groundProposal(model, {
    label: "Reference before creation",
    commands: [
      { type: "SetFormula", variableId: V.newArr, formula: { type: "ref", variableId: "v_not_yet" } },
      {
        type: "InsertVariable",
        index: 0,
        variable: { id: "v_not_yet", groupId: model.groups[0].id, name: "Too Late", kind: "INPUT", format: "COUNT", aggregation: "SUM" },
      },
    ],
  });
  check("but not before it exists — order in the batch matters", !backwards.ok);

  // A live run against this exact model produced this: SetOverride pointed at the base
  // case, passed grounding, and would have failed only when a human clicked Accept.
  const baseOverride = groundProposal(model, {
    label: "Grow faster",
    commands: [{ type: "SetOverride", scenarioId: "s_base", variableId: V.newAccounts, value: { kind: "SCALE", factor: 1.2 } }],
  });
  check(
    "an override on the base scenario is refused before it reaches the UI",
    !baseOverride.ok && baseOverride.error.includes("base case"),
    baseOverride.ok ? "accepted" : baseOverride.error,
  );

  const badArity = groundProposal(model, {
    label: "Bad call",
    commands: [{ type: "SetFormula", variableId: V.revenue, formula: { type: "call", fn: "ABS", args: [] } }],
  });
  check("an arity error is caught the same way a human's would be", !badArity.ok);
}

/* ── A period is not a dimension member (found by the finance-ops agent) ──
 *
 * `CommandSchema` types `member` as a string and nothing checked it against the variable's
 * dimension, so a live run proposing `{ variableId: v_new_accounts, member: "2026-07",
 * period: 7 }` grounded clean. `New Accounts` is dimensioned by plan, so accepting that
 * would have written an input under a key no row reads — invisible in the grid, absent from
 * every rollup, and still sitting in `variable_input`. Data that exists and cannot be seen
 * is worse than a rejected proposal.
 */
{
  const dimensioned = model.variables.find((v) => v.dimensionId);
  const plain = model.variables.find((v) => !v.dimensionId && v.kind === "INPUT");

  if (dimensioned && plain) {
    const set = (variableId: string, member: string, period = 0) =>
      groundProposal(model, {
        label: "member check",
        commands: [{ type: "SetInput", variableId, member, period, value: 1 }] as never,
      });

    check(
      "a period string is not accepted as a dimension member",
      !set(dimensioned.id, "2026-07").ok,
      "it grounded clean — an input would land under a key nothing reads",
    );
    check(
      "…and the error names the real members",
      /starter|growth|enterprise/.test((set(dimensioned.id, "2026-07") as { error?: string }).error ?? ""),
    );
    check("a real member key is accepted", set(dimensioned.id, "growth").ok);
    check("TOTAL is accepted on a dimensioned row", set(dimensioned.id, TOTAL).ok);
    check(
      "a member on an undimensioned row is refused",
      !set(plain.id, "growth").ok,
      "an undimensioned variable has no members to set",
    );
    check(
      "a period past the horizon is refused",
      !set(dimensioned.id, TOTAL, model.periods.length + 5).ok,
      "it would write outside the model",
    );
  } else {
    check("fixture has a dimensioned and a plain input variable", false, "fixture changed");
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
