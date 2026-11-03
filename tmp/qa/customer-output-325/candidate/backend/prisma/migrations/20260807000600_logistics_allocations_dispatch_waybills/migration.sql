CREATE TYPE "LogisticsAllocationRevisionStatus" AS ENUM ('ACTIVE', 'REJECTED', 'RETURNED', 'WITHDRAWN', 'SUPERSEDED');
CREATE TYPE "AccountingDispatchCandidateStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'RETURNED', 'WITHDRAWN');
CREATE TYPE "AccountingDispatchWorkItemStatus" AS ENUM ('OPEN', 'COMPLETED');
CREATE TYPE "AccountingDispatchWaybillStatus" AS ENUM ('ISSUED', 'VOIDED');

CREATE SEQUENCE "accounting_dispatch_waybill_number_seq" START 1000000001;

CREATE TABLE "logistics_allocation_batches" (
  "id" TEXT NOT NULL, "loadingId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finalizedBy" TEXT NOT NULL,
  CONSTRAINT "logistics_allocation_batches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "logistics_allocation_batches_loadingId_idempotencyKey_key" ON "logistics_allocation_batches"("loadingId", "idempotencyKey");
CREATE INDEX "logistics_allocation_batches_loadingId_finalizedAt_idx" ON "logistics_allocation_batches"("loadingId", "finalizedAt");

CREATE TABLE "logistics_allocation_drafts" (
  "id" TEXT NOT NULL, "loadingId" TEXT NOT NULL, "queueTurnId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "logistics_allocation_drafts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "logistics_allocation_drafts_queueTurnId_key" ON "logistics_allocation_drafts"("queueTurnId");
CREATE UNIQUE INDEX "logistics_allocation_drafts_loadingId_queueTurnId_key" ON "logistics_allocation_drafts"("loadingId", "queueTurnId");
CREATE INDEX "logistics_allocation_drafts_loadingId_idx" ON "logistics_allocation_drafts"("loadingId");

CREATE TABLE "logistics_allocation_draft_lines" (
  "id" TEXT NOT NULL, "draftId" TEXT NOT NULL, "sourceContractId" TEXT NOT NULL,
  "sourceContractItemId" TEXT NOT NULL, "productRowId" TEXT NOT NULL, "productId" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL, "unit" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "logistics_allocation_draft_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "logistics_allocation_draft_lines_draftId_idx" ON "logistics_allocation_draft_lines"("draftId");
CREATE INDEX "logistics_allocation_draft_lines_sourceContractItemId_idx" ON "logistics_allocation_draft_lines"("sourceContractItemId");

CREATE TABLE "logistics_allocation_revisions" (
  "id" TEXT NOT NULL, "batchId" TEXT NOT NULL, "loadingId" TEXT NOT NULL, "queueTurnId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL, "status" "LogisticsAllocationRevisionStatus" NOT NULL DEFAULT 'ACTIVE',
  "snapshot" JSONB NOT NULL, "integrityHash" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finalizedBy" TEXT NOT NULL,
  "disposedAt" TIMESTAMP(3), "disposedBy" TEXT, "dispositionReason" TEXT,
  CONSTRAINT "logistics_allocation_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "logistics_allocation_revisions_integrityHash_key" ON "logistics_allocation_revisions"("integrityHash");
CREATE UNIQUE INDEX "logistics_allocation_revisions_loadingId_queueTurnId_revisionNumber_key" ON "logistics_allocation_revisions"("loadingId", "queueTurnId", "revisionNumber");
CREATE INDEX "logistics_allocation_revisions_loadingId_finalizedAt_idx" ON "logistics_allocation_revisions"("loadingId", "finalizedAt");
CREATE INDEX "logistics_allocation_revisions_queueTurnId_idx" ON "logistics_allocation_revisions"("queueTurnId");

CREATE TABLE "logistics_allocation_revision_lines" (
  "id" TEXT NOT NULL, "revisionId" TEXT NOT NULL, "sourceContractId" TEXT NOT NULL,
  "sourceContractItemId" TEXT NOT NULL, "productRowId" TEXT NOT NULL, "productId" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL, "unit" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
  "integrityHash" TEXT NOT NULL,
  CONSTRAINT "logistics_allocation_revision_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "logistics_allocation_revision_lines_integrityHash_key" ON "logistics_allocation_revision_lines"("integrityHash");
CREATE INDEX "logistics_allocation_revision_lines_revisionId_idx" ON "logistics_allocation_revision_lines"("revisionId");
CREATE INDEX "logistics_allocation_revision_lines_sourceContractItemId_idx" ON "logistics_allocation_revision_lines"("sourceContractItemId");

CREATE TABLE "accounting_dispatch_candidates" (
  "id" TEXT NOT NULL, "allocationRevisionId" TEXT NOT NULL,
  "status" "AccountingDispatchCandidateStatus" NOT NULL DEFAULT 'PENDING', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispositionAt" TIMESTAMP(3), "dispositionBy" TEXT, "dispositionReason" TEXT,
  CONSTRAINT "accounting_dispatch_candidates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_dispatch_candidates_allocationRevisionId_key" ON "accounting_dispatch_candidates"("allocationRevisionId");
CREATE INDEX "accounting_dispatch_candidates_status_createdAt_idx" ON "accounting_dispatch_candidates"("status", "createdAt");

CREATE TABLE "accounting_dispatch_work_items" (
  "id" TEXT NOT NULL, "candidateId" TEXT NOT NULL,
  "status" "AccountingDispatchWorkItemStatus" NOT NULL DEFAULT 'OPEN', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3), CONSTRAINT "accounting_dispatch_work_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_dispatch_work_items_candidateId_key" ON "accounting_dispatch_work_items"("candidateId");
CREATE INDEX "accounting_dispatch_work_items_status_createdAt_idx" ON "accounting_dispatch_work_items"("status", "createdAt");

CREATE TABLE "accounting_dispatch_waybills" (
  "id" TEXT NOT NULL, "number" BIGINT NOT NULL DEFAULT nextval('accounting_dispatch_waybill_number_seq'),
  "candidateId" TEXT NOT NULL, "status" "AccountingDispatchWaybillStatus" NOT NULL DEFAULT 'ISSUED',
  "snapshot" JSONB NOT NULL, "integrityHash" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "issuedBy" TEXT NOT NULL,
  "voidedAt" TIMESTAMP(3), "voidedBy" TEXT, "voidReason" TEXT, "replacesWaybillId" TEXT,
  CONSTRAINT "accounting_dispatch_waybills_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_dispatch_waybills_number_key" ON "accounting_dispatch_waybills"("number");
CREATE UNIQUE INDEX "accounting_dispatch_waybills_integrityHash_key" ON "accounting_dispatch_waybills"("integrityHash");
CREATE UNIQUE INDEX "accounting_dispatch_waybills_replacesWaybillId_key" ON "accounting_dispatch_waybills"("replacesWaybillId");
CREATE UNIQUE INDEX "accounting_dispatch_waybills_one_active_per_candidate" ON "accounting_dispatch_waybills"("candidateId") WHERE "status" = 'ISSUED';
CREATE INDEX "accounting_dispatch_waybills_candidateId_issuedAt_idx" ON "accounting_dispatch_waybills"("candidateId", "issuedAt");

CREATE TABLE "accounting_dispatch_commands" (
  "id" TEXT NOT NULL, "candidateId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL, "result" JSONB NOT NULL, "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_dispatch_commands_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accounting_dispatch_commands_candidateId_idempotencyKey_key" ON "accounting_dispatch_commands"("candidateId", "idempotencyKey");

CREATE TABLE "dispatch_lifecycle_audits" (
  "id" TEXT NOT NULL, "aggregateType" TEXT NOT NULL, "aggregateId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL, "payload" JSONB NOT NULL, "actorId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "previousHash" TEXT, "eventHash" TEXT NOT NULL,
  CONSTRAINT "dispatch_lifecycle_audits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dispatch_lifecycle_audits_eventHash_key" ON "dispatch_lifecycle_audits"("eventHash");
CREATE INDEX "dispatch_lifecycle_audits_aggregateType_aggregateId_recordedAt_idx" ON "dispatch_lifecycle_audits"("aggregateType", "aggregateId", "recordedAt");

ALTER TABLE "logistics_allocation_batches" ADD CONSTRAINT "logistics_allocation_batches_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "logistics_loadings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "logistics_allocation_drafts" ADD CONSTRAINT "logistics_allocation_drafts_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "logistics_loadings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_allocation_drafts" ADD CONSTRAINT "logistics_allocation_drafts_queueTurnId_fkey" FOREIGN KEY ("queueTurnId") REFERENCES "guard_driver_queue_turns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "logistics_allocation_draft_lines" ADD CONSTRAINT "logistics_allocation_draft_lines_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "logistics_allocation_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "logistics_allocation_revisions" ADD CONSTRAINT "logistics_allocation_revisions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "logistics_allocation_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "logistics_allocation_revisions" ADD CONSTRAINT "logistics_allocation_revisions_loadingId_fkey" FOREIGN KEY ("loadingId") REFERENCES "logistics_loadings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "logistics_allocation_revisions" ADD CONSTRAINT "logistics_allocation_revisions_queueTurnId_fkey" FOREIGN KEY ("queueTurnId") REFERENCES "guard_driver_queue_turns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "logistics_allocation_revision_lines" ADD CONSTRAINT "logistics_allocation_revision_lines_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "logistics_allocation_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_dispatch_candidates" ADD CONSTRAINT "accounting_dispatch_candidates_allocationRevisionId_fkey" FOREIGN KEY ("allocationRevisionId") REFERENCES "logistics_allocation_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_dispatch_work_items" ADD CONSTRAINT "accounting_dispatch_work_items_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "accounting_dispatch_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_dispatch_waybills" ADD CONSTRAINT "accounting_dispatch_waybills_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "accounting_dispatch_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_dispatch_waybills" ADD CONSTRAINT "accounting_dispatch_waybills_replacesWaybillId_fkey" FOREIGN KEY ("replacesWaybillId") REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_dispatch_commands" ADD CONSTRAINT "accounting_dispatch_commands_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "accounting_dispatch_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_dispatch_immutable_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'dispatch evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER logistics_allocation_revision_immutable BEFORE UPDATE OR DELETE ON "logistics_allocation_revision_lines" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_immutable_change();
CREATE TRIGGER dispatch_lifecycle_audit_append_only BEFORE UPDATE OR DELETE ON "dispatch_lifecycle_audits" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_immutable_change();

CREATE FUNCTION protect_allocation_revision_snapshot() RETURNS trigger AS $$
BEGIN
  IF NEW."batchId" <> OLD."batchId" OR NEW."loadingId" <> OLD."loadingId" OR NEW."queueTurnId" <> OLD."queueTurnId"
     OR NEW."revisionNumber" <> OLD."revisionNumber" OR NEW."snapshot" <> OLD."snapshot" OR NEW."integrityHash" <> OLD."integrityHash"
     OR NEW."finalizedAt" <> OLD."finalizedAt" OR NEW."finalizedBy" <> OLD."finalizedBy" THEN
    RAISE EXCEPTION 'allocation revision snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER logistics_allocation_revision_snapshot_immutable BEFORE UPDATE ON "logistics_allocation_revisions" FOR EACH ROW EXECUTE FUNCTION protect_allocation_revision_snapshot();
CREATE TRIGGER logistics_allocation_revision_no_delete BEFORE DELETE ON "logistics_allocation_revisions" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_immutable_change();

CREATE FUNCTION protect_waybill_evidence() RETURNS trigger AS $$
BEGIN
  IF NEW."number" <> OLD."number" OR NEW."candidateId" <> OLD."candidateId" OR NEW."snapshot" <> OLD."snapshot"
     OR NEW."integrityHash" <> OLD."integrityHash" OR NEW."issuedAt" <> OLD."issuedAt" OR NEW."issuedBy" <> OLD."issuedBy"
     OR NEW."replacesWaybillId" IS DISTINCT FROM OLD."replacesWaybillId" THEN
    RAISE EXCEPTION 'dispatch waybill evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER accounting_dispatch_waybill_evidence_immutable BEFORE UPDATE ON "accounting_dispatch_waybills" FOR EACH ROW EXECUTE FUNCTION protect_waybill_evidence();
CREATE TRIGGER accounting_dispatch_waybill_no_delete BEFORE DELETE ON "accounting_dispatch_waybills" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_immutable_change();
