"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";

import type { AuthState, MagicLinkState } from "@/app/(auth)/form-state";
import { auth } from "@/lib/auth";

/**
 * A Server Action is a public POST endpoint that merely happens to live next to
 * a page. Nothing in this file may assume it was reached from our own form —
 * every field is validated here, on the server, regardless of what the input
 * elements claim.
 *
 * Everything exported below is an async function, and it has to stay that way:
 * a `"use server"` module turns each export into an endpoint, so the state type
 * and its initial value live in ./form-state.ts instead.
 */

/** Mirrors `emailAndPassword.minPasswordLength` in lib/auth.ts. */
const MIN_PASSWORD = 12;

/**
 * Not a full RFC 5322 parser on purpose — the only authority on whether an
 * address exists is a mail sent to it. This just catches obvious typos.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Only ever redirect to a path on this origin. `next=https://evil.example` in
 * the query string is an open redirect, and a login page is exactly where a
 * phisher wants one. A leading `//` is protocol-relative, so it has to go too.
 */
function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/workspace";
}

function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = readField(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const state: AuthState = { values: { name: "", email }, errors: {} };

  if (!email) state.errors.email = "Enter your email address.";
  if (!password) state.errors.password = "Enter your password.";
  if (state.errors.email || state.errors.password) return state;

  try {
    await auth.api.signInEmail({
      body: { email, password },
      // Forwarding the real headers is what lets Better Auth record the IP and
      // user agent on the session row, and — via the nextCookies plugin — set
      // the session cookie on this action's response.
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      /**
       * Deliberately one message for every failure mode. "No such account" and
       * "wrong password" are the same sentence, because the difference between
       * them tells an attacker which addresses are worth attacking.
       *
       * Timing is the other half of that promise and is not solved yet: a
       * missing user skips the hash comparison and so answers faster. That
       * belongs with rate limiting in A12.
       */
      return { ...state, errors: { form: "Invalid email or password." } };
    }
    throw error;
  }

  // Outside the try: `redirect()` works by throwing, and a catch block would
  // swallow it and report a successful sign-in as a failure.
  redirect(safeNext(formData.get("next")));
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const name = readField(formData, "name");
  const email = readField(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const state: AuthState = { values: { name, email }, errors: {} };

  if (name.length < 2) state.errors.name = "Enter your name.";
  if (!EMAIL_RE.test(email)) {
    state.errors.email = "Enter a valid email address.";
  }
  if (password.length < MIN_PASSWORD) {
    state.errors.password = `Use at least ${MIN_PASSWORD} characters. Length beats symbols.`;
  }
  if (state.errors.name || state.errors.email || state.errors.password) {
    return state;
  }

  try {
    await auth.api.signUpEmail({
      // `callbackURL` is where the verification link lands once clicked; without
      // it Better Auth sends people to `/`, i.e. back to the marketing page.
      body: { name, email, password, callbackURL: safeNext(formData.get("next")) },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      /**
       * This does leak that an address is registered, which §5 of the plan says
       * it should not. Hiding it requires sign-up to end in "check your email"
       * for both cases instead of an immediate session — i.e. it is blocked on
       * the mail path being chosen. Noted here so it is not mistaken for done.
       */
      const alreadyExists =
        error.body?.code?.startsWith("USER_ALREADY_EXISTS") ?? false;
      return {
        ...state,
        errors: alreadyExists
          ? { email: "An account with this email already exists." }
          : { form: "Could not create the account. Try again." },
      };
    }
    throw error;
  }

  redirect(safeNext(formData.get("next")));
}

/**
 * Email a one-time sign-in link.
 *
 * Unlike the two actions above this one does not redirect on success: the
 * browser that asks for the link is often not the one that opens it. It renders
 * "check your email" instead — and renders exactly that whether or not the
 * address is registered, because an unknown address gets an account created
 * when the link is opened. Same response, same work, either way.
 */
export async function requestMagicLink(
  _prev: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const email = readField(formData, "email").toLowerCase();
  const next = safeNext(formData.get("next"));

  if (!EMAIL_RE.test(email)) {
    return { email, sent: false, errors: { email: "Enter a valid email address." } };
  }

  try {
    await auth.api.signInMagicLink({
      body: {
        email,
        /**
         * Only used if this link ends up creating the account. Better Auth
         * would otherwise store an empty name, and every screen that greets
         * someone by name would greet nobody. Onboarding asks for the real one.
         */
        name: email.split("@")[0],
        callbackURL: next,
        newUserCallbackURL: next,
        // Where the library sends people whose link is expired, already used,
        // or tampered with.
        errorCallbackURL: "/sign-in/link",
      },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) {
      // A delivery failure is about our mail server, not about the address, so
      // saying so out loud leaks nothing.
      return {
        email,
        sent: false,
        errors: { form: "Could not send the link. Try again in a moment." },
      };
    }
    throw error;
  }

  /**
   * Not rate limited yet. Better Auth's limiter guards the HTTP endpoint at
   * `/api/auth/sign-in/magic-link`, but this action calls `auth.api` in
   * process and never passes through it — so this path can currently be used
   * to send mail in a loop. A12 has to add a limiter here, at the action.
   */
  return { email, sent: true, errors: {} };
}

export async function signOut() {
  // Deletes the session row, not just the cookie — a cookie-only sign-out
  // leaves a working session behind for anyone who kept a copy of it.
  await auth.api.signOut({ headers: await headers() });

  // The flag, not the message: /sign-in decides what those words are. See
  // components/ui/flash.tsx.
  redirect("/sign-in?signed-out=1");
}
