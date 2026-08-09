-- Additive terminal state for candidates whose immutable pricing/document evidence
-- is malformed or no longer matches its recorded integrity identity.
ALTER TYPE "AccountingDispatchCandidateStatus"
  ADD VALUE IF NOT EXISTS 'EVIDENCE_CONFLICT';
