-- CreateTable
CREATE TABLE "comment" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "variableId" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comment_modelId_createdAt_idx" ON "comment"("modelId", "createdAt");

-- CreateIndex
CREATE INDEX "comment_variableId_idx" ON "comment"("variableId");

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_variableId_fkey" FOREIGN KEY ("variableId") REFERENCES "variable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
