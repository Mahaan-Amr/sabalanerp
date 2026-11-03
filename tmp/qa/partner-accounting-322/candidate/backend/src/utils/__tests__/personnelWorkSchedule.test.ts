import assert from 'node:assert/strict';
import { calculateDelayMinutes, calculatePresenceMinutes, calculateScheduledOvertime, normalizeWorkSchedule, persianWeekdayIndex } from '../personnelWorkSchedule';
import { parseSecurityBusinessDate, securityDateKey, securityPersianDate } from '../securityBusinessDate';

// Regression: Tehran midnight was sent as the previous UTC evening, then truncated to the previous day.
const legacyIso = '2026-07-17T20:30:00.000Z';
assert.equal(securityDateKey(parseSecurityBusinessDate(legacyIso)), '2026-07-18');
assert.equal(securityDateKey(parseSecurityBusinessDate('2026-07-18')), '2026-07-18');
assert.equal(securityPersianDate(parseSecurityBusinessDate('2026-07-18')), '۱۴۰۵/۴/۲۷');
assert.equal(persianWeekdayIndex(parseSecurityBusinessDate('2026-07-18')), 0);

assert.equal(calculateDelayMinutes('08:25', '08:00'), 25);
assert.equal(calculateDelayMinutes('07:50', '08:00'), 0);
assert.equal(calculateScheduledOvertime('17:30', '08:00', '17:00'), 30);
assert.equal(calculateScheduledOvertime('07:30', '19:00', '07:00'), 30);
assert.equal(calculatePresenceMinutes('09:00', '13:30'), 270);
assert.equal(calculatePresenceMinutes('19:00', '01:00'), 360);

const schedule = normalizeWorkSchedule({ effectiveDate: '2099-01-01', days: [{ weekday: 0, startTime: '08:00', endTime: '17:00' }] });
assert.equal(schedule?.days.length, 1);
assert.throws(() => normalizeWorkSchedule({ effectiveDate: '2099-01-01', days: [{ weekday: 0, startTime: '08:00', endTime: '' }] }), /زمان از و تا/);

console.log('personnel work schedule tests passed');
