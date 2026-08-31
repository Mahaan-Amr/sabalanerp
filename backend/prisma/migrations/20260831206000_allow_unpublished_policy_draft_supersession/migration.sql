ALTER TABLE "performance_policy_versions"
  DROP CONSTRAINT "performance_policy_versions_publication_check";

ALTER TABLE "performance_policy_versions"
  ADD CONSTRAINT "performance_policy_versions_publication_check" CHECK (
    ("lifecycle" IN ('DRAFT', 'CANCELLED') AND "publishedAt" IS NULL)
    OR (
      "lifecycle" <> 'DRAFT'
      AND "publishedAt" IS NOT NULL
      AND "publishedByUserId" IS NOT NULL
      AND "publicationReason" IS NOT NULL
    )
  );
