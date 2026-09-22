CREATE TABLE "accounting_bank_import_mappings" (
  "id" TEXT NOT NULL,
  "financialAccountId" TEXT NOT NULL,
  "adapterType" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "columnMapping" JSONB NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "evidenceHash" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounting_bank_import_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_bank_import_mappings_financial_adapter_version_key"
ON "accounting_bank_import_mappings"("financialAccountId", "adapterType", "version");
CREATE INDEX "accounting_bank_import_mappings_financial_effective_idx"
ON "accounting_bank_import_mappings"("financialAccountId", "effectiveFrom", "effectiveTo");

ALTER TABLE "accounting_bank_statement_lines" ADD COLUMN "mappingId" TEXT;
ALTER TABLE "accounting_bank_statement_lines" ADD CONSTRAINT "accounting_bank_statement_lines_mappingId_fkey"
FOREIGN KEY ("mappingId") REFERENCES "accounting_bank_import_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "accounting_bank_import_mapping_immutable" BEFORE UPDATE OR DELETE
ON "accounting_bank_import_mappings" FOR EACH ROW EXECUTE FUNCTION "accounting_reject_immutable_change"();
