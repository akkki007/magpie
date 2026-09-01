"use server";

import { db } from "@/lib/db";
import { CommandSchema } from "@/lib/model/command-schema";
import { applyCommandToDb } from "@/lib/model/commands-db";
import type { Command } from "@/lib/model/commands";
import { getSession } from "@/lib/session";

/**
 * Persisting one command (`docs/modelling-plan.md` M1.1).
 *
 * **The authorisation check is in here, not in the page.** A server function is reachable by
 * direct POST — it is an HTTP endpoint that happens to be written as a function — so a check
 * upstream in the page protects the page and nothing else. Next's own docs are blunt about
 * this, and it is the same reasoning `docs/auth-plan.md` §4 gives for keeping the session
 * check out of the layout.
 *
 * The client has already applied this command to its own copy (M1.2). This returning an error
 * is what tells it to take that back, so the failure path matters as much as the success one:
 * an action that swallowed errors would leave the screen showing an edit the database
 * rejected, which is worse than never having accepted the keystroke.
 */
export async function persistCommand(
  slug: string,
  command: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session has expired — sign in again." };

  const parsed = CommandSchema.safeParse(command);
  if (!parsed.success) {
    // Deliberately not echoed to the client verbatim: a schema path is useful to a developer
    // and noise to a controller, and it describes the shape of an internal type.
    console.error("[persistCommand] rejected", parsed.error.issues);
    return { ok: false, error: "That edit was not in a form the server could accept." };
  }

  try {
    await db.$transaction(async (tx) => {
      const model = await tx.model.findUnique({ where: { slug }, select: { id: true } });
      if (!model) throw new Error(`no model at ${slug}`);
      await applyCommandToDb(tx, model.id, parsed.data as Command);
    });
    return { ok: true };
  } catch (error) {
    console.error("[persistCommand]", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The edit could not be saved.",
    };
  }
}
