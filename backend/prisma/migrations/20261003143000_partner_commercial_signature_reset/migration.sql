CREATE OR REPLACE FUNCTION partner_customer_commercial_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."partnerCaseId" IS NULL THEN RETURN NEW; END IF;
  IF ROW(OLD.title,OLD."titlePersian",OLD.content,OLD."customerId",OLD."totalAmount",OLD.currency,OLD.notes,
      OLD."contractData",OLD.calculations) IS DISTINCT FROM
     ROW(NEW.title,NEW."titlePersian",NEW.content,NEW."customerId",NEW."totalAmount",NEW.currency,NEW.notes,
      NEW."contractData",NEW.calculations) AND NEW."partnerRevision" <> OLD."partnerRevision" + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Customer commercial changes require a coherent Case successor';
  END IF;
  IF (OLD."printedAt" IS NOT NULL AND NEW."printedAt" IS DISTINCT FROM OLD."printedAt")
    OR (OLD."signedAt" IS NOT NULL AND NEW."signedAt" IS DISTINCT FROM OLD."signedAt"
      AND NOT (NEW."commercialFlowVersion" = 2 AND NEW."commercialRevision" = OLD."commercialRevision" + 1
        AND NEW."salesApprovalRevision" IS NULL AND NEW."customerAcceptanceRevision" IS NULL
        AND NEW."signedAt" IS NULL AND NEW.status = 'DRAFT'))
    OR (OLD.status = 'PRINTED' AND NEW.status NOT IN ('PRINTED','CANCELLED')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner signature and print facts cannot regress';
  END IF;
  RETURN NEW;
END $$;
