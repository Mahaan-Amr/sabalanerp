ALTER TABLE "hr_formal_assessment_plans"
ADD COLUMN "executionMethod" "HrAssessmentExecutionMethod";

UPDATE "hr_formal_assessment_plans" AS plan
SET "executionMethod" = uniform_methods."executionMethod"
FROM (
  SELECT selection."planId", MIN(selection."executionMethod"::text)::"HrAssessmentExecutionMethod" AS "executionMethod"
  FROM "hr_formal_assessment_plan_selections" AS selection
  WHERE selection."selected" = true AND selection."executionMethod" IS NOT NULL
  GROUP BY selection."planId"
  HAVING COUNT(DISTINCT selection."executionMethod") = 1
) AS uniform_methods
WHERE plan."id" = uniform_methods."planId";

ALTER TABLE "hr_application_decisions"
ADD COLUMN "evidenceJson" JSONB,
ADD COLUMN "criteriaTemplateVersion" INTEGER;

CREATE TABLE "hr_initial_interview_drafts" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "criteriaTemplateVersion" INTEGER NOT NULL DEFAULT 1,
  "dataJson" JSONB NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hr_initial_interview_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_initial_interview_drafts_applicationId_key"
ON "hr_initial_interview_drafts"("applicationId");

ALTER TABLE "hr_initial_interview_drafts"
ADD CONSTRAINT "hr_initial_interview_drafts_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "hr_job_applications"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hr_initial_interview_drafts"
ADD CONSTRAINT "hr_initial_interview_drafts_version_check" CHECK ("version" > 0);

ALTER TABLE "hr_initial_interview_drafts"
ADD CONSTRAINT "hr_initial_interview_drafts_template_version_check" CHECK ("criteriaTemplateVersion" > 0);
