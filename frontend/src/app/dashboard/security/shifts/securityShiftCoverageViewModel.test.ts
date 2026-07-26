import assert from 'node:assert/strict';
import { categorizeSecurityCoverageSlots } from './securityShiftCoverageViewModel';

const slots = [
  { id: 'future-later', operationalState: 'WAITING', startsAt: '2026-07-28T07:00:00.000Z', endsAt: '2026-07-28T19:00:00.000Z' },
  { id: 'closed-old', operationalState: 'CLOSED', startsAt: '2026-07-20T07:00:00.000Z', endsAt: '2026-07-20T19:00:00.000Z', session: { endedAt: '2026-07-20T19:02:00.000Z' } },
  { id: 'review', operationalState: 'MANAGER_REVIEW', startsAt: '2026-07-25T07:00:00.000Z', endsAt: '2026-07-25T19:00:00.000Z' },
  { id: 'active', operationalState: 'ACTIVE', startsAt: '2026-07-26T07:00:00.000Z', endsAt: '2026-07-26T19:00:00.000Z' },
  { id: 'future-next', operationalState: 'WAITING', startsAt: '2026-07-27T07:00:00.000Z', endsAt: '2026-07-27T19:00:00.000Z' },
  { id: 'no-shift', operationalState: 'NO_SHIFT_CONFIRMED', startsAt: '2026-07-21T07:00:00.000Z', endsAt: '2026-07-21T19:00:00.000Z', noShiftConfirmedAt: '2026-07-22T08:00:00.000Z' },
  { id: 'force-new', operationalState: 'FORCE_CLOSED', startsAt: '2026-07-23T07:00:00.000Z', endsAt: '2026-07-23T19:00:00.000Z', session: { endedAt: '2026-07-23T19:05:00.000Z' } },
];

const categorized = categorizeSecurityCoverageSlots(slots);
assert.deepEqual(categorized.open.map((slot) => slot.id), ['active', 'review', 'future-next', 'future-later']);
assert.deepEqual(categorized.finished.map((slot) => slot.id), ['force-new', 'no-shift', 'closed-old']);

console.log('security shift coverage view-model tests passed');
