ALTER TABLE "partner_operations_controls"
  DROP CONSTRAINT "partner_operations_controls_cohortId_fkey";
ALTER TABLE "partner_operations_controls"
  ADD CONSTRAINT "partner_operations_controls_cohortId_fkey"
  FOREIGN KEY ("cohortId") REFERENCES "partner_release_cohorts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
