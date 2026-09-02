/*
  Warnings:

  - You are about to drop the `agent_run` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_changeSetId_fkey";

-- DropForeignKey
ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_modelId_fkey";

-- DropTable
DROP TABLE "agent_run";

-- CreateTable
CREATE TABLE "agent_chat" (
    "modelId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_chat_pkey" PRIMARY KEY ("modelId")
);

-- AddForeignKey
ALTER TABLE "agent_chat" ADD CONSTRAINT "agent_chat_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
