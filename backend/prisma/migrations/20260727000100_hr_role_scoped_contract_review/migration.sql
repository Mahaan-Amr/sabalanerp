ALTER TABLE "hr_employment_contract_documents"
  ADD COLUMN "submittedBy" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "returnedBy" TEXT,
  ADD COLUMN "returnedAt" TIMESTAMP(3),
  ADD COLUMN "returnReason" TEXT;

CREATE INDEX "hr_employment_contract_documents_applicationId_submittedAt_idx"
  ON "hr_employment_contract_documents"("applicationId", "submittedAt");
