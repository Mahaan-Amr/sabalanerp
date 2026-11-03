UPDATE "dispatch_buyer_sms_intents" AS intent
SET "sessionId" = authz."sessionId"
FROM "guard_physical_exits" AS physical_exit
JOIN "dispatch_exit_authorizations" AS authz
  ON authz."id" = physical_exit."authorizationId"
WHERE intent."physicalExitId" = physical_exit."id"
  AND intent."sessionId" IS NULL;

ALTER TABLE "dispatch_buyer_sms_intents"
  ADD CONSTRAINT "dispatch_buyer_sms_intents_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "dispatch_confirmation_sessions"("id") ON DELETE RESTRICT;

CREATE INDEX "dispatch_buyer_sms_intents_sessionId_idx" ON "dispatch_buyer_sms_intents"("sessionId");
