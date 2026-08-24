ALTER TABLE "hr_formal_assessment_results"
  ADD COLUMN "resultExplanation" TEXT,
  ADD COLUMN "correctionReason" TEXT;

ALTER TABLE "hr_company_evaluation_occurrences"
  ADD COLUMN "legacyWithoutScore" BOOLEAN NOT NULL DEFAULT false;

UPDATE "hr_company_evaluation_occurrences"
SET "legacyWithoutScore" = true
WHERE "status" = 'COMPLETED' AND "resultScore" IS NULL;
