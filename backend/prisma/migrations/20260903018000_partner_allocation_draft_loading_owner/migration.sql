BEGIN;

-- A reusable physical visit is not the owner of private allocation intent.
-- The existing (loadingId, queueTurnId) unique key retains exact draft ownership.
DROP INDEX "logistics_allocation_drafts_queueTurnId_key";

COMMIT;
