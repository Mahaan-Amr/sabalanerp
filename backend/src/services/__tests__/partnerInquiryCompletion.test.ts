import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCaseInquiryCompletion, summarizeCasePricingResponses } from '../partnerSales/cases/pricingResponse';

test('a rejection does not make a partially answered request complete', () => {
  const rows = [{ subjectHash: 'a', outcome: 'REJECTED', superseded: false },
    { subjectHash: 'b', outcome: 'PENDING', superseded: false }];
  assert.equal(summarizeCasePricingResponses(['a', 'b'], rows, new Date()), 'REJECTED');
  assert.equal(summarizeCaseInquiryCompletion(['a', 'b'], rows).complete, false);
  rows[1].outcome = 'APPROVED';
  assert.equal(summarizeCaseInquiryCompletion(['a', 'b'], rows).complete, true);
});

test('expiry does not undo response completion; a successor request does', () => {
  const old = { subjectHash: 'a', outcome: 'APPROVED', superseded: false, expiresAt: new Date('2020-01-01') };
  assert.equal(summarizeCaseInquiryCompletion(['a'], [old]).complete, true);
  assert.equal(summarizeCasePricingResponses(['a'], [old], new Date()), 'EXPIRED');
  assert.deepEqual(summarizeCaseInquiryCompletion(['a'], [{ ...old, hasSuccessor: true },
    { subjectHash: 'a', outcome: 'PENDING', superseded: false, predecessorId: 'old' }]),
  { complete: false, resubmittedWaiting: true });
});
