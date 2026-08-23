ALTER TABLE "personnel"
ADD COLUMN "identityCompletionStatus" TEXT NOT NULL DEFAULT 'COMPLETE';

ALTER TABLE "hr_employment_contract_documents"
ADD COLUMN "withdrawnBy" TEXT,
ADD COLUMN "withdrawnAt" TIMESTAMP(3),
ADD COLUMN "withdrawalReason" TEXT;

CREATE TABLE "hr_candidate_personnel_identity_conflicts" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "potentialCandidateId" TEXT,
    "potentialPersonnelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "claimedIdentityJson" JSONB NOT NULL,
    "matchedIdentityJson" JSONB,
    "mobileMismatch" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "resolutionCode" TEXT,
    "selectedPersonnelId" TEXT,
    "rejectedPersonnelId" TEXT,
    "authoritativeEvidenceIds" JSONB,
    "correctionReason" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hr_candidate_personnel_identity_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hr_candidate_personnel_identity_conflicts_applicationId_status_idx"
ON "hr_candidate_personnel_identity_conflicts"("applicationId", "status");
CREATE INDEX "hr_candidate_personnel_identity_conflicts_candidateId_status_idx"
ON "hr_candidate_personnel_identity_conflicts"("candidateId", "status");
CREATE INDEX "hr_candidate_personnel_identity_conflicts_potentialPersonnelId_status_idx"
ON "hr_candidate_personnel_identity_conflicts"("potentialPersonnelId", "status");

ALTER TABLE "hr_candidate_personnel_identity_conflicts"
ADD CONSTRAINT "hr_candidate_personnel_identity_conflicts_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_candidate_personnel_identity_conflicts"
ADD CONSTRAINT "hr_candidate_personnel_identity_conflicts_candidateId_fkey"
FOREIGN KEY ("candidateId") REFERENCES "hr_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
