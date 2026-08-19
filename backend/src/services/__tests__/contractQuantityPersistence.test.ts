import assert from 'node:assert/strict';
import test from 'node:test';
import { persistContractQuantityAtPolicyScale } from '../contractService';
import {
  CURRENT_CONTRACT_PRODUCT_POLICY,
  CURRENT_CONTRACT_PRODUCT_POLICY_V2,
} from '../contractProductGraphMigration';

test('contract writer replays the recorded persistence scale without binary floating point', () => {
  assert.equal(
    persistContractQuantityAtPolicyScale('58.335', CURRENT_CONTRACT_PRODUCT_POLICY).toString(),
    '58.34',
  );
  assert.equal(
    persistContractQuantityAtPolicyScale('58.3335', CURRENT_CONTRACT_PRODUCT_POLICY_V2).toString(),
    '58.334',
  );
});

test('contract writer rejects malformed quantities instead of creating a zero sentinel', () => {
  for (const value of [undefined, null, '', 'not-a-number', -1]) {
    assert.throws(
      () => persistContractQuantityAtPolicyScale(value, CURRENT_CONTRACT_PRODUCT_POLICY_V2),
      /کمیت واردشده معتبر نیست/,
    );
  }
});
