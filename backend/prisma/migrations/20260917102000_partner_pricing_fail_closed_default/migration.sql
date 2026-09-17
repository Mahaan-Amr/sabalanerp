ALTER TABLE "partner_sale_cases"
  ALTER COLUMN "pricingState" SET DEFAULT 'INCOMPLETE';
ALTER TABLE "partner_case_revisions"
  ALTER COLUMN "pricingState" SET DEFAULT 'INCOMPLETE';
ALTER TABLE "sabalan_to_partner_sale_records"
  ALTER COLUMN "pricingState" SET DEFAULT 'INCOMPLETE';
