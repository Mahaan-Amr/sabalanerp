ALTER TABLE "accounting_ledger_lines"
ADD COLUMN "evidencePayload" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "accounting_ledger_lines"
ALTER COLUMN "evidencePayload" DROP DEFAULT;

ALTER TABLE "accounting_ledger_vouchers"
ADD COLUMN "sourcePayload" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "accounting_ledger_vouchers"
ALTER COLUMN "sourcePayload" DROP DEFAULT;
