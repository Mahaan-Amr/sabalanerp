ALTER TABLE "performance_policy_versions"
  DROP CONSTRAINT "performance_policy_versions_activation_evidence_check";

ALTER TABLE "performance_policy_versions"
  ADD CONSTRAINT "performance_policy_versions_activation_evidence_check" CHECK (
    "lifecycle" IN ('DRAFT', 'CANCELLED')
    OR (
      "activationPreviewId" IS NOT NULL
      AND "activationPreviewHash" IS NOT NULL
      AND "activationConfirmedAt" IS NOT NULL
      AND "publishedAt" IS NOT NULL
      AND "effectiveFrom" >= "publishedAt"
      AND "activationConfirmedAt" <= "publishedAt"
    )
  );
