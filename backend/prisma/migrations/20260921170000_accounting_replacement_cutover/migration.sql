CREATE TABLE "accounting_replacement_migration_runs" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "sourcePackageHash" TEXT NOT NULL,
  "toolVersion" TEXT NOT NULL,
  "mappingVersion" INTEGER NOT NULL,
  "scope" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "inputCount" INTEGER NOT NULL,
  "acceptedCount" INTEGER NOT NULL,
  "rejectedCount" INTEGER NOT NULL,
  "outputHash" TEXT NOT NULL,
  "reconciliation" JSONB,
  "predecessorRunId" TEXT,
  "successorRunId" TEXT,
  "previewedAt" TIMESTAMP(3) NOT NULL,
  "committedAt" TIMESTAMP(3),
  "acceptedBy" TEXT,
  "acceptanceReason" TEXT,
  CONSTRAINT "accounting_replacement_migration_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_replacement_migration_runs_counts_check" CHECK ("inputCount" = "acceptedCount" + "rejectedCount"),
  CONSTRAINT "accounting_replacement_migration_runs_hashes_check" CHECK ("sourcePackageHash" ~ '^[0-9a-f]{64}$' AND "outputHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "accounting_replacement_migration_runs_status_check" CHECK ("status" IN ('PREVIEWED', 'RECONCILED'))
);

CREATE TABLE "accounting_replacement_migration_records" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "sourceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "targetIdentity" TEXT,
  "rejectionReason" TEXT,
  "sourceHash" TEXT NOT NULL,
  "targetHash" TEXT,
  "debitRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
  "creditRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
  "quantity" TEXT,
  "valueRials" DECIMAL(20,0),
  "sourcePayload" JSONB NOT NULL,
  CONSTRAINT "accounting_replacement_migration_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_replacement_migration_records_disposition_check" CHECK (
    ("disposition" = 'ACCEPTED' AND "targetIdentity" IS NOT NULL AND "rejectionReason" IS NULL AND "targetHash" IS NOT NULL)
    OR ("disposition" = 'REJECTED' AND "targetIdentity" IS NULL AND "rejectionReason" IS NOT NULL AND "targetHash" IS NULL)
  ),
  CONSTRAINT "accounting_replacement_migration_records_amount_check" CHECK ("debitRials" >= 0 AND "creditRials" >= 0 AND NOT ("debitRials" > 0 AND "creditRials" > 0)),
  CONSTRAINT "accounting_replacement_migration_records_hash_check" CHECK ("sourceHash" ~ '^[0-9a-f]{64}$' AND ("targetHash" IS NULL OR "targetHash" ~ '^[0-9a-f]{64}$'))
);

CREATE TABLE "accounting_legacy_archive_records" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "migrationRunId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "searchText" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_legacy_archive_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounting_replacement_parallel_runs" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "periodIdentity" TEXT NOT NULL,
  "completeMonth" BOOLEAN NOT NULL,
  "fullClose" BOOLEAN NOT NULL,
  "differences" JSONB NOT NULL,
  "accepted" BOOLEAN NOT NULL,
  "actorId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_replacement_parallel_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_replacement_parallel_runs_acceptance_check" CHECK (NOT "accepted" OR "completeMonth")
);

CREATE TABLE "accounting_replacement_recovery_proofs" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "checkpointIdentity" TEXT NOT NULL,
  "databaseHash" TEXT NOT NULL,
  "filesHash" TEXT NOT NULL,
  "configurationHash" TEXT NOT NULL,
  "encryptedOffsite" BOOLEAN NOT NULL,
  "immutableRecoveryPoint" BOOLEAN NOT NULL,
  "restoreVerified" BOOLEAN NOT NULL,
  "repeatedRestoreVerified" BOOLEAN NOT NULL,
  "rpoMinutes" INTEGER NOT NULL,
  "rtoMinutes" INTEGER NOT NULL,
  "drillKind" TEXT NOT NULL,
  "proven" BOOLEAN NOT NULL,
  "actorId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounting_replacement_recovery_proofs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_replacement_recovery_proofs_targets_check" CHECK (NOT "proven" OR ("encryptedOffsite" AND "immutableRecoveryPoint" AND "restoreVerified" AND "repeatedRestoreVerified" AND "rpoMinutes" <= 15 AND "rtoMinutes" <= 240))
);

CREATE TABLE "accounting_replacement_cutover_runs" (
  "id" TEXT NOT NULL,
  "bookId" TEXT NOT NULL,
  "checkpointIdentity" TEXT NOT NULL,
  "finalDeltaRunId" TEXT NOT NULL,
  "exactReconciliationHash" TEXT NOT NULL,
  "acceptanceHash" TEXT NOT NULL,
  "writesBlocked" BOOLEAN NOT NULL,
  "servicesDrained" BOOLEAN NOT NULL,
  "status" TEXT NOT NULL,
  "authorityTransferredAt" TIMESTAMP(3),
  "authorityTransferReason" TEXT,
  "sepidarReadOnly" BOOLEAN NOT NULL DEFAULT false,
  "sabalanAuthoritative" BOOLEAN NOT NULL DEFAULT false,
  "firstAuthoritativeVoucherId" TEXT,
  "firstAuthoritativePostingAt" TIMESTAMP(3),
  "rollbackAllowed" BOOLEAN NOT NULL DEFAULT true,
  "failureCode" TEXT,
  "failureReason" TEXT,
  CONSTRAINT "accounting_replacement_cutover_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accounting_replacement_cutover_runs_status_check" CHECK ("status" IN ('PREPARED', 'AUTHORITY_TRANSFERRED', 'ROLLED_BACK', 'PAUSED_FIX_FORWARD')),
  CONSTRAINT "accounting_replacement_cutover_runs_authority_check" CHECK (
    "authorityTransferredAt" IS NULL OR ("authorityTransferReason" IS NOT NULL AND "sepidarReadOnly" AND "sabalanAuthoritative")
  ),
  CONSTRAINT "accounting_replacement_cutover_runs_posting_check" CHECK ("firstAuthoritativeVoucherId" IS NULL OR ("firstAuthoritativePostingAt" IS NOT NULL AND NOT "rollbackAllowed"))
);

CREATE TABLE "accounting_replacement_audit_entries" (
  "id" TEXT NOT NULL,
  "sequence" BIGINT NOT NULL,
  "action" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "previousHash" TEXT,
  "entryHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_replacement_audit_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_replacement_migration_runs_bookId_sourcePackageHash_mappingVersion_key" ON "accounting_replacement_migration_runs"("bookId", "sourcePackageHash", "mappingVersion");
CREATE UNIQUE INDEX "accounting_replacement_migration_runs_successorRunId_key" ON "accounting_replacement_migration_runs"("successorRunId");
CREATE INDEX "accounting_replacement_migration_runs_bookId_status_previewedAt_idx" ON "accounting_replacement_migration_runs"("bookId", "status", "previewedAt");
CREATE INDEX "accounting_replacement_migration_runs_predecessorRunId_idx" ON "accounting_replacement_migration_runs"("predecessorRunId");
CREATE UNIQUE INDEX "accounting_replacement_migration_records_runId_sequence_key" ON "accounting_replacement_migration_records"("runId", "sequence");
CREATE UNIQUE INDEX "accounting_replacement_migration_records_runId_sourceId_key" ON "accounting_replacement_migration_records"("runId", "sourceId");
CREATE INDEX "accounting_replacement_migration_records_sourceId_kind_idx" ON "accounting_replacement_migration_records"("sourceId", "kind");
CREATE UNIQUE INDEX "accounting_legacy_archive_records_bookId_sourceId_sourceHash_key" ON "accounting_legacy_archive_records"("bookId", "sourceId", "sourceHash");
CREATE INDEX "accounting_legacy_archive_records_bookId_createdAt_idx" ON "accounting_legacy_archive_records"("bookId", "createdAt");
CREATE UNIQUE INDEX "accounting_replacement_parallel_runs_bookId_periodIdentity_key" ON "accounting_replacement_parallel_runs"("bookId", "periodIdentity");
CREATE INDEX "accounting_replacement_parallel_runs_bookId_accepted_recordedAt_idx" ON "accounting_replacement_parallel_runs"("bookId", "accepted", "recordedAt");
CREATE UNIQUE INDEX "accounting_replacement_recovery_proofs_bookId_checkpointIdentity_key" ON "accounting_replacement_recovery_proofs"("bookId", "checkpointIdentity");
CREATE INDEX "accounting_replacement_recovery_proofs_bookId_proven_recordedAt_idx" ON "accounting_replacement_recovery_proofs"("bookId", "proven", "recordedAt");
CREATE INDEX "accounting_replacement_cutover_runs_bookId_status_idx" ON "accounting_replacement_cutover_runs"("bookId", "status");
CREATE UNIQUE INDEX "accounting_replacement_one_authority_transfer_per_book" ON "accounting_replacement_cutover_runs"("bookId") WHERE "authorityTransferredAt" IS NOT NULL;
CREATE UNIQUE INDEX "accounting_replacement_audit_entries_sequence_key" ON "accounting_replacement_audit_entries"("sequence");
CREATE UNIQUE INDEX "accounting_replacement_audit_entries_entryHash_key" ON "accounting_replacement_audit_entries"("entryHash");
CREATE INDEX "accounting_replacement_audit_entries_createdAt_idx" ON "accounting_replacement_audit_entries"("createdAt");

ALTER TABLE "accounting_replacement_migration_runs" ADD CONSTRAINT "accounting_replacement_migration_runs_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_replacement_migration_runs" ADD CONSTRAINT "accounting_replacement_migration_runs_predecessorRunId_fkey" FOREIGN KEY ("predecessorRunId") REFERENCES "accounting_replacement_migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_replacement_migration_records" ADD CONSTRAINT "accounting_replacement_migration_records_runId_fkey" FOREIGN KEY ("runId") REFERENCES "accounting_replacement_migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_legacy_archive_records" ADD CONSTRAINT "accounting_legacy_archive_records_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_legacy_archive_records" ADD CONSTRAINT "accounting_legacy_archive_records_migrationRunId_fkey" FOREIGN KEY ("migrationRunId") REFERENCES "accounting_replacement_migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_replacement_parallel_runs" ADD CONSTRAINT "accounting_replacement_parallel_runs_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_replacement_recovery_proofs" ADD CONSTRAINT "accounting_replacement_recovery_proofs_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_replacement_cutover_runs" ADD CONSTRAINT "accounting_replacement_cutover_runs_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_accounting_replacement_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Accounting replacement evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounting_replacement_records_immutable BEFORE UPDATE OR DELETE ON "accounting_replacement_migration_records" FOR EACH ROW EXECUTE FUNCTION prevent_accounting_replacement_evidence_mutation();
CREATE TRIGGER accounting_legacy_archive_immutable BEFORE UPDATE OR DELETE ON "accounting_legacy_archive_records" FOR EACH ROW EXECUTE FUNCTION prevent_accounting_replacement_evidence_mutation();
CREATE TRIGGER accounting_replacement_parallel_immutable BEFORE UPDATE OR DELETE ON "accounting_replacement_parallel_runs" FOR EACH ROW EXECUTE FUNCTION prevent_accounting_replacement_evidence_mutation();
CREATE TRIGGER accounting_replacement_recovery_immutable BEFORE UPDATE OR DELETE ON "accounting_replacement_recovery_proofs" FOR EACH ROW EXECUTE FUNCTION prevent_accounting_replacement_evidence_mutation();
CREATE TRIGGER accounting_replacement_audit_immutable BEFORE UPDATE OR DELETE ON "accounting_replacement_audit_entries" FOR EACH ROW EXECUTE FUNCTION prevent_accounting_replacement_evidence_mutation();

CREATE OR REPLACE FUNCTION preserve_accounting_authority_transfer() RETURNS trigger AS $$
BEGIN
  IF OLD."authorityTransferredAt" IS NOT NULL AND (
    NEW."authorityTransferredAt" IS DISTINCT FROM OLD."authorityTransferredAt"
    OR NEW."authorityTransferReason" IS DISTINCT FROM OLD."authorityTransferReason"
    OR NEW."sepidarReadOnly" IS DISTINCT FROM OLD."sepidarReadOnly"
    OR NEW."sabalanAuthoritative" IS DISTINCT FROM OLD."sabalanAuthoritative"
  ) THEN
    RAISE EXCEPTION 'Accounting authority transfer is immutable';
  END IF;
  IF OLD."firstAuthoritativeVoucherId" IS NOT NULL AND (
    NEW."firstAuthoritativeVoucherId" IS DISTINCT FROM OLD."firstAuthoritativeVoucherId"
    OR NEW."firstAuthoritativePostingAt" IS DISTINCT FROM OLD."firstAuthoritativePostingAt"
  ) THEN
    RAISE EXCEPTION 'First authoritative posting is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounting_authority_transfer_immutable BEFORE UPDATE ON "accounting_replacement_cutover_runs" FOR EACH ROW EXECUTE FUNCTION preserve_accounting_authority_transfer();

CREATE OR REPLACE FUNCTION enforce_accounting_cutover_posting_boundary() RETURNS trigger AS $$
DECLARE
  active_cutover "accounting_replacement_cutover_runs"%ROWTYPE;
BEGIN
  IF NEW."status" = 'POSTED' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'POSTED') THEN
    SELECT * INTO active_cutover FROM "accounting_replacement_cutover_runs"
      WHERE "bookId" = NEW."bookId" AND "authorityTransferredAt" IS NOT NULL
      LIMIT 1 FOR UPDATE;
    IF FOUND AND active_cutover."status" = 'PAUSED_FIX_FORWARD' THEN
      RAISE EXCEPTION 'Accounting authoritative posting is paused for fix-forward recovery';
    END IF;
    IF FOUND AND active_cutover."firstAuthoritativeVoucherId" IS NULL THEN
      UPDATE "accounting_replacement_cutover_runs"
        SET "firstAuthoritativeVoucherId" = NEW."id", "firstAuthoritativePostingAt" = COALESCE(NEW."postedAt", CURRENT_TIMESTAMP), "rollbackAllowed" = false
        WHERE "id" = active_cutover."id";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounting_cutover_posting_boundary
AFTER INSERT OR UPDATE OF "status" ON "accounting_ledger_vouchers"
FOR EACH ROW EXECUTE FUNCTION enforce_accounting_cutover_posting_boundary();
