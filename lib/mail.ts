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
  raise(error);
}

type TemplateMail = {
  to: string;
  /**
   * The template's **alias** from the Resend dashboard (`sign-in`), not its uuid. Both
   * resolve — verified against the live API — and the alias is the one a person can read
   * and re-point at a rebuilt template without a code change.
   */
  template: string;
  /**
   * Every variable the template declares, always. Resend substitutes a template's
   * `fallback_value` for anything omitted, and those fallbacks are authoring placeholders:
   * leaving `first_name` out greets every user as "Alice".
   */
  variables: Record<string, string>;
};

/**
 * Send a template authored in Resend, rather than a body built here.
 *
 * A separate function on purpose. `sendMail` takes a body and Resend delivers it; this
 * hands Resend a *name and some values* and Resend owns the subject, the HTML, and the
 * text. Those are opposite contracts, and collapsing them into one signature with four
 * optional fields would make every call site read as though it could do both.
 */
export async function sendTemplateMail({ to, template, variables }: TemplateMail) {
  const resend = client();

  if (!resend) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set");
    }
    // The variables are all we have — the body lives in Resend. That is enough for the
    // case this fallback exists for: `magic_link_url` is right there to paste.
    console.warn(
      `\n── mail not configured, printing instead ──\nto:       ${to}\ntemplate: ${template}\n\n${Object.entries(
        variables,
      )
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n")}\n──────────────────────────────────────────\n`,
    );
    return;
  }

  /**
   * `from` is passed even though the template carries one, so the sending identity has a
   * single source of truth in this file rather than drifting whenever someone edits the
   * template. `subject` is deliberately *not* passed: it is part of the copy, and the copy
   * belongs to the template.
   */
  const { error } = await resend.emails.send({
    from: MAIL_FROM,
    to,
    template: { id: template, variables },
  });
  raise(error);
}

/**
 * Resend *returns* its errors as `{ data: null, error }` rather than throwing. Left
 * unchecked that turns every failure into a successful-looking send — and `sendMagicLink`
 * in `lib/auth.ts` deliberately awaits its send and lets errors propagate so the sign-in
 * form can say the link did not go out. Re-throwing is what keeps that promise true.
 */
function raise(error: { name: string; message: string } | null) {
  if (error) {
    throw new Error(`Resend refused the send (${error.name}): ${error.message}`);
  }
}
