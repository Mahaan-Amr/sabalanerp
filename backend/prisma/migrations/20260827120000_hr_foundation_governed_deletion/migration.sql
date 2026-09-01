ALTER TABLE "hr_organizational_units" ADD COLUMN "codeOccurrence" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "hr_jobs" ADD COLUMN "codeOccurrence" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "hr_positions" ADD COLUMN "codeOccurrence" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "hr_foundation_code_occurrences" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "occurrence" INTEGER NOT NULL,
  "entityId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedByUserId" TEXT NOT NULL,
  "releasedAt" TIMESTAMP(3),
  "releasedByUserId" TEXT,
  "releaseReason" TEXT,
  CONSTRAINT "hr_foundation_code_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_foundation_code_occurrences_entityType_code_occurrence_key"
  ON "hr_foundation_code_occurrences"("entityType", "code", "occurrence");
CREATE INDEX "hr_foundation_code_occurrences_entityType_code_releasedAt_idx"
  ON "hr_foundation_code_occurrences"("entityType", "code", "releasedAt");
CREATE INDEX "hr_foundation_code_occurrences_entityType_entityId_assignedAt_idx"
  ON "hr_foundation_code_occurrences"("entityType", "entityId", "assignedAt");

INSERT INTO "hr_foundation_code_occurrences" ("id", "entityType", "code", "occurrence", "entityId", "assignedAt", "assignedByUserId")
SELECT 'legacy-unit-' || "id", 'ORGANIZATIONAL_UNIT', "code", 1, "id", "createdAt", "createdBy" FROM "hr_organizational_units";
INSERT INTO "hr_foundation_code_occurrences" ("id", "entityType", "code", "occurrence", "entityId", "assignedAt", "assignedByUserId")
SELECT 'legacy-job-' || "id", 'JOB', "code", 1, "id", "createdAt", "createdBy" FROM "hr_jobs";
INSERT INTO "hr_foundation_code_occurrences" ("id", "entityType", "code", "occurrence", "entityId", "assignedAt", "assignedByUserId")
SELECT 'legacy-position-' || "id", 'POSITION', "code", 1, "id", "createdAt", "createdBy" FROM "hr_positions";

CREATE TABLE "hr_foundation_deletion_receipts" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "codeOccurrence" INTEGER NOT NULL,
  "deletedByUserId" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" TEXT NOT NULL,
  "dependencyResolutionJson" JSONB NOT NULL,
  CONSTRAINT "hr_foundation_deletion_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_foundation_deletion_receipts_entityType_entityId_key"
  ON "hr_foundation_deletion_receipts"("entityType", "entityId");
CREATE INDEX "hr_foundation_deletion_receipts_entityType_code_codeOccurrence_idx"
  ON "hr_foundation_deletion_receipts"("entityType", "code", "codeOccurrence");

CREATE TABLE "hr_foundation_historical_snapshots" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "codeOccurrence" INTEGER NOT NULL,
  "displayName" TEXT NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "capturedByUserId" TEXT NOT NULL,
  CONSTRAINT "hr_foundation_historical_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_foundation_historical_snapshots_entityType_entityId_key"
  ON "hr_foundation_historical_snapshots"("entityType", "entityId");
CREATE INDEX "hr_foundation_historical_snapshots_entityType_code_codeOccurrence_idx"
  ON "hr_foundation_historical_snapshots"("entityType", "code", "codeOccurrence");

INSERT INTO "hr_foundation_deletion_receipts" ("id", "entityType", "entityId", "code", "codeOccurrence", "deletedByUserId", "deletedAt", "reason", "dependencyResolutionJson")
SELECT 'legacy-receipt-' || "id", "entityType", "deletedEntityId", "code", 1, "deletedByUserId", "deletedAt", "reason", '{"source":"legacy-reserved-code"}'::jsonb
FROM "hr_foundation_reserved_codes";
INSERT INTO "hr_foundation_code_occurrences" ("id", "entityType", "code", "occurrence", "entityId", "assignedAt", "assignedByUserId", "releasedAt", "releasedByUserId", "releaseReason")
SELECT 'legacy-deleted-' || "id", "entityType", "code", 1, "deletedEntityId", "deletedAt", "deletedByUserId", "deletedAt", "deletedByUserId", "reason"
FROM "hr_foundation_reserved_codes"
ON CONFLICT ("entityType", "code", "occurrence") DO NOTHING;

CREATE TABLE "hr_employment_assignment_withdrawals" (
  "id" TEXT NOT NULL,
  "originalAssignmentId" TEXT NOT NULL,
  "employmentRelationshipId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "assignmentSnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_employment_assignment_withdrawals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_employment_assignment_withdrawals_originalAssignmentId_action_key"
  ON "hr_employment_assignment_withdrawals"("originalAssignmentId", "action");
CREATE INDEX "hr_employment_assignment_withdrawals_employmentRelationshipId_createdAt_idx"
  ON "hr_employment_assignment_withdrawals"("employmentRelationshipId", "createdAt");
ALTER TABLE "hr_employment_assignment_withdrawals" ADD CONSTRAINT "hr_employment_assignment_withdrawals_employmentRelationshipId_fkey"
  FOREIGN KEY ("employmentRelationshipId") REFERENCES "hr_employment_relationships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hr_employment_assignments" DROP CONSTRAINT "hr_employment_assignments_positionId_fkey";
ALTER TABLE "hr_employment_assignments" ALTER COLUMN "positionId" DROP NOT NULL;
ALTER TABLE "hr_employment_assignments" ADD COLUMN "positionSnapshot" JSONB;
ALTER TABLE "hr_employment_assignments" ADD COLUMN "organizationalUnitSnapshot" JSONB;
ALTER TABLE "hr_employment_assignments" ADD CONSTRAINT "hr_employment_assignments_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hr_job_applications" DROP CONSTRAINT "hr_job_applications_positionId_fkey";
ALTER TABLE "hr_job_applications" ALTER COLUMN "positionId" DROP NOT NULL;
ALTER TABLE "hr_job_applications" ADD COLUMN "positionSnapshot" JSONB;
ALTER TABLE "hr_job_applications" ADD CONSTRAINT "hr_job_applications_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hr_recruitment_requests" DROP CONSTRAINT "hr_recruitment_requests_positionId_fkey";
ALTER TABLE "hr_recruitment_requests" ALTER COLUMN "positionId" DROP NOT NULL;
ALTER TABLE "hr_recruitment_requests" ADD COLUMN "positionSnapshot" JSONB;
ALTER TABLE "hr_recruitment_requests" ADD CONSTRAINT "hr_recruitment_requests_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hr_position_capacity_changes" DROP CONSTRAINT "hr_position_capacity_changes_positionId_fkey";
ALTER TABLE "hr_position_capacity_changes" ALTER COLUMN "positionId" DROP NOT NULL;
ALTER TABLE "hr_position_capacity_changes" ADD COLUMN "positionSnapshot" JSONB;
ALTER TABLE "hr_position_capacity_changes" ADD CONSTRAINT "hr_position_capacity_changes_positionId_fkey"
  FOREIGN KEY ("positionId") REFERENCES "hr_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
