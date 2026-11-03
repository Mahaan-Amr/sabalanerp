import assert from 'node:assert/strict';
import { formatMoney, roundMoney, roundMoneyFields } from '../money';

assert.equal(roundMoney(24162273014.56), 24162273015);
assert.equal(roundMoney(24162273014.49), 24162273014);
assert.equal(roundMoney(-10.5), -11);
assert.equal(formatMoney(1250.5), '۱٬۲۵۱ تومان');
assert.deepEqual(
  roundMoneyFields({ amount: 10.6, count: 2.5 }, ['amount']),
  { amount: 11, count: 2.5 },
);

console.log('money presentation tests passed');
