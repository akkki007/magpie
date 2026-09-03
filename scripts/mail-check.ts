/**
 * Proves the Resend setup in `.env` works, without sending anything.
 *
 * Listing domains is the cheapest authenticated call there is, and it answers two
 * questions at once: whether the API key is real, and whether the domain the app sends
 * *from* is actually verified. That second half is the one that matters — a valid key
 * sending from an unverified domain fails at the moment a real user asks for a sign-in
 * link, which is exactly the failure this script exists to move earlier. Prints no
 * secrets.
 *
 *   bun run mail:check
 */
import "dotenv/config";
import { Resend } from "resend";

import { MAIL_FROM } from "../lib/mail";

const key = process.env.RESEND_API_KEY;

if (!key) {
  console.error("RESEND_API_KEY is not set in .env");
  process.exit(1);
}

/** `Magpie <hello@magpie.akkki.tech>` → `magpie.akkki.tech`. */
const address = MAIL_FROM.match(/<(.+)>/)?.[1] ?? MAIL_FROM;
const domain = address.split("@")[1];

const { data, error } = await new Resend(key).domains.list();

if (error) {
  console.error(`Resend rejected the key (${error.name}): ${error.message}`);
  process.exit(1);
}

const match = data.data.find((entry) => entry.name === domain);

if (!match) {
  console.error(
    `Resend OK, but ${domain} is not on this account. Sending from ${address} will fail.\n` +
      `Domains on the account: ${data.data.map((entry) => entry.name).join(", ") || "none"}`,
  );
  process.exit(1);
}

if (match.status !== "verified") {
  console.error(`Resend OK, but ${domain} is "${match.status}", not verified.`);
  process.exit(1);
}

console.log(`Resend OK — ${domain} verified, sending as ${address}`);
