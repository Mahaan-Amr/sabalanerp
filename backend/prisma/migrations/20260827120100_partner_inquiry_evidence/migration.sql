BEGIN;
SET LOCAL lock_timeout = '5s';
-- CreateEnum
CREATE TYPE "PartnerInquiryOutcome" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "partner_command_outcomes" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "targetScope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "outcome" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_command_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_inquiries" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_inquiry_assignments" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "responderId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "eligibilityEvidence" JSONB NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_inquiry_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_inquiry_rows" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "predecessorId" TEXT,
    "outcome" "PartnerInquiryOutcome" NOT NULL DEFAULT 'PENDING',
    "configurationHash" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_inquiry_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_inquiry_approvals" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "authorizationEvidenceId" TEXT NOT NULL,
    "wholesaleUnitPrice" DECIMAL(30,10) NOT NULL,
    "currency" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "note" TEXT,
    "supersessionReason" TEXT,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + '48:00:00'::interval),

    CONSTRAINT "partner_inquiry_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_inquiry_events" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "rowId" TEXT,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "evidence" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_inquiry_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_command_outcomes_actorId_operation_targetScope_key_key" ON "partner_command_outcomes"("actorId", "operation", "targetScope", "key");

-- CreateIndex
CREATE INDEX "partner_inquiries_profileId_createdAt_idx" ON "partner_inquiries"("profileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "partner_inquiry_assignments_inquiryId_revision_key" ON "partner_inquiry_assignments"("inquiryId", "revision");

-- CreateIndex
CREATE INDEX "partner_inquiry_rows_inquiryId_outcome_idx" ON "partner_inquiry_rows"("inquiryId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "partner_inquiry_approvals_rowId_key" ON "partner_inquiry_approvals"("rowId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_inquiry_approvals_commandId_key" ON "partner_inquiry_approvals"("commandId");

-- CreateIndex
CREATE INDEX "partner_inquiry_events_commandId_idx" ON "partner_inquiry_events"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_inquiry_events_inquiryId_revision_key" ON "partner_inquiry_events"("inquiryId", "revision");

-- AddForeignKey
ALTER TABLE "partner_inquiries" ADD CONSTRAINT "partner_inquiries_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "partner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_inquiry_assignments" ADD CONSTRAINT "partner_inquiry_assignments_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "partner_inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_inquiry_rows" ADD CONSTRAINT "partner_inquiry_rows_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "partner_inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_inquiry_rows" ADD CONSTRAINT "partner_inquiry_rows_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "partner_inquiry_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_inquiry_approvals" ADD CONSTRAINT "partner_inquiry_approvals_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "partner_inquiry_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_inquiry_approvals" ADD CONSTRAINT "partner_inquiry_approvals_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "partner_inquiry_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_inquiry_events" ADD CONSTRAINT "partner_inquiry_events_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "partner_inquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_inquiry_events" ADD CONSTRAINT "partner_inquiry_events_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "partner_inquiry_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX partner_one_open_successor ON partner_inquiry_rows ("predecessorId")
  WHERE outcome IN ('PENDING','APPROVED');
ALTER TABLE partner_inquiry_rows ADD CONSTRAINT partner_row_definition CHECK
  (version > 0 AND revision > 0 AND "predecessorId" IS DISTINCT FROM id AND "configurationHash" ~ '^sha256-v1:[a-f0-9]{64}$');
ALTER TABLE partner_command_outcomes ADD CONSTRAINT partner_command_hash CHECK ("payloadHash" ~ '^sha256-v1:[a-f0-9]{64}$');
ALTER TABLE partner_inquiry_approvals ADD CONSTRAINT partner_approval_window CHECK
  ("expiresAt" = "approvedAt" + interval '48 hours' AND "wholesaleUnitPrice" >= 0 AND currency IN ('IRR','IRT')
   AND "evidenceHash" ~ '^sha256-v1:[a-f0-9]{64}$');

CREATE FUNCTION partner_stamp_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM partner_inquiry_rows r JOIN partner_inquiry_assignments a
    ON a."inquiryId" = r."inquiryId" WHERE r.id = NEW."rowId" AND a.id = NEW."assignmentId"
    AND a."responderId" = NEW."actorId") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Approval assignment must belong to its inquiry and actor';
  END IF;
  NEW."approvedAt" := transaction_timestamp();
  NEW."expiresAt" := NEW."approvedAt" + interval '48 hours';
  RETURN NEW;
END $$;
CREATE TRIGGER partner_approval_clock BEFORE INSERT ON partner_inquiry_approvals
  FOR EACH ROW EXECUTE FUNCTION partner_stamp_approval();

CREATE FUNCTION partner_inquiry_row_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.outcome <> 'PENDING' OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Inquiry decision is immutable or stale';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_row_identity BEFORE UPDATE OR DELETE ON partner_inquiry_rows FOR EACH ROW
  EXECUTE FUNCTION partner_protect_identity('id','inquiryId','version','predecessorId','configurationHash','definition','submittedAt');
CREATE TRIGGER partner_row_transition BEFORE UPDATE ON partner_inquiry_rows FOR EACH ROW EXECUTE FUNCTION partner_inquiry_row_transition();
CREATE TRIGGER partner_inquiry_identity BEFORE UPDATE OR DELETE ON partner_inquiries FOR EACH ROW
  EXECUTE FUNCTION partner_protect_identity('id','profileId','createdAt');
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['partner_command_outcomes','partner_inquiry_assignments','partner_inquiry_approvals','partner_inquiry_events'] LOOP
    EXECUTE format('CREATE TRIGGER partner_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION partner_reject_evidence_mutation()', name);
    EXECUTE format('CREATE TRIGGER partner_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION partner_reject_evidence_mutation()', name);
  END LOOP;
END $$;
COMMIT;
