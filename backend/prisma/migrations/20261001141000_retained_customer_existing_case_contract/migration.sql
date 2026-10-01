CREATE OR REPLACE FUNCTION require_live_customer_card() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE customer_id text;
BEGIN
 customer_id := NEW."customerId";
 IF customer_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND NEW."customerId" IS NOT DISTINCT FROM OLD."customerId" THEN RETURN NEW; END IF;
 -- Parent before membership lock serializes selection against deletion.
 PERFORM 1 FROM crm_customers WHERE id = customer_id FOR KEY SHARE;
 IF TG_TABLE_NAME = 'sales_contracts' AND EXISTS (SELECT 1 FROM partner_sale_cases
    WHERE id = to_jsonb(NEW)->>'partnerCaseId' AND "customerId" = customer_id) THEN RETURN NEW; END IF;
 IF NOT EXISTS (SELECT 1 FROM crm_customer_cards WHERE "customerId" = customer_id) THEN
   RAISE EXCEPTION 'Permanently deleted Customer card cannot be selected for new work';
 END IF; RETURN NEW;
END $$;
