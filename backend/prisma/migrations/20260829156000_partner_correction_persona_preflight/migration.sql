-- Never infer a successor for historical internal Accounting work. Refuse the
-- upgrade if an already-active/irreversible Partner still owns an OPEN
-- correction so an authorized owner must explicitly transfer or close it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM accounting_correction_requests correction
    JOIN partner_profiles profile ON profile."userId" = correction."assignedToUserId"
    WHERE correction.status = 'OPEN'
      AND (profile."irreversibleAt" IS NOT NULL OR profile.state = 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'open Accounting correction remains assigned to an active or irreversible Partner persona'
      USING ERRCODE = '23514';
  END IF;
END;
$$;
