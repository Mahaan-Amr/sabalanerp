BEGIN;
SET LOCAL lock_timeout = '5s';
-- CreateEnum
CREATE TYPE "PartnerCaseState" AS ENUM ('DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION', 'CUSTOMER_APPROVED', 'COMMITTED', 'CANCELLED', 'VOIDED');

-- AlterTable
ALTER TABLE "sales_contracts" ADD COLUMN     "partnerCaseId" TEXT,
ADD COLUMN     "partnerIntegrityHash" TEXT,
ADD COLUMN     "partnerKind" TEXT,
ADD COLUMN     "partnerRevision" INTEGER;

-- CreateTable
CREATE TABLE "partner_sale_cases" (
    "id" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "internalRecordId" TEXT NOT NULL,
    "customerContractId" TEXT NOT NULL,
    "headRevision" INTEGER NOT NULL,
    "integrityHash" TEXT NOT NULL,
    "state" "PartnerCaseState" NOT NULL DEFAULT 'DRAFT',
    "stateRevision" INTEGER NOT NULL DEFAULT 1,
    "committedAt" TIMESTAMPTZ(3),
    "commitmentTrigger" TEXT,
    "committedRevision" INTEGER,
    "commitmentEventId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_sale_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sabalan_to_partner_sale_records" (
    "id" TEXT NOT NULL,
    "recordNumber" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SABALAN_TO_PARTNER',
    "commercialAccountId" TEXT NOT NULL,
    "expectedRevision" INTEGER NOT NULL,
    "integrityHash" TEXT NOT NULL,

    CONSTRAINT "sabalan_to_partner_sale_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_commercial_numbers" (
    "number" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,

    CONSTRAINT "partner_commercial_numbers_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "partner_case_revisions" (
    "caseId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "predecessorRevision" INTEGER,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "integrityHash" TEXT NOT NULL,
    "graphHash" TEXT NOT NULL,
    "graph" JSONB NOT NULL,
    "partySnapshots" JSONB NOT NULL,
    "wholesaleEnvelope" JSONB NOT NULL,
    "retailEnvelope" JSONB NOT NULL,
    "paymentEvidence" JSONB NOT NULL,
    "customerContent" JSONB NOT NULL,
    "internalProjection" JSONB NOT NULL,
    "customerProjection" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_case_revisions_pkey" PRIMARY KEY ("caseId","revision")
);

-- CreateTable
CREATE TABLE "partner_product_rows" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,

    CONSTRAINT "partner_product_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_case_row_bindings" (
    "caseId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "productRowId" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "quantity" DECIMAL(30,10) NOT NULL,
    "unit" TEXT NOT NULL,
    "precisionPolicyVersion" TEXT NOT NULL,

    CONSTRAINT "partner_case_row_bindings_pkey" PRIMARY KEY ("caseId","revision","productRowId")
);

-- CreateTable
CREATE TABLE "partner_inquiry_usages" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseRevision" INTEGER NOT NULL,
    "productRowId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "approvalSnapshot" JSONB NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "usedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_inquiry_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_case_deliveries" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "destination" TEXT NOT NULL,

    CONSTRAINT "partner_case_deliveries_pkey" PRIMARY KEY ("caseId","revision","id")
);

-- CreateTable
CREATE TABLE "partner_case_delivery_items" (
    "caseId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "productRowId" TEXT NOT NULL,
    "quantity" DECIMAL(30,10) NOT NULL,

    CONSTRAINT "partner_case_delivery_items_pkey" PRIMARY KEY ("caseId","revision","deliveryId","productRowId")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_sale_cases_caseNumber_key" ON "partner_sale_cases"("caseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "partner_sale_cases_internalRecordId_key" ON "partner_sale_cases"("internalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_sale_cases_customerContractId_key" ON "partner_sale_cases"("customerContractId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_sale_cases_commitmentEventId_key" ON "partner_sale_cases"("commitmentEventId");

-- CreateIndex
CREATE INDEX "partner_sale_cases_profileId_state_idx" ON "partner_sale_cases"("profileId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "sabalan_to_partner_sale_records_recordNumber_key" ON "sabalan_to_partner_sale_records"("recordNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sabalan_to_partner_sale_records_caseId_key" ON "sabalan_to_partner_sale_records"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_commercial_numbers_caseId_purpose_key" ON "partner_commercial_numbers"("caseId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "partner_case_revisions_commandId_key" ON "partner_case_revisions"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_product_rows_caseId_id_key" ON "partner_product_rows"("caseId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_inquiry_usages_caseId_caseRevision_productRowId_key" ON "partner_inquiry_usages"("caseId", "caseRevision", "productRowId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_contracts_partnerCaseId_key" ON "sales_contracts"("partnerCaseId");

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_partnerCaseId_fkey" FOREIGN KEY ("partnerCaseId") REFERENCES "partner_sale_cases"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_sale_cases" ADD CONSTRAINT "partner_sale_cases_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "partner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_sale_cases" ADD CONSTRAINT "partner_sale_cases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_sale_cases" ADD CONSTRAINT "partner_sale_cases_internalRecordId_fkey" FOREIGN KEY ("internalRecordId") REFERENCES "sabalan_to_partner_sale_records"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_sale_cases" ADD CONSTRAINT "partner_sale_cases_customerContractId_fkey" FOREIGN KEY ("customerContractId") REFERENCES "sales_contracts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_sale_cases" ADD CONSTRAINT "partner_sale_cases_id_headRevision_fkey" FOREIGN KEY ("id", "headRevision") REFERENCES "partner_case_revisions"("caseId", "revision") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sabalan_to_partner_sale_records" ADD CONSTRAINT "sabalan_to_partner_sale_records_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "partner_sale_cases"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sabalan_to_partner_sale_records" ADD CONSTRAINT "sabalan_to_partner_sale_records_commercialAccountId_fkey" FOREIGN KEY ("commercialAccountId") REFERENCES "partner_commercial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_commercial_numbers" ADD CONSTRAINT "partner_commercial_numbers_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "partner_sale_cases"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_case_revisions" ADD CONSTRAINT "partner_case_revisions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "partner_sale_cases"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_product_rows" ADD CONSTRAINT "partner_product_rows_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "partner_sale_cases"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_case_row_bindings" ADD CONSTRAINT "partner_case_row_bindings_caseId_revision_fkey" FOREIGN KEY ("caseId", "revision") REFERENCES "partner_case_revisions"("caseId", "revision") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_case_row_bindings" ADD CONSTRAINT "partner_case_row_bindings_caseId_productRowId_fkey" FOREIGN KEY ("caseId", "productRowId") REFERENCES "partner_product_rows"("caseId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_inquiry_usages" ADD CONSTRAINT "partner_inquiry_usages_caseId_caseRevision_productRowId_fkey" FOREIGN KEY ("caseId", "caseRevision", "productRowId") REFERENCES "partner_case_row_bindings"("caseId", "revision", "productRowId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_inquiry_usages" ADD CONSTRAINT "partner_inquiry_usages_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "partner_inquiry_approvals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_case_deliveries" ADD CONSTRAINT "partner_case_deliveries_caseId_revision_fkey" FOREIGN KEY ("caseId", "revision") REFERENCES "partner_case_revisions"("caseId", "revision") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_case_delivery_items" ADD CONSTRAINT "partner_case_delivery_items_caseId_revision_deliveryId_fkey" FOREIGN KEY ("caseId", "revision", "deliveryId") REFERENCES "partner_case_deliveries"("caseId", "revision", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "partner_case_delivery_items" ADD CONSTRAINT "partner_case_delivery_items_caseId_revision_productRowId_fkey" FOREIGN KEY ("caseId", "revision", "productRowId") REFERENCES "partner_case_row_bindings"("caseId", "revision", "productRowId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Intermediate releases cannot write an unprotected pair.
CREATE FUNCTION partner_schema_not_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner pair constraints are not installed';
END $$;
CREATE TRIGGER partner_schema_barrier BEFORE INSERT ON partner_sale_cases FOR EACH ROW EXECUTE FUNCTION partner_schema_not_ready();
CREATE TRIGGER partner_schema_barrier BEFORE INSERT ON sabalan_to_partner_sale_records FOR EACH ROW EXECUTE FUNCTION partner_schema_not_ready();
ALTER TABLE sales_contracts ADD CONSTRAINT partner_customer_shape CHECK (
  ("partnerKind" IS NULL AND "partnerCaseId" IS NULL AND "partnerRevision" IS NULL AND "partnerIntegrityHash" IS NULL)
  OR ("partnerKind" IS NOT NULL AND "partnerKind" = 'PARTNER_CUSTOMER' AND "partnerCaseId" IS NOT NULL
    AND "partnerRevision" IS NOT NULL AND "partnerRevision" > 0 AND "partnerIntegrityHash" IS NOT NULL
    AND "partnerIntegrityHash" ~ '^sha256-v1:[a-f0-9]{64}$'));
COMMIT;
