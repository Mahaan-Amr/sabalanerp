ALTER TABLE "accounting_replacement_migration_runs"
  DROP CONSTRAINT "accounting_replacement_migration_runs_status_check";

ALTER TABLE "accounting_replacement_migration_runs"
  ADD CONSTRAINT "accounting_replacement_migration_runs_status_check"
  CHECK ("status" IN ('PREVIEWED', 'ARCHIVED', 'RECONCILED'));
