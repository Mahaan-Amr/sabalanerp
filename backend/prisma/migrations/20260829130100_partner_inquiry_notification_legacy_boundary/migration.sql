-- Existing immutable events predate the live delivery composition. They must
-- not emit delayed notifications when the worker is first enabled.
INSERT INTO "partner_inquiry_notification_deliveries"
  ("eventId", "attempts", "lastAttemptAt", "handledAt", "status")
SELECT "id", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'LEGACY'
FROM "partner_inquiry_events"
ON CONFLICT ("eventId") DO NOTHING;
