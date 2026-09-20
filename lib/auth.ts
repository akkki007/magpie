import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";

import { db } from "@/lib/db";
import { MAGIC_LINK_TEMPLATE, magicLinkVariables } from "@/lib/emails/magic-link";
import { verifyEmailEmail } from "@/lib/emails/verify-email";
import { sendMail, sendTemplateMail } from "@/lib/mail";

/**
 * How long a sign-in link stays valid.
 *
 * 15, not the 10 it was, because the email now says so: the "Sign In" template's copy
 * reads "This link will expire in 15 minutes", and that sentence is authored in Resend's
 * dashboard, not here. Of the two ways to stop the email lying, matching the constant is
 * the one that does not require editing a published template on every change — and 15
 * minutes for a single-use, hashed-at-rest token is well inside normal.
 *
 * If the template's copy changes, this changes with it. They are one fact in two places,
 * which is a thing to know rather than a thing to fix: making the duration a template
 * variable would put the number back under code's control, and is worth doing the moment
 * anyone wants to tune it.
 */
export const MAGIC_LINK_MINUTES = 15;

/**
 * Longer than a sign-in link, because it is not one: this link proves an
 * address, it does not mint a session for a stranger who intercepts it.
 */
export const VERIFY_EMAIL_MINUTES = 60;

/**
 * The auth server. This object is the source of truth for the auth tables:
 * `bunx @better-auth/cli generate` reads this config and writes the matching
 * models into prisma/schema.prisma. Change something here that has a column
 * behind it, and re-generate + migrate before anything else.
 *
 * Reasoning behind every option below is in docs/auth-plan.md §2 and §5.
 */
export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
    /**
     * Not the default, and it should be. Sign-up writes a `user` row and then
     * an `account` row holding the password hash; without a transaction a
     * failure between the two leaves a user who can never sign in and can never
     * sign up again — "email already exists" with nothing to authenticate
     * against. We produced exactly that row while building this. Postgres has
     * transactions; use them.
     */
    transaction: true,
  }),

  emailAndPassword: {
    enabled: true,
    // Length beats composition rules. 12 is the floor from the plan; there are
    // deliberately no "must contain a symbol" rules to fight with.
    minPasswordLength: 12,
    maxPasswordLength: 128,
    /**
     * Verification is sent but not enforced: an unverified user can still work.
     * Blocking sign-in on a click in an inbox is a support burden we do not
     * need yet, and the thing verification actually protects here — see
     * `emailVerification` below — is fixed by *sending* it, not by gating on it.
     */
    requireEmailVerification: false,
  },

  emailVerification: {
    /**
     * On by default now that there is a mail path, and it matters more than it
     * looks. Better Auth treats an `emailVerified: false` row as carrying no
     * proof that its password belongs to the mailbox owner — so when a magic
     * link later resolves to that row, it deletes every account link and
     * session that predates the proof (`revokeUnprovenAccountAccess`). That is
     * the right call against someone squatting your address, but it means that
     * without this line, one emailed link silently erases the password of a
     * user who never verified. Verifying on sign-up closes the window.
     */
    sendOnSignUp: true,
    /**
     * Left off deliberately. Turning it on would mint a session for whoever
     * opens the link, which makes this a second magic link with six times the
     * lifetime — and a weaker one, since a verification mail is the one people
     * forward. It proves the address; that is all it should do.
     */
    autoSignInAfterVerification: false,
    expiresIn: VERIFY_EMAIL_MINUTES * 60,

    async sendVerificationEmail({ user, url }) {
      const { subject, text, html } = verifyEmailEmail({
        url,
        expiresInMinutes: VERIFY_EMAIL_MINUTES,
      });

      /**
       * Swallowed on purpose, and only here. Better Auth awaits this call
       * *after* it has already committed the user and account rows, so an
       * SMTP outage would surface to the caller as "sign-up failed" for an
       * account that now exists — and the next attempt would be told the email
       * is taken. Losing the verification mail is recoverable; losing the
       * account is not. The magic-link sender deliberately does the opposite,
       * because there the email *is* the thing that was asked for.
       */
      try {
        await sendMail({ to: user.email, subject, text, html });
      } catch (error) {
        console.error("[auth] verification email failed to send", error);
      }
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    // Sliding expiry, but the row is only rewritten once a day — otherwise
    // every request turns into a write.
    updateAge: 60 * 60 * 24,
    /**
     * Deliberately NOT enabling `cookieCache`. It would let Better Auth skip
     * the session lookup by trusting a signed cookie for a few seconds, which
     * is the JWT trade-off under another name: inside that window a revoked
     * session still works and a changed role has not changed. Instant
     * revocation is the entire reason §2 chose database sessions.
     */
  },

  advanced: {
    // Secure cookies (and the `__Secure-` prefix Better Auth adds with them)
    // require HTTPS, which localhost is not.
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
    },
  },

  plugins: [
    magicLink({
      /**
       * A link in an inbox is a bearer token sitting in the least protected
       * place a user owns, so it is short-lived and single-use — the library
       * consumes the token atomically on first verification.
       */
      expiresIn: MAGIC_LINK_MINUTES * 60,

      /**
       * Hashed at rest. The default stores the token in the `verification`
       * table in plain text, which means anyone with a moment of read access to
       * that table can sign in as anybody who has an unexpired link. Hashing it
       * is the same reasoning as never storing a password: the database should
       * not hold anything that is itself a credential.
       */
      storeToken: "hashed",

      /**
       * Left at the default `false`, so a link to an unknown address creates
       * the account. That is what lets the response be identical for a
       * registered and an unregistered address — the enumeration-proof shape
       * §5 of the plan asks for, which password sign-up cannot have until
       * verification exists. Users arriving this way have a verified email and
       * no password; setting one is a later, optional step.
       */

      async sendMagicLink({ email, url }) {
        /**
         * The template greets by first name, and Better Auth hands this callback only an
         * address — so we look the name up ourselves. One indexed read on a unique column,
         * and it is allowed to miss: a link to an address with no account is the sign-up
         * path, and `magicLinkVariables` turns a missing name into "Hi there,".
         */
        const user = await db.user.findUnique({
          where: { email },
          select: { name: true },
        });

        await sendTemplateMail({
          to: email,
          template: MAGIC_LINK_TEMPLATE,
          variables: magicLinkVariables({ url, name: user?.name ?? null }),
        });
      },
    }),

    /**
     * `nextCookies` must stay LAST in this array. It hooks the end of every
     * request so cookies set by an auth call made from a Server Action are
     * actually attached to the response — without it, sign-in succeeds in the
     * database and the browser never receives the session cookie.
     */
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
