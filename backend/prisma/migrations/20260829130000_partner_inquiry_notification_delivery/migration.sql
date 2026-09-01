CREATE TABLE "partner_inquiry_notification_deliveries" (
  "eventId" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMPTZ(3),
  "handledAt" TIMESTAMPTZ(3),
  "status" TEXT,
  CONSTRAINT "partner_inquiry_notification_deliveries_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX "partner_inquiry_notification_deliveries_handledAt_lastAttemptAt_idx"
  ON "partner_inquiry_notification_deliveries"("handledAt", "lastAttemptAt");

ALTER TABLE "partner_inquiry_notification_deliveries"
  ADD CONSTRAINT "partner_inquiry_notification_deliveries_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "partner_inquiry_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
