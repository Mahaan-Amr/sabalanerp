CREATE UNIQUE INDEX "accounting_ledger_vouchers_book_source_version_key"
ON "accounting_ledger_vouchers"("bookId", "sourceType", "sourceId", "sourceVersion");
