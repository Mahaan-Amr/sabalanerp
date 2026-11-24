import assert from 'node:assert/strict';
import test from 'node:test';
import { describeStoneReturnRate } from './stoneReturnRate';

test('calculates the whole-rial credit from the agreed rate and accepted quantity', () => {
  assert.deepEqual(describeStoneReturnRate('۳٫۳۳۳۳۳۳۳۳', '3'), {
    agreedUnitRateRials: '3.33333333', customerCreditRials: '10',
  });
  assert.deepEqual(describeStoneReturnRate('۱۲٬۵۰۰٫۵', '2'), {
    agreedUnitRateRials: '12500.5', customerCreditRials: '25001',
  });
});
