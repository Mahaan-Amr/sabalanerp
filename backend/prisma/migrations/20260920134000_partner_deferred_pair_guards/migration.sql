-- A numbered Partner Case is intentionally allowed to exist before the two
-- linked commercial records. The pair is attached exactly once, in the same
-- transaction that performs explicit Partner finalization.

DROP TRIGGER partner_case_identity ON partner_sale_cases;
CREATE TRIGGER partner_case_identity BEFORE UPDATE OR DELETE ON partner_sale_cases FOR EACH ROW
  EXECUTE FUNCTION partner_protect_identity('id','caseNumber','profileId','createdAt');

CREATE OR REPLACE FUNCTION partner_case_link_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."internalRecordId" IS NULL) <> (OLD."customerContractId" IS NULL)
    OR (NEW."internalRecordId" IS NULL) <> (NEW."customerContractId" IS NULL)
    OR (OLD."internalRecordId" IS NOT NULL AND
      (NEW."internalRecordId" IS DISTINCT FROM OLD."internalRecordId"
        OR NEW."customerContractId" IS DISTINCT FROM OLD."customerContractId"))
    OR (OLD."internalRecordId" IS NULL AND NEW."internalRecordId" IS NULL AND
      NEW."customerContractId" IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner linked pair can only be allocated together once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_case_link_once BEFORE UPDATE ON partner_sale_cases FOR EACH ROW
  EXECUTE FUNCTION partner_case_link_once();

CREATE OR REPLACE FUNCTION partner_check_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_id text; c partner_sale_cases; i sabalan_to_partner_sale_records; s sales_contracts;
  r partner_case_revisions; seller_id text; number_count integer;
BEGIN
  IF TG_TABLE_NAME = 'sales_contracts' THEN case_id := NEW."partnerCaseId";
  ELSIF TG_TABLE_NAME = 'partner_sale_cases' THEN case_id := NEW.id;
  ELSE case_id := NEW."caseId"; END IF;
  IF case_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM partner_sale_cases WHERE id = case_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner record has no Case'; END IF;
  SELECT * INTO r FROM partner_case_revisions WHERE "caseId" = c.id AND revision = c."headRevision";
  IF NOT FOUND OR r."integrityHash" <> c."integrityHash" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner head revision is missing or disagrees';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM partner_case_row_bindings b WHERE b."caseId" = c.id AND b.revision = c."headRevision") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner head revision has no row binding';
  END IF;
  SELECT count(*) INTO number_count FROM partner_commercial_numbers n WHERE n."caseId" = c.id;

  IF c."internalRecordId" IS NULL AND c."customerContractId" IS NULL THEN
    IF c.state <> 'DRAFT' OR number_count <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Unfinalized Partner Case must retain only its Case number';
    END IF;
    RETURN NULL;
  END IF;
  IF c."internalRecordId" IS NULL OR c."customerContractId" IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner linked pair is incomplete';
  END IF;

  SELECT * INTO i FROM sabalan_to_partner_sale_records WHERE id = c."internalRecordId";
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner internal record is missing'; END IF;
  SELECT * INTO s FROM sales_contracts WHERE id = c."customerContractId";
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner customer contract is missing'; END IF;
  SELECT "userId" INTO seller_id FROM partner_profiles WHERE id = c."profileId";
  IF i."caseId" IS DISTINCT FROM c.id OR s."partnerCaseId" IS DISTINCT FROM c.id OR s."partnerKind" IS DISTINCT FROM 'PARTNER_CUSTOMER'
    OR i.kind <> 'SABALAN_TO_PARTNER' OR i."expectedRevision" <> c."headRevision" OR s."partnerRevision" IS DISTINCT FROM c."headRevision"
    OR i."integrityHash" <> c."integrityHash" OR s."partnerIntegrityHash" IS DISTINCT FROM c."integrityHash"
    OR s."createdBy" IS DISTINCT FROM seller_id OR s."responsibleSellerId" IS DISTINCT FROM seller_id
    OR (s."realizedSellerId" IS NOT NULL AND s."realizedSellerId" <> seller_id) OR s."customerId" <> c."customerId"
    OR NOT EXISTS (SELECT 1 FROM partner_commercial_accounts a WHERE a.id = i."commercialAccountId" AND a."profileId" = c."profileId")
    OR number_count <> 3 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner exact pair or revision binding disagrees';
  END IF;
  IF (c.state = 'DRAFT' AND s.status <> 'DRAFT')
    OR (c.state = 'AWAITING_CUSTOMER_CONFIRMATION' AND s.status <> 'PENDING_APPROVAL')
    OR (c.state = 'CUSTOMER_APPROVED' AND s.status <> 'APPROVED')
    OR (c.state = 'COMMITTED' AND s.status NOT IN ('DRAFT','PENDING_APPROVAL','APPROVED','SIGNED','PRINTED'))
    OR (c.state IN ('CANCELLED','VOIDED') AND s.status <> 'CANCELLED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer status must project Case state';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION partner_case_cas() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR (NEW.state <> OLD.state AND NOT ((OLD.state = 'DRAFT' AND NEW.state IN ('AWAITING_CUSTOMER_CONFIRMATION','COMMITTED','CANCELLED'))
      OR (OLD.state = 'AWAITING_CUSTOMER_CONFIRMATION' AND NEW.state IN ('CUSTOMER_APPROVED','CANCELLED'))
      OR (OLD.state = 'CUSTOMER_APPROVED' AND NEW.state IN ('COMMITTED','CANCELLED'))
      OR (OLD.state = 'COMMITTED' AND NEW.state = 'VOIDED')))
    OR OLD.state IN ('CANCELLED','VOIDED') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner Case mutation is stale or regresses retained lifecycle evidence';
  END IF;
  RETURN NEW;
END $$;
