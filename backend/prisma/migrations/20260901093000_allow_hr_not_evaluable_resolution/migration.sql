CREATE OR REPLACE FUNCTION performance_guard_operational_lifecycle()
RETURNS trigger AS $$
DECLARE old_state TEXT; new_state TEXT;
BEGIN
  new_state := NEW."status"::TEXT;
  IF TG_OP = 'INSERT' THEN
    IF (TG_TABLE_NAME IN ('performance_evaluations', 'performance_evaluation_sections', 'performance_cycles') AND new_state <> 'DRAFT')
      OR (TG_TABLE_NAME = 'performance_drafts' AND new_state <> 'OPEN')
      OR (TG_TABLE_NAME = 'performance_accepted_results' AND new_state <> 'EFFECTIVE')
      OR (TG_TABLE_NAME = 'performance_corrections' AND new_state <> 'OPEN')
      OR (TG_TABLE_NAME IN ('performance_legal_holds', 'performance_safety_pauses') AND new_state <> 'ACTIVE')
      OR (TG_TABLE_NAME = 'performance_export_receipts' AND new_state <> 'QUEUED') THEN
      RAISE EXCEPTION 'invalid initial personnel performance lifecycle state';
    END IF;
    RETURN NEW;
  END IF;
  old_state := OLD."status"::TEXT;
  IF TG_TABLE_NAME = 'performance_accepted_results'
    AND (to_jsonb(OLD) - 'status') IS DISTINCT FROM (to_jsonb(NEW) - 'status') THEN
    RAISE EXCEPTION 'accepted performance result evidence is immutable';
  END IF;
  IF TG_TABLE_NAME = 'performance_cycles' AND old_state <> 'DRAFT'
    AND (to_jsonb(OLD) - 'status') IS DISTINCT FROM (to_jsonb(NEW) - 'status') THEN
    RAISE EXCEPTION 'scheduled performance cycle is immutable';
  END IF;
  IF TG_TABLE_NAME = 'performance_drafts'
    AND ((old_state <> 'OPEN') OR (old_state <> new_state))
    AND (to_jsonb(OLD) - 'status') IS DISTINCT FROM (to_jsonb(NEW) - 'status') THEN
    RAISE EXCEPTION 'closed performance draft is immutable';
  END IF;
  IF TG_TABLE_NAME = 'performance_legal_holds'
    AND (to_jsonb(OLD) - 'status' - 'releasedByUserId' - 'releasedAt' - 'releaseReason')
      IS DISTINCT FROM (to_jsonb(NEW) - 'status' - 'releasedByUserId' - 'releasedAt' - 'releaseReason') THEN
    RAISE EXCEPTION 'active legal hold scope is immutable';
  END IF;
  IF old_state = new_state THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'performance_evaluations' AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('READY_FOR_SUBMISSION','CANCELLED','INVALIDATED')) OR
    (old_state = 'READY_FOR_SUBMISSION' AND new_state IN ('UNDER_REVIEW','NOT_EVALUABLE','CANCELLED','INVALIDATED')) OR
    (old_state = 'UNDER_REVIEW' AND new_state IN ('ACCEPTED','NOT_EVALUABLE','CANCELLED','INVALIDATED')) OR
    (old_state IN ('ACCEPTED','NOT_EVALUABLE') AND new_state = 'INVALIDATED')
  ) THEN RAISE EXCEPTION 'invalid performance evaluation lifecycle transition'; END IF;
  IF TG_TABLE_NAME = 'performance_evaluation_sections' AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('SUBMITTED','NOT_EVALUABLE','CANCELLED','INVALIDATED')) OR
    (old_state = 'SUBMITTED' AND new_state IN ('REJECTED','ACCEPTED','NOT_EVALUABLE','CANCELLED','INVALIDATED')) OR
    (old_state = 'REJECTED' AND new_state IN ('DRAFT','NOT_EVALUABLE')) OR
    (old_state IN ('ACCEPTED','NOT_EVALUABLE') AND new_state = 'INVALIDATED')
  ) THEN RAISE EXCEPTION 'invalid performance section lifecycle transition'; END IF;
  IF TG_TABLE_NAME = 'performance_cycles' AND NOT (
    (old_state = 'DRAFT' AND new_state IN ('SCHEDULED','CANCELLED')) OR
    (old_state = 'SCHEDULED' AND new_state IN ('ACTIVE','CANCELLED')) OR
    (old_state = 'ACTIVE' AND new_state = 'CLOSED')
  ) THEN RAISE EXCEPTION 'invalid performance cycle lifecycle transition'; END IF;
  IF TG_TABLE_NAME = 'performance_drafts' AND NOT (old_state = 'OPEN' AND new_state IN ('SUBMITTED','DISCARDED')) THEN
    RAISE EXCEPTION 'invalid performance draft lifecycle transition';
  END IF;
  IF TG_TABLE_NAME = 'performance_accepted_results' AND NOT (
    old_state = 'EFFECTIVE' AND new_state IN ('SUSPENDED','SUPERSEDED','EXPIRED')
  ) AND NOT (old_state = 'SUSPENDED' AND new_state = 'SUPERSEDED') THEN
    RAISE EXCEPTION 'invalid accepted performance result lifecycle transition';
  END IF;
  IF TG_TABLE_NAME = 'performance_corrections' AND NOT (old_state = 'OPEN' AND new_state IN ('ACCEPTED','REJECTED','CANCELLED')) THEN
    RAISE EXCEPTION 'invalid performance correction lifecycle transition';
  END IF;
  IF TG_TABLE_NAME IN ('performance_legal_holds', 'performance_safety_pauses') AND NOT (old_state = 'ACTIVE' AND new_state IN ('RELEASED','RESUMED')) THEN
    RAISE EXCEPTION 'invalid personnel performance hold lifecycle transition';
  END IF;
  IF TG_TABLE_NAME = 'performance_export_receipts' AND NOT (
    (old_state = 'QUEUED' AND new_state IN ('RUNNING','FAILED')) OR
    (old_state = 'RUNNING' AND new_state IN ('READY','FAILED')) OR
    (old_state = 'READY' AND new_state IN ('DOWNLOADED','EXPIRED','DELETED')) OR
    (old_state = 'DOWNLOADED' AND new_state = 'DELETED') OR
    (old_state = 'EXPIRED' AND new_state = 'DELETED')
  ) THEN RAISE EXCEPTION 'invalid performance export lifecycle transition'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
