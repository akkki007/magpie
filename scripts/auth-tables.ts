/**
 * Prints the tables Better Auth expects, straight out of the running library.
 *
 * Why this exists instead of `@better-auth/cli generate`: the CLI ships as its
 * own package and lags the library (1.5.0-beta against better-auth 1.7.2 at the
 * time of writing). Its output is missing `account.issuer`, which the installed
 * version writes on every sign-up — so following the CLI produces a schema that
 * type-checks, migrates cleanly, and then fails on the first real sign-up.
 *
 * `getAuthTables` is what the adapter itself reads, so this cannot drift.
 *
 *   bun run auth:tables
 */
import { getAuthTables } from "@better-auth/core/db";

import { auth } from "@/lib/auth";

const tables = getAuthTables(auth.options);

for (const [key, table] of Object.entries(tables)) {
  const indexes = table.indexes?.length
    ? `  indexes: ${JSON.stringify(table.indexes)}`
    : "";
  console.log(`\n${key} → "${table.modelName}"${indexes}`);

  for (const [name, field] of Object.entries(table.fields)) {
    const notes = [
      field.required ? "required" : "optional",
      field.unique ? "unique" : null,
      field.index ? "index" : null,
      field.references
        ? `→ ${field.references.model}.${field.references.field}`
        : null,
    ].filter(Boolean);

    // `type` widens to a union that includes an enum's string[], so stringify.
    const type = String(field.type);
    console.log(`  ${name.padEnd(24)} ${type.padEnd(8)} ${notes.join(", ")}`);
  }
}
