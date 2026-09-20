-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BinaryOp" ADD VALUE 'EQ';
ALTER TYPE "BinaryOp" ADD VALUE 'NEQ';
ALTER TYPE "BinaryOp" ADD VALUE 'LT';
ALTER TYPE "BinaryOp" ADD VALUE 'LTE';
ALTER TYPE "BinaryOp" ADD VALUE 'GT';
ALTER TYPE "BinaryOp" ADD VALUE 'GTE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FormulaFn" ADD VALUE 'OPENING';
ALTER TYPE "FormulaFn" ADD VALUE 'CLOSING';
ALTER TYPE "FormulaFn" ADD VALUE 'GROWTH';
ALTER TYPE "FormulaFn" ADD VALUE 'SPREAD';
ALTER TYPE "FormulaFn" ADD VALUE 'IF';
ALTER TYPE "FormulaFn" ADD VALUE 'MEMBER_SUM';
ALTER TYPE "FormulaFn" ADD VALUE 'MEMBER_AVG';
ALTER TYPE "FormulaFn" ADD VALUE 'MEMBER_MIN';
ALTER TYPE "FormulaFn" ADD VALUE 'MEMBER_MAX';
ALTER TYPE "FormulaFn" ADD VALUE 'MEMBER_COUNT';
