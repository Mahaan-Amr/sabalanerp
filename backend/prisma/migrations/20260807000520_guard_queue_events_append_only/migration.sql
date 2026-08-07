CREATE OR REPLACE FUNCTION prevent_guard_queue_event_rewrite()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Canonical Guard queue audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "guard_queue_events_append_only"
BEFORE UPDATE OR DELETE ON "guard_driver_queue_events"
FOR EACH ROW EXECUTE FUNCTION prevent_guard_queue_event_rewrite();
