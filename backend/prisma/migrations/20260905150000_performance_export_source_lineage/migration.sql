-- Existing receipts intentionally have no lineage: guessing historical membership is unsafe.
CREATE TABLE performance_export_lineage (
  "exportId" TEXT PRIMARY KEY REFERENCES performance_export_receipts(id) ON DELETE RESTRICT,
  "schemaVersion" INTEGER NOT NULL CHECK ("schemaVersion" = 1),
  "reconstructionId" TEXT NOT NULL UNIQUE REFERENCES performance_encrypted_payloads(id) ON DELETE RESTRICT,
  "dependencyHash" TEXT NOT NULL CHECK ("dependencyHash" ~ '^[a-f0-9]{64}$'),
  "dependencyCount" INTEGER NOT NULL CHECK ("dependencyCount" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE performance_export_dependencies (
  "exportId" TEXT NOT NULL REFERENCES performance_export_lineage("exportId") DEFERRABLE INITIALLY DEFERRED,
  "aggregateType" TEXT NOT NULL,
  "aggregateIdHash" TEXT NOT NULL CHECK ("aggregateIdHash" ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY ("exportId", "aggregateType", "aggregateIdHash")
);
CREATE INDEX performance_export_dependency_scope ON performance_export_dependencies("aggregateType", "aggregateIdHash");
CREATE TRIGGER performance_export_lineage_immutable BEFORE UPDATE OR DELETE ON performance_export_lineage
FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE TRIGGER performance_export_dependency_immutable BEFORE UPDATE OR DELETE ON performance_export_dependencies
FOR EACH ROW EXECUTE FUNCTION performance_reject_evidence_mutation();
CREATE FUNCTION performance_seal_export_lineage() RETURNS trigger AS $$
DECLARE actual_count INTEGER; actual_hash TEXT;
BEGIN
  PERFORM 1 FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE;
  IF TG_TABLE_NAME = 'performance_export_dependencies' THEN
    IF EXISTS (SELECT 1 FROM performance_export_lineage WHERE "exportId" = NEW."exportId") THEN
      RAISE EXCEPTION 'performance export lineage is sealed';
    END IF;
  ELSE
    SELECT count(*), encode(digest(string_agg("aggregateType" || ':' || "aggregateIdHash", E'\n' ORDER BY ("aggregateType" || ':' || "aggregateIdHash") COLLATE "C"), 'sha256'), 'hex')
    INTO actual_count, actual_hash FROM performance_export_dependencies WHERE "exportId" = NEW."exportId";
    IF actual_count <> NEW."dependencyCount" OR actual_hash IS DISTINCT FROM NEW."dependencyHash" THEN
      RAISE EXCEPTION 'performance export dependency manifest is incomplete';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_export_dependency_seal BEFORE INSERT ON performance_export_dependencies
FOR EACH ROW EXECUTE FUNCTION performance_seal_export_lineage();
CREATE TRIGGER performance_export_lineage_seal BEFORE INSERT ON performance_export_lineage
FOR EACH ROW EXECUTE FUNCTION performance_seal_export_lineage();
-- These mutable inputs also affect report reconstruction. Share the existing disclosure fence.
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['performance_evaluations','performance_evaluation_sections',
    'performance_privacy_scopes','performance_artifact_snapshot_bindings',
    'hr_employment_relationships','hr_employment_assignments','hr_positions'] LOOP
    EXECUTE format('CREATE TRIGGER performance_export_source_revision BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION performance_bump_disclosure_revision()', table_name);
  END LOOP;
END $$;
