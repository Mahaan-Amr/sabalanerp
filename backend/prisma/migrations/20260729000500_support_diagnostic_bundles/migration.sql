CREATE TABLE "support_ticket_diagnostic_bundles" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "generatedById" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEW',
  "markdown" TEXT NOT NULL,
  "json" JSONB NOT NULL,
  "selectedSensitiveAttachmentIds" JSONB NOT NULL,
  "confirmationReason" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_ticket_diagnostic_bundles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_ticket_diagnostic_bundles_ticketId_createdAt_idx"
  ON "support_ticket_diagnostic_bundles"("ticketId", "createdAt");
CREATE INDEX "support_ticket_diagnostic_bundles_generatedById_createdAt_idx"
  ON "support_ticket_diagnostic_bundles"("generatedById", "createdAt");

ALTER TABLE "support_ticket_diagnostic_bundles"
  ADD CONSTRAINT "support_ticket_diagnostic_bundles_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_ticket_diagnostic_bundles"
  ADD CONSTRAINT "support_ticket_diagnostic_bundles_generatedById_fkey"
  FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
