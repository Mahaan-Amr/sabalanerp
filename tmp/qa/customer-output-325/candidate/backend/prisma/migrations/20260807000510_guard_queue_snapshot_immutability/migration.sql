ALTER TABLE "guard_driver_queue_turns"
  ADD CONSTRAINT "guard_driver_queue_turns_replacementTurnId_fkey"
  FOREIGN KEY ("replacementTurnId") REFERENCES "guard_driver_queue_turns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_guard_queue_admission_rewrite()
RETURNS trigger AS $$
BEGIN
  IF NEW."driverSource" IS DISTINCT FROM OLD."driverSource"
    OR NEW."internalDriverId" IS DISTINCT FROM OLD."internalDriverId"
    OR NEW."externalDriverId" IS DISTINCT FROM OLD."externalDriverId"
    OR NEW."companyVehicleId" IS DISTINCT FROM OLD."companyVehicleId"
    OR NEW."externalVehicleId" IS DISTINCT FROM OLD."externalVehicleId"
    OR NEW."assignmentId" IS DISTINCT FROM OLD."assignmentId"
    OR NEW."admittedAt" IS DISTINCT FROM OLD."admittedAt"
    OR NEW."admittedBy" IS DISTINCT FROM OLD."admittedBy"
    OR NEW."snapshotSchemaVersion" IS DISTINCT FROM OLD."snapshotSchemaVersion"
    OR NEW."admissionSnapshot" IS DISTINCT FROM OLD."admissionSnapshot"
    OR NEW."integrityHash" IS DISTINCT FROM OLD."integrityHash"
  THEN
    RAISE EXCEPTION 'Canonical Guard queue admission evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "guard_queue_admission_immutable"
BEFORE UPDATE ON "guard_driver_queue_turns"
FOR EACH ROW EXECUTE FUNCTION prevent_guard_queue_admission_rewrite();
