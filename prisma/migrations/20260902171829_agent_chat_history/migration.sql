/*
  Warnings:

  - The primary key for the `agent_chat` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The required column `id` was added to the `agent_chat` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `title` to the `agent_chat` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "agent_chat" DROP CONSTRAINT "agent_chat_pkey",
ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "id" TEXT NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL,
ADD CONSTRAINT "agent_chat_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "agent_chat_modelId_actorId_updatedAt_idx" ON "agent_chat"("modelId", "actorId", "updatedAt");
