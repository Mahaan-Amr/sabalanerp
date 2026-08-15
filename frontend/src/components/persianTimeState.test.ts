import assert from 'node:assert/strict';
import {
  formatTime12,
  parseTimeSelection,
  stepTimeSelection,
  to24HourTime,
} from './persianTimeState';

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
