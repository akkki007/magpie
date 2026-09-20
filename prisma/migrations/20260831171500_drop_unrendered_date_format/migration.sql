-- Narrow NumberFormat: drop DATE.
--
-- §2 of docs/modelling-plan.md lists a fifth format, DATE. Nothing renders one
-- — `formatValue`'s switch in lib/model/format.ts is exhaustive over the other
-- four — so a DATE row would load without error and then render as nothing.
-- The database must not be able to express a state the engine cannot honour;
-- that correspondence is the whole premise of M0.
--
-- Written by hand because `prisma migrate dev` will not create a destructive
-- enum change without an interactive confirmation. Postgres cannot remove a
-- value from an enum in place, so the type is rebuilt and the column recast.
ALTER TYPE "NumberFormat" RENAME TO "NumberFormat_old";

CREATE TYPE "NumberFormat" AS ENUM ('CURRENCY', 'COUNT', 'PERCENT', 'RATIO');

ALTER TABLE "variable"
  ALTER COLUMN "format" TYPE "NumberFormat"
  USING ("format"::text::"NumberFormat");

DROP TYPE "NumberFormat_old";
