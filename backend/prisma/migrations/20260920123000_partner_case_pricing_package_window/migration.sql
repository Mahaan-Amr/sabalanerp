ALTER TABLE "partner_inquiries"
  ADD COLUMN "pricingReadyAt" TIMESTAMPTZ(3),
  ADD COLUMN "pricingExpiresAt" TIMESTAMPTZ(3);

ALTER TABLE "partner_inquiries"
  ADD CONSTRAINT "partner_inquiries_pricing_window_check"
  CHECK (
    ("pricingReadyAt" IS NULL AND "pricingExpiresAt" IS NULL)
    OR
    ("pricingReadyAt" IS NOT NULL AND "pricingExpiresAt" = "pricingReadyAt" + INTERVAL '48 hours')
  );
