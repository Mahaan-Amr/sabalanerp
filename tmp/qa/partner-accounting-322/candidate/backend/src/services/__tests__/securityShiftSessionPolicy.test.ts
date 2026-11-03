import assert from 'node:assert/strict';
import {
  buildCombinedSecurityShiftTimeline,
  validateShiftSessionCorrectionPolicy,
} from '../securityShiftSessionPolicy';

const at = (value: string) => new Date(value);
const basePolicy = {
  now: at('2026-07-26T12:00:00.000Z'),
  plannedStartedAt: at('2026-07-26T05:30:00.000Z'),
  plannedEndedAt: at('2026-07-26T17:30:00.000Z'),
  proposedStartedAt: at('2026-07-26T05:35:00.000Z'),
  proposedEndedAt: at('2026-07-26T11:30:00.000Z'),
  requireEndedAt: false,
  deviationConfirmed: false,
  evidenceInstants: [],
  overlappingSessions: [],
};

assert.deepEqual(validateShiftSessionCorrectionPolicy(basePolicy), { deviatesFromPlan: false });

assert.throws(
  () => validateShiftSessionCorrectionPolicy({ ...basePolicy, proposedEndedAt: null, requireEndedAt: true }),
  /زمان شروع و پایان الزامی/
);
assert.throws(
  () => validateShiftSessionCorrectionPolicy({ ...basePolicy, proposedStartedAt: at('2026-07-26T13:00:00.000Z') }),
  /آینده/
);
assert.throws(
  () => validateShiftSessionCorrectionPolicy({
    ...basePolicy,
    evidenceInstants: [at('2026-07-26T05:34:00.000Z')],
  }),
  /همه گزارش‌ها و گشت‌زنی/
);
assert.throws(
  () => validateShiftSessionCorrectionPolicy({
    ...basePolicy,
    overlappingSessions: [{
      startedAt: at('2026-07-26T10:00:00.000Z'),
      endedAt: at('2026-07-26T13:00:00.000Z'),
    }],
  }),
  /هم‌پوشانی/
);
assert.throws(
  () => validateShiftSessionCorrectionPolicy({
    ...basePolicy,
    proposedStartedAt: at('2026-07-26T05:00:00.000Z'),
  }),
  /تأیید خروج/
);
assert.deepEqual(
  validateShiftSessionCorrectionPolicy({
    ...basePolicy,
    proposedStartedAt: at('2026-07-26T05:00:00.000Z'),
    deviationConfirmed: true,
  }),
  { deviatesFromPlan: true }
);

const timeline = buildCombinedSecurityShiftTimeline({
  defaultAuthor: 'نگهبان الف',
  logEntries: [{
    id: 'log-1',
    status: 'ACTIVE',
    rowNumber: 1,
    categoryNameSnapshot: 'رویداد',
    description: 'رویداد میان گشت',
    createdAt: '2026-07-26T06:15:00.000Z',
    participants: [],
    attachments: [],
  }],
  patrolSessions: [{
    id: 'patrol-1',
    status: 'FINISHED',
    startedAt: '2026-07-26T06:00:00.000Z',
    endedAt: '2026-07-26T06:30:00.000Z',
    description: 'محوطه بررسی شد',
    personnel: { user: { firstName: 'نگهبان', lastName: 'الف' } },
  }],
});

assert.deepEqual(timeline.map((event) => event.kind), ['PATROL_START', 'SHIFT_LOG', 'PATROL_FINISH']);
assert.equal(timeline[2].typeDescription, 'مدت گشت: ۳۰ دقیقه');
assert.equal(timeline[2].description, 'محوطه بررسی شد');

console.log('security shift session policy tests passed');
