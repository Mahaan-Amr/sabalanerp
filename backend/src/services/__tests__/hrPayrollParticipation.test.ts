import assert from 'node:assert/strict';
import { normalizePayrollParticipationCommand } from '../hrPayrollParticipation';

const planned = new Date('2026-07-23T00:00:00.000Z');

assert.deepEqual(
  normalizePayrollParticipationCommand(
    { effectiveFrom: '2026-07-23', reviewConfirmed: true },
    planned
  ),
  { effectiveFrom: planned, startMismatchReason: null }
);
assert.throws(
  () => normalizePayrollParticipationCommand(
    { effectiveFrom: '2026-07-24', reviewConfirmed: true },
    planned
  ),
  /reason/i
);
assert.throws(
  () => normalizePayrollParticipationCommand(
    { effectiveFrom: '2026-07-23' },
    planned
  ),
  /confirm/i
);
assert.equal(
  normalizePayrollParticipationCommand(
    {
      effectiveFrom: '2026-07-24',
      startMismatchReason: 'Approved payroll cutover',
      reviewConfirmed: true,
    },
    planned
  ).startMismatchReason,
  'Approved payroll cutover'
);

console.log('HR payroll participation policy tests passed.');
