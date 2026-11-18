type Ledger = { successful: number; rolledBack: number; latest: string; unfinished?: number };
type Expected = { previousCommit: string; rawInquirySha256: string; sourceMigrationLedger: Ledger };
type Observed = { promoted: boolean; inquiryTransformation?: unknown; manifestCommit: string | null;
  manifestInquirySha256: string; liveInquirySha256: string; sourceMigrationLedger: Ledger };

/** The retained tier must receive the exact source schema and Inquiry bytes. */
export const assertQaRetainedOldStateProof = (expected: Expected, observed: Observed) => {
  const ledger = expected.sourceMigrationLedger;
  const actual = observed.sourceMigrationLedger;
  if (!observed.promoted || observed.inquiryTransformation != null
    || observed.manifestCommit !== expected.previousCommit
    || observed.manifestInquirySha256 !== expected.rawInquirySha256
    // The source Inquiry database can already contain its migration ledger.
    // Byte identity, including that ledger, is proven by the raw file hash.
    || observed.liveInquirySha256 !== expected.rawInquirySha256
    || actual.successful !== ledger.successful || actual.rolledBack !== ledger.rolledBack
    || actual.latest !== ledger.latest || actual.unfinished !== 0) {
    throw Object.assign(new Error('QA_RESTORE_OLD_STATE_CHANGED'), { code: 'QA_RESTORE_OLD_STATE_CHANGED' });
  }
  return { previousCommit: expected.previousCommit, rawInquirySha256: expected.rawInquirySha256,
    sourceMigrationLedger: ledger, candidateMigrationsApplied: false };
};
