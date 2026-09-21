CREATE OR REPLACE FUNCTION accounting_guard_voucher_immutability()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'سند قطعی حسابداری قابل حذف نیست';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" IN ('POSTED', 'REVERSED') THEN
    IF OLD."status" = 'POSTED'
       AND NEW."status" = 'REVERSED'
       AND NEW."reversedAt" IS NOT NULL
       AND ROW(
         NEW."id", NEW."bookId", NEW."fiscalYearId", NEW."periodId",
         NEW."referenceNumber", NEW."statutoryNumber", NEW."idempotencyKey",
         NEW."correlationId", NEW."description", NEW."documentDate",
         NEW."occurredAt", NEW."recordedAt", NEW."discoveredAt", NEW."postedAt",
         NEW."sourceType", NEW."sourceId", NEW."sourceVersion", NEW."sourceHash", NEW."sourcePayload",
         NEW."debitTotalRials", NEW."creditTotalRials", NEW."contentHash",
         NEW."reversalOfId", NEW."createdBy", NEW."createdAt"
       ) IS NOT DISTINCT FROM ROW(
         OLD."id", OLD."bookId", OLD."fiscalYearId", OLD."periodId",
         OLD."referenceNumber", OLD."statutoryNumber", OLD."idempotencyKey",
         OLD."correlationId", OLD."description", OLD."documentDate",
         OLD."occurredAt", OLD."recordedAt", OLD."discoveredAt", OLD."postedAt",
         OLD."sourceType", OLD."sourceId", OLD."sourceVersion", OLD."sourceHash", OLD."sourcePayload",
         OLD."debitTotalRials", OLD."creditTotalRials", OLD."contentHash",
         OLD."reversalOfId", OLD."createdBy", OLD."createdAt"
       )
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'سند قطعی حسابداری تغییرناپذیر است';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
