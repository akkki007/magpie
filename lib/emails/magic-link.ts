/**
 * The sign-in link email.
 *
 * The body is no longer built here — it is a published Resend template ("Sign In"), so the
 * copy and the layout are edited in the dashboard rather than in this repo. What is left is
 * the part that must stay in code: which template, and the exact set of variables it
 * declares.
 *
 * That set is not optional. Resend substitutes a variable's authoring `fallback_value` for
 * anything the send omits, and this template's fallbacks are placeholders — `first_name`
 * falls back to "Alice". A missing variable is therefore not a blank, it is a confident
 * wrong answer, which is why `magicLinkVariables` returns all three or none.
 */

/** The template's alias, not its uuid. Both resolve; this one is legible. */
export const MAGIC_LINK_TEMPLATE = "sign-in";

/** The product name the template greets people with. */
const APP_NAME = "Magpie";

export function magicLinkVariables({ url, name }: { url: string; name: string | null }) {
  return {
    app_name: APP_NAME,
    first_name: firstName(name),
    magic_link_url: url,
  };
}

/**
 * "Akshay Nazare" → "Akshay"; anything empty → "there", because the template renders
 * `Hi {{first_name}},` and "Hi ," is worse than a generic greeting.
 *
 * A magic link to an address with no account is a legitimate sign-up path (§10 of the auth
 * plan — `disableSignUp` is left at its default), so "no name" is an ordinary case here,
 * not an error.
 */
function firstName(name: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "there";
}
