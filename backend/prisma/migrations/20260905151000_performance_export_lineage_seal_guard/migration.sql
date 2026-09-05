-- Lineage tables use exportId/composite keys rather than the generic evidence id.
CREATE FUNCTION performance_reject_export_lineage_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'performance export source lineage is immutable and append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER performance_export_lineage_immutable ON performance_export_lineage;
DROP TRIGGER performance_export_dependency_immutable ON performance_export_dependencies;
CREATE TRIGGER performance_export_lineage_immutable BEFORE UPDATE OR DELETE ON performance_export_lineage
FOR EACH ROW EXECUTE FUNCTION performance_reject_export_lineage_mutation();
CREATE TRIGGER performance_export_dependency_immutable BEFORE UPDATE OR DELETE ON performance_export_dependencies
FOR EACH ROW EXECUTE FUNCTION performance_reject_export_lineage_mutation();
-- Once sealed, a receipt cannot be repurposed for a different report or requester.
CREATE FUNCTION performance_guard_export_source_identity() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM performance_export_lineage WHERE "exportId" = OLD.id) AND
    ROW(NEW.id, NEW."requestedByUserId", NEW."exportKind", NEW."scopeHash", NEW."permissionHash", NEW."requestedAt") IS DISTINCT FROM
    ROW(OLD.id, OLD."requestedByUserId", OLD."exportKind", OLD."scopeHash", OLD."permissionHash", OLD."requestedAt") THEN
    RAISE EXCEPTION 'sealed performance export source identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_export_source_identity BEFORE UPDATE ON performance_export_receipts
FOR EACH ROW EXECUTE FUNCTION performance_guard_export_source_identity();
