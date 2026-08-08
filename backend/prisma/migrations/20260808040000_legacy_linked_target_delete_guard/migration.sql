CREATE OR REPLACE FUNCTION protect_legacy_linked_target() RETURNS trigger AS $$
DECLARE referenced BOOLEAN;
BEGIN
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
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "legacy_linked_internal_driver_delete_guard" BEFORE DELETE ON "internal_driver_profiles"
  FOR EACH ROW EXECUTE FUNCTION protect_legacy_linked_target('DRIVER', 'INTERNAL');
CREATE TRIGGER "legacy_linked_external_driver_delete_guard" BEFORE DELETE ON "external_drivers"
  FOR EACH ROW EXECUTE FUNCTION protect_legacy_linked_target('DRIVER', 'EXTERNAL');
CREATE TRIGGER "legacy_linked_company_vehicle_delete_guard" BEFORE DELETE ON "company_vehicles"
  FOR EACH ROW EXECUTE FUNCTION protect_legacy_linked_target('VEHICLE', 'COMPANY');
CREATE TRIGGER "legacy_linked_external_vehicle_delete_guard" BEFORE DELETE ON "external_vehicles"
  FOR EACH ROW EXECUTE FUNCTION protect_legacy_linked_target('VEHICLE', 'EXTERNAL');
