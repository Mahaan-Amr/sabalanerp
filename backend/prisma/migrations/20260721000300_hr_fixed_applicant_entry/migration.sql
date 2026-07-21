ALTER TABLE "hr_candidate_invitations"
  ADD COLUMN "mobileSnapshot" TEXT;

UPDATE "hr_candidate_invitations" AS invitation
SET "mobileSnapshot" = candidate."mobile",
    "revokedAt" = COALESCE(invitation."revokedAt", CURRENT_TIMESTAMP)
FROM "hr_job_applications" AS application
JOIN "hr_candidates" AS candidate ON candidate."id" = application."candidateId"
WHERE application."id" = invitation."applicationId";

ALTER TABLE "hr_candidate_invitations"
  ALTER COLUMN "mobileSnapshot" SET NOT NULL,
  DROP COLUMN "tokenHash",
  DROP COLUMN "failedAttempts",
  DROP COLUMN "blockedUntil";

CREATE UNIQUE INDEX "hr_candidate_invitations_mobileSnapshot_otpHash_key"
  ON "hr_candidate_invitations"("mobileSnapshot", "otpHash");

CREATE INDEX "hr_candidate_invitations_mobileSnapshot_expiresAt_revokedAt_idx"
  ON "hr_candidate_invitations"("mobileSnapshot", "expiresAt", "revokedAt");

CREATE TABLE "hr_candidate_access_throttles" (
  "id" TEXT NOT NULL,
  "subjectKind" TEXT NOT NULL,
  "subjectHash" TEXT NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blockedUntil" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_candidate_access_throttles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_candidate_access_throttles_subjectKind_subjectHash_key"
  ON "hr_candidate_access_throttles"("subjectKind", "subjectHash");

CREATE INDEX "hr_candidate_access_throttles_blockedUntil_idx"
  ON "hr_candidate_access_throttles"("blockedUntil");

CREATE TABLE "hr_candidate_access_attempts" (
  "id" TEXT NOT NULL,
  "mobileHash" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "invitationId" TEXT,
  "applicationId" TEXT,
  "outcome" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_candidate_access_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hr_candidate_access_attempts_mobileHash_createdAt_idx"
  ON "hr_candidate_access_attempts"("mobileHash", "createdAt");

CREATE INDEX "hr_candidate_access_attempts_ipHash_createdAt_idx"
  ON "hr_candidate_access_attempts"("ipHash", "createdAt");

CREATE INDEX "hr_candidate_access_attempts_applicationId_createdAt_idx"
  ON "hr_candidate_access_attempts"("applicationId", "createdAt");
