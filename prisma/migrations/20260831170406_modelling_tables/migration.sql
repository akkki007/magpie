-- CreateEnum
CREATE TYPE "Grain" AS ENUM ('MONTH', 'QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "VariableKind" AS ENUM ('INPUT', 'FORMULA', 'LINKED');

-- CreateEnum
CREATE TYPE "NumberFormat" AS ENUM ('CURRENCY', 'COUNT', 'PERCENT', 'RATIO', 'DATE');

-- CreateEnum
CREATE TYPE "Aggregation" AS ENUM ('SUM', 'FIRST', 'LAST', 'AVG', 'NONE');

-- CreateEnum
CREATE TYPE "MemberRollup" AS ENUM ('SUM', 'AVG');

-- CreateEnum
CREATE TYPE "ChipTone" AS ENUM ('amber', 'rose', 'graphite', 'sky', 'blue');

-- CreateEnum
CREATE TYPE "FormulaNodeType" AS ENUM ('literal', 'ref', 'binary', 'call');

-- CreateEnum
CREATE TYPE "BinaryOp" AS ENUM ('ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'POWER');

-- CreateEnum
CREATE TYPE "FormulaFn" AS ENUM ('PRIOR', 'NEXT', 'YTD', 'CUMULATIVE', 'MIN', 'MAX', 'ABS');

-- CreateTable
CREATE TABLE "model" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "baseGrain" "Grain" NOT NULL DEFAULT 'MONTH',
    "horizonStart" DATE NOT NULL,
    "horizonEnd" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variable_group" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chip" "ChipTone" NOT NULL DEFAULT 'graphite',
    "order" INTEGER NOT NULL,

    CONSTRAINT "variable_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variable" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "VariableKind" NOT NULL,
    "format" "NumberFormat" NOT NULL,
    "aggregation" "Aggregation" NOT NULL,
    "dimensionId" TEXT,
    "memberRollup" "MemberRollup",
    "timeContext" TEXT,
    "note" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "variable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimension" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "name" TEXT NOT NULL,

    CONSTRAINT "dimension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimension_member" (
    "id" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "dimension_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formula_node" (
    "id" TEXT NOT NULL,
    "variableId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "FormulaNodeType" NOT NULL,
    "op" "BinaryOp",
    "literal" DECIMAL(20,6),
    "refVariableId" TEXT,
    "refMember" TEXT,
    "fn" "FormulaFn",
    "order" INTEGER NOT NULL,

    CONSTRAINT "formula_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variable_input" (
    "id" TEXT NOT NULL,
    "variableId" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL DEFAULT '',
    "period" DATE NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "variable_input_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variable_series" (
    "id" TEXT NOT NULL,
    "variableId" TEXT NOT NULL,
    "scenarioId" TEXT,
    "dimensionKey" TEXT NOT NULL DEFAULT '',
    "values" JSONB NOT NULL,
    "staleAt" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variable_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isBase" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_override" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "variableId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "scenario_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "model_organisationId_idx" ON "model"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "model_slug_key" ON "model"("slug");

-- CreateIndex
CREATE INDEX "variable_group_modelId_idx" ON "variable_group"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "variable_group_modelId_name_key" ON "variable_group"("modelId", "name");

-- CreateIndex
CREATE INDEX "variable_modelId_idx" ON "variable"("modelId");

-- CreateIndex
CREATE INDEX "variable_groupId_idx" ON "variable"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "variable_modelId_name_key" ON "variable"("modelId", "name");

-- CreateIndex
CREATE INDEX "dimension_organisationId_idx" ON "dimension"("organisationId");

-- CreateIndex
CREATE INDEX "dimension_member_dimensionId_idx" ON "dimension_member"("dimensionId");

-- CreateIndex
CREATE UNIQUE INDEX "dimension_member_dimensionId_key_key" ON "dimension_member"("dimensionId", "key");

-- CreateIndex
CREATE INDEX "formula_node_variableId_idx" ON "formula_node"("variableId");

-- CreateIndex
CREATE INDEX "formula_node_parentId_idx" ON "formula_node"("parentId");

-- CreateIndex
CREATE INDEX "formula_node_refVariableId_idx" ON "formula_node"("refVariableId");

-- CreateIndex
CREATE INDEX "variable_input_variableId_idx" ON "variable_input"("variableId");

-- CreateIndex
CREATE UNIQUE INDEX "variable_input_variableId_dimensionKey_period_key" ON "variable_input"("variableId", "dimensionKey", "period");

-- CreateIndex
CREATE INDEX "variable_series_variableId_idx" ON "variable_series"("variableId");

-- CreateIndex
CREATE UNIQUE INDEX "variable_series_variableId_scenarioId_dimensionKey_key" ON "variable_series"("variableId", "scenarioId", "dimensionKey");

-- CreateIndex
CREATE INDEX "scenario_modelId_idx" ON "scenario"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_modelId_name_key" ON "scenario"("modelId", "name");

-- CreateIndex
CREATE INDEX "scenario_override_scenarioId_idx" ON "scenario_override"("scenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "scenario_override_scenarioId_variableId_key" ON "scenario_override"("scenarioId", "variableId");

-- AddForeignKey
ALTER TABLE "variable_group" ADD CONSTRAINT "variable_group_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable" ADD CONSTRAINT "variable_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable" ADD CONSTRAINT "variable_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "variable_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable" ADD CONSTRAINT "variable_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "dimension"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dimension_member" ADD CONSTRAINT "dimension_member_dimensionId_fkey" FOREIGN KEY ("dimensionId") REFERENCES "dimension"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_node" ADD CONSTRAINT "formula_node_variableId_fkey" FOREIGN KEY ("variableId") REFERENCES "variable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_node" ADD CONSTRAINT "formula_node_refVariableId_fkey" FOREIGN KEY ("refVariableId") REFERENCES "variable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_node" ADD CONSTRAINT "formula_node_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "formula_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_input" ADD CONSTRAINT "variable_input_variableId_fkey" FOREIGN KEY ("variableId") REFERENCES "variable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_series" ADD CONSTRAINT "variable_series_variableId_fkey" FOREIGN KEY ("variableId") REFERENCES "variable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_series" ADD CONSTRAINT "variable_series_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario" ADD CONSTRAINT "scenario_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario" ADD CONSTRAINT "scenario_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "scenario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_override" ADD CONSTRAINT "scenario_override_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_override" ADD CONSTRAINT "scenario_override_variableId_fkey" FOREIGN KEY ("variableId") REFERENCES "variable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- §2: "a formula referencing 'Revenue' can only mean one variable."
--
-- The `@@unique([modelId, name])` above stops two variables sharing a name
-- exactly; this stops "Revenue" and "revenue" coexisting, which is the case
-- that actually bites — a formula referencing one of them is unresolvable by
-- eye, and the AST would happily point at either. Prisma's schema language
-- cannot express a functional index, so it lives here.
CREATE UNIQUE INDEX "variable_model_name_lower_key"
  ON "variable" ("modelId", lower("name"));
