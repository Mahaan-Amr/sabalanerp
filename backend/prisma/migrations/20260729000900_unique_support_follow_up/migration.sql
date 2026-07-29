DROP INDEX IF EXISTS "support_tickets_previousTicketId_idx";

CREATE UNIQUE INDEX "support_tickets_previousTicketId_key"
ON "support_tickets"("previousTicketId");
