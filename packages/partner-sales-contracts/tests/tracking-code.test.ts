import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerCustomerContractLabel, partnerTrackingCode } from '../src/tracking-code';

test('the same Case always has one shorter, collision-free tracking label', () => {
  const first = 'PC-c27668a2-7578-4229-a060-b1f7639b627f';
  const second = 'PC-c27668a2-7578-4229-a060-b1f7639b6280';
  assert.match(partnerTrackingCode(first), /^همکار-[0-9A-Z]{25}$/);
  assert.notEqual(partnerTrackingCode(first), partnerTrackingCode(second));
  assert.equal(partnerTrackingCode(first), partnerTrackingCode(first));
  assert.equal(partnerCustomerContractLabel(first, '100329'), '100329');
  assert.equal(partnerCustomerContractLabel(first), partnerTrackingCode(first));
  assert.equal(partnerTrackingCode(first, 329), 'همکار-۰۰۳۲۹');
  assert.equal(partnerCustomerContractLabel(first, null, 329), 'همکار-۰۰۳۲۹');
});
