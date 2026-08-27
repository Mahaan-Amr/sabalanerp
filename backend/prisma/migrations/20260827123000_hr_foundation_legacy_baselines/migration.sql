-- Legacy definitions may predate lifecycle versioning. Give each such record an
-- explicit version-1 baseline, then walk recorded deltas backwards so event-time
-- snapshots can start from the definition that existed before those deltas.

CREATE TEMP TABLE "legacy_foundation_baseline_targets" (
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  PRIMARY KEY ("entityType", "entityId")
) ON COMMIT DROP;

INSERT INTO "legacy_foundation_baseline_targets" ("entityType", "entityId")
SELECT 'ORGANIZATIONAL_UNIT', unit."id" FROM "hr_organizational_units" unit
WHERE NOT EXISTS (
  SELECT 1 FROM "hr_foundation_lifecycle_versions" version
  WHERE version."entityType" = 'ORGANIZATIONAL_UNIT' AND version."entityId" = unit."id"
    AND version."version" = 1 AND version."beforeJson" IS NULL
    AND version."afterJson" ?& ARRAY['id', 'code', 'name', 'type']
)
UNION ALL
SELECT 'JOB', job."id" FROM "hr_jobs" job
WHERE NOT EXISTS (
  SELECT 1 FROM "hr_foundation_lifecycle_versions" version
  WHERE version."entityType" = 'JOB' AND version."entityId" = job."id"
    AND version."version" = 1 AND version."beforeJson" IS NULL
    AND version."afterJson" ?& ARRAY['id', 'code', 'title']
)
UNION ALL
SELECT 'POSITION', position."id" FROM "hr_positions" position
WHERE NOT EXISTS (
  SELECT 1 FROM "hr_foundation_lifecycle_versions" version
  WHERE version."entityType" = 'POSITION' AND version."entityId" = position."id"
    AND version."version" = 1 AND version."beforeJson" IS NULL
    AND version."afterJson" ?& ARRAY['id', 'code', 'title', 'jobId', 'organizationalUnitId']
);

-- Move existing partial versions out of the unique-key range, then shift them by
-- one so version 1 remains the immutable full baseline.
UPDATE "hr_foundation_lifecycle_versions" version
SET "version" = version."version" + 1000000
FROM "legacy_foundation_baseline_targets" target
WHERE version."entityType" = target."entityType" AND version."entityId" = target."entityId";

UPDATE "hr_foundation_lifecycle_versions" version
SET "version" = version."version" - 999999
FROM "legacy_foundation_baseline_targets" target
WHERE version."entityType" = target."entityType" AND version."entityId" = target."entityId";

INSERT INTO "hr_foundation_lifecycle_versions"
  ("id", "stableKey", "entityType", "entityId", "version", "status", "effectiveFrom", "reason", "beforeJson", "afterJson", "changedByUserId", "createdAt")
SELECT
  'legacy-baseline-unit-' || unit."id",
  'legacy-baseline-unit-' || unit."id",
  'ORGANIZATIONAL_UNIT',
  unit."id",
  1,
  CASE WHEN unit."isActive" THEN 'ACTIVE' ELSE 'INACTIVE' END::"HrFoundationLifecycleStatus",
  unit."createdAt",
  'LEGACY_FOUNDATION_BASELINE',
  NULL,
  jsonb_build_object(
    'id', unit."id", 'code', unit."code", 'codeOccurrence', unit."codeOccurrence",
    'name', unit."name", 'type', unit."type", 'parentId', unit."parentId", 'isActive', unit."isActive"
  ),
  unit."createdBy",
  unit."createdAt"
FROM "hr_organizational_units" unit
WHERE NOT EXISTS (
  SELECT 1 FROM "hr_foundation_lifecycle_versions" version
  WHERE version."entityType" = 'ORGANIZATIONAL_UNIT' AND version."entityId" = unit."id"
    AND version."version" = 1 AND version."beforeJson" IS NULL
    AND version."afterJson" ?& ARRAY['id', 'code', 'name', 'type']
);

INSERT INTO "hr_foundation_lifecycle_versions"
  ("id", "stableKey", "entityType", "entityId", "version", "status", "effectiveFrom", "reason", "beforeJson", "afterJson", "changedByUserId", "createdAt")
SELECT
  'legacy-baseline-job-' || job."id",
  'legacy-baseline-job-' || job."id",
  'JOB',
  job."id",
  1,
  CASE WHEN job."isActive" THEN 'ACTIVE' ELSE 'INACTIVE' END::"HrFoundationLifecycleStatus",
  job."createdAt",
  'LEGACY_FOUNDATION_BASELINE',
  NULL,
  jsonb_build_object(
    'id', job."id", 'code', job."code", 'codeOccurrence', job."codeOccurrence",
    'title', job."title", 'description', job."description", 'responsibilities', job."responsibilities", 'isActive', job."isActive"
  ),
  job."createdBy",
  job."createdAt"
FROM "hr_jobs" job
WHERE NOT EXISTS (
  SELECT 1 FROM "hr_foundation_lifecycle_versions" version
  WHERE version."entityType" = 'JOB' AND version."entityId" = job."id"
    AND version."version" = 1 AND version."beforeJson" IS NULL
    AND version."afterJson" ?& ARRAY['id', 'code', 'title']
);

INSERT INTO "hr_foundation_lifecycle_versions"
  ("id", "stableKey", "entityType", "entityId", "version", "status", "effectiveFrom", "reason", "beforeJson", "afterJson", "changedByUserId", "createdAt")
SELECT
  'legacy-baseline-position-' || position."id",
  'legacy-baseline-position-' || position."id",
  'POSITION',
  position."id",
  1,
  CASE WHEN position."isActive" THEN 'ACTIVE' ELSE 'INACTIVE' END::"HrFoundationLifecycleStatus",
  position."createdAt",
  'LEGACY_FOUNDATION_BASELINE',
  NULL,
  jsonb_build_object(
    'id', position."id", 'code', position."code", 'codeOccurrence', position."codeOccurrence",
    'title', position."title", 'capacity', position."capacity", 'jobId', position."jobId",
    'organizationalUnitId', position."organizationalUnitId", 'workplaceId', position."workplaceId",
    'costCenterId', position."costCenterId", 'supervisorPositionId', position."supervisorPositionId",
    'isActive', position."isActive"
  ),
  position."createdBy",
  position."createdAt"
FROM "hr_positions" position
WHERE NOT EXISTS (
  SELECT 1 FROM "hr_foundation_lifecycle_versions" version
  WHERE version."entityType" = 'POSITION' AND version."entityId" = position."id"
    AND version."version" = 1 AND version."beforeJson" IS NULL
    AND version."afterJson" ?& ARRAY['id', 'code', 'title', 'jobId', 'organizationalUnitId']
);

DO $$
DECLARE
  change_record RECORD;
BEGIN
  FOR change_record IN
    SELECT "entityType", "entityId", "beforeJson"
    FROM "hr_foundation_lifecycle_versions"
    WHERE "version" <> 1 AND "beforeJson" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "legacy_foundation_baseline_targets" target
        WHERE target."entityType" = "hr_foundation_lifecycle_versions"."entityType"
          AND target."entityId" = "hr_foundation_lifecycle_versions"."entityId"
      )
    ORDER BY "entityType", "entityId", "effectiveFrom" DESC, "version" DESC
  LOOP
    UPDATE "hr_foundation_lifecycle_versions"
    SET "afterJson" = "afterJson" || change_record."beforeJson"
    WHERE "entityType" = change_record."entityType"
      AND "entityId" = change_record."entityId"
      AND "version" = 1;
  END LOOP;
END $$;
