CREATE OR REPLACE FUNCTION performance_reject_copy_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'personnel performance recoverable-copy evidence is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_recoverable_copies_append_only BEFORE UPDATE OR DELETE ON "performance_recoverable_copies" FOR EACH ROW EXECUTE FUNCTION performance_reject_copy_evidence_mutation();
