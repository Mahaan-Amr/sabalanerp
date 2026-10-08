import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remainingPartnerAmount, stepPartnerDeliveryAmount } from './partnerRetail';

test('delivery arrows preserve decimal quantities and clamp to the allocation left by other deliveries', () => {
  const maximum = remainingPartnerAmount('14.4', ['4.3']);
  assert.equal(maximum, '10.1');
  assert.equal(stepPartnerDeliveryAmount('0.1', maximum!, 1), '1.1');
  assert.equal(stepPartnerDeliveryAmount('9.8', maximum!, 1), '10.1');
  assert.equal(stepPartnerDeliveryAmount('0.4', maximum!, -1), '0');
  assert.equal(stepPartnerDeliveryAmount('0', '0.25', 1), '0.25');
  assert.equal(remainingPartnerAmount('14.4', ['4.3', maximum!]), '0');
});

test('delivery arrows retain precision beyond binary floating point and reject invalid quantities', () => {
  assert.equal(stepPartnerDeliveryAmount('0.123456789012345678', '2', 1), '1.123456789012345678');
  assert.equal(stepPartnerDeliveryAmount('1.123456789012345678', '2', -1), '0.123456789012345678');
  assert.equal(stepPartnerDeliveryAmount('invalid', '2', 1), null);
  assert.equal(stepPartnerDeliveryAmount('1', '-2', 1), null);
});
