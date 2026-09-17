ALTER TABLE "partner_sale_cases"
  ALTER COLUMN "pricingState" SET DEFAULT 'READY_TO_FINALIZE';
ALTER TABLE "sabalan_to_partner_sale_records"
  ALTER COLUMN "pricingState" SET DEFAULT 'READY_TO_FINALIZE';
ALTER TABLE "partner_case_revisions"
  ALTER COLUMN "pricingState" SET DEFAULT 'READY_TO_FINALIZE';
