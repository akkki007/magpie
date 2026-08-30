import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/**
 * Every Better Auth endpoint — sign-in, sign-out, callbacks, session lookup —
 * lives behind this one catch-all. The library owns the routing inside
 * `/api/auth/*`; we only hand it the request.
 *
 * Our own UI does not call these over `fetch`: the forms use Server Actions,
 * which talk to `auth.api` directly. This handler still has to exist, because
 * OAuth providers redirect back to a URL, and a browser redirect cannot land
 * on a Server Action.
 */
export const { GET, POST } = toNextJsHandler(auth.handler);
