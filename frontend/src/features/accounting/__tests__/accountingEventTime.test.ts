import assert from 'node:assert/strict';
import test from 'node:test';
import { accountingEventInstant } from '../accountingEventTime';

test('a current Partner action uses the server clock, not selected-day midnight', () => {
  assert.equal(accountingEventInstant({ timing: 'NOW' }), undefined);
});

test('explicit historical Accounting time is Tehran civil time regardless of browser timezone', () => {
  assert.equal(accountingEventInstant({ timing: 'HISTORICAL', date: '1405/06/12', time: '00:05:00' }), '2026-09-02T20:35:00.000Z');
  assert.equal(accountingEventInstant({ timing: 'HISTORICAL', date: '۱۴۰۵/۰۶/۱۲', time: '۱۲:۳۰:۰۰' }), '2026-09-03T09:00:00.000Z');
  for (const input of [{ date: '1405/06/12', time: '25:00:00' }, { date: '1405/13/01', time: '12:00:00' },
    { date: '1405/06/12', time: '' }]) assert.throws(() => accountingEventInstant({ timing: 'HISTORICAL', ...input }), /تاریخ|زمان/);
});
