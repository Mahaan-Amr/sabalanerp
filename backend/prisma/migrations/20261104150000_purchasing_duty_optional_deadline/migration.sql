-- An inquiry has no promised deadline unless one was actually agreed.
ALTER TABLE "hr_duties" DROP CONSTRAINT "duty_deadline_required_for_other_sources";
ALTER TABLE "hr_duties" ADD CONSTRAINT "duty_deadline_required_for_other_sources"
  CHECK ("dueAt" IS NOT NULL OR "sourceType" IN ('CONTRACT_DISPATCH', 'PURCHASING_INQUIRY'));
