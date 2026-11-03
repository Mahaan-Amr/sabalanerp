import assert from 'node:assert/strict';
import {
  automaticHiringWorkItemSourceKey,
  eligibleUsersForHiringAction,
  personalHrWorkProgress,
  staleAutomaticHiringWorkItemStatus,
  startOfPersianMonth
} from '../hrWorkItems';

const now = new Date('2026-07-29T12:00:00.000Z');
const monthStart = startOfPersianMonth(now);
assert.equal(new Intl.DateTimeFormat('en-US-u-ca-persian', { day: 'numeric', timeZone: 'Asia/Tehran' }).format(monthStart), '1');
assert.equal(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).format(monthStart), '00:00');

assert.deepEqual(personalHrWorkProgress([
  { status: 'COMPLETE', completedAt: now },
  { status: 'COMPLETE', completedAt: monthStart },
  { status: 'PENDING' },
  { status: 'IN_PROGRESS' },
  { status: 'WAIVED' },
  { status: 'COMPLETE', completedAt: new Date(monthStart.getTime() - 1) }
], now), { completed: 2, remaining: 2, total: 4, percentage: 50 });

assert.deepEqual(personalHrWorkProgress([], now), {
  completed: 0,
  remaining: 0,
  total: 0,
  percentage: null
});

assert.deepEqual(eligibleUsersForHiringAction(
  ['HR_PROCESSOR', 'HR_MANAGER'],
  new Map([
    ['processor-user', new Set(['HR_PROCESSOR'])],
    ['manager-user', new Set(['HR_MANAGER'])],
    ['unrelated-user', new Set(['FINANCE_MANAGER'])]
  ])
), ['manager-user', 'processor-user']);

assert.equal(
  automaticHiringWorkItemSourceKey('application-1', 'review', 'processor-user'),
  'HIRING:application-1:review:USER:processor-user'
);
assert.equal(
  automaticHiringWorkItemSourceKey('application-1', 'review', null),
  'HIRING:application-1:review:UNASSIGNED'
);
assert.equal(
  staleAutomaticHiringWorkItemStatus(
    'HIRING:application-1:review:USER:former-user',
    new Set(['HIRING:application-1:review'])
  ),
  'WAIVED'
);
assert.equal(
  staleAutomaticHiringWorkItemStatus(
    'HIRING:application-1:review:USER:processor-user',
    new Set()
  ),
  'COMPLETE'
);

console.log('HR work-item tests passed.');
