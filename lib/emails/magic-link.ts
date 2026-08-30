import { renderEmail } from "@/lib/emails/shell";

/** The sign-in link email. The link in it is a credential — say so plainly. */
export function magicLinkEmail({
  url,
  expiresInMinutes,
}: {
  url: string;
  expiresInMinutes: number;
}) {
  return renderEmail({
    subject: "Your Magpie sign-in link",
    title: "Sign in to Magpie",
    intro: "Open the link below and you're in. No password needed.",
    cta: { label: "Sign in to Magpie", url },
    note: `The link expires in ${expiresInMinutes} minutes and works once.`,
    footer:
      "Didn't ask to sign in? Ignore this email. Nobody can reach your account without this link.",
  });
}
