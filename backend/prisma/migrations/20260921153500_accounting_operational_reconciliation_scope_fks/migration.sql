ALTER TABLE accounting_operational_reconciliations
  ADD CONSTRAINT accounting_operational_reconciliations_book_fk FOREIGN KEY ("bookId") REFERENCES accounting_books(id) ON DELETE RESTRICT,
  ADD CONSTRAINT accounting_operational_reconciliations_year_fk FOREIGN KEY ("fiscalYearId") REFERENCES accounting_fiscal_years(id) ON DELETE RESTRICT,
  ADD CONSTRAINT accounting_operational_reconciliations_period_fk FOREIGN KEY ("periodId") REFERENCES accounting_posting_periods(id) ON DELETE RESTRICT;
