CREATE TYPE "DispatchCorrectionStatus" AS ENUM ('DRAFT', 'POSTED');
CREATE TYPE "DispatchOutageStatus" AS ENUM ('VERIFIED', 'ENDED');
CREATE TYPE "ManualOutageExitStatus" AS ENUM ('PENDING_APPROVALS', 'APPROVED', 'REGISTERED', 'SPOILED', 'CONFLICT');

CREATE TABLE "dispatch_corrections" (
  "id" TEXT PRIMARY KEY,
  "waybillId" TEXT NOT NULL REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT,
  "status" "DispatchCorrectionStatus" NOT NULL DEFAULT 'DRAFT',
  "reason" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3),
  "postedBy" TEXT,
  "reversalOfId" TEXT REFERENCES "dispatch_corrections"("id") ON DELETE RESTRICT,
  "integrityHash" TEXT
);
CREATE INDEX "dispatch_corrections_waybillId_createdAt_idx" ON "dispatch_corrections"("waybillId", "createdAt");
CREATE INDEX "dispatch_corrections_status_idx" ON "dispatch_corrections"("status");

CREATE TABLE "dispatch_correction_lines" (
  "id" TEXT PRIMARY KEY,
  "correctionId" TEXT NOT NULL REFERENCES "dispatch_corrections"("id") ON DELETE RESTRICT,
  "contractId" TEXT NOT NULL,
  "contractItemId" TEXT NOT NULL,
  "productRowId" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "returnEvidenceId" TEXT
);
CREATE INDEX "dispatch_correction_lines_correctionId_idx" ON "dispatch_correction_lines"("correctionId");
CREATE INDEX "dispatch_correction_lines_contractItemId_idx" ON "dispatch_correction_lines"("contractItemId");

CREATE TABLE "dispatch_outages" (
  "id" TEXT PRIMARY KEY,
  "status" "DispatchOutageStatus" NOT NULL DEFAULT 'VERIFIED',
  "scope" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "verification" JSONB NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "verifiedBy" TEXT NOT NULL,
  "endedAt" TIMESTAMP(3),
  "endedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "dispatch_outages_status_verifiedAt_idx" ON "dispatch_outages"("status", "verifiedAt");

CREATE TABLE "manual_outage_exits" (
  "id" TEXT PRIMARY KEY,
  "paperNumber" TEXT NOT NULL UNIQUE,
  "outageId" TEXT NOT NULL REFERENCES "dispatch_outages"("id") ON DELETE RESTRICT,
  "waybillId" TEXT NOT NULL UNIQUE REFERENCES "accounting_dispatch_waybills"("id") ON DELETE RESTRICT,
  "queueTurnId" TEXT NOT NULL UNIQUE REFERENCES "guard_driver_queue_turns"("id") ON DELETE RESTRICT,
  "allocationRevisionId" TEXT NOT NULL UNIQUE REFERENCES "logistics_allocation_revisions"("id") ON DELETE RESTRICT,
  "status" "ManualOutageExitStatus" NOT NULL DEFAULT 'PENDING_APPROVALS',
  "actualOccurredAt" TIMESTAMP(3) NOT NULL,
  "paperEvidence" JSONB NOT NULL,
  "accountingApprovedAt" TIMESTAMP(3),
  "accountingApprovedBy" TEXT,
  "guardApprovedAt" TIMESTAMP(3),
  "guardApprovedBy" TEXT,
  "recordedAt" TIMESTAMP(3),
  "recordedBy" TEXT,
  "snapshot" JSONB,
  "integrityHash" TEXT UNIQUE
);
CREATE INDEX "manual_outage_exits_outageId_status_idx" ON "manual_outage_exits"("outageId", "status");

CREATE TABLE "dispatch_evidence_exceptions" (
  "id" TEXT PRIMARY KEY,
  "exceptionType" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'HIGH',
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "detail" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "resolution" TEXT
);
CREATE INDEX "dispatch_evidence_exceptions_status_createdAt_idx" ON "dispatch_evidence_exceptions"("status", "createdAt");
CREATE INDEX "dispatch_evidence_exceptions_aggregateType_aggregateId_idx" ON "dispatch_evidence_exceptions"("aggregateType", "aggregateId");

ALTER TABLE "dispatch_buyer_sms_intents" ALTER COLUMN "physicalExitId" DROP NOT NULL;
ALTER TABLE "dispatch_buyer_sms_intents" ADD COLUMN "manualOutageExitId" TEXT;
ALTER TABLE "dispatch_buyer_sms_intents" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "dispatch_buyer_sms_intents" ADD CONSTRAINT "dispatch_buyer_sms_intents_manualOutageExitId_fkey"
  FOREIGN KEY ("manualOutageExitId") REFERENCES "manual_outage_exits"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "dispatch_buyer_sms_intents_manualOutageExitId_key" ON "dispatch_buyer_sms_intents"("manualOutageExitId");
ALTER TABLE "dispatch_buyer_sms_intents" ADD CONSTRAINT "dispatch_buyer_sms_exactly_one_source"
  CHECK (("physicalExitId" IS NOT NULL)::int + ("manualOutageExitId" IS NOT NULL)::int = 1);

CREATE OR REPLACE FUNCTION prevent_posted_dispatch_correction_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN RAISE EXCEPTION 'Posted dispatch corrections are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "dispatch_corrections_immutable_when_posted" BEFORE UPDATE OR DELETE ON "dispatch_corrections"
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_dispatch_correction_mutation();

CREATE OR REPLACE FUNCTION prevent_posted_dispatch_correction_line_mutation() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "dispatch_corrections" WHERE "id" = COALESCE(OLD."correctionId", NEW."correctionId") AND "status" = 'POSTED')
  THEN RAISE EXCEPTION 'Posted dispatch correction lines are immutable'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "dispatch_correction_lines_immutable_when_posted" BEFORE INSERT OR UPDATE OR DELETE ON "dispatch_correction_lines"
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_dispatch_correction_line_mutation();

CREATE OR REPLACE FUNCTION prevent_registered_manual_outage_exit_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('REGISTERED','SPOILED') THEN RAISE EXCEPTION 'Final manual outage records are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "manual_outage_exits_immutable_when_final" BEFORE UPDATE OR DELETE ON "manual_outage_exits"
  FOR EACH ROW EXECUTE FUNCTION prevent_registered_manual_outage_exit_mutation();
