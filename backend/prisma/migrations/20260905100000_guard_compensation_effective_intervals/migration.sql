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
  IF old_state <> 'DRAFT' THEN
    IF old_state = 'ACTIVE' AND new_state = 'RETIRED' THEN
      IF NEW."effectiveTo" IS NULL OR NEW."effectiveTo" <= NEW."effectiveFrom"
        OR (OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" > OLD."effectiveTo")
        OR (to_jsonb(OLD) - 'status' - 'effectiveTo') IS DISTINCT FROM (to_jsonb(NEW) - 'status' - 'effectiveTo')
      THEN RAISE EXCEPTION 'published compensation agreement is immutable'; END IF;
    ELSIF (to_jsonb(OLD) - 'status') IS DISTINCT FROM (to_jsonb(NEW) - 'status') THEN
      RAISE EXCEPTION 'published compensation agreement is immutable';
    END IF;
  END IF;
  IF new_state = 'ACTIVE' AND NEW."effectiveFrom" > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'compensation agreement cannot activate before its effective time';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
