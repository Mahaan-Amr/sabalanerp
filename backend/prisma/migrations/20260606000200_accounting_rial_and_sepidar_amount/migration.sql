ALTER TABLE "accounting_financial_records"
ADD COLUMN "sepidarAmount" DECIMAL(18,2);

ALTER TABLE "accounting_financial_records"
ALTER COLUMN "currency" SET DEFAULT 'ریال';

ALTER TABLE "accounting_receivables"
ALTER COLUMN "currency" SET DEFAULT 'ریال';

ALTER TABLE "accounting_payment_statuses"
ALTER COLUMN "currency" SET DEFAULT 'ریال';

ALTER TABLE "accounting_settings"
ALTER COLUMN "defaultCurrency" SET DEFAULT 'ریال';

CREATE TEMP TABLE "_accounting_toman_invoice_ids" AS
SELECT "id"
FROM "accounting_financial_records"
WHERE "currency" IN ('تومان', 'TOMAN', 'toman');

UPDATE "accounting_settings"
SET "defaultCurrency" = 'ریال'
WHERE "defaultCurrency" IN ('تومان', 'TOMAN', 'toman');

UPDATE "accounting_financial_records"
SET
  "amount" = "amount" * 10,
  "sepidarAmount" = CASE WHEN "sepidarAmount" IS NULL THEN NULL ELSE "sepidarAmount" * 10 END,
  "currency" = 'ریال'
WHERE "currency" IN ('تومان', 'TOMAN', 'toman');

UPDATE "accounting_receivables"
SET
  "originalAmount" = "originalAmount" * 10,
  "paidAmount" = "paidAmount" * 10,
  "remainingAmount" = "remainingAmount" * 10,
  "currency" = 'ریال'
WHERE "currency" IN ('تومان', 'TOMAN', 'toman');

UPDATE "accounting_payment_statuses"
SET
  "amount" = "amount" * 10,
  "currency" = 'ریال'
WHERE "currency" IN ('تومان', 'TOMAN', 'toman');

UPDATE "accounting_invoice_candidate_items"
SET
  "unitPrice" = "unitPrice" * 10,
  "totalPrice" = "totalPrice" * 10
WHERE "invoiceId" IN (
  SELECT "id"
  FROM "_accounting_toman_invoice_ids"
);

UPDATE "accounting_tax_records"
SET
  "taxableAmount" = "taxableAmount" * 10,
  "exemptAmount" = "exemptAmount" * 10,
  "vatAmount" = "vatAmount" * 10
WHERE "invoiceRecordId" IN (
  SELECT "id"
  FROM "_accounting_toman_invoice_ids"
);

DROP TABLE "_accounting_toman_invoice_ids";
