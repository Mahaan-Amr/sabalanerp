-- NULL preserves the unknown activity of existing customers. NONE is an explicit choice.
ALTER TABLE "crm_customers" ADD COLUMN "activityCategory" TEXT;
ALTER TABLE "crm_customers" ADD CONSTRAINT "crm_customers_activity_category_check"
  CHECK ("activityCategory" IN ('BUILDER', 'ARCHITECT', 'NONE'));
