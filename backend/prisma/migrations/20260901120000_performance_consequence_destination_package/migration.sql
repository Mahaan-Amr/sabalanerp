CREATE TABLE "performance_consequence_packages" (
  "id" TEXT NOT NULL,
  "encryptedPayloadId" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "destinationResponsibilityId" TEXT NOT NULL,
  "destinationWorkspaceCode" TEXT NOT NULL,
  "destinationFeatureCode" TEXT,
  "destinationQueueCode" TEXT NOT NULL,
  "destinationVersion" INTEGER NOT NULL,
  "assignedDestinationUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_consequence_packages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "performance_consequence_packages_encryptedPayloadId_key" ON "performance_consequence_packages"("encryptedPayloadId");
CREATE INDEX "performance_consequence_packages_assignedDestinationUserId_createdAt_idx" ON "performance_consequence_packages"("assignedDestinationUserId", "createdAt");

ALTER TABLE "performance_consequence_handoffs"
  ADD COLUMN "packageId" TEXT,
  ALTER COLUMN "reasonCategory" DROP NOT NULL,
  ALTER COLUMN "reason" DROP NOT NULL,
  ALTER COLUMN "encryptedPayloadId" DROP NOT NULL;

CREATE UNIQUE INDEX "performance_consequence_handoffs_packageId_key" ON "performance_consequence_handoffs"("packageId");

INSERT INTO "hr_responsibility_type_catalogs" ("id", "code", "version", "displayName", "isActive", "createdAt", "updatedAt")
VALUES
  ('perf-dest-comp-review', 'PERFORMANCE_CONSEQUENCE_DESTINATION_COMPENSATION_REVIEW', 1, 'مقصد بازبینی جبران خدمت عملکرد', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-dest-bonus-review', 'PERFORMANCE_CONSEQUENCE_DESTINATION_DISCRETIONARY_BONUS_REVIEW', 1, 'مقصد بازبینی پاداش اختیاری عملکرد', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-dest-promotion', 'PERFORMANCE_CONSEQUENCE_DESTINATION_PROMOTION_REVIEW', 1, 'مقصد بررسی ارتقای عملکرد', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-dest-improvement', 'PERFORMANCE_CONSEQUENCE_DESTINATION_PERFORMANCE_IMPROVEMENT_REVIEW', 1, 'مقصد برنامه بهبود عملکرد', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perf-dest-demotion', 'PERFORMANCE_CONSEQUENCE_DESTINATION_DEMOTION_REVIEW', 1, 'مقصد بررسی تنزل عملکرد', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
