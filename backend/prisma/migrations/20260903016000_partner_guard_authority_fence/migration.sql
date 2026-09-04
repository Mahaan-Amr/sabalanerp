BEGIN;

-- Guard reads retain private Case associations only with current Security
-- workspace authority. The same deferred fence protects a waiting repeatable
-- read from using a workspace grant revoked after its snapshot began.
CREATE OR REPLACE FUNCTION partner_operational_permission_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND OLD.workspace IN ('accounting', 'logistics', 'security')) OR
     (TG_OP <> 'DELETE' AND NEW.workspace IN ('accounting', 'logistics', 'security')) THEN
    UPDATE effective_authorization_state SET revision = revision + 1 WHERE id = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operational authority state unavailable'; END IF;
  END IF;
  RETURN NULL;
END $$;

COMMIT;
