-- A corrected row can complete a package beside an older, still-valid approval.
-- The package ends at the earliest row expiry, so its remaining window can be
-- shorter than 48 hours without extending the unchanged approval.
ALTER TABLE "partner_inquiries"
  DROP CONSTRAINT "partner_inquiries_pricing_window_check";

ALTER TABLE "partner_inquiries"
  ADD CONSTRAINT "partner_inquiries_pricing_window_check"
  CHECK (
    ("pricingReadyAt" IS NULL AND "pricingExpiresAt" IS NULL)
    OR
    ("pricingReadyAt" IS NOT NULL
      AND "pricingExpiresAt" > "pricingReadyAt"
      AND "pricingExpiresAt" <= "pricingReadyAt" + INTERVAL '48 hours')
  );
