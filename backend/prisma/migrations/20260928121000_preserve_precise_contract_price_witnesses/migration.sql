-- Price witnesses remain precise even when quantity × rate has more than two
-- fractional digits. Preserve the full previous integer range in every column.
-- These widenings do not recalculate any historical amount or posted obligation.
ALTER TABLE "contract_items"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(25,12),
  ALTER COLUMN "totalPrice" TYPE DECIMAL(25,12),
  ALTER COLUMN "originalTotalPrice" TYPE DECIMAL(25,12);

ALTER TABLE "accounting_invoice_candidate_items"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(28,12),
  ALTER COLUMN "totalPrice" TYPE DECIMAL(28,12);
