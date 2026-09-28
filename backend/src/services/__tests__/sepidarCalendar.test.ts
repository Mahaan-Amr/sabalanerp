import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSepidarLocalDateTime, sepidarLocalDayStart } from '../sepidarCalendar';

test('Sepidar midnight belongs to its Tehran fiscal day across the 1404/1405 boundary', () => {
  assert.equal(sepidarLocalDayStart('2026-03-21').toISOString(), '2026-03-20T20:30:00.000Z');
  assert.equal(parseSepidarLocalDateTime('2026-03-21T00:00:00.0000000').toISOString(), '2026-03-20T20:30:00.000Z');
  assert.equal(sepidarLocalDayStart('2025-03-21').toISOString(), '2025-03-20T20:30:00.000Z');
});
