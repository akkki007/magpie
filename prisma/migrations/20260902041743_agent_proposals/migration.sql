-- CreateEnum
CREATE TYPE "ChangeSetStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "change_set" ADD COLUMN     "status" "ChangeSetStatus",
ALTER COLUMN "seq" DROP NOT NULL;

-- AlterTable
ALTER TABLE "command" ALTER COLUMN "inverse" DROP NOT NULL;

-- CreateTable
CREATE TABLE "agent_run" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "answer" TEXT,
    "changeSetId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_changeSetId_key" ON "agent_run"("changeSetId");

-- CreateIndex
CREATE INDEX "agent_run_modelId_createdAt_idx" ON "agent_run"("modelId", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "change_set"("id") ON DELETE SET NULL ON UPDATE CASCADE;
