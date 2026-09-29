import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCasePricingResponses } from '../pricingResponse';
const now = new Date('2026-09-29T10:00:00Z');
const offer = (subjectHash: string) => ({ subjectHash, outcome: 'APPROVED', expiresAt: new Date('2026-09-30T10:00:00Z'), superseded: false });
test('unaccepted current offers are ready and another pending product stays partial', () => {
  assert.equal(summarizeCasePricingResponses(['a', 'b'], [offer('a'), offer('b')], now), 'READY');
  assert.equal(summarizeCasePricingResponses(['a', 'b'], [offer('a')], now), 'PARTIAL');
});
test('edited identity, rejected, expired, and superseded offers cannot mark a draft ready', () => {
  assert.equal(summarizeCasePricingResponses(['edited'], [offer('original')], now), 'WAITING');
  assert.equal(summarizeCasePricingResponses(['a'], [{ ...offer('a'), outcome: 'REJECTED' }], now), 'REJECTED');
  assert.equal(summarizeCasePricingResponses(['a'], [{ ...offer('a'), expiresAt: now }], now), 'EXPIRED');
  assert.equal(summarizeCasePricingResponses(['a'], [{ ...offer('a'), superseded: true }], now), 'WAITING');
  assert.equal(summarizeCasePricingResponses([], [], now), 'WAITING');
});
test('a still valid retained offer survives a pending replacement and is independent of other rows', () => {
  assert.equal(summarizeCasePricingResponses(['a', 'b'], [{ subjectHash: 'a', outcome: 'PENDING', superseded: false }, offer('a'), offer('b')], now), 'READY');
});
