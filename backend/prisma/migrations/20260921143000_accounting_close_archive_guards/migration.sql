ALTER TABLE accounting_close_runs
  ADD COLUMN "closingVoucherId" TEXT,
  ADD COLUMN "openingVoucherId" TEXT,
  ADD COLUMN "openingFiscalYearId" TEXT,
  ADD COLUMN "openingPeriodId" TEXT,
  ADD COLUMN "yearEndEvidence" JSONB;

CREATE OR REPLACE FUNCTION accounting_reject_archive_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'مدرک بایگانی قانونی تغییرناپذیر است';
END;
$$;

CREATE TRIGGER accounting_archive_evidence_immutable
BEFORE UPDATE OR DELETE ON accounting_archive_evidence
FOR EACH ROW EXECUTE FUNCTION accounting_reject_archive_evidence_mutation();

CREATE OR REPLACE FUNCTION accounting_guard_completed_close_run()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('HARD_CLOSED', 'COMPLETED') THEN
    RAISE EXCEPTION 'اجرای بستن تکمیل‌شده تغییرناپذیر است';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounting_completed_close_run_immutable
BEFORE UPDATE OR DELETE ON accounting_close_runs
FOR EACH ROW EXECUTE FUNCTION accounting_guard_completed_close_run();

CREATE OR REPLACE FUNCTION accounting_guard_close_step_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting_close_runs
    WHERE id = OLD."closeRunId" AND status IN ('HARD_CLOSED', 'COMPLETED')
  ) THEN
    RAISE EXCEPTION 'شواهد اجرای بستن تکمیل‌شده تغییرناپذیر است';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounting_completed_close_steps_immutable
BEFORE UPDATE OR DELETE ON accounting_close_run_steps
FOR EACH ROW EXECUTE FUNCTION accounting_guard_close_step_mutation();
