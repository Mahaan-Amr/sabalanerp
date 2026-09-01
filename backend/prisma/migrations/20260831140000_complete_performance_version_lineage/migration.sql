CREATE TYPE "PerformancePolicyKind" AS ENUM ('EVALUATION_PLAN', 'SCORING', 'CURRENT_LEVEL', 'LEVEL_CLASSIFICATION', 'RETENTION', 'ROLLOUT');
ALTER TABLE "performance_policy_versions" ALTER COLUMN "policyKind" TYPE "PerformancePolicyKind" USING "policyKind"::"PerformancePolicyKind";

ALTER TABLE "performance_criterion_versions" ADD COLUMN "publicationReason" TEXT;
ALTER TABLE "performance_criterion_versions" ADD COLUMN "publishedByUserId" TEXT;
ALTER TABLE "performance_criterion_versions" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "performance_criterion_versions" ADD CONSTRAINT "performance_criterion_versions_publisher_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_criterion_versions" ADD CONSTRAINT "performance_criterion_versions_publication_check" CHECK (
  ("lifecycle" = 'DRAFT' AND "publishedAt" IS NULL AND "publishedByUserId" IS NULL AND "publicationReason" IS NULL)
  OR
  ("lifecycle" <> 'DRAFT' AND "publishedAt" IS NOT NULL AND "publishedByUserId" IS NOT NULL AND "publicationReason" IS NOT NULL)
);

ALTER TABLE "performance_template_versions" ADD COLUMN "publicationReason" TEXT;
ALTER TABLE "performance_template_versions" ADD COLUMN "publishedByUserId" TEXT;
ALTER TABLE "performance_template_versions" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "performance_template_versions" ADD CONSTRAINT "performance_template_versions_publisher_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_template_versions" ADD CONSTRAINT "performance_template_versions_publication_check" CHECK (
  ("lifecycle" = 'DRAFT' AND "publishedAt" IS NULL AND "publishedByUserId" IS NULL AND "publicationReason" IS NULL)
  OR
  ("lifecycle" <> 'DRAFT' AND "publishedAt" IS NOT NULL AND "publishedByUserId" IS NOT NULL AND "publicationReason" IS NOT NULL)
);

ALTER TABLE "performance_cohort_versions" ADD COLUMN "predecessorId" TEXT;
CREATE UNIQUE INDEX "performance_cohort_versions_id_key_key" ON "performance_cohort_versions"("id", "cohortKey");
ALTER TABLE "performance_cohort_versions" ADD CONSTRAINT "performance_cohort_versions_predecessor_key_fkey" FOREIGN KEY ("predecessorId", "cohortKey") REFERENCES "performance_cohort_versions"("id", "cohortKey") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "performance_evaluations" ADD CONSTRAINT "performance_evaluations_no_active_overlap"
EXCLUDE USING gist (
  "subjectId" WITH =,
  tsrange("measurementFrom", "measurementTo", '[)') WITH &&
)
WHERE ("status" IN ('DRAFT', 'READY_FOR_SUBMISSION', 'UNDER_REVIEW', 'ACCEPTED'));
