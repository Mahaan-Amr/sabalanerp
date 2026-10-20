-- OFFLINE ONLY. Not installed. Paired native acceptance and a new canonical
-- Prisma capsule are required before production admission.
CREATE TABLE online_hr_invalidation_intents (
  id TEXT PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
  event TEXT NOT NULL CHECK(event='hr.personnel.changed'),
  "originRuntimeId" TEXT NOT NULL CHECK("originRuntimeId" ~ '^[a-f0-9]{64}$'),
  "originNonceSha256" TEXT NOT NULL CHECK("originNonceSha256" ~ '^[a-f0-9]{64}$'),
  "sourceOutcome" TEXT NOT NULL DEFAULT 'PREPARED' CHECK("sourceOutcome" IN ('PREPARED','READY','CANCELLED','UNKNOWN')),
  "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING' CHECK("deliveryStatus" IN ('PENDING','SETTLED','UNKNOWN')),
  "sourceSettledAt" TIMESTAMPTZ(3),"deliverySettledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CHECK (("sourceOutcome"='PREPARED')=("sourceSettledAt" IS NULL)),
  CHECK (("deliveryStatus"='SETTLED')=("deliverySettledAt" IS NOT NULL)),
  CHECK ("deliveryStatus"='PENDING' OR "sourceOutcome"='READY')
);
CREATE INDEX online_hr_invalidations_ready ON online_hr_invalidation_intents("sourceOutcome","deliveryStatus","createdAt",id);
CREATE TABLE online_realtime_batches (
  id TEXT PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
  kind TEXT NOT NULL CHECK(kind IN ('NOTIFICATION','HR_PERSONNEL_INVALIDATION')),
  "sourceId" TEXT NOT NULL,"notificationId" TEXT,"userId" TEXT,
  "producerRuntimeId" TEXT NOT NULL CHECK("producerRuntimeId" ~ '^[a-f0-9]{64}$'),
  "producerNonceSha256" TEXT NOT NULL CHECK("producerNonceSha256" ~ '^[a-f0-9]{64}$'),
  "targetsSha256" TEXT NOT NULL CHECK("targetsSha256" ~ '^[a-f0-9]{64}$'),
  "targetsJson" JSONB NOT NULL CHECK(jsonb_typeof("targetsJson")='array' AND jsonb_array_length("targetsJson") BETWEEN 1 AND 1024),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(kind,"sourceId","notificationId","userId"),
  CHECK ((kind='NOTIFICATION' AND "notificationId" IS NOT NULL AND "userId" IS NOT NULL)
    OR (kind='HR_PERSONNEL_INVALIDATION' AND "notificationId" IS NULL AND "userId" IS NULL))
);
CREATE UNIQUE INDEX online_realtime_hr_source ON online_realtime_batches(kind,"sourceId") WHERE kind='HR_PERSONNEL_INVALIDATION';
CREATE TABLE online_realtime_commands (
  id TEXT PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
  "batchId" TEXT NOT NULL REFERENCES online_realtime_batches(id) ON DELETE RESTRICT,
  "runtimeId" TEXT NOT NULL,"nonceSha256" TEXT NOT NULL CHECK("nonceSha256" ~ '^[a-f0-9]{64}$'),
  "releaseId" TEXT NOT NULL,"imageIdentity" TEXT NOT NULL CHECK("imageIdentity" ~ '^sha256:[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','SETTLED','UNKNOWN')),
  "claimToken" TEXT CHECK("claimToken" ~ '^[a-f0-9]{64}$'),
  "startedAt" TIMESTAMPTZ(3),"settledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE("batchId","runtimeId","nonceSha256"),
  CHECK ((status='PENDING' AND "startedAt" IS NULL AND "settledAt" IS NULL AND "claimToken" IS NULL)
    OR(status IN ('RUNNING','UNKNOWN') AND "startedAt" IS NOT NULL AND "settledAt" IS NULL AND "claimToken" IS NOT NULL)
    OR(status='SETTLED' AND "startedAt" IS NOT NULL AND "settledAt" IS NOT NULL AND "claimToken" IS NOT NULL))
);
CREATE INDEX online_realtime_commands_owner ON online_realtime_commands("runtimeId","nonceSha256",status,"createdAt");
CREATE FUNCTION sabalan_guard_realtime_command() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ONLINE_REALTIME_RETENTION_REQUIRES_ORIGINAL_CLOSURE'; END IF;
  IF TG_TABLE_NAME='online_realtime_batches' THEN RAISE EXCEPTION 'ONLINE_REALTIME_TARGET_SET_IMMUTABLE'; END IF;
  IF TG_TABLE_NAME='online_hr_invalidation_intents' THEN
    IF (to_jsonb(NEW)-'sourceOutcome'-'deliveryStatus'-'sourceSettledAt'-'deliverySettledAt') IS DISTINCT FROM
       (to_jsonb(OLD)-'sourceOutcome'-'deliveryStatus'-'sourceSettledAt'-'deliverySettledAt')
      OR NOT ((OLD."sourceOutcome"='PREPARED' AND NEW."sourceOutcome" IN ('READY','CANCELLED','UNKNOWN')
          AND NEW."deliveryStatus"=OLD."deliveryStatus")
        OR(OLD."sourceOutcome"='READY' AND NEW."sourceOutcome"='READY' AND OLD."deliveryStatus"='PENDING'
          AND NEW."deliveryStatus" IN ('SETTLED','UNKNOWN')))
      OR(OLD."sourceSettledAt" IS NOT NULL AND NEW."sourceSettledAt" IS DISTINCT FROM OLD."sourceSettledAt") THEN
      RAISE EXCEPTION 'ONLINE_HR_INVALIDATION_TRANSITION_REFUSED';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-'status'-'startedAt'-'settledAt'-'claimToken') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'startedAt'-'settledAt'-'claimToken')
      OR NOT ((OLD.status='PENDING' AND NEW.status='RUNNING') OR(OLD.status='RUNNING' AND NEW.status IN ('SETTLED','UNKNOWN')))
      OR(OLD."claimToken" IS NOT NULL AND NEW."claimToken" IS DISTINCT FROM OLD."claimToken")
      OR(OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt") THEN
      RAISE EXCEPTION 'ONLINE_REALTIME_COMMAND_TRANSITION_REFUSED';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER online_realtime_batch_guard BEFORE UPDATE OR DELETE ON online_realtime_batches FOR EACH ROW EXECUTE FUNCTION sabalan_guard_realtime_command();
CREATE TRIGGER online_realtime_command_guard BEFORE UPDATE OR DELETE ON online_realtime_commands FOR EACH ROW EXECUTE FUNCTION sabalan_guard_realtime_command();
CREATE TRIGGER online_hr_invalidation_guard BEFORE UPDATE OR DELETE ON online_hr_invalidation_intents FOR EACH ROW EXECUTE FUNCTION sabalan_guard_realtime_command();
-- Runtime DELETE remains denied. Bridge event/audit evidence is retained.
-- Measure actual table/index bytes and deployment disk headroom; pruning this
-- history is not a prerequisite of the initial approved release. Newest-two
-- COMPLETE backup retention and unused-image/container cleanup are unchanged.
