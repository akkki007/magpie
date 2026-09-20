-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'WAITING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "agent_run" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "plan" JSONB,
    "steps" JSONB,
    "files" JSONB,
    "result" TEXT,
    "error" TEXT,
    "threadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_run_actorId_createdAt_idx" ON "agent_run"("actorId", "createdAt");
