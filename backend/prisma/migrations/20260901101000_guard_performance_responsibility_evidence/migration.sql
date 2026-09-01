CREATE OR REPLACE FUNCTION hr_guard_performance_responsibility_period()
RETURNS trigger AS $$
BEGIN
  IF NEW."employmentAssignmentId" = NEW."supervisorAssignmentId" THEN
    RAISE EXCEPTION 'performance responsibility cannot be self-referential';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'superseded performance responsibility history is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'ACTIVE' AND (
    (NEW."status" = 'ACTIVE' AND (to_jsonb(OLD) - 'effectiveTo') IS DISTINCT FROM (to_jsonb(NEW) - 'effectiveTo'))
    OR (NEW."status" = 'SUPERSEDED' AND (to_jsonb(OLD) - 'status') IS DISTINCT FROM (to_jsonb(NEW) - 'status'))
    OR NEW."status" NOT IN ('ACTIVE', 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'performance responsibility evidence must be corrected by supersession';
  END IF;
  IF NEW."status" = 'ACTIVE' AND EXISTS (
    SELECT 1
    FROM "hr_assignment_performance_responsibilities" existing
    WHERE existing."employmentAssignmentId" = NEW."employmentAssignmentId"
      AND existing."status" = 'ACTIVE'
      AND existing."id" <> NEW."id"
      AND existing."effectiveFrom" < COALESCE(NEW."effectiveTo", 'infinity'::timestamp)
      AND NEW."effectiveFrom" < COALESCE(existing."effectiveTo", 'infinity'::timestamp)
  ) THEN
    RAISE EXCEPTION 'overlapping performance responsibility periods are not allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
