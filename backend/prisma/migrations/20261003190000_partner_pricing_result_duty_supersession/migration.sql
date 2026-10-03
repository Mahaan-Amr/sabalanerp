-- Keep exactly the current result duty; preserve older results and prices in history.
BEGIN;
LOCK TABLE hr_duties, hr_duty_assignment_history, hr_duty_audit_versions IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE superseded_partner_result_duties ON COMMIT DROP AS
SELECT duty.* FROM hr_duties duty
JOIN partner_inquiries inquiry ON inquiry.id = duty."sourceId"
JOIN LATERAL (
  SELECT latest.id, latest.revision FROM partner_inquiries latest
  WHERE latest."caseId" = inquiry."caseId"
  ORDER BY latest."caseRevision" DESC NULLS LAST, latest."createdAt" DESC, latest.id DESC LIMIT 1
) current_inquiry ON true
WHERE duty."sourceType" = 'PARTNER_PRICING'
  AND duty."sourceActionCode" = 'PARTNER_PRICE_RESULT' AND duty.status = 'OPEN'
  AND (inquiry.id <> current_inquiry.id OR duty."sourceVersion" <> current_inquiry.revision);
INSERT INTO hr_duty_audit_versions
  (id, "dutyId", version, "eventCode", "actorUserId", "sourceVersion", "envelopeVersion", "policyVersion", "beforeJson", "afterJson", reason, "createdAt")
SELECT 'partner-result-superseded-' || duty.id, duty.id,
  COALESCE((SELECT MAX(audit.version) FROM hr_duty_audit_versions audit WHERE audit."dutyId" = duty.id), 0) + 1,
  'WAIVED', NULL, duty."sourceVersion", duty."envelopeVersion", 1,
  '{"status":"OPEN"}'::jsonb, '{"status":"WAIVED"}'::jsonb,
  'پاسخ استعلام جدید جایگزین وظیفه پاسخ قبلی این پرونده شد', NOW()
FROM superseded_partner_result_duties duty;
UPDATE hr_duty_assignment_history assignment
SET "endedAt" = NOW(), "endReason" = 'WAIVED', "changedByUserId" = NULL
FROM superseded_partner_result_duties duty
WHERE assignment."dutyId" = duty.id AND assignment."endedAt" IS NULL;
UPDATE hr_duties target SET status = 'WAIVED', "updatedAt" = NOW(),
  "respondedAt" = NULL, "respondedByUserId" = NULL, "structuredResultJson" = '{"result":"WAIVED"}'::jsonb
FROM superseded_partner_result_duties duty WHERE target.id = duty.id;
COMMIT;
