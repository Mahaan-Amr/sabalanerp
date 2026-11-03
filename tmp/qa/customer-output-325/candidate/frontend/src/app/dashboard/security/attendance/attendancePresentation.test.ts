import assert from 'node:assert/strict';
import { formatAttendanceDelay } from './attendancePresentation';

assert.equal(formatAttendanceDelay(null), null);
assert.equal(formatAttendanceDelay(0), null);
assert.equal(formatAttendanceDelay(23), '۲۳ دقیقه');
assert.equal(formatAttendanceDelay(60), '۱ ساعت');
assert.equal(formatAttendanceDelay(95), '۱ ساعت و ۳۵ دقیقه');

console.log('attendance presentation tests passed');
