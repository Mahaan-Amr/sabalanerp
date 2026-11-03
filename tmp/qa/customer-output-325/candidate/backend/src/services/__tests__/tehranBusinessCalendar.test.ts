import assert from 'node:assert/strict';
import { addTehranWorkingDays } from '../tehranBusinessCalendar';

assert.equal(
  addTehranWorkingDays(new Date('2026-08-20T08:00:00.000Z'), 1).toISOString(),
  '2026-08-22T08:00:00.000Z',
  'Friday is not a Tehran working day',
);
assert.equal(
  addTehranWorkingDays(new Date('2026-08-19T08:00:00.000Z'), 3).toISOString(),
  '2026-08-23T08:00:00.000Z',
  'three working days skip Friday while preserving Tehran wall-clock time',
);

console.log('Tehran business calendar tests passed.');
