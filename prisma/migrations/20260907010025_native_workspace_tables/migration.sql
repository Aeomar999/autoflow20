-- DropIndex
DROP INDEX "KnowledgeChunk_embedding_hnsw_idx";

-- AlterTable
ALTER TABLE "KnowledgeChunk" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "KnowledgeSource" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Template" ALTER COLUMN "tags" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "approval_request" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "workspace_table" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_record" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_table_organizationId_idx" ON "workspace_table"("organizationId");

-- CreateIndex
CREATE INDEX "workspace_record_tableId_idx" ON "workspace_record"("tableId");

-- CreateIndex
CREATE INDEX "workspace_record_organizationId_idx" ON "workspace_record"("organizationId");

-- AddForeignKey
ALTER TABLE "workspace_table" ADD CONSTRAINT "workspace_table_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_record" ADD CONSTRAINT "workspace_record_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "workspace_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_record" ADD CONSTRAINT "workspace_record_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
