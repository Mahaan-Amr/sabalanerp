ALTER TABLE "sales_contracts"
  ADD COLUMN "responsibleSellerId" TEXT,
  ADD COLUMN "responsibleSellerSource" TEXT NOT NULL DEFAULT 'CREATOR_DEFAULT',
  ADD COLUMN "realizedSellerId" TEXT,
  ADD COLUMN "realizedSellerSource" TEXT,
  ADD COLUMN "realizedAt" TIMESTAMP(3),
  ADD COLUMN "realizedAmount" DECIMAL(15,2),
  ADD COLUMN "lostAt" TIMESTAMP(3);

-- CRM reassignment events preserve the previous seller. The first reassignment
-- after contract creation therefore identifies the seller at conversion. When
-- there was no later reassignment, the project's current owner is reliable.
WITH linked_projects AS (
  SELECT
    c."id" AS "contractId",
    COALESCE(
      (
        SELECT e."metadata"->>'previousSellerId'
        FROM "crm_timeline_events" e
        WHERE e."potentialProjectId" = p."id"
          AND e."eventType" = 'reassigned'
          AND e."createdAt" >= c."createdAt"
          AND e."metadata"->>'previousSellerId' IS NOT NULL
        ORDER BY e."createdAt" ASC
        LIMIT 1
      ),
      p."responsibleSellerId"
    ) AS "sellerId"
  FROM "sales_contracts" c
  JOIN "crm_potential_projects" p ON p."wonSalesContractId" = c."id"
)
UPDATE "sales_contracts" c
SET
  "responsibleSellerId" = lp."sellerId",
  "responsibleSellerSource" = 'CRM_TIMELINE_BACKFILL'
FROM linked_projects lp
WHERE c."id" = lp."contractId"
  AND lp."sellerId" IS NOT NULL;

UPDATE "sales_contracts"
SET
  "responsibleSellerId" = "createdBy",
  "responsibleSellerSource" = 'MIGRATED_CREATOR'
WHERE "responsibleSellerId" IS NULL;

UPDATE "sales_contracts"
SET
  "realizedAt" = COALESCE("signedAt", "createdAt"),
  "realizedAmount" = COALESCE("totalAmount", 0),
  "realizedSellerSource" = 'LEGACY_UNASSIGNED'
WHERE "status" IN ('SIGNED', 'PRINTED');

UPDATE "sales_contracts"
SET "lostAt" = "updatedAt"
WHERE "status" IN ('CANCELLED', 'EXPIRED');

ALTER TABLE "sales_contracts" ALTER COLUMN "responsibleSellerId" SET NOT NULL;

CREATE TABLE "sales_contract_seller_audits" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "previousSellerId" TEXT,
  "nextSellerId" TEXT,
  "changedBy" TEXT NOT NULL,
  "changeType" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_contract_seller_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_reporting_events" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "sellerId" TEXT,
  "sourceKey" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_reporting_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_report_presets" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'PERSONAL',
  "departmentId" TEXT,
  "configuration" JSONB NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_report_presets_pkey" PRIMARY KEY ("id")
);

INSERT INTO "sales_reporting_events" (
  "id", "contractId", "eventType", "amount", "effectiveAt", "sellerId",
  "sourceKey", "reason", "metadata", "createdBy"
)
SELECT
  'sre_' || md5(c."id" || ':legacy-realized'),
  c."id",
  'REALIZED',
  COALESCE(c."realizedAmount", 0),
  c."realizedAt",
  NULL,
  'realized:' || c."id",
  'Legacy realized sale; seller credit requires reviewed attribution',
  jsonb_build_object('source', 'LEGACY_BACKFILL', 'credit', 'UNASSIGNED'),
  NULL
FROM "sales_contracts" c
WHERE c."status" IN ('SIGNED', 'PRINTED') AND c."realizedAt" IS NOT NULL;

CREATE UNIQUE INDEX "sales_reporting_events_sourceKey_key" ON "sales_reporting_events"("sourceKey");
CREATE INDEX "sales_contracts_responsibleSellerId_idx" ON "sales_contracts"("responsibleSellerId");
CREATE INDEX "sales_contracts_realizedSellerId_idx" ON "sales_contracts"("realizedSellerId");
CREATE INDEX "sales_contracts_realizedAt_idx" ON "sales_contracts"("realizedAt");
CREATE INDEX "sales_contracts_lostAt_idx" ON "sales_contracts"("lostAt");
CREATE INDEX "sales_contract_seller_audits_contractId_createdAt_idx" ON "sales_contract_seller_audits"("contractId", "createdAt");
CREATE INDEX "sales_contract_seller_audits_changedBy_idx" ON "sales_contract_seller_audits"("changedBy");
CREATE INDEX "sales_reporting_events_effectiveAt_idx" ON "sales_reporting_events"("effectiveAt");
CREATE INDEX "sales_reporting_events_eventType_effectiveAt_idx" ON "sales_reporting_events"("eventType", "effectiveAt");
CREATE INDEX "sales_reporting_events_sellerId_effectiveAt_idx" ON "sales_reporting_events"("sellerId", "effectiveAt");
CREATE INDEX "sales_reporting_events_contractId_effectiveAt_idx" ON "sales_reporting_events"("contractId", "effectiveAt");
CREATE INDEX "sales_report_presets_ownerId_idx" ON "sales_report_presets"("ownerId");
CREATE INDEX "sales_report_presets_visibility_departmentId_idx" ON "sales_report_presets"("visibility", "departmentId");

ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_responsibleSellerId_fkey" FOREIGN KEY ("responsibleSellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_realizedSellerId_fkey" FOREIGN KEY ("realizedSellerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_contract_seller_audits" ADD CONSTRAINT "sales_contract_seller_audits_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_contract_seller_audits" ADD CONSTRAINT "sales_contract_seller_audits_previousSellerId_fkey" FOREIGN KEY ("previousSellerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_contract_seller_audits" ADD CONSTRAINT "sales_contract_seller_audits_nextSellerId_fkey" FOREIGN KEY ("nextSellerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_contract_seller_audits" ADD CONSTRAINT "sales_contract_seller_audits_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_reporting_events" ADD CONSTRAINT "sales_reporting_events_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "sales_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_reporting_events" ADD CONSTRAINT "sales_reporting_events_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_reporting_events" ADD CONSTRAINT "sales_reporting_events_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_report_presets" ADD CONSTRAINT "sales_report_presets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
