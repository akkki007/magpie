"use server";

import { revalidatePath } from "next/cache";

import { readTable, listTables } from "@/lib/data/persist";
import type { Table } from "@/lib/data/types";
import { addTile, readBoard, removeTile } from "@/lib/board/persist";
import { askForTile } from "@/lib/board/openai-board";
import { db } from "@/lib/db";
import { readModel } from "@/lib/model/persist";
import { getSession } from "@/lib/session";

/**
 * Asking a board a question (`docs/board-plan.md` feature 1).
 *
 * Auth is checked here for the reason `models/actions.ts` gives at length: a server function
 * is an HTTP endpoint that happens to be written as a function.
 *
 * The answer is **persisted as a tile**, not returned to be rendered once. A question
 * somebody asked and got a useful answer to is the board they wanted; making it durable is
 * the difference between a chat window and a report.
 */

type Result = { ok: true } | { ok: false; error: string };

/** Every table, rows included — the rollup needs them, and the catalogue needs the fields. */
async function allTables(): Promise<Table[]> {
  const summaries = await listTables(db);
  const tables = await Promise.all(summaries.map((s) => readTable(db, s.slug)));
  return tables.filter((t): t is Table => t !== null);
}

export async function askBoard(
  boardSlug: string,
  modelSlug: string,
  question: string,
): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session has expired — sign in again." };

  const trimmed = question.trim();
  if (!trimmed) return { ok: false, error: "Ask something first." };
  if (trimmed.length > 500) return { ok: false, error: "That question is too long." };

  const [board, model, tables] = await Promise.all([
    readBoard(db, boardSlug),
    readModel(db, modelSlug),
    allTables(),
  ]);
  if (!board) return { ok: false, error: "That board no longer exists." };
  if (!model) return { ok: false, error: "That model no longer exists." };

  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "OPENAI_API_KEY is not set, so questions cannot be answered." };
  }

  const answer = await askForTile(trimmed, model, tables);
  if (!answer.ok) return { ok: false, error: answer.error };

  await addTile(db, board.id, answer.spec, trimmed);
  revalidatePath(`/boards/${boardSlug}`);
  return { ok: true };
}

export async function deleteTile(boardSlug: string, tileId: string): Promise<Result> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session has expired — sign in again." };

  const board = await readBoard(db, boardSlug);
  if (!board) return { ok: false, error: "That board no longer exists." };

  await removeTile(db, board.id, tileId);
  revalidatePath(`/boards/${boardSlug}`);
  return { ok: true };
}
