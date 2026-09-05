INSERT INTO "hr_feature_catalogs" ("id", "code", "workspaceCode", "version", "displayName", "isActive", "createdAt", "updatedAt")
SELECT 'hr-feature-view-assigned-performance-consequence', 'VIEW_ASSIGNED_PERFORMANCE_CONSEQUENCE_HANDOFF', 'HUMAN_RESOURCES', 1,
  'مشاهده ارجاع پیامد عملکرد اختصاص‌یافته', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "hr_workspace_catalogs" WHERE "code" = 'HUMAN_RESOURCES')
ON CONFLICT ("code") DO UPDATE SET "displayName" = EXCLUDED."displayName", "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "hr_responsibility_type_catalogs" ("id", "code", "version", "displayName", "isActive", "createdAt", "updatedAt") VALUES
  ('perf-legal-comp-review', 'PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL_COMPENSATION_REVIEW', 1, 'کنترل حقوقی بازبینی جبران خدمت', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-legal-bonus-review', 'PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL_DISCRETIONARY_BONUS_REVIEW', 1, 'کنترل حقوقی بازبینی پاداش اختیاری', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-legal-improvement', 'PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL_PERFORMANCE_IMPROVEMENT_REVIEW', 1, 'کنترل حقوقی برنامه بهبود عملکرد', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-legal-demotion', 'PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL_DEMOTION_REVIEW', 1, 'کنترل حقوقی بررسی تنزل', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "hr_compensation_agreements"
  ADD CONSTRAINT "hr_compensation_agreements_status_check" CHECK ("status" IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'RETIRED', 'CANCELLED')),
  ADD CONSTRAINT "hr_compensation_agreements_legal_check" CHECK ("legalControlStatus" IN ('PENDING', 'APPROVED', 'REJECTED')),
  ADD CONSTRAINT "hr_compensation_agreements_approval_check" CHECK (
    "status" NOT IN ('SCHEDULED', 'ACTIVE', 'RETIRED') OR (
      "legalControlStatus" = 'APPROVED' AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND length("contentHash") = 64
    )
  );

CREATE OR REPLACE FUNCTION hr_guard_compensation_agreement()
RETURNS trigger AS $$
DECLARE old_state TEXT; new_state TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'compensation agreement evidence is immutable'; END IF;
  new_state := NEW."status";
  IF TG_OP = 'INSERT' THEN
    IF new_state <> 'DRAFT' THEN RAISE EXCEPTION 'compensation agreements must begin as drafts'; END IF;
    RETURN NEW;
  END IF;
  old_state := OLD."status";
  IF old_state <> new_state AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('SCHEDULED', 'CANCELLED')) OR
    (old_state = 'SCHEDULED' AND new_state = 'ACTIVE') OR
    (old_state = 'ACTIVE' AND new_state = 'RETIRED')
  ) THEN RAISE EXCEPTION 'invalid compensation agreement lifecycle transition'; END IF;
  IF old_state <> 'DRAFT' AND (
    (to_jsonb(OLD) - 'status' - 'effectiveTo') IS DISTINCT FROM (to_jsonb(NEW) - 'status' - 'effectiveTo')
    OR (old_state = 'ACTIVE' AND new_state = 'RETIRED' AND (NEW."effectiveTo" IS NULL OR NEW."effectiveTo" <= NEW."effectiveFrom"))
  ) THEN RAISE EXCEPTION 'published compensation agreement is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER "hr_compensation_agreement_guard" ON "hr_compensation_agreements";
CREATE TRIGGER "hr_compensation_agreement_guard" BEFORE INSERT OR UPDATE OR DELETE ON "hr_compensation_agreements" FOR EACH ROW EXECUTE FUNCTION hr_guard_compensation_agreement();

UPDATE "performance_consequence_policy_versions" SET "lifecycle" = 'RETIRED', "retiredAt" = CURRENT_TIMESTAMP WHERE "lifecycle" = 'ACTIVE';
WITH source AS (
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'rules', jsonb_object_agg(rule.key, rule.value || CASE rule.key
      WHEN 'COMPENSATION_REVIEW' THEN jsonb_build_object('legalControlResponsibilityTypeCode', 'PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL_COMPENSATION_REVIEW')
      WHEN 'DISCRETIONARY_BONUS_REVIEW' THEN jsonb_build_object('legalControlResponsibilityTypeCode', 'PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL_DISCRETIONARY_BONUS_REVIEW')
      WHEN 'PERFORMANCE_IMPROVEMENT_REVIEW' THEN jsonb_build_object('legalControlResponsibilityTypeCode', 'PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL_PERFORMANCE_IMPROVEMENT_REVIEW')
      WHEN 'DEMOTION_REVIEW' THEN jsonb_build_object('legalControlResponsibilityTypeCode', 'PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL_DEMOTION_REVIEW')
      ELSE '{}'::jsonb END)
  ) AS content
  FROM "performance_consequence_policy_versions" policy,
       LATERAL jsonb_each(policy."content"->'rules') rule
  WHERE policy."id" = 'performance-consequence-policy-v2'
)
INSERT INTO "performance_consequence_policy_versions" ("id", "version", "content", "contentHash")
SELECT 'performance-consequence-policy-v3', 3, content, encode(digest(content::text, 'sha256'), 'hex') FROM source;
UPDATE "performance_consequence_policy_versions" SET "lifecycle" = 'SCHEDULED', "effectiveFrom" = CURRENT_TIMESTAMP, "publicationReason" = 'تفکیک کنترل حقوقی و اختیار مشاهده مقصد', "publishedAt" = CURRENT_TIMESTAMP WHERE "id" = 'performance-consequence-policy-v3';
UPDATE "performance_consequence_policy_versions" SET "lifecycle" = 'ACTIVE' WHERE "id" = 'performance-consequence-policy-v3';
