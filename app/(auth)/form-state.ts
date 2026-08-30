/**
 * The shape a form action hands back to the form.
 *
 * This lives outside actions.ts on purpose: every export of a `"use server"`
 * module has to be an async function, because each one becomes a callable
 * endpoint. Exporting a plain object from there compiles, and then arrives at
 * the client as `undefined` — which is exactly the kind of bug that only shows
 * up at runtime.
 */
export type AuthState = {
  /** Echoed back so a failed submit does not wipe what was typed. */
  values: { name: string; email: string };
  errors: { name?: string; email?: string; password?: string; form?: string };
};

export const emptyAuthState: AuthState = {
  values: { name: "", email: "" },
  errors: {},
};

/**
 * Magic link has its own state because its success is a *screen*, not a
 * redirect: the browser that asked for the link is not necessarily the one that
 * will open it.
 */
export type MagicLinkState = {
  email: string;
  /** True once we have said "check your email" — true for unknown addresses too. */
  sent: boolean;
  errors: { email?: string; form?: string };
};

export const emptyMagicLinkState: MagicLinkState = {
  email: "",
  sent: false,
  errors: {},
};
