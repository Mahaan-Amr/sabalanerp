CREATE FUNCTION preserve_retired_contract_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."retiredAt" IS NOT NULL AND (TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Retired contract item history is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_retired_contract_item_history
BEFORE UPDATE OR DELETE ON "contract_items"
FOR EACH ROW EXECUTE FUNCTION preserve_retired_contract_item();

CREATE FUNCTION reject_loading_of_retired_contract_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE retirement_time TIMESTAMP(3);
BEGIN
  SELECT "retiredAt" INTO retirement_time FROM "contract_items"
    WHERE "id" = NEW."sourceContractItemId" FOR SHARE;
  IF retirement_time IS NOT NULL THEN
    RAISE EXCEPTION 'Retired contract item cannot receive new loading work' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reject_retired_loading_line
BEFORE INSERT OR UPDATE OF "sourceContractItemId" ON "logistics_loading_lines"
FOR EACH ROW EXECUTE FUNCTION reject_loading_of_retired_contract_item();
CREATE TRIGGER reject_retired_driver_allocation
BEFORE INSERT OR UPDATE OF "sourceContractItemId" ON "logistics_loading_driver_allocations"
FOR EACH ROW EXECUTE FUNCTION reject_loading_of_retired_contract_item();
