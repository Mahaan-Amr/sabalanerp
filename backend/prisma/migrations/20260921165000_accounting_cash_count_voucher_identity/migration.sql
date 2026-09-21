CREATE UNIQUE INDEX "accounting_cash_counts_ledgerVoucherId_key"
ON "accounting_cash_counts"("ledgerVoucherId");

CREATE UNIQUE INDEX "accounting_check_instrument_events_ledgerVoucherId_key"
ON "accounting_check_instrument_events"("ledgerVoucherId");
