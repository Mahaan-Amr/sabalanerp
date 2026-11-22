-- Keep unknown entry times null; observation is evidence, never a duration boundary.
ALTER TABLE attendance_intervals ALTER COLUMN "enteredAt" DROP NOT NULL;
ALTER TABLE attendance_intervals ADD COLUMN "observedInsideAt" TIMESTAMP(3);
ALTER TABLE attendance_intervals ADD CONSTRAINT attendance_entry_evidence_required CHECK ("enteredAt" IS NOT NULL OR "observedInsideAt" IS NOT NULL);
ALTER TABLE attendance_punches ADD COLUMN "correctedOccurredAt" TIMESTAMP(3), ADD COLUMN "clockEvidence" JSONB;
CREATE OR REPLACE FUNCTION attendance_interval_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(164000145);
  SELECT "personnelId" INTO subject FROM attendance_records WHERE id = NEW."attendanceRecordId";
  IF NEW."exitedAt" IS NOT NULL AND NEW."exitedAt" <= COALESCE(NEW."enteredAt", NEW."observedInsideAt") THEN
    RAISE EXCEPTION 'attendance_exit_before_entry' USING ERRCODE = '23514';
  END IF;
  IF NEW."exitUnknown" AND NEW."exitedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'attendance_unknown_exit_has_time' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ACTIVE' AND NOT NEW."exitUnknown" AND subject IS NOT NULL AND EXISTS (
    SELECT 1 FROM attendance_intervals i JOIN attendance_records r ON r.id = i."attendanceRecordId"
    WHERE r."personnelId" = subject AND i.id <> NEW.id AND i.status = 'ACTIVE' AND NOT i."exitUnknown"
      AND COALESCE(i."enteredAt", i."observedInsideAt") < COALESCE(NEW."exitedAt", 'infinity'::timestamp)
      AND COALESCE(i."exitedAt", 'infinity'::timestamp) > COALESCE(NEW."enteredAt", NEW."observedInsideAt")
  ) THEN RAISE EXCEPTION 'attendance_interval_overlap' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
