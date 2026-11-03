import assert from 'node:assert/strict';
import {
  candidateSmsDeliverySummary,
  candidateSmsInitialState,
  candidateSmsRetryEligibility,
  mapSmsIrDeliveryState,
  type CandidateSmsAttemptView,
} from '../hrCandidateSmsDelivery';

const now = new Date('2026-08-26T08:00:00.000Z');
const attempt = (
  id: string,
  state: CandidateSmsAttemptView['providerDeliveryState'],
  createdAt: string,
): CandidateSmsAttemptView => ({ id, providerDeliveryState: state, createdAt: new Date(createdAt) });

const deliveredOlder = [
  attempt('delivered', 'DELIVERED', '2026-08-25T07:00:00.000Z'),
  attempt('failed-newer', 'FAILED', '2026-08-26T07:00:00.000Z'),
];
assert.deepEqual(candidateSmsDeliverySummary(deliveredOlder, now), {
  state: 'DELIVERED',
  latestAttemptId: 'failed-newer',
  deliveredAttemptId: 'delivered',
});
assert.deepEqual(candidateSmsRetryEligibility(deliveredOlder, now), {
  allowed: false,
  reason: 'DELIVERED',
  availableAt: null,
});

assert.deepEqual(candidateSmsRetryEligibility([
  attempt('accepted', 'ACCEPTED', '2026-08-25T09:00:00.000Z'),
], now), {
  allowed: false,
  reason: 'REPORT_WINDOW_ACTIVE',
  availableAt: new Date('2026-08-26T09:00:00.000Z'),
});

assert.equal(mapSmsIrDeliveryState(1), 'DELIVERED');
for (const state of [2, 4, 6, 7]) assert.equal(mapSmsIrDeliveryState(state), 'FAILED');
for (const state of [3, 5]) assert.equal(mapSmsIrDeliveryState(state), 'ACCEPTED');
for (const state of [0, null, undefined]) assert.equal(mapSmsIrDeliveryState(state), 'UNKNOWN');
assert.equal(candidateSmsInitialState({ success: false, failureKind: 'NETWORK' }), 'UNKNOWN');
assert.equal(candidateSmsInitialState({ success: false, failureKind: 'HTTP', httpStatus: 503 }), 'UNKNOWN');
assert.equal(candidateSmsInitialState({ success: false, failureKind: 'HTTP', httpStatus: 400 }), 'FAILED');
assert.equal(candidateSmsInitialState({ success: false, failureKind: 'PROVIDER_REJECTION' }), 'FAILED');
assert.equal(candidateSmsInitialState({ success: true, messageId: 42 }), 'ACCEPTED');

assert.deepEqual(candidateSmsRetryEligibility([
  attempt('pending-old', 'PENDING', '2026-08-25T07:59:59.000Z'),
], now), {
  allowed: true,
  reason: 'UNKNOWN_AFTER_REPORT_WINDOW',
  availableAt: null,
});

assert.deepEqual(candidateSmsRetryEligibility([
  attempt('unknown-old', 'UNKNOWN', '2026-08-25T07:59:59.000Z'),
], now), {
  allowed: true,
  reason: 'UNKNOWN_AFTER_REPORT_WINDOW',
  availableAt: null,
});

assert.deepEqual(candidateSmsRetryEligibility([
  attempt('failed-recent', 'FAILED', '2026-08-26T07:59:00.000Z'),
], now), {
  allowed: false,
  reason: 'COOLDOWN',
  availableAt: new Date('2026-08-26T08:01:00.000Z'),
});

assert.deepEqual(candidateSmsRetryEligibility([
  attempt('failed', 'FAILED', '2026-08-26T07:57:59.000Z'),
], now), {
  allowed: true,
  reason: 'FAILED',
  availableAt: null,
});

console.log('HR Candidate SMS delivery policy tests passed.');
