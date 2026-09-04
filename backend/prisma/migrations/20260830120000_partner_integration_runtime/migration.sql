CREATE TABLE "partner_customer_artifacts" (
  "id" TEXT PRIMARY KEY,
  "snapshotId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "caseRevision" INTEGER NOT NULL,
  "mode" TEXT NOT NULL,
  "outputHash" TEXT NOT NULL,
  "byteHash" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "actorId" TEXT NOT NULL,
  "publishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_customer_artifacts_snapshotId_mode_key" UNIQUE ("snapshotId", "mode")
);
CREATE INDEX "partner_customer_artifacts_caseId_caseRevision_idx"
  ON "partner_customer_artifacts" ("caseId", "caseRevision");

CREATE TABLE "partner_fulfillment_lineages" (
  "id" TEXT PRIMARY KEY,
  "caseId" TEXT NOT NULL,
  "caseRevision" INTEGER NOT NULL,
  "integrityHash" TEXT NOT NULL,
  "internalRecordId" TEXT NOT NULL,
  "productRowId" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "recipient" JSONB NOT NULL,
  "deliveryIds" JSONB NOT NULL,
  "commandId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partner_fulfillment_lineages_caseId_productRowId_key" UNIQUE ("caseId", "productRowId")
);
CREATE INDEX "partner_fulfillment_lineages_internalRecordId_idx"
  ON "partner_fulfillment_lineages" ("internalRecordId");

CREATE TABLE "partner_report_exports" (
  "id" TEXT PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "query" JSONB NOT NULL,
  "report" JSONB NOT NULL,
  "roots" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "partner_report_exports_actorId_expiresAt_idx"
  ON "partner_report_exports" ("actorId", "expiresAt");

CREATE TABLE "partner_operations_incidents" (
  "key" TEXT PRIMARY KEY,
  "category" TEXT NOT NULL,
  "evidenceReference" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
  "occurrences" INTEGER NOT NULL,
  "resolution" JSONB,
  "remediation" JSONB
);
CREATE INDEX "partner_operations_incidents_lastSeenAt_idx"
  ON "partner_operations_incidents" ("lastSeenAt");

ALTER TABLE "partner_customer_artifacts"
  ADD CONSTRAINT "partner_customer_artifacts_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "partner_customer_output_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_fulfillment_lineages"
  ADD CONSTRAINT "partner_fulfillment_lineages_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "partner_sale_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
