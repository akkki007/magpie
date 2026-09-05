"use client";

import { useEffect, useState } from "react";

import { listRollupSources, type RollupSource } from "@/app/(app)/databases/actions";
import { MenuLabel } from "@/components/modelling/menu";
import { cn } from "@/lib/cn";
import type { Aggregation, RollupSpec } from "@/lib/data/rollup";

/**
 * "Add from database" (`docs/database-plan.md` D4) — the form behind §3's one sentence: a
 * column, bucketed by a date field, becomes a `LINKED` variable in this model.
 *
 * It asks four questions and answers three of them itself. The variable's *name* is derived
 * rather than typed (`describeRollup`), because making someone name the thing before they
 * have seen it is what turns a two-click action into a form — the same reasoning M4.1 used
 * for not asking a new scenario for its name.
 *
 * Sources load when the menu opens rather than on every model page render: the columns are
 * needed only by whoever opens this, and the rows are never sent at all.
 */

const AGGREGATIONS: { value: Aggregation; label: string; hint: string }[] = [
  { value: "COUNT", label: "Count", hint: "records per period" },
  { value: "SUM", label: "Sum", hint: "of a number column" },
  { value: "AVG", label: "Average", hint: "of a number column" },
];

const NUMERIC = new Set(["NUMBER", "CURRENCY"]);

export function RollupForm({
  onAdd,
  onDone,
}: {
  onAdd: (source: RollupSource, spec: RollupSpec) => Promise<void>;
  onDone: () => void;
}) {
  const [sources, setSources] = useState<RollupSource[] | null>(null);
  const [slug, setSlug] = useState("");
  const [aggregation, setAggregation] = useState<Aggregation>("COUNT");
  const [dateFieldId, setDateFieldId] = useState("");
  const [valueFieldId, setValueFieldId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    listRollupSources().then((loaded) => {
      if (!live) return;
      setSources(loaded);
      // Default to the first table and its first date column, so the common case is one
      // click. A picker that opens empty makes you do work the data could have done.
      const first = loaded[0];
      if (first) {
        setSlug(first.slug);
        setDateFieldId(first.fields.find((f) => f.type === "DATE")?.id ?? "");
        setValueFieldId(first.fields.find((f) => NUMERIC.has(f.type))?.id ?? "");
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const source = sources?.find((s) => s.slug === slug);
  const dateFields = source?.fields.filter((f) => f.type === "DATE") ?? [];
  const valueFields = source?.fields.filter((f) => NUMERIC.has(f.type)) ?? [];
  const needsValue = aggregation !== "COUNT";
  const ready = Boolean(source && dateFieldId && (!needsValue || valueFieldId)) && !busy;

  if (sources === null) {
    return <p className="p-3 text-[12px] text-ink-faint">Loading tables…</p>;
  }

  if (sources.length === 0) {
    return (
      <div className="p-3">
        <p className="text-[12px] text-ink-muted">No tables yet.</p>
        <pre className="mt-2 rounded-button border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-ink-2">
          bun run seed:database
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-1">
      <MenuLabel>Add from database</MenuLabel>

      <Field label="Table">
        <select
          value={slug}
          onChange={(event) => {
            const next = sources.find((s) => s.slug === event.target.value);
            setSlug(event.target.value);
            setDateFieldId(next?.fields.find((f) => f.type === "DATE")?.id ?? "");
            setValueFieldId(next?.fields.find((f) => NUMERIC.has(f.type))?.id ?? "");
          }}
          className={SELECT}
        >
          {sources.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name} ({option.rowCount.toLocaleString("en-US")} rows)
            </option>
          ))}
        </select>
      </Field>

      <div className="flex gap-1 px-0.5">
        {AGGREGATIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            onClick={() => setAggregation(option.value)}
            className={cn(
              "flex-1 rounded-button px-2 py-1 text-[12px] transition-colors",
              aggregation === option.value
                ? "bg-blue-400 font-medium text-white"
                : "border border-line text-ink-2 hover:bg-hover",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <Field label="Bucket by">
        <select value={dateFieldId} onChange={(e) => setDateFieldId(e.target.value)} className={SELECT}>
          {dateFields.length === 0 && <option value="">No date column</option>}
          {dateFields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>
      </Field>

      {needsValue && (
        <Field label={aggregation === "AVG" ? "Average" : "Sum"}>
          <select value={valueFieldId} onChange={(e) => setValueFieldId(e.target.value)} className={SELECT}>
            {valueFields.length === 0 && <option value="">No number column</option>}
            {valueFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <button
        type="button"
        disabled={!ready}
        onClick={async () => {
          if (!source) return;
          setBusy(true);
          try {
            await onAdd(source, {
              dateFieldId,
              valueFieldId: needsValue ? valueFieldId : null,
              aggregation,
            });
            onDone();
          } finally {
            setBusy(false);
          }
        }}
        className={cn(
          "mt-0.5 rounded-button px-2 py-1.5 text-[12px]",
          ready ? "bg-blue-400 text-white hover:bg-blue-500" : "cursor-not-allowed bg-line text-ink-faint",
        )}
      >
        {busy ? "Adding…" : "Add variable"}
      </button>
    </div>
  );
}

const SELECT =
  "w-full rounded-button border border-line bg-canvas px-2 py-1 text-[12px] text-ink outline-none focus:border-blue-400";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 px-0.5">
      <span className="text-[11px] text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
