-- CreateEnum
CREATE TYPE "ChangeOrigin" AS ENUM ('USER', 'AGENT', 'SYNC');

-- CreateEnum
CREATE TYPE "ChangeKind" AS ENUM ('EDIT', 'UNDO', 'REDO', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "CommandType" AS ENUM ('SetInput', 'RenameVariable', 'SetFormula', 'InsertVariable', 'RemoveVariable');

-- CreateTable
CREATE TABLE "change_set" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "ChangeKind" NOT NULL,
    "origin" "ChangeOrigin" NOT NULL DEFAULT 'USER',
    "label" TEXT NOT NULL,
    "targetId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command" (
    "id" TEXT NOT NULL,
    "changeSetId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "CommandType" NOT NULL,
    "payload" JSONB NOT NULL,
    "inverse" JSONB NOT NULL,

    CONSTRAINT "command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_version" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "change_set_modelId_createdAt_idx" ON "change_set"("modelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "change_set_modelId_seq_key" ON "change_set"("modelId", "seq");

-- CreateIndex
CREATE INDEX "command_changeSetId_idx" ON "command"("changeSetId");

-- CreateIndex
CREATE INDEX "model_version_modelId_seq_idx" ON "model_version"("modelId", "seq");

-- AddForeignKey
ALTER TABLE "change_set" ADD CONSTRAINT "change_set_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_set" ADD CONSTRAINT "change_set_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "change_set"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command" ADD CONSTRAINT "command_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "change_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_version" ADD CONSTRAINT "model_version_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
