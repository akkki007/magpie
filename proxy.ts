import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Next 16's Proxy — what used to be called Middleware.
 *
 * This is UX, **not** security. All it does is check that a session cookie is
 * *present*; it never asks the database whether that session is still valid,
 * because this runs on every request including every prefetch, and a query
 * here would be a query on every hover.
 *
 * A forged cookie gets past this file and is then caught by `getSession()` on
 * the page itself, which is the check that actually counts. Nothing may rely
 * on this layer alone — see docs/auth-plan.md §4.
 */
const PROTECTED = ["/workspace"];
const AUTH_PAGES = ["/sign-in", "/sign-in/link", "/sign-up"];
// The marketing page is for someone deciding whether to sign up; a returning, signed-in
// visitor gets no value from reading it again, so they skip straight to `/workspace` —
// the same redirect AUTH_PAGES already gets, just one more path added to it.
const SIGNED_IN_SKIPS = [...AUTH_PAGES, "/"];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = getSessionCookie(request) !== null;

  if (!hasSessionCookie && PROTECTED.some((p) => pathname.startsWith(p))) {
    const url = new URL("/sign-in", request.nextUrl);
    // Remember where they were headed so sign-in can send them back.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && SIGNED_IN_SKIPS.includes(pathname)) {
    return NextResponse.redirect(new URL("/workspace", request.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  // Skip the auth API itself, Next's internals, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|woff2)$).*)"],
};
