import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSepidarCustomerOpening } from '../prepareSepidarCustomerOpening';

const evidence = {
  sourcePackageHash: 'a'.repeat(64), sourceCustomerId: '7', sourceVoucherItemId: '91',
  signedRials: '-11', debitRials: '0', creditRials: '11', targetWorkspaceKey: 'profile-7',
};
const destination = {
  customerId: 'customer-7', profileId: 'profile-7', bookId: 'book-1', periodId: 'period-1', postingRuleId: 'rule-1',
  counterAccountId: 'clearing-1', basisAt: new Date('2026-03-21T00:00:00Z'), snapshotHash: 'b'.repeat(64),
  postedSourceCount: 0, priorOpeningReview: false, sourceRecordByBasisCount: 0,
  actor: { id: 'accountant', profile: 'ACCOUNTANT' as const },
};

test('preparing a reviewed credit binds the exact Sepidar row, fresh destination and signed rial amount', () => {
  const prepared = prepareSepidarCustomerOpening(evidence, destination);
  assert.equal(prepared.command.amountRials, -11n);
  assert.equal(prepared.manifestLine.totalRials, '-11');
  assert.equal(prepared.manifestLine.profileId, 'profile-7');
  assert.equal(prepared.manifestLine.sourceVoucherItemId, '91');
  assert.equal(prepared.command.openingReview?.lines[0]?.kind, 'CREDIT');
  assert.equal(prepared.command.openingReview?.lines[0]?.amountRials, 11n);
  assert.match(prepared.manifestLine.commandHash, /^[0-9a-f]{64}$/);
  assert.notEqual(prepareSepidarCustomerOpening(evidence, { ...destination, snapshotHash: 'c'.repeat(64) })
    .manifestLine.commandHash, prepared.manifestLine.commandHash);
});

test('preparation refuses existing postings or a different customer profile for manual reconciliation', () => {
  assert.throws(() => prepareSepidarCustomerOpening(evidence, { ...destination, postedSourceCount: 1 }),
    { code: 'SEPIDAR_OPENING_DESTINATION_REVIEW_REQUIRED' });
  assert.throws(() => prepareSepidarCustomerOpening(evidence, { ...destination, profileId: 'another-profile' }),
    { code: 'SEPIDAR_OPENING_DESTINATION_REVIEW_REQUIRED' });
  assert.throws(() => prepareSepidarCustomerOpening({ ...evidence, creditRials: '12' }, destination),
    { code: 'SEPIDAR_OPENING_EVIDENCE_INVALID' });
});
