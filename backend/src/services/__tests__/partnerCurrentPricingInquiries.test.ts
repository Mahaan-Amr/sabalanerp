import assert from 'node:assert/strict';
import test from 'node:test';
import { currentPartnerPricingInquiryIds } from '../partnerSales/inquiries/currentPricing';
const replacement = { evidence: { version: 1, caseId: 'case', replacementInquiryId: 'current-pending', rowIds: ['a','b'] } };
const cancelled = { id: 'replaced-edit', rows: [{ id: 'a', outcome: 'CANCELLED' }, { id: 'b', outcome: 'CANCELLED' }], events: [replacement] };
const live = { id: 'current-pending', rows: [{ id: 'c', outcome: 'PENDING' }], events: [] };

test('current pricing prunes only completely replaced packages; live decisions and explicit cancellations retain normal validation', () => {
 const inquiries = [cancelled, live,
  { id: 'approved-expiry-checked-downstream', rows: [{ id: 'd', outcome: 'APPROVED' }], events: [] },
  { id: 'retained-rejection', rows: [{ id: 'e', outcome: 'REJECTED' }], events: [] },
  { id: 'partially-cancelled', rows: [{ id: 'f', outcome: 'CANCELLED' }, { id: 'g', outcome: 'PENDING' }], events: [] },
  { id: 'manual-cancellation', rows: [{ id: 'h', outcome: 'CANCELLED' }], events: [{ evidence: { rowIds: ['h'] } }] },
  { id: 'empty-integrity-check', rows: [], events: [] },
  { id: 'unknown-integrity-check', rows: [{ id: 'i', outcome: 'INVALID' }], events: [] },
 ];
 const before = structuredClone(inquiries);
 assert.deepEqual(currentPartnerPricingInquiryIds('case', inquiries), inquiries.slice(1).map(inquiry => inquiry.id));
 assert.deepEqual(inquiries, before);
});

for (const evidence of [null, { ...replacement.evidence, caseId: 'other' }, { ...replacement.evidence, replacementInquiryId: 'missing' },
 { ...replacement.evidence, replacementInquiryId: 'replaced-edit' }, { ...replacement.evidence, rowIds: ['a'] }]) {
 test(`incomplete replacement proof cannot hide a historical inquiry: ${JSON.stringify(evidence)}`, () => {
  assert.deepEqual(currentPartnerPricingInquiryIds('case', [{ ...cancelled, events: [{ evidence }] }, live]), ['replaced-edit','current-pending']);
 });
}
