ALTER TABLE "support_tickets"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "previousTicketId" TEXT;

CREATE UNIQUE INDEX "support_tickets_idempotencyKey_key"
ON "support_tickets"("idempotencyKey");

CREATE UNIQUE INDEX "support_ticket_attachments_storageName_key"
ON "support_ticket_attachments"("storageName");

CREATE INDEX "support_tickets_previousTicketId_idx"
ON "support_tickets"("previousTicketId");

ALTER TABLE "support_tickets"
ADD CONSTRAINT "support_tickets_previousTicketId_fkey"
FOREIGN KEY ("previousTicketId") REFERENCES "support_tickets"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
