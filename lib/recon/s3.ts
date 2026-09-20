import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { SourceName } from "./ingest";

/**
 * Where uploaded statements are archived (S3, one private bucket).
 *
 * **The bucket is optional, and that is deliberate.** With `RECON_BUCKET` unset every function
 * here is unreachable — `archiveEnabled()` is false, the upload panel is not rendered, and a
 * fresh clone with no AWS account behaves exactly as it did before this file existed.
 *
 * **Credentials are never read here.** The SDK resolves them itself: the instance role on the
 * EC2 host, `magpie-dev` from `~/.aws` on a laptop. Nothing in `.env` carries an AWS key, so
 * there is nothing to leak into an image layer.
 *
 * **Objects are the raw file, untouched.** `ingestSources` is a pure function of file contents
 * (`lib/recon/ingest.ts`), so the archive is enough to reproduce any run exactly. Storing the
 * parsed form instead would archive the parser's opinion rather than what the bank sent.
 */

/**
 * The runtime list behind the `SourceName` type. The `satisfies` keeps every entry a real
 * source; the type below fails the build if a source is added to `SourceName` and forgotten
 * here — which would otherwise mean an upload panel that silently cannot accept it.
 */
export const SOURCE_NAMES = [
  "payments.csv",
  "refunds.csv",
  "chargebacks.csv",
  "settlements.csv",
  "recon.csv",
  "bank.csv",
  "ledger.csv",
] as const satisfies readonly SourceName[];

type Missing = Exclude<SourceName, (typeof SOURCE_NAMES)[number]>;
const _exhaustive: [Missing] extends [never] ? true : never = true;
void _exhaustive;

export const isSourceName = (value: string): value is SourceName =>
  (SOURCE_NAMES as readonly string[]).includes(value);

export const archiveEnabled = () => Boolean(process.env.RECON_BUCKET);

const bucket = () => {
  const name = process.env.RECON_BUCKET;
  if (!name) throw new Error("RECON_BUCKET is not set — statement archiving is disabled");
  return name;
};

let cached: S3Client | undefined;
const s3 = () => (cached ??= new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" }));

export async function putText(key: string, body: string, contentType = "text/csv") {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: `${contentType}; charset=utf-8`,
    }),
  );
}

async function getText(key: string): Promise<string> {
  const response = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!response.Body) throw new Error(`s3://${bucket()}/${key} came back empty`);
  return response.Body.transformToString("utf-8");
}

/**
 * Read one archived batch back as the `Partial<Record<SourceName, string>>` that
 * `ingestSources` takes. A prefix with none of the seven files returns `{}` rather than
 * throwing, because "nothing there" is the caller's to report — it knows which batch it asked
 * for.
 */
export async function readBatch(prefix: string): Promise<Partial<Record<SourceName, string>>> {
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const found = new Map<SourceName, string>();

  let token: string | undefined;
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: base, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      const name = object.Key?.slice(base.length);
      if (name && isSourceName(name)) found.set(name, object.Key!);
    }
    token = page.NextContinuationToken;
  } while (token);

  const sources: Partial<Record<SourceName, string>> = {};
  await Promise.all(
    [...found].map(async ([name, key]) => {
      sources[name] = await getText(key);
    }),
  );
  return sources;
}
