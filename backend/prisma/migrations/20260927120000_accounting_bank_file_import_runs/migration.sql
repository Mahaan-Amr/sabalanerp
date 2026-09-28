CREATE TABLE "accounting_bank_file_import_runs" (
    "id" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    "mappingEvidenceHash" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "imported" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "sourceFile" BYTEA NOT NULL,
    "sourceRows" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_bank_file_import_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_file_import_identity_key"
ON "accounting_bank_file_import_runs"("financialAccountId", "adapterType", "mappingVersion", "fileHash");
CREATE INDEX "bank_file_import_created_at_idx" ON "accounting_bank_file_import_runs"("createdAt");

CREATE FUNCTION prevent_bank_file_import_run_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Accounting bank file import evidence is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_file_import_runs_append_only
BEFORE UPDATE OR DELETE ON "accounting_bank_file_import_runs"
FOR EACH ROW EXECUTE FUNCTION prevent_bank_file_import_run_mutation();
