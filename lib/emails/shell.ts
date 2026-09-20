/**
 * The one layout every transactional email uses.
 *
 * Written as a string rather than a React component on purpose: email clients
 * are a decade behind browsers, so this is tables, inline styles and web-safe
 * fonts. Nothing here may depend on the app's CSS — the design tokens are
 * copied in as literal hex, which is the one place `docs/design-system.md`'s
 * "no hex outside globals.css" rule cannot apply.
 *
 * No images and no tracking pixel. A mail that renders with images blocked —
 * the default in most clients — is a mail that always works. Every template
 * also ships plain text, because that is what an unrendered client shows.
 */
export type EmailContent = {
  subject: string;
  /** Heading inside the card. Usually the same words as the button. */
  title: string;
  /** One line under the heading. */
  intro: string;
  cta: { label: string; url: string };
  /** Small print under the button — expiry, single use, and so on. */
  note: string;
  /** Greyed line under a hairline. Usually "didn't ask for this?". */
  footer: string;
};

export function renderEmail({
  subject,
  title,
  intro,
  cta,
  note,
  footer,
}: EmailContent) {
  const text = [
    title,
    "",
    intro,
    "",
    cta.url,
    "",
    note,
    "",
    footer,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f8f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="400" style="width:400px;max-width:100%;background:#ffffff;border:1px solid #ededed;border-radius:12px;">
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 4px;font-size:20px;font-weight:600;color:#1c1c1c;letter-spacing:-0.01em;">
                  ${title}
                </h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:22px;color:#737373;">
                  ${intro}
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td align="center" style="background:#2563eb;border-radius:8px;">
                      <a href="${cta.url}" style="display:block;padding:11px 16px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;">
                        ${cta.label}
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#737373;">
                  ${note} If the button does nothing, paste this into your browser:
                </p>
                <p style="margin:8px 0 0;font-size:12px;line-height:18px;word-break:break-all;">
                  <a href="${cta.url}" style="color:#2563eb;">${cta.url}</a>
                </p>

                <p style="margin:24px 0 0;padding-top:24px;border-top:1px solid #ededed;font-size:12px;line-height:18px;color:#a0a0a4;">
                  ${footer}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
