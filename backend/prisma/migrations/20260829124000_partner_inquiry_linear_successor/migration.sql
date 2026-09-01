BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT "predecessorId" FROM partner_inquiry_rows
    WHERE "predecessorId" IS NOT NULL GROUP BY "predecessorId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'partner inquiry successor history is branched';
  END IF;
END $$;

DROP INDEX IF EXISTS partner_one_open_successor;
CREATE UNIQUE INDEX "partner_inquiry_rows_predecessorId_key"
  ON partner_inquiry_rows ("predecessorId") WHERE "predecessorId" IS NOT NULL;

COMMIT;
