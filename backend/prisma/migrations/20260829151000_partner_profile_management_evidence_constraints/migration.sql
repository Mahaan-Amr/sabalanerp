ALTER TABLE "partner_identity_evidence"
  ADD CONSTRAINT "partner_identity_evidence_required_text_check"
    CHECK (length(btrim("legalName")) > 0 AND length(btrim("phone")) > 0 AND length(btrim("address")) > 0),
  ADD CONSTRAINT "partner_identity_evidence_identifiers_object_check"
    CHECK (jsonb_typeof("identifiers") = 'object'),
  ADD CONSTRAINT "partner_identity_evidence_integrity_hash_check"
    CHECK ("integrityHash" ~ '^sha256-v1:[0-9a-f]{64}$'),
  ADD CONSTRAINT "partner_identity_evidence_time_check"
    CHECK (("expiresAt" IS NULL OR "expiresAt" > "issuedAt") AND
      ("revokedAt" IS NULL OR "revokedAt" >= "issuedAt"));

ALTER TABLE "partner_terms_policies"
  ADD CONSTRAINT "partner_terms_policy_label_check" CHECK (length(btrim("label")) > 0),
  ADD CONSTRAINT "partner_terms_policy_terms_object_check" CHECK (jsonb_typeof("terms") = 'object'),
  ADD CONSTRAINT "partner_terms_policy_integrity_hash_check"
    CHECK ("integrityHash" ~ '^sha256-v1:[0-9a-f]{64}$'),
  ADD CONSTRAINT "partner_terms_policy_time_check"
    CHECK (("expiresAt" IS NULL OR "expiresAt" > "issuedAt") AND
      ("revokedAt" IS NULL OR "revokedAt" >= "issuedAt"));
