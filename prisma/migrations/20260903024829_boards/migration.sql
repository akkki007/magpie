-- CreateEnum
CREATE TYPE "TileKind" AS ENUM ('KPI', 'CHART', 'TEXT');

-- CreateTable
CREATE TABLE "board" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "emoji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_tile" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "kind" "TileKind" NOT NULL,
    "spec" JSONB NOT NULL,
    "question" TEXT,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_tile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_organisationId_idx" ON "board"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "board_slug_key" ON "board"("slug");

-- CreateIndex
CREATE INDEX "board_tile_boardId_order_idx" ON "board_tile"("boardId", "order");

-- AddForeignKey
ALTER TABLE "board_tile" ADD CONSTRAINT "board_tile_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
