import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerMoneyText } from './partnerRetail';

test('retail totals group only whole digits and preserve decimal precision', () => {
  assert.equal(partnerMoneyText('675315000', 'IRT'), '۶۷۵,۳۱۵,۰۰۰ تومان');
  assert.equal(partnerMoneyText('12345.6789', 'IRR'), '۱۲,۳۴۵.۶۷۸۹ ریال');
});
