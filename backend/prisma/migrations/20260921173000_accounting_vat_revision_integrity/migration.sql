DROP INDEX "accounting_vat_input_evidence_sourceType_sourceId_sourceVersion_kind_key";
CREATE UNIQUE INDEX "accounting_vat_input_evidence_sourceType_sourceId_sourceVersion_key"
ON "accounting_vat_input_evidence"("sourceType", "sourceId", "sourceVersion");

DROP INDEX "accounting_vat_reconciliations_legalEntityId_fiscalYearId_p_key";
ALTER TABLE "accounting_vat_reconciliations" ADD COLUMN "revision" INTEGER;
ALTER TABLE "accounting_vat_reconciliations" ADD COLUMN "supersedesId" TEXT;
ALTER TABLE "accounting_vat_reconciliations" ADD COLUMN "sourceHash" TEXT;
UPDATE "accounting_vat_reconciliations" SET "revision" = 1, "sourceHash" = "ledgerControlHash";
ALTER TABLE "accounting_vat_reconciliations" ALTER COLUMN "revision" SET NOT NULL;
ALTER TABLE "accounting_vat_reconciliations" ALTER COLUMN "sourceHash" SET NOT NULL;
CREATE UNIQUE INDEX "accounting_vat_reconciliations_entity_period_revision_key"
ON "accounting_vat_reconciliations"("legalEntityId", "fiscalYearId", "periodId", "revision");
CREATE UNIQUE INDEX "accounting_vat_reconciliations_supersedesId_key"
ON "accounting_vat_reconciliations"("supersedesId");
CREATE INDEX "accounting_vat_reconciliations_entity_period_created_idx"
ON "accounting_vat_reconciliations"("legalEntityId", "fiscalYearId", "periodId", "createdAt");
ALTER TABLE "accounting_vat_reconciliations" ADD CONSTRAINT "accounting_vat_reconciliations_supersedesId_fkey"
FOREIGN KEY ("supersedesId") REFERENCES "accounting_vat_reconciliations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
