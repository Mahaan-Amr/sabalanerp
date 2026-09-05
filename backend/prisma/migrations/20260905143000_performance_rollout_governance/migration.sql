ALTER TABLE "performance_cohort_versions"
  ADD COLUMN "stage" TEXT,
  ADD COLUMN "targetPercent" INTEGER,
  ADD COLUMN "readinessHash" TEXT;

ALTER TABLE "performance_cohort_versions"
  ADD CONSTRAINT "performance_cohort_stage_check" CHECK (
    ("stage" IS NULL AND "targetPercent" IS NULL AND "readinessHash" IS NULL)
    OR ("stage" IN ('PILOT','TEN_PERCENT','TWENTY_FIVE_PERCENT','FIFTY_PERCENT','ALL')
      AND "targetPercent" IN (10,25,50,100)
      AND "readinessHash" ~ '^[a-f0-9]{64}$')
  );

CREATE TABLE "performance_training_evidence" (
  "id" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "curriculumHash" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "recordedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_training_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_training_subject_fkey" FOREIGN KEY ("subjectId") REFERENCES "performance_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_training_actor_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_training_hash_check" CHECK ("curriculumHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "performance_training_window_check" CHECK ("completedAt" <= "validUntil")
);
CREATE INDEX "performance_training_subject_valid_idx" ON "performance_training_evidence"("subjectId", "validUntil");

CREATE TABLE "performance_rollout_decisions" (
  "id" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "authorityHash" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_rollout_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_rollout_decision_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_rollout_decision_shape_check" CHECK (
    "scopeType" IN ('COHORT','SAFETY_PAUSE')
    AND "ownerType" IN ('HUMAN_RESOURCES','SECURITY_PRIVACY','SYSTEM_OWNER')
    AND "action" IN ('APPROVE','VETO','APPROVE_RESUME')
    AND "version" > 0
    AND "reasonCode" ~ '^[A-Z][A-Z0-9_]{2,79}$'
    AND "authorityHash" ~ '^[a-f0-9]{64}$'
    AND "evidenceHash" ~ '^[a-f0-9]{64}$'
  )
);
CREATE UNIQUE INDEX "performance_rollout_decision_scope_owner_version_key"
  ON "performance_rollout_decisions"("scopeType", "scopeId", "ownerType", "version");
CREATE INDEX "performance_rollout_decision_scope_action_idx"
  ON "performance_rollout_decisions"("scopeType", "scopeId", "action", "decidedAt");

INSERT INTO "hr_feature_catalogs" ("id","code","workspaceCode","version","displayName","isActive","createdAt","updatedAt")
SELECT 'hr-feature-' || lower(replace(source."code", '_', '-')), source."code", 'HUMAN_RESOURCES', 1,
  source."displayName", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('RECORD_PERFORMANCE_TRAINING','ثبت شاهد آموزش فعال‌سازی عملکرد'),
  ('APPROVE_PERFORMANCE_COHORT_HR','تصویب منابع انسانی جامعه عملکرد'),
  ('APPROVE_PERFORMANCE_COHORT_SECURITY','تصویب امنیت و حریم خصوصی جامعه عملکرد'),
  ('APPROVE_PERFORMANCE_COHORT_SYSTEM','تصویب مالک سامانه جامعه عملکرد'),
  ('TECHNICALLY_ACTIVATE_PERFORMANCE_COHORT','فعال‌سازی فنی جامعه عملکرد'),
  ('APPROVE_PERFORMANCE_RESUME_HR','تصویب منابع انسانی رفع توقف عملکرد'),
  ('APPROVE_PERFORMANCE_RESUME_SECURITY','تصویب امنیت و حریم خصوصی رفع توقف عملکرد'),
  ('APPROVE_PERFORMANCE_RESUME_SYSTEM','تصویب مالک سامانه رفع توقف عملکرد')
) AS source("code","displayName")
WHERE EXISTS (SELECT 1 FROM "hr_workspace_catalogs" WHERE "code" = 'HUMAN_RESOURCES')
ON CONFLICT ("code") DO UPDATE SET "displayName" = EXCLUDED."displayName", "isActive" = true, "updatedAt" = CURRENT_TIMESTAMP;

CREATE TRIGGER performance_training_evidence_immutable BEFORE UPDATE OR DELETE ON "performance_training_evidence"
  FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_rollout_decisions_immutable BEFORE UPDATE OR DELETE ON "performance_rollout_decisions"
  FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();

CREATE OR REPLACE FUNCTION performance_guard_cohort_governance()
RETURNS trigger AS $$
DECLARE approved_count INTEGER;
BEGIN
  IF NEW."lifecycle" IN ('SCHEDULED','ACTIVE') AND OLD."lifecycle" = 'DRAFT' AND NEW."stage" IS NOT NULL THEN
    SELECT count(DISTINCT "ownerType") INTO approved_count
    FROM "performance_rollout_decisions"
    WHERE "scopeType" = 'COHORT' AND "scopeId" = NEW."id" AND "action" = 'APPROVE';
    IF approved_count <> 3 OR EXISTS (
      SELECT 1 FROM "performance_rollout_decisions" d
      WHERE d."scopeType" = 'COHORT' AND d."scopeId" = NEW."id" AND d."action" = 'VETO'
        AND NOT EXISTS (SELECT 1 FROM "performance_rollout_decisions" later
          WHERE later."scopeType" = d."scopeType" AND later."scopeId" = d."scopeId"
            AND later."ownerType" = d."ownerType" AND later."version" > d."version" AND later."action" = 'APPROVE')
    ) THEN
      RAISE EXCEPTION 'performance cohort requires three current owner approvals';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_cohort_governance_guard BEFORE UPDATE ON "performance_cohort_versions"
  FOR EACH ROW EXECUTE FUNCTION performance_guard_cohort_governance();
