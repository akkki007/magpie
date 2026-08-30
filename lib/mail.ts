import nodemailer from "nodemailer";

/**
 * Outbound mail. Gmail SMTP with an app password for now — the cheapest thing
 * that actually delivers while there is no domain to authenticate.
 *
 * It is deliberately one narrow function rather than an exported transporter:
 * everything that sends mail should have to describe what it is sending, and
 * swapping Gmail for Resend later should touch this file and nothing else.
 * Gmail will also rate-limit and eventually flag bulk sending, so this is a
 * development and demo path, not a production one.
 */

type Mail = {
  to: string;
  subject: string;
  /** Always send both. Plain text is what an unrendered client shows. */
  text: string;
  html: string;
};

const globalForMail = globalThis as unknown as {
  mailer?: nodemailer.Transporter;
};

function transporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) return null;

  // Reused across hot reloads for the same reason as the Prisma client: a new
  // transport per reload means a new pool of SMTP connections per save.
  globalForMail.mailer ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    // 465 is implicit TLS — encrypted from the first byte, rather than 587's
    // STARTTLS upgrade on a connection that begins in the clear.
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  return globalForMail.mailer;
}

export async function sendMail({ to, subject, text, html }: Mail) {
  const mailer = transporter();

  /**
   * No credentials configured: print the mail to the server log instead of
   * throwing, so a fresh clone can still walk the whole magic-link flow by
   * copying the URL out of the terminal. Loud on purpose — a silent no-op here
   * would look exactly like a delivery problem. Never reachable in production:
   * the app refuses to send at all without credentials there.
   */
  if (!mailer) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD are not set");
    }
    console.warn(
      `\n── mail not configured, printing instead ──\nto:      ${to}\nsubject: ${subject}\n\n${text}\n──────────────────────────────────────────\n`,
    );
    return;
  }

  await mailer.sendMail({
    from: `Magpie <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  });
}
