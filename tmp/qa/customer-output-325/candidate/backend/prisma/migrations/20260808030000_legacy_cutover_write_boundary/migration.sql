CREATE TRIGGER "legacy_loading_assignment_write_boundary"
  BEFORE INSERT OR UPDATE OR DELETE ON "logistics_loading_driver_assignments"
  FOR EACH ROW EXECUTE FUNCTION guard_legacy_dispatch_writes();

CREATE TRIGGER "legacy_loading_allocation_write_boundary"
  BEFORE INSERT OR UPDATE OR DELETE ON "logistics_loading_driver_allocations"
  FOR EACH ROW EXECUTE FUNCTION guard_legacy_dispatch_writes();
