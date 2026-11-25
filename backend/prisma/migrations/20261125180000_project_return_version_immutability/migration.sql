BEGIN;

ALTER TABLE "project_return_versions" ADD COLUMN "customerId" TEXT, ADD COLUMN "customerName" TEXT;

UPDATE "project_return_versions" AS version
SET "customerId" = case_row."customerId", "customerName" = case_row."customerName"
FROM "project_return_cases" AS case_row
WHERE version."caseId" = case_row."id";

ALTER TABLE "project_return_versions"
  ALTER COLUMN "customerId" SET NOT NULL,
  ALTER COLUMN "customerName" SET NOT NULL,
  ADD CONSTRAINT "project_return_versions_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "project_return_versions_customerId_idx" ON "project_return_versions"("customerId");

CREATE TRIGGER "project_return_versions_immutable" BEFORE UPDATE OR DELETE
  ON "project_return_versions" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "project_return_version_projects_immutable" BEFORE UPDATE OR DELETE
  ON "project_return_version_projects" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "project_return_version_items_immutable" BEFORE UPDATE OR DELETE
  ON "project_return_version_items" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
CREATE TRIGGER "project_return_operations_immutable" BEFORE UPDATE OR DELETE
  ON "project_return_operations" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();

CREATE FUNCTION "project_return_preserve_case_origin"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) - 'operationStatus') = (to_jsonb(NEW) - 'operationStatus') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Project return case origin is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "project_return_case_origin_immutable" BEFORE UPDATE OR DELETE
  ON "project_return_cases" FOR EACH ROW EXECUTE FUNCTION "project_return_preserve_case_origin"();

COMMIT;
