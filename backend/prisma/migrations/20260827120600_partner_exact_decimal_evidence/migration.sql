-- Scale is owned by versioned commercial evidence, never an implicit NUMERIC typmod.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- AlterTable
ALTER TABLE "partner_inquiry_approvals" ALTER COLUMN "wholesaleUnitPrice" SET DATA TYPE DECIMAL;

-- AlterTable
ALTER TABLE "partner_case_row_bindings" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL;

-- AlterTable
ALTER TABLE "partner_case_delivery_items" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL;

-- AlterTable
ALTER TABLE "partner_payment_installments" ALTER COLUMN "amount" SET DATA TYPE DECIMAL;

-- AlterTable
ALTER TABLE "partner_retail_receipts" ALTER COLUMN "amount" SET DATA TYPE DECIMAL;

-- AlterTable
ALTER TABLE "partner_retail_receipt_allocations" ALTER COLUMN "amount" SET DATA TYPE DECIMAL;

-- AlterTable
ALTER TABLE "partner_financial_adjustments" ALTER COLUMN "delta" SET DATA TYPE DECIMAL;

CREATE OR REPLACE FUNCTION partner_check_approval_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_id text; state "PartnerInquiryOutcome"; has_approval boolean;
BEGIN
  IF TG_TABLE_NAME = 'partner_inquiry_rows' THEN row_id := NEW.id;
  ELSE row_id := NEW."rowId"; END IF;
  SELECT outcome INTO state FROM partner_inquiry_rows WHERE id = row_id;
  SELECT EXISTS (SELECT 1 FROM partner_inquiry_approvals WHERE "rowId" = row_id) INTO has_approval;
  IF (state = 'APPROVED') IS DISTINCT FROM has_approval THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Inquiry decision and immutable approval must agree';
  END IF;
  RETURN NULL;
END $$;
COMMIT;
