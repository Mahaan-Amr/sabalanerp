CREATE OR REPLACE FUNCTION freeze_retained_customer_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE customer_id text;
BEGIN
 IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM crm_customers WHERE id = OLD."customerId" AND "cardDeletedAt" IS NOT NULL) THEN
   RAISE EXCEPTION 'Deleted Customer historical card data is immutable';
 END IF;
 IF TG_OP = 'DELETE' THEN customer_id := OLD."customerId"; ELSE customer_id := NEW."customerId"; END IF;
 IF EXISTS (SELECT 1 FROM crm_customers WHERE id = customer_id AND "cardDeletedAt" IS NOT NULL) THEN
   RAISE EXCEPTION 'Deleted Customer historical card data is immutable';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
