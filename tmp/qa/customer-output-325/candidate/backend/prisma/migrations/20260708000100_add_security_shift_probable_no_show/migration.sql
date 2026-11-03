ALTER TABLE "security_shift_plan_slots" ADD COLUMN "probableNoShowAt" TIMESTAMP(3);
CREATE INDEX "security_shift_plan_slots_probableNoShowAt_idx" ON "security_shift_plan_slots"("probableNoShowAt");
