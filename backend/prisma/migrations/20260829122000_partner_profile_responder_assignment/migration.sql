BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "partner_profile_responder_assignments" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "responderId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "eligibilityEvidence" JSONB NOT NULL,
  "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_profile_responder_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_profile_responder_assignment_revision" CHECK ("revision" > 0),
  CONSTRAINT "partner_profile_responder_assignments_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "partner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "partner_profile_responder_assignments_profileId_revision_key"
  ON "partner_profile_responder_assignments"("profileId", "revision");
CREATE INDEX "partner_profile_responder_assignments_responderId_assignedAt_idx"
  ON "partner_profile_responder_assignments"("responderId", "assignedAt");

CREATE TRIGGER partner_append_only BEFORE UPDATE OR DELETE ON partner_profile_responder_assignments
  FOR EACH ROW EXECUTE FUNCTION partner_reject_evidence_mutation();
CREATE TRIGGER partner_no_truncate BEFORE TRUNCATE ON partner_profile_responder_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION partner_reject_evidence_mutation();

COMMIT;
