BEGIN;

-- Loading creation uses both scoped Case authority and current Logistics
-- workspace/feature authority. Preserve the deferred User -> revision lock
-- order of the Accounting fence, including newly inserted direct overrides.
ALTER FUNCTION partner_accounting_permission_revision() RENAME TO partner_operational_permission_revision;
CREATE OR REPLACE FUNCTION partner_operational_permission_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND OLD.workspace IN ('accounting', 'logistics')) OR
     (TG_OP <> 'DELETE' AND NEW.workspace IN ('accounting', 'logistics')) THEN
    UPDATE effective_authorization_state SET revision = revision + 1 WHERE id = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Operational authority state unavailable'; END IF;
  END IF;
  RETURN NULL;
END $$;

ALTER TRIGGER partner_accounting_permission_revision ON workspace_permissions RENAME TO partner_operational_permission_revision;
ALTER TRIGGER partner_accounting_permission_revision ON role_workspace_permissions RENAME TO partner_operational_permission_revision;
ALTER TRIGGER partner_accounting_permission_revision ON feature_permissions RENAME TO partner_operational_permission_revision;
ALTER TRIGGER partner_accounting_permission_revision ON role_feature_permissions RENAME TO partner_operational_permission_revision;

COMMIT;
