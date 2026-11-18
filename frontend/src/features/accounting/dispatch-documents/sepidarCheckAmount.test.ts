import assert from 'node:assert/strict';
import test from 'node:test';
import { sepidarCheckAmount } from './sepidarCheckAmount';

test('compares Persian rial input with the selected driver total in toman', () => {
  const expected = sepidarCheckAmount({ amount: '10560000', currency: 'تومان' });
  assert.equal(expected, '105600000');
  assert.equal(sepidarCheckAmount({ amount: '۱۰۵٬۶۰۰٬۰۰۰', currency: 'IRR' }), expected);
  assert.notEqual(sepidarCheckAmount({ amount: '۱۰٬۵۶۰٬۰۰۰', currency: 'IRR' }), expected);
});

test('keeps conversion exact for fractional and large amounts', () => {
  assert.equal(sepidarCheckAmount({ amount: '9007199254740993.0250', currency: 'IRT' }), '90071992547409930.25');
  assert.equal(sepidarCheckAmount({ amount: '۰۰۱٫۲۰۰', currency: 'ریال' }), '1.2');
});

test('refuses missing pricing and unsupported currency', () => {
  assert.equal(sepidarCheckAmount({ amount: 'UNKNOWN', currency: 'IRT' }), null);
  assert.equal(sepidarCheckAmount({ amount: '', currency: 'IRR' }), null);
  assert.equal(sepidarCheckAmount({ amount: '10560000', currency: 'USD' }), null);
});
