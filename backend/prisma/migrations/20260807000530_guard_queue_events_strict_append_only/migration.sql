CREATE OR REPLACE FUNCTION prevent_guard_queue_event_rewrite()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Canonical Guard queue audit events are append-only';
END;
$$ LANGUAGE plpgsql;
