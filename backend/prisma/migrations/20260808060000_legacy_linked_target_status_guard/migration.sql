CREATE OR REPLACE FUNCTION protect_legacy_linked_target_status() RETURNS trigger AS $$
DECLARE referenced BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('DISPATCH_TARGET:' || TG_ARGV[1] || ':' || OLD."id"));
  IF NEW."status" = 'ACTIVE' THEN RETURN NEW; END IF;
  IF TG_ARGV[0] = 'DRIVER' THEN
    SELECT EXISTS (
      SELECT 1 FROM "legacy_driver_vehicle_dispositions"
      WHERE "disposition" = 'LINKED' AND "driverSource" = TG_ARGV[1] AND "driverId" = OLD."id"
    ) INTO referenced;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM "legacy_driver_vehicle_dispositions"
      WHERE "disposition" = 'LINKED' AND "vehicleSource" = TG_ARGV[1] AND "vehicleId" = OLD."id"
    ) INTO referenced;
  END IF;
  IF referenced THEN RAISE EXCEPTION 'Canonical identity is retained by an immutable legacy dispatch disposition'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "legacy_linked_internal_driver_status_guard" BEFORE UPDATE OF "status" ON "internal_driver_profiles"
  FOR EACH ROW EXECUTE FUNCTION protect_legacy_linked_target_status('DRIVER', 'INTERNAL');
CREATE TRIGGER "legacy_linked_external_driver_status_guard" BEFORE UPDATE OF "status" ON "external_drivers"
  FOR EACH ROW EXECUTE FUNCTION protect_legacy_linked_target_status('DRIVER', 'EXTERNAL');
CREATE TRIGGER "legacy_linked_company_vehicle_status_guard" BEFORE UPDATE OF "status" ON "company_vehicles"
  FOR EACH ROW EXECUTE FUNCTION protect_legacy_linked_target_status('VEHICLE', 'COMPANY');
CREATE TRIGGER "legacy_linked_external_vehicle_status_guard" BEFORE UPDATE OF "status" ON "external_vehicles"
  FOR EACH ROW EXECUTE FUNCTION protect_legacy_linked_target_status('VEHICLE', 'EXTERNAL');
