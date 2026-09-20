import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";

import { periodDate, periodsBetween } from "./persist";

/**
 * Comments, anchored to a variable and a period (`docs/modelling-plan.md` §6, M6.1).
 *
 * Not a `Command`. §1.3's list — the things undo, the audit log and agent proposals share
 * one mechanism for — is about the model's *numbers*. A comment does not change what the
 * model computes, so it has no inverse and no place in the undo stack; it is closer to a
 * `ModelVersion`'s label than to an edit, and CRUD is the honest shape for that.
 */

export type Comment = {
  id: string;
  variableId: string;
  variableName: string;
  periodLabel: string;
  body: string;
  authorName: string;
  resolvedAt: string | null;
  createdAt: string;
};

type Tx = Prisma.TransactionClient | PrismaClient;

export async function listComments(tx: Tx, modelId: string): Promise<Comment[]> {
  const rows = await tx.comment.findMany({
    where: { modelId },
    orderBy: { createdAt: "desc" },
    include: { variable: { select: { name: true } } },
  });

  const model = await tx.model.findUniqueOrThrow({
    where: { id: modelId },
    select: { horizonStart: true, horizonEnd: true },
  });
  const periods = periodsBetween(model.horizonStart, model.horizonEnd);
  const labelFor = (date: Date) =>
    periods.find((p) => p.year === date.getUTCFullYear() && p.month === date.getUTCMonth() + 1)?.label ??
    date.toISOString().slice(0, 7);

  return rows.map((row) => ({
    id: row.id,
    variableId: row.variableId,
    variableName: row.variable.name,
    periodLabel: labelFor(row.period),
    body: row.body,
    authorName: row.authorName,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function addComment(
  tx: Tx,
  args: {
    modelId: string;
    variableId: string;
    /** Index into the model's own period list, the same way `SetInput.period` addresses one. */
    period: number;
    body: string;
    actor: { id: string | null; name: string };
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const variable = await tx.variable.findFirst({
    where: { id: args.variableId, modelId: args.modelId },
    select: { id: true },
  });
  if (!variable) return { ok: false, error: "That variable is not in this model." };

  const model = await tx.model.findUniqueOrThrow({
    where: { id: args.modelId },
    select: { horizonStart: true, horizonEnd: true },
  });
  const periods = periodsBetween(model.horizonStart, model.horizonEnd);
  const period = periods[args.period];
  if (!period) return { ok: false, error: "That period is outside the model's horizon." };

  await tx.comment.create({
    data: {
      modelId: args.modelId,
      variableId: args.variableId,
      period: periodDate(period),
      body: args.body,
      authorId: args.actor.id,
      authorName: args.actor.name,
    },
  });
  return { ok: true };
}

export async function setCommentResolved(
  tx: Tx,
  args: { modelId: string; commentId: string; resolved: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { count } = await tx.comment.updateMany({
    where: { id: args.commentId, modelId: args.modelId },
    data: { resolvedAt: args.resolved ? new Date() : null },
  });
  if (count === 0) return { ok: false, error: "That comment is not on this model." };
  return { ok: true };
}
