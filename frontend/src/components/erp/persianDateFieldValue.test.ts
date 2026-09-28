import assert from 'node:assert/strict';
import test from 'node:test';
import { fromPersianDateFieldValue, toPersianDateFieldValue } from './persianDateFieldValue';

test('Persian date selection preserves ISO day and local clock without timezone conversion', () => {
  assert.equal(toPersianDateFieldValue('2026-03-21', 'iso-date'), '1405/01/01');
  assert.equal(fromPersianDateFieldValue('1405/01/01', 'iso-date'), '2026-03-21');
  assert.equal(toPersianDateFieldValue('2026-09-28T23:59', 'local-datetime'), '1405/07/06 23:59');
  assert.equal(fromPersianDateFieldValue('1405/07/06 23:59', 'local-datetime'), '2026-09-28T23:59');
  assert.equal(fromPersianDateFieldValue('', 'iso-date'), '');
  assert.equal(toPersianDateFieldValue('1405/07/06', 'persian'), '1405/07/06');
});
