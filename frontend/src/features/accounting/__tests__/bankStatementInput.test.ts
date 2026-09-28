import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBankApiRecord } from '../bankStatementInput';

test('a filename in the API record gives an actionable Persian upload error', () => {
  assert.throws(() => parseBankApiRecord('bank-mixed.csv'), /بارگذاری کنید/);
  for (const value of ['null', '[]', '12']) assert.throws(() => parseBankApiRecord(value), /شیء JSON/);
  assert.deepEqual(parseBankApiRecord('{"reference":"QA-1","amountRials":"1200"}'), { reference: 'QA-1', amountRials: '1200' });
});
