import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { TX_BUDGET } from "@/lib/tx-budget";

import { OverrideSchema } from "./scenario";

import type { ValidationContext } from "./validate";

import { TOTAL } from "./types";
import type {
  BinaryOp,
  FormulaFn,
  Dimension,
  FormulaNode,
  InputTable,
  Model,
  Period,
  Scenario,
  Variable,
  VariableGroup,
} from "./types";

/**
 * The model, to and from Postgres (`docs/modelling-plan.md` M0).
 *
 * M0's goal is stated as *delete nothing from the UI and change where the model comes from*,
 * and this file is the whole of that change. `readModel` returns the same `Model` object
 * `buildRevenueModel()` used to return, so the engine, the grid and `calc:check` cannot tell
 * the difference — which is the only way to know the fixture was honest.
 *
 * Two conversions happen here and nowhere else.
 *
 * **`Decimal` becomes `number` once, at this edge.** Prisma returns `numeric` as a Decimal
 * object; the engine takes numbers. Doing it here means no component ever meets a Decimal and
 * no float ever creeps into a column — the two failure modes §2 is guarding against, and they
 * point in opposite directions.
 *
 * **The formula tree flattens to rows and rebuilds.** §1.1 forbids a string column, so the
 * AST is stored as `FormulaNode` rows keyed by `parentId` and `order`. Rebuilding is a
 * grouped walk, and `order` is what makes `a - b` come back as `a - b` rather than `b - a`.
 */

/* ── Enum mapping ─────────────────────────────────────────────────────────*/

/**
 * The operator symbols are the AST's, the names are the database's.
 *
 * `+` is not a legal Postgres enum label, and mapping in one table beats scattering
 * `op === "ADD" ? "+" : …` through two files.
 */
const OP_TO_DB = {
  "+": "ADD",
  "-": "SUBTRACT",
  "*": "MULTIPLY",
  "/": "DIVIDE",
  "^": "POWER",
  "=": "EQ",
  "<>": "NEQ",
  "<": "LT",
  "<=": "LTE",
  ">": "GT",
  ">=": "GTE",
} as const satisfies Record<BinaryOp, string>;
const OP_FROM_DB: Record<string, BinaryOp> = Object.fromEntries(
  Object.entries(OP_TO_DB).map(([symbol, name]) => [name, symbol as BinaryOp]),
);

/* ── Periods ──────────────────────────────────────────────────────────────*/

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The columns derive from the horizon rather than being stored per period (§2). */
export function periodsBetween(start: Date, end: Date): Period[] {
  const periods: Period[] = [];
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1;
  const lastYear = end.getUTCFullYear();
  const lastMonth = end.getUTCMonth() + 1;

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    periods.push({
      key: `${year}-${String(month).padStart(2, "0")}`,
      label: `${MONTHS[month - 1]} '${String(year).slice(2)}`,
      year,
      month,
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return periods;
}

export const periodDate = (period: Period) => new Date(Date.UTC(period.year, period.month - 1, 1));

/* ── Writing ──────────────────────────────────────────────────────────────*/

export type FlatNode = {
  id: string;
  parentId: string | null;
  type: FormulaNode["type"];
  op: (typeof OP_TO_DB)[keyof typeof OP_TO_DB] | null;
  literal: number | null;
  refVariableId: string | null;
  refMember: string | null;
  fn: FormulaFn | null;
  order: number;
};

/** Depth-first, so a parent row always precedes the children that reference it. */
export function flattenFormula(node: FormulaNode, variableId: string): FlatNode[] {
  const out: FlatNode[] = [];
  flatten(node, variableId, null, 0, out);
  return out;
}

function flatten(node: FormulaNode, variableId: string, parentId: string | null, order: number, out: FlatNode[]): void {
  const id = `${variableId}:${parentId ?? "root"}:${order}`;
  out.push({
    id,
    parentId,
    type: node.type,
    op: node.type === "binary" ? OP_TO_DB[node.op] : null,
    literal: node.type === "literal" ? node.value : null,
    refVariableId: node.type === "ref" ? node.variableId : null,
    refMember: node.type === "ref" ? (node.member ?? null) : null,
    fn: node.type === "call" ? node.fn : null,
    order,
  });

  if (node.type === "binary") {
    flatten(node.left, variableId, id, 0, out);
    flatten(node.right, variableId, id, 1, out);
  } else if (node.type === "call") {
    node.args.forEach((arg, index) => flatten(arg, variableId, id, index, out));
  }
}

/**
 * Upsert the model on its natural key, so running the seed twice leaves the same rows.
 *
 * Deliberately delete-and-rewrite inside one transaction rather than diffing: M0 is a seed
 * path, and a diff that is subtly wrong produces a model that is subtly wrong, which is far
 * harder to notice than a seed that failed. M3's command stream is what will do incremental
 * writes, and it will do them one typed command at a time.
 */
export async function writeModel(db: PrismaClient, model: Model, slug: string): Promise<string> {
  return db.$transaction(async (tx) => {
    const horizonStart = periodDate(model.periods[0]);
    const horizonEnd = periodDate(model.periods[model.periods.length - 1]);

    const existing = await tx.model.findUnique({ where: { slug } });
    if (existing) await tx.model.delete({ where: { id: existing.id } });

    const created = await tx.model.create({
      data: { id: model.id, name: model.name, slug, baseGrain: "MONTH", horizonStart, horizonEnd },
    });

    for (const dimension of model.dimensions) {
      await tx.dimension.upsert({
        where: { id: dimension.id },
        create: {
          id: dimension.id,
          name: dimension.name,
          members: {
            create: dimension.members.map((member, order) => ({
              id: `${dimension.id}:${member.key}`,
              key: member.key,
              name: member.name,
              order,
            })),
          },
        },
        update: { name: dimension.name },
      });
    }

    await tx.variableGroup.createMany({
      data: model.groups.map((group, order) => ({
        id: group.id,
        modelId: created.id,
        name: group.name,
        chip: group.chip,
        order,
      })),
    });

    await tx.variable.createMany({
      data: model.variables.map((variable, order) => ({
        id: variable.id,
        modelId: created.id,
        groupId: variable.groupId,
        name: variable.name,
        kind: variable.kind,
        format: variable.format,
        aggregation: variable.aggregation,
        dimensionId: variable.dimensionId ?? null,
        memberRollup: variable.memberRollup ?? null,
        timeContext: variable.timeContext ?? null,
        note: variable.note ?? null,
        order,
      })),
    });

    // Formula rows go in after every variable exists, because `refVariableId` is a foreign
    // key — which is exactly the constraint that makes a rename safe (§1.1).
    const nodes: FlatNode[] = [];
    for (const variable of model.variables) {
      if (!variable.formula) continue;
      const flat: FlatNode[] = [];
      flatten(variable.formula, variable.id, null, 0, flat);
      nodes.push(...flat.map((node) => ({ ...node, variableId: variable.id }) as FlatNode & { variableId: string }));
    }
    /**
     * One statement, not one per node.
     *
     * This was a `create()` per row, which is fine against a Postgres on localhost — a few
     * hundred round trips at 0.1ms each disappear. Against a managed database in another
     * region it is fatal: at ~200ms per round trip the loop alone blew the interactive
     * transaction's 5s budget and the seed died with P2028 partway through, leaving nothing
     * written.
     *
     * `createMany` is safe here despite `parentId` being a self-referencing foreign key,
     * for two reasons that both have to hold: `flatten` is pre-order, so a parent is always
     * earlier in the array than its children, and Postgres checks a non-deferrable FK at the
     * end of the *statement* rather than per row. One statement, one round trip.
     */
    await tx.formulaNode.createMany({
      data: (nodes as (FlatNode & { variableId: string })[]).map((node) => ({
        id: node.id,
        variableId: node.variableId,
        parentId: node.parentId,
        type: node.type,
        op: node.op,
        literal: node.literal,
        refVariableId: node.refVariableId,
        refMember: node.refMember,
        fn: node.fn,
        order: node.order,
      })),
    });

    const inputRows: { variableId: string; dimensionKey: string; period: Date; value: number }[] = [];
    for (const [variableId, byMember] of Object.entries(model.inputs)) {
      for (const [member, values] of Object.entries(byMember)) {
        values.forEach((value, index) => {
          const period = model.periods[index];
          if (!period) return;
          inputRows.push({ variableId, dimensionKey: member, period: periodDate(period), value });
        });
      }
    }
    for (let i = 0; i < inputRows.length; i += 1000) {
      await tx.variableInput.createMany({ data: inputRows.slice(i, i + 1000) });
    }

    for (const scenario of model.scenarios) {
      await tx.scenario.create({
        data: {
          id: scenario.id,
          modelId: created.id,
          name: scenario.name,
          isBase: scenario.isBase,
          parentId: scenario.parentId ?? null,
          overrides: {
            create: scenario.overrides.map((override) => ({
              variableId: override.variableId,
              value: override.value,
            })),
          },
        },
      });
    }

    return created.id;
  },
  /**
   * The batching above removes most of the round trips; `TX_BUDGET` covers the ones that
   * remain — an `upsert` per dimension, a `create` per scenario, and the input rows in
   * pages of 1000 — so the deadline does not depend on where the database happens to live.
   */
  TX_BUDGET);
}

/* ── Reading ──────────────────────────────────────────────────────────────*/

/**
 * Just enough of a model to validate a formula against it (M2.3).
 *
 * `readModel` would also do, and would also load 264 input cells and every
 * scenario overlay to answer a question about names, dimensions and the
 * dependency graph. A write path runs this on every keystroke that commits a
 * formula, so it reads the three things the check actually looks at.
 */
export async function readValidationContext(
  tx: Prisma.TransactionClient | PrismaClient,
  modelId: string,
): Promise<ValidationContext> {
  // Sequential, not `Promise.all`. This runs inside a transaction, and a transaction is one
  // connection: two queries in flight on it at once is what `pg` deprecates and what a future
  // major version removes. One extra round trip on a write path is not worth that.
  const variables = await tx.variable.findMany({
    where: { modelId },
    select: { id: true, name: true, dimensionId: true, formula: true },
  });
  const dimensions = await tx.dimension.findMany({
    where: { variables: { some: { modelId } } },
    select: {
      id: true,
      name: true,
      members: { select: { key: true, name: true }, orderBy: { order: "asc" } },
    },
  });

  return {
    variables: variables.map((v) => ({
      id: v.id,
      name: v.name,
      dimensionId: v.dimensionId ?? undefined,
      formula: rebuild(v.formula),
    })),
    dimensions,
  };
}

/** Rebuild one variable's AST from its rows. `order` is what preserves `a - b`. */
export { rebuild as rebuildFormula };

function rebuild(rows: { id: string; parentId: string | null; type: string; op: string | null; literal: unknown; refVariableId: string | null; refMember: string | null; fn: string | null; order: number }[]): FormulaNode | undefined {
  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const bucket = byParent.get(row.parentId) ?? [];
    bucket.push(row);
    byParent.set(row.parentId, bucket);
  }
  for (const bucket of byParent.values()) bucket.sort((a, b) => a.order - b.order);

  const build = (row: (typeof rows)[number]): FormulaNode => {
    const children = byParent.get(row.id) ?? [];
    switch (row.type) {
      case "literal":
        return { type: "literal", value: Number(row.literal) };
      case "ref":
        return {
          type: "ref",
          variableId: row.refVariableId!,
          ...(row.refMember ? { member: row.refMember } : {}),
        };
      case "binary":
        return {
          type: "binary",
          op: OP_FROM_DB[row.op!],
          left: build(children[0]),
          right: build(children[1]),
        };
      default:
        return { type: "call", fn: row.fn as never, args: children.map(build) };
    }
  };

  const root = byParent.get(null)?.[0];
  return root ? build(root) : undefined;
}

/**
 * Accepts a transaction client as well as the root one, because M3.3's rollback has to read
 * the model back *inside* its own transaction — the writes it is checking are not committed
 * yet, and a read on the root client would not see them.
 */
export async function readModel(
  db: Prisma.TransactionClient | PrismaClient,
  slug: string,
): Promise<Model | null> {
  const row = await db.model.findUnique({
    where: { slug },
    include: {
      groups: { orderBy: { order: "asc" } },
      scenarios: { include: { overrides: true }, orderBy: { name: "asc" } },
      variables: {
        orderBy: { order: "asc" },
        include: {
          formula: true,
          inputs: true,
          dimension: { include: { members: { orderBy: { order: "asc" } } } },
        },
      },
    },
  });
  if (!row) return null;

  const periods = periodsBetween(row.horizonStart, row.horizonEnd);
  const periodIndex = new Map(periods.map((period, index) => [period.key, index]));

  const groups: VariableGroup[] = row.groups.map((group) => ({
    id: group.id,
    name: group.name,
    chip: group.chip,
  }));

  const dimensions = new Map<string, Dimension>();
  const variables: Variable[] = row.variables.map((variable) => {
    if (variable.dimension && !dimensions.has(variable.dimension.id)) {
      dimensions.set(variable.dimension.id, {
        id: variable.dimension.id,
        name: variable.dimension.name,
        members: variable.dimension.members.map((member) => ({ key: member.key, name: member.name })),
      });
    }
    const formula = rebuild(variable.formula);
    return {
      id: variable.id,
      groupId: variable.groupId,
      name: variable.name,
      kind: variable.kind,
      format: variable.format,
      aggregation: variable.aggregation,
      ...(formula ? { formula } : {}),
      ...(variable.dimensionId ? { dimensionId: variable.dimensionId } : {}),
      ...(variable.memberRollup ? { memberRollup: variable.memberRollup } : {}),
      ...(variable.timeContext ? { timeContext: variable.timeContext } : {}),
      ...(variable.note ? { note: variable.note } : {}),
    };
  });

  const inputs: InputTable = {};
  for (const variable of row.variables) {
    for (const input of variable.inputs) {
      const key = `${input.period.getUTCFullYear()}-${String(input.period.getUTCMonth() + 1).padStart(2, "0")}`;
      const index = periodIndex.get(key);
      if (index === undefined) continue;
      const table = (inputs[variable.id] ??= {});
      const series = (table[input.dimensionKey] ??= new Array(periods.length).fill(0));
      // The one Decimal → number conversion, at the edge and nowhere else.
      series[index] = Number(input.value);
    }
  }

  const scenarios: Scenario[] = row.scenarios.map((scenario) => ({
    id: scenario.id,
    name: scenario.name,
    isBase: scenario.isBase,
    ...(scenario.parentId ? { parentId: scenario.parentId } : {}),
    overrides: scenario.overrides.map((override) => ({
      variableId: override.variableId,
      // Parsed, not cast. `jsonb` has no shape Postgres will enforce, so a row written by an
      // older build would otherwise be read as `undefined` deep inside the evaluator and
      // quietly become a zero — a wrong number nobody can trace. This fails at the read.
      value: OverrideSchema.parse(override.value),
    })),
  }));

  return {
    id: row.id,
    name: row.name,
    baseGrain: "MONTH",
    periods,
    groups,
    variables,
    dimensions: [...dimensions.values()],
    inputs,
    scenarios,
  };
}

export { TOTAL };
