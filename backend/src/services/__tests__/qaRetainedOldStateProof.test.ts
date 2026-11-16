import assert from 'node:assert/strict';
import test from 'node:test';
import { assertQaRetainedOldStateProof } from '../qaRetainedOldStateProof';

const expected = {
  previousCommit: 'b58c53c0f88d2d89da3cb6a45949e6eca97e4308',
  rawInquirySha256: '4e16ab0af5a643417e7638d8f7d09ddfec3803702f200861ba3688e373566f72',
  sourceMigrationLedger: { successful: 439, rolledBack: 1, latest: '20261017100000_attendance_review_and_clock' },
};
const observation = () => ({ promoted: true, inquiryTransformation: undefined, manifestCommit: expected.previousCommit,
  manifestInquirySha256: expected.rawInquirySha256, liveInquirySha256: expected.rawInquirySha256,
  inquiryLedgerTables: 0, sourceMigrationLedger: { ...expected.sourceMigrationLedger, unfinished: 0 } });

test('retained old state accepts only raw Inquiry bytes and the source migration ledger', () => {
  assert.deepEqual(assertQaRetainedOldStateProof(expected, observation()), {
    previousCommit: expected.previousCommit, rawInquirySha256: expected.rawInquirySha256,
    sourceMigrationLedger: expected.sourceMigrationLedger, candidateMigrationsApplied: false,
  });
});

test('retained old state refuses adopted Inquiry, candidate migrations, and changed raw bytes', () => {
  assert.throws(() => assertQaRetainedOldStateProof(expected, { ...observation(), inquiryLedgerTables: 1 }), /QA_RESTORE_OLD_STATE_CHANGED/);
  assert.throws(() => assertQaRetainedOldStateProof(expected, { ...observation(), sourceMigrationLedger: { ...expected.sourceMigrationLedger, successful: 451 } }), /QA_RESTORE_OLD_STATE_CHANGED/);
  assert.throws(() => assertQaRetainedOldStateProof(expected, { ...observation(), liveInquirySha256: 'f'.repeat(64) }), /QA_RESTORE_OLD_STATE_CHANGED/);
  assert.throws(() => assertQaRetainedOldStateProof(expected, { ...observation(), inquiryTransformation: {} }), /QA_RESTORE_OLD_STATE_CHANGED/);
});
