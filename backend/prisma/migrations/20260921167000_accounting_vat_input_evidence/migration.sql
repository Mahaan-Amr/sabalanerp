CREATE TABLE "accounting_vat_input_evidence" (
  "id" TEXT NOT NULL,
  "legalEntityId" TEXT NOT NULL,
  "fiscalYearId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amountRials" DECIMAL(20,0) NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_vat_input_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_vat_input_evidence_sourceType_sourceId_sourceVersion_kind_key"
ON "accounting_vat_input_evidence"("sourceType", "sourceId", "sourceVersion", "kind");
CREATE INDEX "accounting_vat_input_evidence_legalEntityId_fiscalYearId_periodId_kind_idx"
ON "accounting_vat_input_evidence"("legalEntityId", "fiscalYearId", "periodId", "kind");
