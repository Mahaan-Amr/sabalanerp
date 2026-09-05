ALTER TABLE "performance_consequence_packages"
  ADD CONSTRAINT "performance_consequence_packages_payload_fkey" FOREIGN KEY ("encryptedPayloadId") REFERENCES "performance_encrypted_payloads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "performance_consequence_packages_responsibility_fkey" FOREIGN KEY ("destinationResponsibilityId") REFERENCES "hr_named_responsibilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "performance_consequence_packages_destination_user_fkey" FOREIGN KEY ("assignedDestinationUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "performance_consequence_handoffs"
  ADD CONSTRAINT "performance_consequence_handoffs_package_fkey" FOREIGN KEY ("packageId") REFERENCES "performance_consequence_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION performance_reject_consequence_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW."subjectId" IS DISTINCT FROM OLD."subjectId"
    OR NEW."personnelId" IS DISTINCT FROM OLD."personnelId"
    OR NEW."employmentRelationshipId" IS DISTINCT FROM OLD."employmentRelationshipId"
    OR NEW."consequenceType" IS DISTINCT FROM OLD."consequenceType"
    OR NEW."policyCycleKey" IS DISTINCT FROM OLD."policyCycleKey"
    OR NEW."reasonCategory" IS DISTINCT FROM OLD."reasonCategory"
    OR NEW."reason" IS DISTINCT FROM OLD."reason"
    OR NEW."encryptedPayloadId" IS DISTINCT FROM OLD."encryptedPayloadId"
    OR NEW."packageId" IS DISTINCT FROM OLD."packageId"
    OR NEW."snapshotHash" IS DISTINCT FROM OLD."snapshotHash"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'performance consequence handoff evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION performance_reject_consequence_package_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'performance consequence destination package is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER performance_consequence_package_immutable
BEFORE UPDATE OR DELETE ON "performance_consequence_packages"
FOR EACH ROW EXECUTE FUNCTION performance_reject_consequence_package_mutation();
