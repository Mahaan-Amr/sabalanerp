CREATE TABLE "performance_consequence_policy_versions" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "lifecycle" "PerformanceArtifactLifecycle" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "content" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  "publicationReason" TEXT,
  "publishedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_consequence_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "performance_consequence_policy_versions_publisher_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_consequence_policy_versions_creator_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "performance_consequence_policy_versions_effective_check" CHECK ("lifecycle" NOT IN ('SCHEDULED', 'ACTIVE') OR "effectiveFrom" IS NOT NULL)
);

CREATE UNIQUE INDEX "performance_consequence_policy_versions_version_key" ON "performance_consequence_policy_versions"("version");
CREATE UNIQUE INDEX "performance_consequence_policy_versions_one_active" ON "performance_consequence_policy_versions"("lifecycle") WHERE "lifecycle" = 'ACTIVE';
CREATE INDEX "performance_consequence_policy_versions_lifecycle_effective_idx" ON "performance_consequence_policy_versions"("lifecycle", "effectiveFrom");

INSERT INTO "performance_consequence_policy_versions" (
  "id", "version", "lifecycle", "effectiveFrom", "content", "contentHash", "publicationReason", "publishedAt"
) VALUES (
  'performance-consequence-policy-v1', 1, 'ACTIVE', CURRENT_TIMESTAMP,
  '{"schemaVersion":1,"rules":{"COMPENSATION_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":true},"DISCRETIONARY_BONUS_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":true},"PROMOTION_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":false},"PERFORMANCE_IMPROVEMENT_REVIEW":{"minimumResults":2,"maximumAgeDays":180,"requireMultiplePeriods":true,"requireCompensationContext":false},"DEMOTION_REVIEW":{"minimumResults":2,"maximumAgeDays":180,"requireMultiplePeriods":true,"requireCompensationContext":false}}}'::jsonb,
  encode(digest('{"schemaVersion":1,"rules":{"COMPENSATION_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":true},"DISCRETIONARY_BONUS_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":true},"PROMOTION_REVIEW":{"minimumResults":1,"maximumAgeDays":365,"requireMultiplePeriods":false,"requireCompensationContext":false},"PERFORMANCE_IMPROVEMENT_REVIEW":{"minimumResults":2,"maximumAgeDays":180,"requireMultiplePeriods":true,"requireCompensationContext":false},"DEMOTION_REVIEW":{"minimumResults":2,"maximumAgeDays":180,"requireMultiplePeriods":true,"requireCompensationContext":false}}}', 'sha256'), 'hex'),
  'سیاست اولیه ارجاع پیامد عملکرد', CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION performance_guard_consequence_policy_version()
RETURNS trigger AS $$
DECLARE old_state TEXT; new_state TEXT := NEW."lifecycle"::TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF new_state <> 'DRAFT' THEN RAISE EXCEPTION 'consequence policy versions must begin as drafts'; END IF;
    RETURN NEW;
  END IF;
  old_state := OLD."lifecycle"::TEXT;
  IF old_state = new_state AND old_state <> 'DRAFT' THEN RAISE EXCEPTION 'published consequence policy is immutable'; END IF;
  IF old_state <> new_state AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('SCHEDULED', 'CANCELLED')) OR
    (old_state = 'SCHEDULED' AND new_state IN ('ACTIVE', 'RETIRED')) OR
    (old_state = 'ACTIVE' AND new_state = 'RETIRED')
  ) THEN RAISE EXCEPTION 'invalid consequence policy lifecycle transition'; END IF;
  IF old_state <> 'DRAFT' AND (to_jsonb(OLD) - 'lifecycle' - 'retiredAt') IS DISTINCT FROM (to_jsonb(NEW) - 'lifecycle' - 'retiredAt') THEN
    RAISE EXCEPTION 'published consequence policy is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "performance_consequence_policy_version_guard"
BEFORE INSERT OR UPDATE ON "performance_consequence_policy_versions"
FOR EACH ROW EXECUTE FUNCTION performance_guard_consequence_policy_version();
