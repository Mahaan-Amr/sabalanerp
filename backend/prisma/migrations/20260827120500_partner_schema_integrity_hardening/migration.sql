BEGIN;
SET LOCAL lock_timeout = '5s';
-- AlterTable
ALTER TABLE "partner_case_revisions" ADD COLUMN     "assemblyTransaction" BIGINT NOT NULL DEFAULT txid_current();

-- Top-level transaction identity survives savepoints; xmin does not.
CREATE FUNCTION partner_stamp_revision_assembly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW."assemblyTransaction" := txid_current(); RETURN NEW; END $$;
CREATE TRIGGER partner_revision_transaction BEFORE INSERT ON partner_case_revisions FOR EACH ROW EXECUTE FUNCTION partner_stamp_revision_assembly();
CREATE OR REPLACE FUNCTION partner_revision_assembly_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rev integer;
BEGIN
  rev := (to_jsonb(NEW)->>'revision')::integer;
  IF rev IS NULL THEN rev := (to_jsonb(NEW)->>'caseRevision')::integer; END IF;
  IF NOT EXISTS (SELECT 1 FROM partner_case_revisions r WHERE r."caseId" = NEW."caseId" AND r.revision = rev
    AND r."assemblyTransaction" = txid_current()) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Revision-owned evidence must be assembled atomically';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION partner_customer_commercial_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."partnerCaseId" IS NULL THEN RETURN NEW; END IF;
  IF ROW(OLD.title,OLD."titlePersian",OLD.content,OLD."customerId",OLD."totalAmount",OLD.currency,OLD.notes,
      OLD."contractData",OLD.calculations) IS DISTINCT FROM
     ROW(NEW.title,NEW."titlePersian",NEW.content,NEW."customerId",NEW."totalAmount",NEW.currency,NEW.notes,
      NEW."contractData",NEW.calculations) AND NEW."partnerRevision" <> OLD."partnerRevision" + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer commercial changes require a coherent Case successor';
  END IF;
  IF (OLD."printedAt" IS NOT NULL AND NEW."printedAt" IS DISTINCT FROM OLD."printedAt")
    OR (OLD."signedAt" IS NOT NULL AND NEW."signedAt" IS DISTINCT FROM OLD."signedAt")
    OR (OLD.status = 'PRINTED' AND NEW.status NOT IN ('PRINTED','CANCELLED')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner signature and print facts cannot regress';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_customer_revision BEFORE UPDATE ON sales_contracts FOR EACH ROW EXECUTE FUNCTION partner_customer_commercial_revision();

CREATE FUNCTION partner_check_inquiry_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."predecessorId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM partner_inquiry_rows p
    JOIN partner_inquiries pi ON pi.id = p."inquiryId" JOIN partner_inquiries ni ON ni.id = NEW."inquiryId"
    WHERE p.id = NEW."predecessorId" AND pi."profileId" = ni."profileId" AND NEW.version = p.version + 1) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Inquiry successor must preserve its Partner lineage';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_inquiry_lineage BEFORE INSERT ON partner_inquiry_rows FOR EACH ROW EXECUTE FUNCTION partner_check_inquiry_lineage();

CREATE FUNCTION partner_check_approval_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_id text; state "PartnerInquiryOutcome"; has_approval boolean;
BEGIN
  row_id := CASE WHEN TG_TABLE_NAME = 'partner_inquiry_rows' THEN NEW.id ELSE NEW."rowId" END;
  SELECT outcome INTO state FROM partner_inquiry_rows WHERE id = row_id;
  SELECT EXISTS (SELECT 1 FROM partner_inquiry_approvals WHERE "rowId" = row_id) INTO has_approval;
  IF (state = 'APPROVED') IS DISTINCT FROM has_approval THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Inquiry decision and immutable approval must agree';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER partner_approval_decision AFTER INSERT OR UPDATE ON partner_inquiry_rows DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_check_approval_decision();
CREATE CONSTRAINT TRIGGER partner_approval_decision AFTER INSERT ON partner_inquiry_approvals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partner_check_approval_decision();

CREATE FUNCTION partner_check_adjustment_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM partner_case_events e JOIN partner_correction_opportunities c ON c.id = NEW."correctionId"
    WHERE e.id = NEW."originalRealizationEventId" AND e.type = 'CASE_COMMITTED' AND e."caseId" = NEW."caseId" AND c."caseId" = NEW."caseId"
    AND c.scope <> 'RETAIL_ONLY') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Sabalan adjustment must retain its original Case realization and financial correction';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_adjustment_owner BEFORE INSERT ON partner_financial_adjustments FOR EACH ROW EXECUTE FUNCTION partner_check_adjustment_owner();

CREATE FUNCTION partner_check_output_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM partner_sale_cases c JOIN sales_contracts s ON s.id = c."customerContractId"
    WHERE c.id = NEW."caseId" AND s."contractNumber" = NEW."contractNumber") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer output must retain its public contract number';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_output_number BEFORE INSERT ON partner_customer_output_snapshots FOR EACH ROW EXECUTE FUNCTION partner_check_output_number();

-- Retained roots cannot be truncated, even while empty of dependent evidence.
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['partner_profiles','partner_commercial_accounts','partner_release_cohorts',
    'partner_inquiries','partner_inquiry_rows','partner_sale_cases','sabalan_to_partner_sale_records'] LOOP
    EXECUTE format('CREATE TRIGGER partner_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION partner_reject_evidence_mutation()', name);
  END LOOP;
END $$;
COMMIT;
