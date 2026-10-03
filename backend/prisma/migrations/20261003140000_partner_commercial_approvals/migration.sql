ALTER TABLE partner_sale_cases ADD COLUMN "commercialFlowVersion" INTEGER NOT NULL DEFAULT 0;

-- Allow catalog-backed independent service contracts without fake stone bindings.
CREATE OR REPLACE FUNCTION partner_check_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE case_id text; c partner_sale_cases; i sabalan_to_partner_sale_records; s sales_contracts;
  r partner_case_revisions; seller_id text; number_count integer;
  service_row jsonb; wholesale_service jsonb; service_ids text[]; wholesale_ids text[];
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
    -- Independent services have no stone graph identity or inquiry binding.
    -- This exception accepts only complete, matching frozen service economics;
    -- all ordinary stone and exact linked-pair guards remain unchanged.
    IF r.graph->'rows' IS DISTINCT FROM '[]'::jsonb
      OR jsonb_typeof(r."retailEnvelope"->'products') IS DISTINCT FROM 'array'
      OR jsonb_typeof(r."wholesaleEnvelope"->'products') IS DISTINCT FROM 'array'
      OR r."wholesaleEnvelope"->>'status' IS DISTINCT FROM 'PRICED' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner head revision has no row binding';
    END IF;
    SELECT array_agg(x->>'productRowId' ORDER BY x->>'productRowId') INTO service_ids
      FROM jsonb_array_elements(r."retailEnvelope"->'products') x;
    SELECT array_agg(x->>'productRowId' ORDER BY x->>'productRowId') INTO wholesale_ids
      FROM jsonb_array_elements(r."wholesaleEnvelope"->'products') x;
    IF cardinality(service_ids) IS NULL OR cardinality(service_ids) = 0
      OR service_ids IS DISTINCT FROM wholesale_ids
      OR cardinality(service_ids) <> (SELECT count(DISTINCT x) FROM unnest(service_ids) x) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner service rows must match unique frozen economics';
    END IF;
    FOR service_row IN SELECT * FROM jsonb_array_elements(r."retailEnvelope"->'products') LOOP
      SELECT x INTO wholesale_service FROM jsonb_array_elements(r."wholesaleEnvelope"->'products') x
        WHERE x->>'productRowId' = service_row->>'productRowId';
      IF service_row->>'productType' IS DISTINCT FROM 'service'
        OR wholesale_service->>'productType' IS DISTINCT FROM 'service'
        OR coalesce(service_row->>'productRowId', '') = ''
        OR service_row->>'quantity' IS DISTINCT FROM wholesale_service->>'quantity'
        OR service_row->>'unit' IS DISTINCT FROM wholesale_service->>'unit'
        OR coalesce(service_row->>'unit', '') NOT IN ('meter', 'squareMeter', 'count')
        OR coalesce(service_row->>'quantity', '') !~ '^[0-9]+(\.[0-9]+)?$'
        OR coalesce(service_row->>'retailUnitPrice', '') !~ '^[0-9]+(\.[0-9]+)?$'
        OR coalesce(wholesale_service->>'wholesaleUnitPrice', '') !~ '^[0-9]+(\.[0-9]+)?$'
        OR coalesce(wholesale_service->>'configurationHash', '') !~ '^sha256-v1:[0-9a-f]{64}$'
        OR wholesale_service ? 'approvalEvidenceId' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner service economics require valid catalog rate evidence';
      END IF;
      IF (service_row->>'quantity')::numeric <= 0 OR (service_row->>'retailUnitPrice')::numeric <= 0
        OR (wholesale_service->>'wholesaleUnitPrice')::numeric < 0 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner service quantity and retail price must be positive';
      END IF;
    END LOOP;
  END IF;
  SELECT count(*) INTO number_count FROM partner_commercial_numbers n WHERE n."caseId" = c.id;

  IF c."internalRecordId" IS NULL AND c."customerContractId" IS NULL THEN
    IF c.state NOT IN ('DRAFT', 'CANCELLED') OR number_count <> 1 THEN
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
  IF c."commercialFlowVersion" = 1 THEN
    IF s."commercialFlowVersion" <> 2 OR s."commercialRevision" < 1
      OR (s.status = 'SIGNED' AND (c.state <> 'COMMITTED'
        OR s."salesApprovalRevision" IS DISTINCT FROM s."commercialRevision"
        OR s."customerAcceptanceRevision" IS DISTINCT FROM s."commercialRevision"
        OR c."pricingState" <> 'READY_TO_FINALIZE'))
      OR (c.state IN ('CANCELLED','VOIDED') AND s.status <> 'CANCELLED') THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner commercial approvals must match current version and pricing';
    END IF;
    RETURN NULL;
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

CREATE OR REPLACE FUNCTION partner_finalize_revision_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner evidence is append-only';
  END IF;
  IF (OLD."customerProjection" IS NOT NULL AND OLD."customerProjection" <> 'null'::jsonb)
    OR NEW."customerProjection" IS NULL OR NEW."customerProjection" = 'null'::jsonb
    OR OLD."internalProjection" ? 'accounting' OR OLD."internalProjection" ? 'fulfillment'
    OR NOT (NEW."internalProjection" ? 'partner' AND (
      (NEW."internalProjection" ? 'accounting' AND NEW."internalProjection" ? 'fulfillment')
      OR EXISTS (SELECT 1 FROM partner_sale_cases c WHERE c.id = OLD."caseId" AND c."commercialFlowVersion" = 1)))
    OR (to_jsonb(OLD) - 'internalProjection' - 'customerProjection')
      IS DISTINCT FROM (to_jsonb(NEW) - 'internalProjection' - 'customerProjection')
    OR NOT EXISTS (SELECT 1 FROM partner_sale_cases c WHERE c.id = OLD."caseId"
      AND c."headRevision" = OLD.revision AND c."integrityHash" = OLD."integrityHash"
      AND c."internalRecordId" IS NOT NULL AND c."customerContractId" IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner revision projection can only be finalized once';
  END IF;
  RETURN NEW;
END $$;
