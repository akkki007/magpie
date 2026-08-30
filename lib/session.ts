import { cache } from "react";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";

/**
 * Read the current session, straight from the database.
 *
 * `cache()` is React's per-request memo: a page whose header, nav, and body all
 * ask who the user is costs one query, not three. It is per-request only —
 * nothing leaks between users, which is why this is safe to use everywhere.
 *
 * This is the *real* check. `proxy.ts` sees only that a cookie exists; this
 * sees whether the session row is still there, which is what makes revocation
 * instant. Call it next to the data, not in a layout — see docs/auth-plan.md §4.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
