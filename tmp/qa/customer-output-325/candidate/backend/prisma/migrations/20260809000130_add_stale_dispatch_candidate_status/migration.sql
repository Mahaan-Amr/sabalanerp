-- Additive terminal state for candidates whose bound approved-pricing evidence
-- changed and therefore require a successor allocation revision.
ALTER TYPE "AccountingDispatchCandidateStatus"
  ADD VALUE IF NOT EXISTS 'STALE_REQUIRES_SUCCESSOR';
