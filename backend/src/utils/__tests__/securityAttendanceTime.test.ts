import test from 'node:test';
import assert from 'node:assert/strict';
import { isFutureSecurityAttendanceTime } from '../securityBusinessDate';

test('manual attendance accepts past and current server minute, with no future-minute tolerance', () => {
  const now = new Date('2026-10-21T07:59:30+03:30');
  for (const value of ['2026-10-20T17:00:00+03:30', '2026-10-21T07:58:59+03:30', '2026-10-21T07:59:00+03:30', '2026-10-21T07:59:59.999+03:30']) {
    assert.equal(isFutureSecurityAttendanceTime(new Date(value), now), false, value);
  }
  for (const value of ['2026-10-21T08:00:00+03:30', '2026-10-21T17:00:00+03:30', '2026-10-22T00:00:00+03:30']) {
    assert.equal(isFutureSecurityAttendanceTime(new Date(value), now), true, value);
  }
});

test('minute boundary stays exact across Tehran midnight and different timestamp offsets', () => {
  const beforeMidnight = new Date('2026-10-21T23:59:59.999+03:30');
  const midnight = new Date('2026-10-22T00:00:00+03:30');
  assert.equal(isFutureSecurityAttendanceTime(midnight, beforeMidnight), true);
  assert.equal(isFutureSecurityAttendanceTime(midnight, midnight), false);
  assert.equal(isFutureSecurityAttendanceTime(new Date('2026-10-21T20:30:00Z'), midnight), false);
});
