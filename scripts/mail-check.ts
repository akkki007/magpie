/**
 * Proves the SMTP credentials in `.env` work, without sending anything.
 *
 * `verify()` opens the connection and completes the AUTH exchange, then hangs
 * up — so a wrong app password fails here in a second rather than silently at
 * the moment a real user asks for a sign-in link. Prints no secrets.
 *
 *   bun run mail:check
 */
import "dotenv/config";
import nodemailer from "nodemailer";

const user = process.env.GMAIL_USER;
const pass = process.env.GMAIL_APP_PASSWORD;

if (!user || !pass) {
  console.error("GMAIL_USER / GMAIL_APP_PASSWORD are not set in .env");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: { user, pass },
});

try {
  await transporter.verify();
  // The local part only — enough to confirm which account answered, without
  // putting the full address in a terminal someone may screenshot.
  console.log(`SMTP OK — authenticated as ${user.split("@")[0]}@…`);
} catch (error) {
  console.error(
    "SMTP failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}
