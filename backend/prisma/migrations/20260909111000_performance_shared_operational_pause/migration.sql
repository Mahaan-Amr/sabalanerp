DROP INDEX IF EXISTS "performance_operational_incidents_safetyPauseId_key";
CREATE INDEX IF NOT EXISTS "performance_operational_incidents_safetyPauseId_idx"
  ON "performance_operational_incidents"("safetyPauseId");
