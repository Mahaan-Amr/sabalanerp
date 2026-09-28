CREATE TABLE "accounting_sepidar_source_snapshots" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "sourcePackageHash" TEXT NOT NULL,
  "sourceDatabase" TEXT NOT NULL,
  "schemaManifestHash" TEXT NOT NULL,
  "schemaManifest" JSONB NOT NULL,
  "sourceMetadata" JSONB NOT NULL,
  "tableCount" INTEGER NOT NULL,
  "expectedRecordCount" INTEGER NOT NULL,
  "importedRecordCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "accounting_sepidar_source_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_sepidar_source_snapshots_hash_check" CHECK ("sourcePackageHash" ~ '^[0-9a-f]{64}$' AND "schemaManifestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "accounting_sepidar_source_snapshots_count_check" CHECK ("tableCount" >= 0 AND "expectedRecordCount" >= 0 AND "importedRecordCount" BETWEEN 0 AND "expectedRecordCount"),
  CONSTRAINT "accounting_sepidar_source_snapshots_status_check" CHECK ("status" IN ('IMPORTING', 'COMPLETE', 'FAILED'))
);

CREATE UNIQUE INDEX "accounting_sepidar_source_snapshots_bookId_sourcePackageHash_key"
  ON "accounting_sepidar_source_snapshots"("bookId", "sourcePackageHash");
CREATE INDEX "accounting_sepidar_source_snapshots_bookId_status_startedAt_idx"
  ON "accounting_sepidar_source_snapshots"("bookId", "status", "startedAt");
ALTER TABLE "accounting_sepidar_source_snapshots"
  ADD CONSTRAINT "accounting_sepidar_source_snapshots_bookId_fkey"
  FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "accounting_sepidar_source_records" (
  "id" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "sourceTable" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "fiscalYearRef" INTEGER,
  "documentDate" TIMESTAMP(3),
  "payload" JSONB NOT NULL,
  "searchText" TEXT NOT NULL,
  CONSTRAINT "accounting_sepidar_source_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_sepidar_source_records_hash_check" CHECK ("sourceHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "accounting_sepidar_source_records_snapshotId_sourceTable_sourceKey_key"
  ON "accounting_sepidar_source_records"("snapshotId", "sourceTable", "sourceKey");
CREATE INDEX "accounting_sepidar_source_records_snapshotId_fiscalYearRef_sourceTable_idx"
  ON "accounting_sepidar_source_records"("snapshotId", "fiscalYearRef", "sourceTable");
ALTER TABLE "accounting_sepidar_source_records"
  ADD CONSTRAINT "accounting_sepidar_source_records_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "accounting_sepidar_source_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION accounting_reject_sepidar_source_record_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Sepidar source records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounting_sepidar_source_record_immutable
  BEFORE UPDATE OR DELETE ON "accounting_sepidar_source_records"
  FOR EACH ROW EXECUTE FUNCTION accounting_reject_sepidar_source_record_mutation();
