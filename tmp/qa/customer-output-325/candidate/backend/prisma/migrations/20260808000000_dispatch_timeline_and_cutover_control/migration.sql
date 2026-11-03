CREATE TYPE "LegacyDispatchDisposition" AS ENUM ('LINKED', 'HISTORICAL_ONLY', 'DUPLICATE', 'INVALID');
CREATE TYPE "DispatchCutoverPhase" AS ENUM ('PRE_CUTOVER', 'CANONICAL_LIVE', 'ROLLED_BACK', 'PILOT_SAFETY_PAUSE');
CREATE TYPE "DispatchRehearsalType" AS ENUM ('CORRECTNESS', 'TIMED_DRESS');
CREATE TYPE "DispatchRehearsalStatus" AS ENUM ('PASSED', 'FAILED');
CREATE TYPE "DispatchCutoverActionType" AS ENUM ('REHEARSAL_RECORDED', 'CUTOVER_EXECUTED', 'LEGACY_WRITES_RESTORED', 'FIRST_CANONICAL_ADMISSION', 'PILOT_SAFETY_PAUSED', 'PILOT_SAFETY_RESUMED');

CREATE TABLE "legacy_driver_vehicle_dispositions" (
  "id" TEXT PRIMARY KEY,
  "legacyPairId" TEXT NOT NULL REFERENCES "security_vehicle_pairs"("id") ON DELETE RESTRICT,
  "disposition" "LegacyDispatchDisposition" NOT NULL,
  "driverSource" TEXT,
  "driverId" TEXT,
  "vehicleSource" TEXT,
  "vehicleId" TEXT,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedBy" TEXT NOT NULL,
  "supersedesId" TEXT UNIQUE REFERENCES "legacy_driver_vehicle_dispositions"("id") ON DELETE RESTRICT,
  "integrityHash" TEXT NOT NULL UNIQUE
);
CREATE INDEX "legacy_driver_vehicle_dispositions_legacyPairId_reviewedAt_idx" ON "legacy_driver_vehicle_dispositions"("legacyPairId", "reviewedAt");
CREATE INDEX "legacy_driver_vehicle_dispositions_disposition_idx" ON "legacy_driver_vehicle_dispositions"("disposition");

CREATE TABLE "dispatch_cutover_control" (
  "id" TEXT PRIMARY KEY DEFAULT 'dispatch',
  "phase" "DispatchCutoverPhase" NOT NULL DEFAULT 'PRE_CUTOVER',
  "legacyWritesEnabled" BOOLEAN NOT NULL DEFAULT true,
  "firstCanonicalAdmissionAt" TIMESTAMP(3),
  "cutoverAt" TIMESTAMP(3),
  "cutoverBy" TEXT,
  "rollbackAt" TIMESTAMP(3),
  "rollbackBy" TEXT,
  "pauseAt" TIMESTAMP(3),
  "pauseBy" TEXT,
  "pauseReason" TEXT,
  "snapshot" JSONB,
  "integrityHash" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "dispatch_cutover_control" ("id") VALUES ('dispatch');

CREATE TABLE "dispatch_cutover_rehearsals" (
  "id" TEXT PRIMARY KEY,
  "rehearsalType" "DispatchRehearsalType" NOT NULL,
  "status" "DispatchRehearsalStatus" NOT NULL,
  "sourceCount" INTEGER NOT NULL,
  "targetCount" INTEGER NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "targetHash" TEXT NOT NULL,
  "checks" JSONB NOT NULL,
  "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "performedBy" TEXT NOT NULL
);
CREATE INDEX "dispatch_cutover_rehearsals_status_performedAt_idx" ON "dispatch_cutover_rehearsals"("status", "performedAt");

CREATE TABLE "dispatch_cutover_actions" (
  "id" TEXT PRIMARY KEY,
  "controlId" TEXT NOT NULL REFERENCES "dispatch_cutover_control"("id") ON DELETE RESTRICT,
  "actionType" "DispatchCutoverActionType" NOT NULL,
  "payload" JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "previousHash" TEXT,
  "eventHash" TEXT NOT NULL UNIQUE
);
CREATE INDEX "dispatch_cutover_actions_controlId_recordedAt_idx" ON "dispatch_cutover_actions"("controlId", "recordedAt");

CREATE TABLE "legacy_cutover_turn_snapshots" (
  "id" TEXT PRIMARY KEY,
  "controlId" TEXT NOT NULL REFERENCES "dispatch_cutover_control"("id") ON DELETE RESTRICT,
  "legacyTurnId" TEXT NOT NULL,
  "cutoverVersion" INTEGER NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "integrityHash" TEXT NOT NULL UNIQUE,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "legacy_cutover_turn_snapshots_controlId_idx" ON "legacy_cutover_turn_snapshots"("controlId");
CREATE UNIQUE INDEX "legacy_cutover_turn_snapshots_controlId_cutoverVersion_legacyTurnId_key" ON "legacy_cutover_turn_snapshots"("controlId", "cutoverVersion", "legacyTurnId");

CREATE OR REPLACE FUNCTION prevent_dispatch_cutover_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Dispatch cutover evidence is append-only and immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "legacy_dispositions_immutable" BEFORE UPDATE OR DELETE ON "legacy_driver_vehicle_dispositions" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_cutover_evidence_mutation();
CREATE TRIGGER "dispatch_rehearsals_immutable" BEFORE UPDATE OR DELETE ON "dispatch_cutover_rehearsals" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_cutover_evidence_mutation();
CREATE TRIGGER "dispatch_cutover_actions_immutable" BEFORE UPDATE OR DELETE ON "dispatch_cutover_actions" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_cutover_evidence_mutation();
CREATE TRIGGER "legacy_cutover_turn_snapshots_immutable" BEFORE UPDATE OR DELETE ON "legacy_cutover_turn_snapshots" FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_cutover_evidence_mutation();

CREATE OR REPLACE FUNCTION guard_legacy_dispatch_writes() RETURNS trigger AS $$
DECLARE writes_enabled BOOLEAN;
BEGIN
  SELECT "legacyWritesEnabled" INTO writes_enabled FROM "dispatch_cutover_control" WHERE "id" = 'dispatch';
  IF writes_enabled IS FALSE THEN RAISE EXCEPTION 'Legacy combined dispatch writes are disabled after canonical cutover'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "legacy_pair_write_boundary" BEFORE INSERT OR UPDATE OR DELETE ON "security_vehicle_pairs" FOR EACH ROW EXECUTE FUNCTION guard_legacy_dispatch_writes();
CREATE TRIGGER "legacy_pair_photo_write_boundary" BEFORE INSERT OR UPDATE OR DELETE ON "security_vehicle_pair_photos" FOR EACH ROW EXECUTE FUNCTION guard_legacy_dispatch_writes();
CREATE TRIGGER "legacy_queue_write_boundary" BEFORE INSERT OR UPDATE OR DELETE ON "security_driver_queue_turns" FOR EACH ROW EXECUTE FUNCTION guard_legacy_dispatch_writes();

CREATE OR REPLACE FUNCTION protect_first_canonical_admission() RETURNS trigger AS $$
BEGIN
  IF OLD."firstCanonicalAdmissionAt" IS NOT NULL AND OLD."firstCanonicalAdmissionAt" IS DISTINCT FROM NEW."firstCanonicalAdmissionAt" THEN
    RAISE EXCEPTION 'First canonical admission boundary is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "dispatch_first_admission_immutable" BEFORE UPDATE ON "dispatch_cutover_control" FOR EACH ROW EXECUTE FUNCTION protect_first_canonical_admission();
