CREATE TYPE "PartnerIdentityPersonType" AS ENUM ('NATURAL', 'LEGAL');
CREATE TYPE "PartnerTermsPurpose" AS ENUM ('PARTNER_TECHNICAL_PRICING', 'PARTNER_CREDIT_TERMS');

CREATE TABLE "partner_identity_evidence" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "legalName" TEXT NOT NULL,
  "tradeName" TEXT,
  "personType" "PartnerIdentityPersonType" NOT NULL,
  "identifiers" JSONB NOT NULL,
  "phone" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "integrityHash" TEXT NOT NULL,
  "issuedBy" TEXT NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "partner_identity_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_terms_policies" (
  "id" TEXT NOT NULL,
  "purpose" "PartnerTermsPurpose" NOT NULL,
  "label" TEXT NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "expiresAt" TIMESTAMPTZ(3),
  "terms" JSONB NOT NULL,
  "integrityHash" TEXT NOT NULL,
  "issuedBy" TEXT NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "partner_terms_policies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "partner_identity_evidence_userId_issuedAt_idx"
  ON "partner_identity_evidence"("userId", "issuedAt");
CREATE INDEX "partner_terms_policies_purpose_effectiveDate_idx"
  ON "partner_terms_policies"("purpose", "effectiveDate");

ALTER TABLE "partner_identity_evidence" ADD CONSTRAINT "partner_identity_evidence_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_identity_evidence" ADD CONSTRAINT "partner_identity_evidence_issuedBy_fkey"
  FOREIGN KEY ("issuedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_terms_policies" ADD CONSTRAINT "partner_terms_policies_issuedBy_fkey"
  FOREIGN KEY ("issuedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION guard_partner_owner_evidence_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Partner owner evidence is append-only';
  END IF;
  IF ROW(OLD."id", OLD."userId", OLD."legalName", OLD."tradeName", OLD."personType", OLD."identifiers",
      OLD."phone", OLD."address", OLD."integrityHash", OLD."issuedBy", OLD."issuedAt", OLD."expiresAt")
    IS DISTINCT FROM
    ROW(NEW."id", NEW."userId", NEW."legalName", NEW."tradeName", NEW."personType", NEW."identifiers",
      NEW."phone", NEW."address", NEW."integrityHash", NEW."issuedBy", NEW."issuedAt", NEW."expiresAt") THEN
    RAISE EXCEPTION 'Partner owner evidence facts are immutable';
  END IF;
  IF OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL THEN
    RAISE EXCEPTION 'Partner owner evidence may only be revoked once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_identity_evidence_immutable
BEFORE UPDATE OR DELETE ON "partner_identity_evidence"
FOR EACH ROW EXECUTE FUNCTION guard_partner_owner_evidence_immutability();

CREATE OR REPLACE FUNCTION guard_partner_terms_policy_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Partner terms policy is append-only';
  END IF;
  IF ROW(OLD."id", OLD."purpose", OLD."label", OLD."effectiveDate", OLD."expiresAt", OLD."terms",
      OLD."integrityHash", OLD."issuedBy", OLD."issuedAt")
    IS DISTINCT FROM
    ROW(NEW."id", NEW."purpose", NEW."label", NEW."effectiveDate", NEW."expiresAt", NEW."terms",
      NEW."integrityHash", NEW."issuedBy", NEW."issuedAt") THEN
    RAISE EXCEPTION 'Partner terms policy facts are immutable';
  END IF;
  IF OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL THEN
    RAISE EXCEPTION 'Partner terms policy may only be revoked once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_terms_policy_immutable
BEFORE UPDATE OR DELETE ON "partner_terms_policies"
FOR EACH ROW EXECUTE FUNCTION guard_partner_terms_policy_immutability();
