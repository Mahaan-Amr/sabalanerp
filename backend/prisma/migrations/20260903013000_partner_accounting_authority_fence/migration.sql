BEGIN;

-- Partner commands also require live internal Accounting workspace/feature
-- authority. The central revision protects absent direct overrides as well as
-- inherited grants, so a waiting Serializable reader must retry after changes.
-- Defer the fence until commit: legacy bulk permission writers delete and then
-- recreate rows (taking User FK locks). Taking this fence before those User
-- locks would invert the documented User -> authority command lock order.
CREATE FUNCTION partner_accounting_permission_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP <> 'INSERT' AND OLD.workspace = 'accounting') OR
     (TG_OP <> 'DELETE' AND NEW.workspace = 'accounting') THEN
    UPDATE effective_authorization_state SET revision = revision + 1 WHERE id = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Accounting authority state unavailable'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER partner_accounting_permission_revision
  AFTER INSERT OR UPDATE OR DELETE ON workspace_permissions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_accounting_permission_revision();
CREATE CONSTRAINT TRIGGER partner_accounting_permission_revision
  AFTER INSERT OR UPDATE OR DELETE ON role_workspace_permissions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_accounting_permission_revision();
CREATE CONSTRAINT TRIGGER partner_accounting_permission_revision
  AFTER INSERT OR UPDATE OR DELETE ON feature_permissions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_accounting_permission_revision();
CREATE CONSTRAINT TRIGGER partner_accounting_permission_revision
  AFTER INSERT OR UPDATE OR DELETE ON role_feature_permissions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_accounting_permission_revision();

COMMIT;
