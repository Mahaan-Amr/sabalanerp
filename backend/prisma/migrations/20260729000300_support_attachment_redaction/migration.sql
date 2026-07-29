ALTER TABLE "support_ticket_attachments"
  ADD COLUMN "redactedAt" TIMESTAMP(3),
  ADD COLUMN "redactionReason" TEXT,
  ADD COLUMN "redactedById" TEXT;

CREATE INDEX "support_ticket_attachments_redactedAt_idx"
  ON "support_ticket_attachments"("redactedAt");
