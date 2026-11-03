import assert from 'node:assert/strict';
import test from 'node:test';
import { accountMoney, normalizeAccountAmount } from './customerAccountModel';

test('customer money preserves currency, Persian input and integers beyond Number precision', () => {
  assert.equal(normalizeAccountAmount('−۱٬۲۳۴'), '-1234');
  assert.equal(normalizeAccountAmount('-۱٬۲۳۴'), '-1234');
  assert.equal(accountMoney('9007199254740993'), `${BigInt('9007199254740993').toLocaleString('fa-IR')} ریال`);
  assert.equal(accountMoney('100.50', 'تومان'), '۱۰۰٫۵ تومان');
  assert.equal(accountMoney('0'), '۰ ریال');
  assert.equal(accountMoney('-0.5'), '−۰٫۵ ریال');
});
