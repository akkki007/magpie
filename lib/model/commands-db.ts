import type { Prisma } from "@/lib/generated/prisma/client";

import type { Command } from "./commands";
import { flattenFormula, periodsBetween } from "./persist";

/**
 * A command, applied to Postgres (`docs/modelling-plan.md` M1.1).
 *
 * The client applies the same command to its own copy first (M1.2) and this runs on the
 * server; both go through `Command`, so there is one vocabulary of legal mutations and not a
 * client one and a server one that drift. §1.3's argument is that undo, the audit log and
 * agent edits are one mechanism — that only holds if the *write* is the same mechanism too.
 *
 * What is deliberately missing is a `Command` table. M3 persists the stream with its
 * inverses; M1 persists the effect. Writing the stream now, before there is a history panel
 * or a version to roll back to, would be a table nothing reads.
 */

type Tx = Prisma.TransactionClient;

/** The period index a command carries → the first of that month. */
async function periodDate(tx: Tx, modelId: string, index: number): Promise<Date | null> {
  const model = await tx.model.findUnique({
    where: { id: modelId },
    select: { horizonStart: true, horizonEnd: true },
  });
  if (!model) return null;
  const periods = periodsBetween(model.horizonStart, model.horizonEnd);
  const period = periods[index];
  return period ? new Date(Date.UTC(period.year, period.month - 1, 1)) : null;
}

export async function applyCommandToDb(tx: Tx, modelId: string, command: Command): Promise<void> {
  switch (command.type) {
    case "SetInput": {
      const period = await periodDate(tx, modelId, command.period);
      if (!period) throw new Error(`period ${command.period} is outside the model's horizon`);

      // The variable must belong to *this* model. Without that check a valid command naming
      // someone else's variable id would be applied happily — the shape is legal, the
      // authorisation is not, and schema validation cannot see the difference.
      const variable = await tx.variable.findFirst({
        where: { id: command.variableId, modelId },
        select: { id: true },
      });
      if (!variable) throw new Error(`variable ${command.variableId} is not in this model`);

      await tx.variableInput.upsert({
        where: {
          variableId_dimensionKey_period: {
            variableId: command.variableId,
            dimensionKey: command.member,
            period,
          },
        },
        create: {
          variableId: command.variableId,
          dimensionKey: command.member,
          period,
          value: command.value,
        },
        update: { value: command.value },
      });
      return;
    }

    case "RenameVariable": {
      const { count } = await tx.variable.updateMany({
        where: { id: command.variableId, modelId },
        data: { name: command.name },
      });
      if (count === 0) throw new Error(`variable ${command.variableId} is not in this model`);
      return;
    }

    case "InsertVariable": {
      const { variable, index } = command;

      // Everything at or after the insertion point shifts down, so `order` keeps meaning
      // what the grid shows. Done in one statement rather than a read-modify-write loop:
      // two people inserting at once would otherwise interleave into a duplicate order.
      await tx.variable.updateMany({
        where: { modelId, order: { gte: index } },
        data: { order: { increment: 1 } },
      });

      await tx.variable.create({
        data: {
          id: variable.id,
          modelId,
          groupId: variable.groupId,
          name: variable.name,
          kind: variable.kind,
          format: variable.format,
          aggregation: variable.aggregation,
          dimensionId: variable.dimensionId ?? null,
          memberRollup: variable.memberRollup ?? null,
          timeContext: variable.timeContext ?? null,
          note: variable.note ?? null,
          order: index,
        },
      });

      if (variable.formula) {
        for (const node of flattenFormula(variable.formula, variable.id)) {
          await tx.formulaNode.create({ data: { ...node, variableId: variable.id } });
        }
      }

      if (command.inputs) {
        const model = await tx.model.findUniqueOrThrow({
          where: { id: modelId },
          select: { horizonStart: true, horizonEnd: true },
        });
        const periods = periodsBetween(model.horizonStart, model.horizonEnd);
        const rows = Object.entries(command.inputs).flatMap(([member, series]) =>
          series.flatMap((value, i) =>
            periods[i]
              ? [
                  {
                    variableId: variable.id,
                    dimensionKey: member,
                    period: new Date(Date.UTC(periods[i].year, periods[i].month - 1, 1)),
                    value,
                  },
                ]
              : [],
          ),
        );
        if (rows.length > 0) await tx.variableInput.createMany({ data: rows });
      }
      return;
    }

    case "RemoveVariable": {
      // Cascades take the formula nodes, inputs, series and overrides with it. `order` is
      // left with a gap on purpose: renumbering every following row to close it would
      // rewrite rows nobody touched, and nothing reads `order` as contiguous.
      const { count } = await tx.variable.deleteMany({
        where: { id: command.variableId, modelId },
      });
      if (count === 0) throw new Error(`variable ${command.variableId} is not in this model`);
      return;
    }
  }
}
