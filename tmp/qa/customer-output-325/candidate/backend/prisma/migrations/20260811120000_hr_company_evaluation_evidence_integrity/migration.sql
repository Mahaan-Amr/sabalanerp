ALTER TABLE "hr_company_evaluation_occurrences"
  ADD COLUMN "resultMimeType" TEXT,
  ADD COLUMN "resultSize" INTEGER,
  ADD COLUMN "resultSha256" TEXT,
  ADD COLUMN "resultMalwareScanStatus" TEXT;
