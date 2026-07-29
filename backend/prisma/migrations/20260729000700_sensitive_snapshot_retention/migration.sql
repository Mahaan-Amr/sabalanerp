ALTER TABLE "support_tickets"
  ADD COLUMN "sensitiveEvidenceSnapshot" JSONB,
  ADD COLUMN "sensitiveEvidenceDeletedAt" TIMESTAMP(3);

CREATE INDEX "support_tickets_sensitiveEvidenceDeletedAt_idx"
  ON "support_tickets"("sensitiveEvidenceDeletedAt");
