import type { Table } from "@/lib/data/types";
import type { Model } from "@/lib/model/types";

import { resolveTile, type TileSpec } from "./spec";

/**
 * Turning a question into a tile — the safety half (`docs/board-plan.md` feature 1).
 *
 * No AI SDK import here, deliberately: this is the same boundary `lib/model/agent-tools.ts`
 * draws for the modelling agent and `lib/recon/adjudicate.ts` draws for reconciliation.
 * Everything that decides whether a generated tile is *honest* lives in a module a script
 * can call without a provider key, and the vendor lives in one file next door.
 */

/** Everything the model is allowed to reference, and nothing else. */
export function catalogue(model: Model, tables: Table[]) {
  return {
    model: {
      name: model.name,
      periods: `${model.periods[0]?.label} – ${model.periods.at(-1)?.label} (${model.periods.length} months)`,
      variables: model.variables.map((v) => ({
        id: v.id,
        name: v.name,
        unit: v.format,
        kind: v.kind,
      })),
    },
    tables: tables.map((t) => ({
      slug: t.slug,
      name: t.name,
      rows: t.rows.length,
      fields: t.fields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
    })),
  };
}

export type Grounded = { ok: true; spec: TileSpec } | { ok: false; error: string };

/**
 * Reject a tile that references something that does not exist, or that draws a shape the
 * data cannot honestly carry.
 *
 * The errors are written to be *corrected from*, not just reported — the same lesson the
 * modelling agent taught when a generic "not well-formed" sent it round six identical
 * failures. Each one names the thing that was wrong and what was available instead.
 */
export function groundTile(spec: TileSpec, model: Model, tables: Table[]): Grounded {
  if (spec.kind === "text") return { ok: true, spec };

  const source = spec.source;

  if (source.kind === "model") {
    for (const id of source.variableIds) {
      if (!model.variables.some((v) => v.id === id)) {
        return {
          ok: false,
          error: `No variable with id "${id}". Use an id from the catalogue exactly as given.`,
        };
      }
    }
  } else {
    const table = tables.find((t) => t.slug === source.tableSlug);
    if (!table) {
      return {
        ok: false,
        error: `No table with slug "${source.tableSlug}". Available: ${tables.map((t) => t.slug).join(", ") || "none"}.`,
      };
    }

    const field = (id: string | null) => (id ? table.fields.find((f) => f.id === id) : undefined);

    const dateField = field(source.dateFieldId);
    if (!dateField) {
      return {
        ok: false,
        error: `"${source.dateFieldId}" is not a field on ${table.name}. Date fields: ${describe(table, "DATE")}.`,
      };
    }
    if (dateField.type !== "DATE") {
      return {
        ok: false,
        error: `${dateField.name} is a ${dateField.type} column and cannot bucket periods. Date fields: ${describe(table, "DATE")}.`,
      };
    }

    if (source.aggregation !== "COUNT") {
      const valueField = field(source.valueFieldId);
      if (!valueField) {
        return {
          ok: false,
          error: `${source.aggregation} needs a numeric column. Available: ${describe(table, "NUMBER", "CURRENCY")}.`,
        };
      }
      if (valueField.type !== "NUMBER" && valueField.type !== "CURRENCY") {
        return {
          ok: false,
          error: `${valueField.name} is a ${valueField.type} column — ${source.aggregation} needs a number. Available: ${describe(table, "NUMBER", "CURRENCY")}.`,
        };
      }
    }

    if (source.breakdownFieldId) {
      const breakdown = field(source.breakdownFieldId);
      if (!breakdown) {
        return {
          ok: false,
          error: `"${source.breakdownFieldId}" is not a field on ${table.name}. Breakdown fields: ${describe(table, "SELECT", "TEXT")}.`,
        };
      }
      if (breakdown.type === "DATE") {
        return { ok: false, error: `Cannot break down by ${breakdown.name} — the periods are already the date axis.` };
      }
    }
  }

  /**
   * A KPI is one number, so it must resolve to exactly one series. A breakdown would give
   * it several and the card would silently show the first — which is the kind of quietly
   * wrong figure an executive board exists to not have.
   */
  if (spec.kind === "kpi" && source.kind === "database" && source.breakdownFieldId) {
    return { ok: false, error: "A KPI shows one number, so it cannot have a breakdown. Drop it, or make this a chart." };
  }
  if (spec.kind === "kpi" && source.kind === "model" && source.variableIds.length > 1) {
    return { ok: false, error: "A KPI shows one number, so name exactly one variable." };
  }

  /** The last gate: it has to actually resolve against today's data. */
  const resolved = resolveTile(spec, { model, tables });
  if (!resolved.ok) return { ok: false, error: resolved.error };

  if (resolved.kind === "chart" && resolved.series.every((s) => s.values.every((v) => v === 0))) {
    return {
      ok: false,
      error: "That resolves to all zeroes — no record fell inside the model's horizon. Try a different column or table.",
    };
  }

  return { ok: true, spec };
}

function describe(table: Table, ...types: string[]): string {
  const matching = table.fields.filter((f) => types.includes(f.type));
  return matching.length > 0
    ? matching.map((f) => `${f.name} (${f.id})`).join(", ")
    : `none on ${table.name}`;
}
