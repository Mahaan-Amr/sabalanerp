-- Formal assessment selections are intentionally limited to the three approved kinds.
CREATE TYPE "HrFormalAssessmentKind" AS ENUM ('DISC', 'EQ', 'BIG_FIVE');

ALTER TABLE "hr_formal_assessment_results"
  DROP CONSTRAINT "hr_formal_assessment_results_planSelectionId_fkey";

ALTER TABLE "hr_formal_assessment_plan_selections"
  ALTER COLUMN "assessmentKind" TYPE "HrFormalAssessmentKind"
  USING ("assessmentKind"::text::"HrFormalAssessmentKind");

ALTER TABLE "hr_formal_assessment_results"
  ADD COLUMN "planId" TEXT NOT NULL,
  ALTER COLUMN "assessmentKind" TYPE "HrFormalAssessmentKind"
  USING ("assessmentKind"::text::"HrFormalAssessmentKind");

CREATE UNIQUE INDEX "hr_formal_assessment_plans_id_applicationId_key"
  ON "hr_formal_assessment_plans"("id", "applicationId");

CREATE UNIQUE INDEX "hr_formal_assessment_plan_selections_id_planId_assessmentKind_key"
  ON "hr_formal_assessment_plan_selections"("id", "planId", "assessmentKind");

ALTER TABLE "hr_formal_assessment_results"
  ADD CONSTRAINT "hr_formal_assessment_results_planId_applicationId_fkey"
  FOREIGN KEY ("planId", "applicationId")
  REFERENCES "hr_formal_assessment_plans"("id", "applicationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hr_formal_assessment_results"
  ADD CONSTRAINT "hr_formal_assessment_results_selection_fkey"
  FOREIGN KEY ("planSelectionId", "planId", "assessmentKind")
  REFERENCES "hr_formal_assessment_plan_selections"("id", "planId", "assessmentKind")
  ON DELETE RESTRICT ON UPDATE CASCADE;
