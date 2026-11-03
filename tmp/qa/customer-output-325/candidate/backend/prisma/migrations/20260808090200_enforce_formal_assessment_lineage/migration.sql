CREATE UNIQUE INDEX "hr_formal_assessment_results_id_applicationId_assessmentKind_key"
  ON "hr_formal_assessment_results"("id", "applicationId", "assessmentKind");

ALTER TABLE "hr_formal_assessment_plans"
  DROP CONSTRAINT "hr_formal_assessment_plans_predecessorPlanId_fkey";

ALTER TABLE "hr_formal_assessment_plans"
  ADD CONSTRAINT "hr_formal_assessment_plans_predecessor_application_fkey"
  FOREIGN KEY ("predecessorPlanId", "applicationId")
  REFERENCES "hr_formal_assessment_plans"("id", "applicationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "hr_formal_assessment_results"
  DROP CONSTRAINT "hr_formal_assessment_results_supersedesResultId_fkey";

ALTER TABLE "hr_formal_assessment_results"
  ADD CONSTRAINT "hr_formal_assessment_results_supersedes_lineage_fkey"
  FOREIGN KEY ("supersedesResultId", "applicationId", "assessmentKind")
  REFERENCES "hr_formal_assessment_results"("id", "applicationId", "assessmentKind")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "hr_validate_formal_assessment_plan_selection"() RETURNS trigger AS $$
BEGIN
  IF NEW."selected" AND EXISTS (
    SELECT 1 FROM "hr_formal_assessment_plans"
    WHERE "id" = NEW."planId" AND "explicitlyNoAssessment" = true
  ) THEN
    RAISE EXCEPTION 'an explicit no-assessment plan cannot contain a selected assessment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "hr_formal_assessment_selection_plan_check"
  BEFORE INSERT OR UPDATE ON "hr_formal_assessment_plan_selections"
  FOR EACH ROW EXECUTE FUNCTION "hr_validate_formal_assessment_plan_selection"();

CREATE FUNCTION "hr_validate_explicit_no_assessment_plan"() RETURNS trigger AS $$
BEGIN
  IF NEW."explicitlyNoAssessment" AND EXISTS (
    SELECT 1 FROM "hr_formal_assessment_plan_selections"
    WHERE "planId" = NEW."id" AND "selected" = true
  ) THEN
    RAISE EXCEPTION 'a plan with selected assessments cannot become explicit no-assessment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "hr_formal_assessment_plan_selection_check"
  BEFORE UPDATE OF "explicitlyNoAssessment" ON "hr_formal_assessment_plans"
  FOR EACH ROW EXECUTE FUNCTION "hr_validate_explicit_no_assessment_plan"();
