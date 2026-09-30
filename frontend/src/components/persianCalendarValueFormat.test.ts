import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarDisplayDate, calendarStoredDate } from './persianCalendarValueFormat';

test('Partner installment ISO date opens the selected Jalali year and month', () => {
  const displayed = calendarDisplayDate('2026-10-28', 'gregorian');
  assert.equal(displayed, '1405/08/06');
  assert.equal(displayed.slice(0, 7), '1405/08');
  assert.equal(calendarStoredDate('1405/08/07', 'gregorian'), '2026-10-29');
});
test('date-only conversion round trips across year and leap-day boundaries', () => {
  for (const iso of ['2026-09-28', '2026-03-21', '2024-02-29', '2025-03-20']) {
    assert.equal(calendarStoredDate(calendarDisplayDate(iso, 'gregorian'), 'gregorian'), iso);
  }
});
test('ordinary Sabalan date and date-time behavior stays in Jalali', () => {
  for (const value of ['', '1405/08/06', '1405/08/06 14:30']) {
    assert.equal(calendarDisplayDate(value, 'jalali'), value);
    assert.equal(calendarStoredDate(value, 'jalali'), value);
  }
});
test('empty or invalid ISO input cannot become an invalid calendar month', () => {
  for (const value of ['', 'invalid', '2026-13-01', '2026-02-30']) {
    assert.equal(calendarDisplayDate(value, 'gregorian'), '');
  }
  assert.equal(calendarStoredDate('', 'gregorian'), '');
});
