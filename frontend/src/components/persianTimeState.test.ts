import assert from 'node:assert/strict';
import {
  reduceTimeDraft,
  formatTime12,
  parseTimeSelection,
  stepTimeSelection,
  to24HourTime,
} from './persianTimeState';

const initialDraft = { selection: { hour: 8, minute: 0, period: 'AM' as const }, commitValue: null };
const changedHour = reduceTimeDraft(initialDraft, { type: 'CHANGE_HOUR', hour: 11 });
assert.deepEqual(changedHour, {
  selection: { hour: 11, minute: 0, period: 'AM' },
  commitValue: null,
});
const changedMinute = reduceTimeDraft(changedHour, { type: 'CHANGE_MINUTE', minute: 45 });
assert.equal(changedMinute.commitValue, null);
const confirmedTime = reduceTimeDraft(changedMinute, { type: 'CONFIRM' });
assert.equal(confirmedTime.commitValue, '11:45');

assert.deepEqual(parseTimeSelection('00:05'), { hour: 12, minute: 5, period: 'AM' });
assert.deepEqual(parseTimeSelection('23:59'), { hour: 11, minute: 59, period: 'PM' });
assert.deepEqual(parseTimeSelection('invalid'), { hour: 8, minute: 0, period: 'AM' });

assert.equal(to24HourTime({ hour: 12, minute: 0, period: 'AM' }), '00:00');
assert.equal(to24HourTime({ hour: 12, minute: 0, period: 'PM' }), '12:00');
assert.equal(formatTime12('17:07'), '05:07 PM');

assert.deepEqual(
  stepTimeSelection({ hour: 12, minute: 59, period: 'AM' }, 'minute', 1),
  { hour: 12, minute: 0, period: 'AM' },
);
assert.deepEqual(
  stepTimeSelection({ hour: 12, minute: 0, period: 'AM' }, 'hour', -1),
  { hour: 11, minute: 0, period: 'AM' },
);

console.log('Persian time state tests passed.');
