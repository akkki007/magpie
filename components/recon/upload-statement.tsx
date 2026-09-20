"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";

import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

/**
 * Archive one statement file to S3 from the review screen (`app/api/recon/statements`).
 *
 * The server does the real work — ingestion, the column check, the archive — and this panel
 * is only the way to reach it and the place its answer lands. What it reports is the
 * ingestion rule made visible: rows in, records out, and every row that could not be read,
 * so a person sees what a batch will contain before anything matches against it.
 */

const SOURCES = [
  "bank.csv",
  "settlements.csv",
  "recon.csv",
  "ledger.csv",
  "payments.csv",
  "refunds.csv",
  "chargebacks.csv",
] as const;

type Rejection = { line: number; reason: string; detail: string };

type Result =
  | {
      ok: true;
      key: string;
      file: string;
      rowsIn: number;
      recordsOut: number;
      rejected: number;
      rejections: Rejection[];
    }
  | { ok: false; error: string };

export function UploadStatement() {
  const [source, setSource] = useState<(typeof SOURCES)[number]>("bank.csv");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, error: "Choose a CSV file first." });
      return;
    }

    setPending(true);
    setResult(null);
    try {
      const body = new FormData();
      body.set("source", source);
      body.set("file", file);

      const response = await fetch("/api/recon/statements", { method: "POST", body });
      const json = (await response.json()) as Result;
      setResult(json);

      if (json.ok) {
        toast.success("Archived to S3", {
          description: `${json.recordsOut} records from ${json.file}, ${json.rejected} rejected.`,
        });
        if (input.current) input.current.value = "";
      }
    } catch {
      setResult({ ok: false, error: "The upload did not reach the server." });
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Upload a statement" className="shrink-0 border-b border-line px-3 py-2 sm:px-4">
      <form onSubmit={upload} className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Which file this is"
          value={source}
          onChange={(event) => setSource(event.target.value as (typeof SOURCES)[number])}
          className="min-h-[34px] rounded-control border border-line bg-white px-2 text-[13px] text-ink"
        >
          {SOURCES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          className="min-w-0 max-w-full text-[12px] text-ink-2"
        />

        <button
          type="submit"
          disabled={pending}
          className={cn(
            "inline-flex min-h-[34px] items-center justify-center gap-2 rounded-button px-3",
            "text-[13px] font-medium transition-colors duration-150",
            pending
              ? "cursor-not-allowed bg-muted text-ink-muted"
              : "bg-ink text-white hover:bg-ink-2",
          )}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={1.75} aria-hidden />
          ) : (
            <Upload className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          )}
          {pending ? "Archiving…" : "Archive to S3"}
        </button>
      </form>

      {result && (
        <div role="status" className="mt-2 text-[12px] leading-[1.6]">
          {result.ok ? (
            <>
              <p className="text-ink-2">
                {result.file}: {result.rowsIn} rows in, {result.recordsOut} records,{" "}
                {result.rejected} rejected. Stored as{" "}
                <code className="font-mono text-ink">{result.key}</code>.
              </p>
              {result.rejections.length > 0 && (
                <pre className="mt-1 overflow-x-auto rounded-control border border-line bg-subtle px-2 py-1 font-mono text-[11px] text-ink-2">
                  {result.rejections
                    .map((r) => `line ${r.line}  ${r.reason}  ${r.detail}`)
                    .join("\n")}
                </pre>
              )}
            </>
          ) : (
            <p className="text-ink-muted">{result.error}</p>
          )}
        </div>
      )}
    </section>
  );
}
