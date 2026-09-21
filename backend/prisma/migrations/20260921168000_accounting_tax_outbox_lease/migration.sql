ALTER TABLE "accounting_tax_outbox_messages"
ADD COLUMN "claimedAt" TIMESTAMP(3);

CREATE INDEX "accounting_tax_outbox_messages_status_claimedAt_idx"
ON "accounting_tax_outbox_messages"("status", "claimedAt");
