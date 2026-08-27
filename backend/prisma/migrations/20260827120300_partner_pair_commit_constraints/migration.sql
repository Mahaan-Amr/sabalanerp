-- Commit-time exact pair, not a service-ordering convention. No legacy row mutation.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conrelid::regclass AS relation, conname FROM pg_constraint
    WHERE contype = 'f' AND (conrelid::regclass::text LIKE 'partner_%'
      OR conrelid = 'sabalan_to_partner_sale_records'::regclass
      OR (conrelid = 'sales_contracts'::regclass AND conname LIKE '%partnerCaseId%')) LOOP
    EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY DEFERRED', c.relation, c.conname);
  END LOOP;
END $$;

ALTER TABLE partner_sale_cases ADD CONSTRAINT partner_case_shape CHECK
  ("headRevision" > 0 AND "stateRevision" > 0 AND "internalRecordId" <> "customerContractId"
   AND "integrityHash" ~ '^sha256-v1:[a-f0-9]{64}$'
   AND ((state IN ('COMMITTED','VOIDED') AND "committedAt" IS NOT NULL AND "commitmentTrigger" IS NOT NULL
     AND "commitmentTrigger" IN ('SIGNED','PRINTED') AND "committedRevision" IS NOT NULL
     AND "committedRevision" > 0 AND "committedRevision" <= "headRevision" AND "commitmentEventId" IS NOT NULL)
   OR (state NOT IN ('COMMITTED','VOIDED') AND "committedAt" IS NULL AND "commitmentTrigger" IS NULL
     AND "committedRevision" IS NULL AND "commitmentEventId" IS NULL)));
ALTER TABLE sabalan_to_partner_sale_records ADD CONSTRAINT partner_internal_kind CHECK
  (kind = 'SABALAN_TO_PARTNER' AND "expectedRevision" > 0 AND "integrityHash" ~ '^sha256-v1:[a-f0-9]{64}$');
ALTER TABLE partner_case_revisions ADD CONSTRAINT partner_revision_shape CHECK
  (revision > 0 AND "schemaVersion" = 1 AND "integrityHash" ~ '^sha256-v1:[a-f0-9]{64}$'
   AND "graphHash" ~ '^sha256-v1:[a-f0-9]{64}$'
   AND ((revision = 1 AND "predecessorRevision" IS NULL) OR (revision > 1 AND "predecessorRevision" = revision - 1)));
ALTER TABLE partner_case_revisions ADD CONSTRAINT partner_revision_predecessor FOREIGN KEY ("caseId","predecessorRevision")
  REFERENCES partner_case_revisions ("caseId",revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE partner_case_row_bindings ADD CONSTRAINT partner_row_quantity CHECK
  (quantity > 0 AND length(trim(unit)) > 0 AND length(trim("precisionPolicyVersion")) > 0
   AND "configurationHash" ~ '^sha256-v1:[a-f0-9]{64}$');
ALTER TABLE partner_case_delivery_items ADD CONSTRAINT partner_delivery_quantity CHECK (quantity > 0);
ALTER TABLE partner_commercial_numbers ADD CONSTRAINT partner_number_purpose CHECK (purpose IN ('CASE','INTERNAL','CUSTOMER'));

CREATE FUNCTION partner_reserve_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'partner_sale_cases' THEN
    INSERT INTO partner_commercial_numbers VALUES (NEW."caseNumber", NEW.id, 'CASE');
  ELSIF TG_TABLE_NAME = 'sabalan_to_partner_sale_records' THEN
    INSERT INTO partner_commercial_numbers VALUES (NEW."recordNumber", NEW."caseId", 'INTERNAL');
  ELSIF NEW."partnerCaseId" IS NOT NULL THEN
    INSERT INTO partner_commercial_numbers VALUES (NEW."contractNumber", NEW."partnerCaseId", 'CUSTOMER');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_number BEFORE INSERT ON partner_sale_cases FOR EACH ROW EXECUTE FUNCTION partner_reserve_number();
CREATE TRIGGER partner_number BEFORE INSERT ON sabalan_to_partner_sale_records FOR EACH ROW EXECUTE FUNCTION partner_reserve_number();
CREATE TRIGGER partner_number BEFORE INSERT ON sales_contracts FOR EACH ROW EXECUTE FUNCTION partner_reserve_number();

CREATE FUNCTION partner_check_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_id text; c partner_sale_cases; i sabalan_to_partner_sale_records; s sales_contracts; r partner_case_revisions; seller_id text;
BEGIN
  IF TG_TABLE_NAME = 'sales_contracts' THEN case_id := NEW."partnerCaseId";
  ELSIF TG_TABLE_NAME = 'partner_sale_cases' THEN case_id := NEW.id;
  ELSE case_id := NEW."caseId"; END IF;
  IF case_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM partner_sale_cases WHERE id = case_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner record has no Case'; END IF;
  SELECT * INTO i FROM sabalan_to_partner_sale_records WHERE id = c."internalRecordId";
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner internal record is missing'; END IF;
  SELECT * INTO s FROM sales_contracts WHERE id = c."customerContractId";
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner customer contract is missing'; END IF;
  SELECT * INTO r FROM partner_case_revisions WHERE "caseId" = c.id AND revision = c."headRevision";
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner head revision is missing'; END IF;
  SELECT "userId" INTO seller_id FROM partner_profiles WHERE id = c."profileId";
  IF i."caseId" IS DISTINCT FROM c.id OR s."partnerCaseId" IS DISTINCT FROM c.id OR s."partnerKind" IS DISTINCT FROM 'PARTNER_CUSTOMER'
    OR i.kind <> 'SABALAN_TO_PARTNER' OR i."expectedRevision" <> c."headRevision" OR s."partnerRevision" IS DISTINCT FROM c."headRevision"
    OR i."integrityHash" <> c."integrityHash" OR s."partnerIntegrityHash" IS DISTINCT FROM c."integrityHash" OR r."integrityHash" <> c."integrityHash"
    OR s."createdBy" IS DISTINCT FROM seller_id OR s."responsibleSellerId" IS DISTINCT FROM seller_id
    OR (s."realizedSellerId" IS NOT NULL AND s."realizedSellerId" <> seller_id) OR s."customerId" <> c."customerId"
    OR NOT EXISTS (SELECT 1 FROM partner_commercial_accounts a WHERE a.id = i."commercialAccountId" AND a."profileId" = c."profileId")
    OR NOT EXISTS (SELECT 1 FROM partner_case_row_bindings b WHERE b."caseId" = c.id AND b.revision = c."headRevision")
    OR (SELECT count(*) FROM partner_commercial_numbers n WHERE n."caseId" = c.id) <> 3 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner exact pair or revision binding disagrees';
  END IF;
  IF (c.state = 'DRAFT' AND s.status <> 'DRAFT')
    OR (c.state = 'AWAITING_CUSTOMER_CONFIRMATION' AND s.status <> 'PENDING_APPROVAL')
    OR (c.state = 'CUSTOMER_APPROVED' AND s.status <> 'APPROVED')
    OR (c.state = 'COMMITTED' AND s.status NOT IN ('SIGNED','PRINTED'))
    OR (c.state IN ('CANCELLED','VOIDED') AND s.status <> 'CANCELLED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer status must project Case state';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER partner_exact_pair AFTER INSERT OR UPDATE ON partner_sale_cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_check_pair();
CREATE CONSTRAINT TRIGGER partner_exact_pair AFTER INSERT OR UPDATE ON sabalan_to_partner_sale_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_check_pair();
CREATE CONSTRAINT TRIGGER partner_exact_pair AFTER INSERT OR UPDATE ON sales_contracts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_check_pair();

CREATE FUNCTION partner_customer_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."partnerCaseId" IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner customer contract is retained'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."partnerCaseId" IS DISTINCT FROM NEW."partnerCaseId" OR OLD."partnerKind" IS DISTINCT FROM NEW."partnerKind" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Historical contracts cannot be converted or relinked';
  END IF;
  IF OLD."partnerCaseId" IS NOT NULL AND (OLD.id <> NEW.id OR OLD."contractNumber" <> NEW."contractNumber"
    OR OLD."createdBy" <> NEW."createdBy" OR OLD."responsibleSellerId" <> NEW."responsibleSellerId") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner customer identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_customer_identity BEFORE UPDATE OR DELETE ON sales_contracts FOR EACH ROW EXECUTE FUNCTION partner_customer_identity();
CREATE TRIGGER partner_case_identity BEFORE UPDATE OR DELETE ON partner_sale_cases FOR EACH ROW
  EXECUTE FUNCTION partner_protect_identity('id','caseNumber','profileId','internalRecordId','customerContractId','createdAt');
CREATE TRIGGER partner_internal_identity BEFORE UPDATE OR DELETE ON sabalan_to_partner_sale_records FOR EACH ROW
  EXECUTE FUNCTION partner_protect_identity('id','recordNumber','caseId','commercialAccountId','kind');

CREATE FUNCTION partner_case_cas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'DRAFT' OR NEW."headRevision" <> 1 OR NEW."stateRevision" <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner Case starts with its first Draft revision';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."stateRevision" <> OLD."stateRevision" + 1 OR NEW."headRevision" NOT IN (OLD."headRevision", OLD."headRevision" + 1)
    OR (NEW."headRevision" = OLD."headRevision" AND (NEW."integrityHash" <> OLD."integrityHash" OR NEW."customerId" <> OLD."customerId"))
    OR (OLD."committedAt" IS NOT NULL AND (NEW."committedAt" IS DISTINCT FROM OLD."committedAt"
      OR NEW."commitmentTrigger" IS DISTINCT FROM OLD."commitmentTrigger" OR NEW."commitmentEventId" IS DISTINCT FROM OLD."commitmentEventId"
      OR NEW."committedRevision" IS DISTINCT FROM OLD."committedRevision"))
    OR (NEW.state <> OLD.state AND NOT ((OLD.state = 'DRAFT' AND NEW.state IN ('AWAITING_CUSTOMER_CONFIRMATION','CANCELLED'))
      OR (OLD.state = 'AWAITING_CUSTOMER_CONFIRMATION' AND NEW.state IN ('CUSTOMER_APPROVED','CANCELLED'))
      OR (OLD.state = 'CUSTOMER_APPROVED' AND NEW.state IN ('COMMITTED','CANCELLED'))
      OR (OLD.state = 'COMMITTED' AND NEW.state = 'VOIDED')))
    OR OLD.state IN ('CANCELLED','VOIDED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner Case mutation is stale or regresses retained lifecycle evidence';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_case_cas BEFORE INSERT OR UPDATE ON partner_sale_cases FOR EACH ROW EXECUTE FUNCTION partner_case_cas();

CREATE FUNCTION partner_reject_duplicate_graph() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM sales_contracts WHERE id = NEW."contractId" AND "partnerCaseId" IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner items, deliveries and payment plans belong to the Case revision';
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['contract_items','deliveries','payments','sales_contract_product_graph_states'] LOOP
    EXECUTE format('CREATE TRIGGER partner_case_owns_graph BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION partner_reject_duplicate_graph()', name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['partner_commercial_numbers','partner_case_revisions','partner_product_rows',
    'partner_case_row_bindings','partner_inquiry_usages','partner_case_deliveries','partner_case_delivery_items'] LOOP
    EXECUTE format('CREATE TRIGGER partner_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION partner_reject_evidence_mutation()', name);
    EXECUTE format('CREATE TRIGGER partner_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION partner_reject_evidence_mutation()', name);
  END LOOP;
END $$;
DROP TRIGGER partner_schema_barrier ON partner_sale_cases;
DROP TRIGGER partner_schema_barrier ON sabalan_to_partner_sale_records;
DROP FUNCTION partner_schema_not_ready();
COMMIT;
