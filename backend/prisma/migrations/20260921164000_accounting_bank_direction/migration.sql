ALTER TABLE "accounting_bank_statement_lines"
ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'INBOUND';

ALTER TABLE "accounting_bank_statement_lines"
ALTER COLUMN "direction" DROP DEFAULT;
