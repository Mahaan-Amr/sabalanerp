import assert from 'node:assert/strict';
import { defaultOwnerForAction, personalHrWorkProgress, startOfPersianMonth } from '../hrWorkItems';

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

assert.equal(defaultOwnerForAction(
  ['HR_PROCESSOR', 'HR_MANAGER'],
  new Map([['HR_MANAGER', 'manager-user']])
), 'manager-user');

console.log('HR work-item tests passed.');
