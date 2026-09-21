-- Finalization may attach only the previously absent accounting, fulfillment,
-- and customer projections. The already-hashed Partner projection is immutable.
CREATE OR REPLACE FUNCTION partner_finalize_revision_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner evidence is append-only';
  END IF;
  IF (OLD."customerProjection" IS NOT NULL AND OLD."customerProjection" <> 'null'::jsonb)
    OR NEW."customerProjection" IS NULL OR NEW."customerProjection" = 'null'::jsonb
    OR OLD."internalProjection" ? 'accounting' OR OLD."internalProjection" ? 'fulfillment'
    OR NOT (NEW."internalProjection" ? 'partner' AND NEW."internalProjection" ? 'accounting'
      AND NEW."internalProjection" ? 'fulfillment')
    OR NEW."internalProjection"->'partner' IS DISTINCT FROM OLD."internalProjection"->'partner'
    OR (to_jsonb(OLD) - 'internalProjection' - 'customerProjection')
      IS DISTINCT FROM (to_jsonb(NEW) - 'internalProjection' - 'customerProjection')
    OR NOT EXISTS (SELECT 1 FROM partner_sale_cases c WHERE c.id = OLD."caseId"
      AND c."headRevision" = OLD.revision AND c."integrityHash" = OLD."integrityHash"
      AND c."internalRecordId" IS NOT NULL AND c."customerContractId" IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner revision projection can only be finalized once';
  END IF;
  RETURN NEW;
END $$;
