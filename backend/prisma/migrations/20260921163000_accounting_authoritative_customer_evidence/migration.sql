ALTER TABLE "accounting_control_transfer_policies"
ADD COLUMN "exceptionOccurredAt" TIMESTAMP(3);

CREATE TABLE "accounting_destination_acceptance_evidence" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "contractId" TEXT NOT NULL,
  "contractVersion" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "productRows" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_destination_acceptance_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_destination_acceptance_evidence_sourceId_sourceVersion_key"
ON "accounting_destination_acceptance_evidence"("sourceId", "sourceVersion");
CREATE UNIQUE INDEX "accounting_destination_acceptance_evidence_evidenceHash_key"
ON "accounting_destination_acceptance_evidence"("evidenceHash");
CREATE INDEX "accounting_destination_acceptance_evidence_contractId_occurredAt_idx"
ON "accounting_destination_acceptance_evidence"("contractId", "occurredAt");

ALTER TABLE "accounting_tax_invoice_lines"
ADD COLUMN "productRowId" TEXT,
ADD COLUMN "quantity" DECIMAL(18,3),
ADD COLUMN "costRials" DECIMAL(20,0);

UPDATE "accounting_tax_invoice_lines"
SET "productRowId" = "sourceLineId", "quantity" = 0, "costRials" = 0
WHERE "productRowId" IS NULL;

ALTER TABLE "accounting_tax_invoice_lines"
ALTER COLUMN "productRowId" SET NOT NULL,
ALTER COLUMN "quantity" SET NOT NULL,
ALTER COLUMN "costRials" SET NOT NULL;

CREATE TABLE "accounting_return_evidence_consumptions" (
  "id" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "creditInvoiceId" TEXT NOT NULL,
  "originalInvoiceId" TEXT NOT NULL,
  "originalLineId" TEXT NOT NULL,
  "productRowId" TEXT NOT NULL,
  "quantity" DECIMAL(18,3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_return_evidence_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_return_evidence_consumptions_evidenceId_key"
ON "accounting_return_evidence_consumptions"("evidenceId");
CREATE INDEX "accounting_return_evidence_consumptions_originalInvoiceId_originalLineId_idx"
ON "accounting_return_evidence_consumptions"("originalInvoiceId", "originalLineId");
