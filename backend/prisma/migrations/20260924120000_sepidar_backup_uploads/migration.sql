CREATE TABLE "accounting_sepidar_backup_uploads" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "sourcePackageHash" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "storageName" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "status" TEXT NOT NULL,
  "uploadedBy" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_sepidar_backup_uploads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_sepidar_backup_uploads_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "accounting_sepidar_backup_uploads_status_check" CHECK ("status" IN ('STAGED_UNVERIFIED', 'EXTRACTED', 'REJECTED')),
  CONSTRAINT "accounting_sepidar_backup_uploads_size_check" CHECK ("sizeBytes" > 0)
);
CREATE UNIQUE INDEX "accounting_sepidar_backup_uploads_bookId_sourcePackageHash_key" ON "accounting_sepidar_backup_uploads"("bookId", "sourcePackageHash");
CREATE INDEX "accounting_sepidar_backup_uploads_bookId_uploadedAt_idx" ON "accounting_sepidar_backup_uploads"("bookId", "uploadedAt");
