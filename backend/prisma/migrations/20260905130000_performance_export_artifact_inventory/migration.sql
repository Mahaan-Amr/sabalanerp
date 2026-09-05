CREATE TABLE performance_export_artifacts (
  id TEXT PRIMARY KEY,
  "exportId" TEXT NOT NULL REFERENCES performance_export_receipts(id) ON DELETE RESTRICT,
  "attemptCount" INTEGER NOT NULL CHECK ("attemptCount" >= 0),
  "artifactPath" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("exportId", "attemptCount")
);
INSERT INTO performance_export_artifacts(id, "exportId", "attemptCount", "artifactPath")
SELECT 'legacy-' || id, id, "attemptCount", "artifactPath"
FROM performance_export_receipts WHERE "artifactPath" IS NOT NULL;

CREATE FUNCTION performance_preserve_export_artifact_inventory() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'export artifact inventory must preserve retry evidence';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER performance_export_artifact_inventory_guard BEFORE UPDATE OR DELETE ON performance_export_artifacts
FOR EACH ROW EXECUTE FUNCTION performance_preserve_export_artifact_inventory();
