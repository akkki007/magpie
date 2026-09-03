import { Resend } from "resend";

/**
 * Outbound mail, over Resend's HTTP API.
 *
 * This replaced Gmail SMTP, which cost ~3.5s of TCP + TLS + AUTH handshake on *every*
 * send because pooling could not be made to work under Bun (see the commit that removed
 * it). A magic link the user waits four seconds for is a broken sign-in, so the fix was
 * to stop speaking SMTP: Resend takes one HTTPS POST on an already-warm connection and
 * does the SMTP part itself, asynchronously, on the other side.
 *
 * It is deliberately one narrow function rather than an exported client: everything that
 * sends mail should have to describe what it is sending, and swapping the provider again
 * should touch this file and nothing else.
 */

type Mail = {
  to: string;
  subject: string;
  /** Always send both. Plain text is what an unrendered client shows. */
  text: string;
  html: string;
};

/**
 * `magpie.akkki.tech` is the verified sending domain. The address only has to exist on a
 * domain Resend has authenticated — the DKIM signature is what inboxes check, not whether
 * a mailbox is listening at `hello@`. Overridable so a fresh clone on a different domain
 * is a config change, not a code change.
 */
export const MAIL_FROM = process.env.MAIL_FROM || "Magpie <hello@magpie.akkki.tech>";

const globalForMail = globalThis as unknown as { resend?: Resend };

function client() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;

  // Reused across hot reloads for the same reason as the Prisma client. Cheaper than the
  // SMTP transport it replaced — this holds a key and a `fetch`, not a live socket — but
  // a new client per save is still pointless.
  globalForMail.resend ??= new Resend(key);
  return globalForMail.resend;
}

export async function sendMail({ to, subject, text, html }: Mail) {
  const resend = client();

  /**
   * No credentials configured: print the mail to the server log instead of throwing, so a
   * fresh clone can still walk the whole magic-link flow by copying the URL out of the
   * terminal. Loud on purpose — a silent no-op here would look exactly like a delivery
   * problem. Never reachable in production: the app refuses to send at all without a key
   * there.
   */
  if (!resend) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set");
    }
    console.warn(
      `\n── mail not configured, printing instead ──\nto:      ${to}\nsubject: ${subject}\n\n${text}\n──────────────────────────────────────────\n`,
    );
    return;
  }

  const { error } = await resend.emails.send({ from: MAIL_FROM, to, subject, text, html });

  /**
   * Resend *returns* its errors as `{ data: null, error }` rather than throwing. Left
   * unchecked that turns every failure into a successful-looking send — and `sendMagicLink`
   * in `lib/auth.ts` deliberately awaits this and lets errors propagate so the sign-in form
   * can say the link did not go out. Re-throwing is what keeps that promise true.
   */
  if (error) {
    throw new Error(`Resend refused the send (${error.name}): ${error.message}`);
  }
}
