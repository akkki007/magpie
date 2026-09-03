-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'SELECT');

-- CreateTable
CREATE TABLE "data_table" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_field" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "options" JSONB,
    "order" INTEGER NOT NULL,

    CONSTRAINT "data_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_record" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "cells" JSONB NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_table_organisationId_idx" ON "data_table"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "data_table_slug_key" ON "data_table"("slug");

-- CreateIndex
CREATE INDEX "data_field_tableId_idx" ON "data_field"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "data_field_tableId_name_key" ON "data_field"("tableId", "name");

-- CreateIndex
CREATE INDEX "data_record_tableId_order_idx" ON "data_record"("tableId", "order");

-- AddForeignKey
ALTER TABLE "data_field" ADD CONSTRAINT "data_field_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "data_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_record" ADD CONSTRAINT "data_record_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "data_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
