BEGIN;
ALTER TABLE crm_customers ADD COLUMN "cardDeletedAt" timestamptz(3);
CREATE TABLE crm_customer_cards (
  "customerId" text PRIMARY KEY REFERENCES crm_customers(id) ON DELETE CASCADE,
  "createdAt" timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE crm_customer_retained_history (
  "customerId" text PRIMARY KEY REFERENCES crm_customers(id) ON DELETE RESTRICT,
  "receiptId" text NOT NULL UNIQUE REFERENCES effective_authorization_audit(id) ON DELETE RESTRICT,
  "retainedAt" timestamptz(3) NOT NULL DEFAULT now(), snapshot jsonb NOT NULL
);
INSERT INTO crm_customer_cards ("customerId", "createdAt") SELECT id, "createdAt" FROM crm_customers;
CREATE FUNCTION init_customer_card() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO crm_customer_cards ("customerId") VALUES (NEW.id); RETURN NEW; END $$;
CREATE TRIGGER crm_customer_card_init AFTER INSERT ON crm_customers FOR EACH ROW EXECUTE FUNCTION init_customer_card();
CREATE FUNCTION customer_card_receipt_valid(customer_id text) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS (SELECT 1 FROM effective_authorization_audit a
 WHERE a.id = nullif(current_setting('sabalan.crm_customer_deletion_receipt', true),'')
 AND a."rootId" = customer_id AND a.action = 'CUSTOMER_PERMANENT_DELETE' AND a.allowed = true
 AND a.xmin::text = pg_current_xact_id()::text)
$$;
CREATE FUNCTION guard_customer_card_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
   IF EXISTS (SELECT 1 FROM crm_customers WHERE id = NEW."customerId" AND "cardDeletedAt" IS NOT NULL)
      OR EXISTS (SELECT 1 FROM crm_customer_retained_history WHERE "customerId" = NEW."customerId") THEN
     RAISE EXCEPTION 'Permanently deleted Customer card cannot be restored';
   END IF; RETURN NEW;
 END IF;
 IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Customer card identity is immutable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM crm_customers WHERE id = OLD."customerId") THEN RETURN OLD; END IF;
 IF NOT customer_card_receipt_valid(OLD."customerId") THEN RAISE EXCEPTION 'Customer card deletion requires current transaction receipt'; END IF;
 IF EXISTS (SELECT 1 FROM crm_customers WHERE id = OLD."customerId") AND NOT EXISTS
    (SELECT 1 FROM crm_customer_retained_history WHERE "customerId" = OLD."customerId"
     AND "receiptId" = current_setting('sabalan.crm_customer_deletion_receipt',true)) THEN
   RAISE EXCEPTION 'Customer card deletion requires immutable retained history';
 END IF; RETURN OLD;
END $$;
CREATE TRIGGER crm_customer_card_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customer_cards FOR EACH ROW EXECUTE FUNCTION guard_customer_card_membership();
CREATE FUNCTION guard_customer_retained_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retained Customer history is immutable'; END IF;
 IF NOT customer_card_receipt_valid(NEW."customerId") OR NEW."receiptId" <> current_setting('sabalan.crm_customer_deletion_receipt',true)
    OR NEW.snapshot->>'id' IS DISTINCT FROM NEW."customerId" THEN
   RAISE EXCEPTION 'Retained Customer history requires current transaction receipt';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER crm_customer_history_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_customer_retained_history FOR EACH ROW EXECUTE FUNCTION guard_customer_retained_history();
CREATE FUNCTION guard_retained_customer_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."cardDeletedAt" IS NOT NULL THEN RAISE EXCEPTION 'Deleted Customer historical identity is immutable'; END IF;
 IF TG_OP = 'UPDATE' AND NEW."cardDeletedAt" IS NOT NULL AND NOT customer_card_receipt_valid(OLD.id) THEN
   RAISE EXCEPTION 'Customer card retirement requires current transaction receipt';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER crm_customer_retained_identity_guard BEFORE UPDATE OR DELETE ON crm_customers FOR EACH ROW EXECUTE FUNCTION guard_retained_customer_identity();
CREATE FUNCTION require_live_customer_card() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE customer_id text;
BEGIN
 customer_id := NEW."customerId";
 IF customer_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND NEW."customerId" IS NOT DISTINCT FROM OLD."customerId" THEN RETURN NEW; END IF;
 -- Parent before membership lock serializes selection against deletion.
 PERFORM 1 FROM crm_customers WHERE id = customer_id FOR KEY SHARE;
 IF NOT EXISTS (SELECT 1 FROM crm_customer_cards WHERE "customerId" = customer_id) THEN
   RAISE EXCEPTION 'Permanently deleted Customer card cannot be selected for new work';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER sales_contract_live_customer BEFORE INSERT OR UPDATE OF "customerId" ON sales_contracts FOR EACH ROW EXECUTE FUNCTION require_live_customer_card();
CREATE TRIGGER partner_case_live_customer BEFORE INSERT OR UPDATE OF "customerId" ON partner_sale_cases FOR EACH ROW EXECUTE FUNCTION require_live_customer_card();
CREATE FUNCTION freeze_retained_customer_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE customer_id text;
BEGIN
 IF TG_OP = 'DELETE' THEN customer_id := OLD."customerId"; ELSE customer_id := NEW."customerId"; END IF;
 IF EXISTS (SELECT 1 FROM crm_customers WHERE id = customer_id AND "cardDeletedAt" IS NOT NULL) THEN
   RAISE EXCEPTION 'Deleted Customer historical card data is immutable';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER retained_phone_guard BEFORE INSERT OR UPDATE OR DELETE ON phone_numbers FOR EACH ROW EXECUTE FUNCTION freeze_retained_customer_children();
CREATE TRIGGER retained_contact_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_contacts FOR EACH ROW EXECUTE FUNCTION freeze_retained_customer_children();
CREATE TRIGGER retained_address_guard BEFORE INSERT OR UPDATE OR DELETE ON project_addresses FOR EACH ROW EXECUTE FUNCTION freeze_retained_customer_children();

COMMIT;
