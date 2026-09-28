CREATE TABLE "accounting_sepidar_target_links" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "sourceTable" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "firstSnapshotId" TEXT NOT NULL,
  "latestSnapshotId" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "mappingVersion" INTEGER NOT NULL,
  "reviewStatus" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "reviewEvidence" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_sepidar_target_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_sepidar_target_links_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accounting_sepidar_target_links_review_status_check" CHECK ("reviewStatus" IN ('PROPOSED', 'USER_APPROVED', 'ACCOUNTANT_APPROVED', 'EXCEPTION'))
);
CREATE UNIQUE INDEX "accounting_sepidar_target_links_bookId_sourceTable_sourceKey_targetKind_key" ON "accounting_sepidar_target_links"("bookId", "sourceTable", "sourceKey", "targetKind");
CREATE INDEX "accounting_sepidar_target_links_bookId_targetKind_targetId_idx" ON "accounting_sepidar_target_links"("bookId", "targetKind", "targetId");
CREATE INDEX "accounting_sepidar_target_links_firstSnapshotId_sourceTable_idx" ON "accounting_sepidar_target_links"("firstSnapshotId", "sourceTable");
