CREATE TYPE "PartnerPricingState" AS ENUM ('INCOMPLETE', 'AWAITING_INQUIRY', 'READY_TO_FINALIZE', 'EXPIRED');
CREATE TYPE "PartnerCustomerConfirmationState" AS ENUM ('NOT_SENT', 'SENT', 'APPROVED', 'REJECTED', 'RECONFIRMATION_REQUIRED');

ALTER TABLE "partner_sale_cases"
  ADD COLUMN "pricingState" "PartnerPricingState" NOT NULL DEFAULT 'AWAITING_INQUIRY',
  ADD COLUMN "customerConfirmationState" "PartnerCustomerConfirmationState" NOT NULL DEFAULT 'NOT_SENT';

ALTER TABLE "sabalan_to_partner_sale_records"
  ADD COLUMN "pricingState" "PartnerPricingState" NOT NULL DEFAULT 'AWAITING_INQUIRY';

ALTER TABLE "partner_case_revisions"
  ADD COLUMN "pricingState" "PartnerPricingState" NOT NULL DEFAULT 'AWAITING_INQUIRY';

UPDATE "partner_sale_cases" SET "pricingState" = 'READY_TO_FINALIZE';
UPDATE "sabalan_to_partner_sale_records" SET "pricingState" = 'READY_TO_FINALIZE';
UPDATE "partner_case_revisions" SET "pricingState" = 'READY_TO_FINALIZE';
