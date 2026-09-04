"use server";

import { revalidatePath } from "next/cache";

import { writeTable } from "@/lib/data/persist";
import { db } from "@/lib/db";
import { writeModel } from "@/lib/model/persist";
import { getSession } from "@/lib/session";
import { CUSTOMERS_TABLE } from "@/prisma/database-data";
import { buildRevenueModel } from "@/prisma/seed-data";

/**
 * Seeding the demo data from the app, instead of from a terminal.
 *
 * Every empty state in this product used to end in `bun run seed`, which is a fine
 * instruction for whoever is holding the repo and a dead end for everybody else: a signed-in
 * user on a deployed URL has no shell to run it in, so the product's answer to "there is
 * nothing here" was an instruction they could not follow. These actions are the same three
 * writes the `scripts/seed-*.ts` files perform, reachable by a button.
 *
 * ── Why each one refuses rather than overwrites ───────────────────────────────
 * `writeModel` and `writeTable` are **destructive by design** — they delete the row at that
 * slug and rewrite it, which is the honest operation for a seeder (`lib/data/persist.ts`
 * explains why a row has no natural key to upsert against). That is safe in a script someone
 * typed deliberately and dangerous behind a button: one tap could discard a month of edits,
 * and a "Seed demo data" button is exactly the kind of thing a curious person taps to see
 * what it does.
 *
 * So each action checks first, and refuses if the thing already exists. The button only
 * appears in an empty state anyway, but that check is in the client's render — and a Server
 * Action is a public POST endpoint that merely happens to live next to a page
 * (`app/(app)/models/actions.ts`), so the guarantee has to be re-established here, where it
 * cannot be skipped by anyone calling the endpoint directly.
 *
 * The consequence worth stating: these can populate an empty database, and they can never
 * reset a populated one. Re-seeding over real data stays a deliberate act with a shell
 * behind it.
 */

const MODEL_SLUG = "revenue-model-2026";
const BOARD_SLUG = "financial-performance-overview";

type Result = { ok: true; message: string } | { ok: false; error: string };

/** The same three things every action needs, in the one place they are checked. */
async function guard(): Promise<{ ok: false; error: string } | null> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session has expired — sign in again." };
  return null;
}

/**
 * The Revenue Model 2026 (`docs/modelling-plan.md` M0.5).
 *
 * Deliberately *not* the verification the script wraps around this call. `scripts/seed-model.ts`
 * writes the model, reads it back, and compares every formula tree and input cell against the
 * fixture — which is the actual deliverable of M0 and belongs in a command someone runs while
 * changing the persistence layer. Re-running it per button press would double the write and
 * add a precision probe that mutates a cell and puts it back, for a user who wants a model to
 * look at.
 */
export async function seedModel(): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;

  try {
    const existing = await db.model.findUnique({
      where: { slug: MODEL_SLUG },
      select: { id: true },
    });
    if (existing) {
      return { ok: false, error: "That model already exists — nothing was overwritten." };
    }

    const fixture = buildRevenueModel();
    await writeModel(db, fixture, MODEL_SLUG);

    revalidatePath("/models");
    revalidatePath(`/models/${MODEL_SLUG}`);
    // A board's tiles resolve against the model on every render, so a board that was
    // showing "no model is seeded" is stale the moment this succeeds.
    revalidatePath("/boards", "layout");

    return {
      ok: true,
      message: `${fixture.name} — ${fixture.variables.length} variables, ${fixture.scenarios.length} scenarios`,
    };
  } catch (error) {
    console.error("[seed/model]", error);
    return { ok: false, error: message(error) };
  }
}

/** The `Customers` table (`docs/database-plan.md` D1). */
export async function seedDatabase(): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;

  try {
    const existing = await db.dataTable.findUnique({
      where: { slug: CUSTOMERS_TABLE.slug },
      select: { id: true },
    });
    if (existing) {
      return { ok: false, error: "That table already exists — nothing was overwritten." };
    }

    await writeTable(db, CUSTOMERS_TABLE);

    revalidatePath("/databases");
    revalidatePath(`/databases/${CUSTOMERS_TABLE.slug}`);

    return {
      ok: true,
      message: `${CUSTOMERS_TABLE.name} — ${CUSTOMERS_TABLE.records.length} rows, ${CUSTOMERS_TABLE.fields.length} fields`,
    };
  } catch (error) {
    console.error("[seed/database]", error);
    return { ok: false, error: message(error) };
  }
}

/**
 * The board from `designs/board-1.jpg` — empty, and ready to be asked.
 *
 * The only one of the three that is not destructive: a board is a title and an emoji, and
 * its tiles are added by asking it questions. The existence check is kept anyway, so all
 * three behave the same way and the button never reports success for a no-op.
 */
export async function seedBoard(): Promise<Result> {
  const denied = await guard();
  if (denied) return denied;

  try {
    const existing = await db.board.findUnique({
      where: { slug: BOARD_SLUG },
      select: { id: true },
    });
    if (existing) {
      return { ok: false, error: "That board already exists — nothing was overwritten." };
    }

    const board = await db.board.create({
      data: { slug: BOARD_SLUG, title: "Financial Performance Overview", emoji: "📈" },
    });

    revalidatePath("/boards");
    revalidatePath(`/boards/${BOARD_SLUG}`);

    return { ok: true, message: `${board.title} — ask it a question to add a tile` };
  } catch (error) {
    console.error("[seed/board]", error);
    return { ok: false, error: message(error) };
  }
}

/**
 * The database is the thing most likely to fail here, and it fails in ways worth naming.
 *
 * A seed against a database that has never been migrated, or one behind an unreachable
 * pooler, produces a Prisma error whose message is the most useful thing on screen — far more
 * so than "something went wrong". It is surfaced rather than swallowed because the person
 * pressing this button is the person who can act on `P1001` or `P2028`.
 */
function message(error: unknown): string {
  return error instanceof Error ? error.message : "The seed could not be written.";
}
