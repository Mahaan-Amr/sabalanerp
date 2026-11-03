CREATE OR REPLACE FUNCTION protect_legacy_linked_target() RETURNS trigger AS $$
DECLARE referenced BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('DISPATCH_TARGET:' || TG_ARGV[1] || ':' || OLD."id"));
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
