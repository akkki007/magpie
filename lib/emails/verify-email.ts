import { renderEmail } from "@/lib/emails/shell";

/**
 * Sent once, on sign-up. Verifying is not required to use the app — but it is
 * what makes the password durable: until an address is proven, Better Auth
 * treats a later magic-link sign-in as the first proof of ownership and drops
 * every credential that predates it. See docs/auth-plan.md §10.
 */
export function verifyEmailEmail({
  url,
  expiresInMinutes,
}: {
  url: string;
  expiresInMinutes: number;
}) {
  return renderEmail({
    subject: "Confirm your email for Magpie",
    title: "Confirm your email",
    intro:
      "One click and this address is yours. You can use Magpie in the meantime.",
    cta: { label: "Confirm email", url },
    note: `The link expires in ${expiresInMinutes} minutes.`,
    footer:
      "Didn't create a Magpie account? Ignore this email and nothing happens.",
  });
}
