ALTER TABLE "hr_employment_contract_documents"
  ADD COLUMN "submittedBy" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "returnedBy" TEXT,
  ADD COLUMN "returnedAt" TIMESTAMP(3),
  ADD COLUMN "returnReason" TEXT;

UPDATE "hr_employment_contract_documents"
SET
  "submittedBy" = "uploadedBy",
  "submittedAt" = "approvedAt"
WHERE "approvedAt" IS NOT NULL;

CREATE INDEX "hr_employment_contract_documents_applicationId_submittedAt_idx"
  ON "hr_employment_contract_documents"("applicationId", "submittedAt");
