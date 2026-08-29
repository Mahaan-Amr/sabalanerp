ALTER TABLE "crm_customers" ADD COLUMN "partnerOwnerProfileId" TEXT;
CREATE INDEX "crm_customers_partnerOwnerProfileId_idx" ON "crm_customers"("partnerOwnerProfileId");
ALTER TABLE "crm_customers" ADD CONSTRAINT "crm_customers_partnerOwnerProfileId_fkey"
  FOREIGN KEY ("partnerOwnerProfileId") REFERENCES "partner_profiles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE OR REPLACE FUNCTION partner_mark_first_owned_evidence_irreversible()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  profile_id text;
  profile_user_id text;
BEGIN
  IF TG_TABLE_NAME = 'crm_customers' THEN
    profile_id := NEW."partnerOwnerProfileId";
    IF profile_id IS NULL THEN RETURN NEW; END IF;
    SELECT "userId" INTO profile_user_id FROM partner_profiles WHERE id = profile_id FOR UPDATE;
    IF profile_user_id IS NULL OR NEW."ownerUserId" IS DISTINCT FROM profile_user_id THEN
      RAISE EXCEPTION 'Partner Customer owner must match its Profile' USING ERRCODE = '23514';
    END IF;
  ELSE
    profile_id := NEW."profileId";
    IF profile_id IS NULL THEN RETURN NEW; END IF;
    PERFORM id FROM partner_profiles WHERE id = profile_id FOR UPDATE;
  END IF;
  UPDATE partner_profiles SET "irreversibleAt" = COALESCE("irreversibleAt", clock_timestamp())
    WHERE id = profile_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_customer_first_evidence_guard
  BEFORE INSERT OR UPDATE OF "partnerOwnerProfileId", "ownerUserId" ON "crm_customers"
  FOR EACH ROW EXECUTE FUNCTION partner_mark_first_owned_evidence_irreversible();
CREATE TRIGGER partner_inquiry_first_evidence_guard
  BEFORE INSERT OR UPDATE OF "profileId" ON "partner_inquiries"
  FOR EACH ROW EXECUTE FUNCTION partner_mark_first_owned_evidence_irreversible();
CREATE TRIGGER partner_case_first_evidence_guard
  BEFORE INSERT OR UPDATE OF "profileId" ON "partner_sale_cases"
  FOR EACH ROW EXECUTE FUNCTION partner_mark_first_owned_evidence_irreversible();

-- Existing Inquiry/Case rows are already unambiguous Partner evidence. Customer
-- rows are intentionally not inferred: only the explicit new Profile binding is
-- Partner ownership, so historical ordinary CRM responsibility is preserved.
UPDATE partner_profiles p SET "irreversibleAt" = COALESCE(p."irreversibleAt", evidence.first_at)
FROM (
  SELECT "profileId", min("createdAt") AS first_at FROM (
    SELECT "profileId", "createdAt" FROM partner_inquiries
    UNION ALL
    SELECT "profileId", "createdAt" FROM partner_sale_cases
  ) owned GROUP BY "profileId"
) evidence WHERE p.id = evidence."profileId" AND p."irreversibleAt" IS NULL;
