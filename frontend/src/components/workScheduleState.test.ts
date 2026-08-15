import assert from 'node:assert/strict';
import {
  applyBulkTimes,
  shouldConfirmBulkTimeReplacement,
  type WorkScheduleDayValue,
} from './workScheduleState';

const days: WorkScheduleDayValue[] = [
  { weekday: 0, startTime: '08:00', endTime: '17:00' },
  { weekday: 1, startTime: '09:00', endTime: '18:00' },
];

assert.equal(shouldConfirmBulkTimeReplacement(days, '08:00', '17:00'), true);
assert.equal(shouldConfirmBulkTimeReplacement(days, '09:00', '18:00'), true);
assert.equal(shouldConfirmBulkTimeReplacement([], '08:00', '17:00'), false);

const replaced = applyBulkTimes(days, '07:30', '16:30');
assert.deepEqual(replaced, [
  { weekday: 0, startTime: '07:30', endTime: '16:30' },
  { weekday: 1, startTime: '07:30', endTime: '16:30' },
]);
assert.notEqual(replaced[0], days[0]);
assert.equal(days[0].startTime, '08:00');

console.log('Work schedule state tests passed.');
