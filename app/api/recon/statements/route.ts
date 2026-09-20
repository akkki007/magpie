import { ingestSources } from "@/lib/recon/ingest";
import { archiveEnabled, isSourceName, putText } from "@/lib/recon/s3";
import { getSession } from "@/lib/session";

/**
 * Upload one source file, ingest it, archive it (`lib/recon/s3.ts`).
 *
 * **Ingestion runs before the archive, and a file with the wrong columns is refused.** Sending
 * `settlements.csv` under the `bank.csv` label is the easy mistake, and archiving it anyway
 * would leave a batch that later fails to ingest with no record of who sent what. So the
 * columns are checked first, and the answer comes back while the person is still looking at
 * the file picker.
 *
 * **Rejected *rows* do not block the archive.** That is the ingestion rule (`lib/recon/
 * ingest.ts`): a row that cannot be parsed becomes a record with a file, a line and a reason,
 * not a reason to refuse the file. The response carries the first few so the person sees what
 * the batch will contain before it is ever matched.
 *
 * `proxy.ts` excludes `/api`, so nothing has checked a cookie before this runs — the session
 * check here is the only one, and it is the real one (`lib/session.ts`).
 */

const MAX_BYTES = 5 * 1024 * 1024;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return fail(401, "Sign in to upload a statement.");

  if (!archiveEnabled()) {
    return fail(503, "Statement archiving is not configured on this deployment.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "Send the file as multipart form data.");
  }

  const source = form.get("source");
  const file = form.get("file");

  // The object key is built from `source`, never from the uploaded filename: a name the
  // sender controls has no business in a key, and the seven names are the whole vocabulary.
  if (typeof source !== "string" || !isSourceName(source)) {
    return fail(400, "Choose which of the seven files this is.");
  }
  if (!(file instanceof File) || file.size === 0) return fail(400, "Choose a non-empty CSV file.");
  if (file.size > MAX_BYTES) return fail(413, "That file is over 5 MB.");

  const text = await file.text();

  let batch: ReturnType<typeof ingestSources>;
  try {
    batch = ingestSources({ [source]: text });
  } catch {
    return fail(422, `That does not parse as ${source}.`);
  }

  const stat = batch.files.find((entry) => entry.file === source);
  if (!stat) return fail(422, `That does not parse as ${source}.`);

  if (stat.missingColumns.length > 0) {
    return fail(
      422,
      `That does not look like ${source} — it has no ${stat.missingColumns.join(", ")} column.`,
    );
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const key = `uploads/${session.user.id}/${stamp}/${source}`;

  try {
    await putText(key, text);
  } catch (error) {
    console.error("[recon/statements] archive failed", error);
    return fail(502, "The file parsed, but it could not be archived. Try again.");
  }

  return Response.json({
    ok: true,
    key,
    file: source,
    rowsIn: stat.rowsIn,
    recordsOut: stat.recordsOut,
    rejected: stat.rejected,
    rejections: batch.rejections.slice(0, 5).map(({ line, reason, detail }) => ({
      line,
      reason,
      detail,
    })),
  });
}
