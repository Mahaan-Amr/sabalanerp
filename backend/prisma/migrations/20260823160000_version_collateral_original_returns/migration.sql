CREATE TABLE "hr_collateral_original_returns" (
  "id" TEXT NOT NULL,
  "collateralItemId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "returnedAt" TIMESTAMP(3),
  "returnedTo" TEXT,
  "returnedBy" TEXT,
  "evidenceNote" TEXT,
  "evidenceStorageName" TEXT,
  "evidenceOriginalName" TEXT,
  "evidenceMimeType" TEXT,
  "evidenceSize" INTEGER,
  "evidenceSha256" TEXT,
  "evidenceMalwareScanStatus" TEXT,
  "confirmedBy" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "returnedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hr_collateral_original_returns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_collateral_original_returns_collateralItemId_version_key" ON "hr_collateral_original_returns"("collateralItemId", "version");
CREATE INDEX "hr_collateral_original_returns_collateralItemId_status_idx" ON "hr_collateral_original_returns"("collateralItemId", "status");
ALTER TABLE "hr_collateral_original_returns" ADD CONSTRAINT "hr_collateral_original_returns_collateralItemId_fkey" FOREIGN KEY ("collateralItemId") REFERENCES "hr_collateral_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "hr_collateral_original_returns" (
  "id", "collateralItemId", "version", "status", "returnedAt", "returnedTo", "returnedBy",
  "evidenceNote", "evidenceStorageName", "evidenceOriginalName", "evidenceMimeType", "evidenceSize",
  "evidenceSha256", "evidenceMalwareScanStatus", "confirmedBy", "confirmedAt", "createdAt"
)
SELECT
  'legacy-' || "id", "id", 1,
  CASE WHEN "returnConfirmedAt" IS NOT NULL THEN 'CONFIRMED' ELSE 'SUBMITTED' END,
  "returnedAt", "returnedTo", "returnedBy", "returnEvidenceNote", "returnEvidenceStorageName",
  "returnEvidenceOriginalName", "returnEvidenceMimeType", "returnEvidenceSize", "returnEvidenceSha256",
  COALESCE("returnEvidenceMalwareScanStatus", 'LEGACY'), "returnConfirmedBy", "returnConfirmedAt", "returnedAt"
FROM "hr_collateral_items"
WHERE "returnedAt" IS NOT NULL
  AND "returnedTo" IS NOT NULL
  AND "returnedBy" IS NOT NULL
  AND "returnEvidenceNote" IS NOT NULL
  AND "returnEvidenceStorageName" IS NOT NULL
  AND "returnEvidenceOriginalName" IS NOT NULL
  AND "returnEvidenceMimeType" IS NOT NULL
  AND "returnEvidenceSize" IS NOT NULL
  AND "returnEvidenceSha256" IS NOT NULL;
