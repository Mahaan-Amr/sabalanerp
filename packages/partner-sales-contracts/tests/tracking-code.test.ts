import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerCustomerContractLabel, partnerTrackingCode } from '../src/tracking-code';

test('only a numbered Case exposes a customer-facing tracking label', () => {
  const first = 'PC-c27668a2-7578-4229-a060-b1f7639b627f';
  const second = 'PC-c27668a2-7578-4229-a060-b1f7639b6280';
  assert.equal(partnerTrackingCode(first), 'همکار');
  assert.equal(partnerTrackingCode(second), 'همکار');
  assert.equal(partnerTrackingCode(first), partnerTrackingCode(first));
  assert.equal(partnerCustomerContractLabel(first, '100329'), '۱۰۰۳۲۹');
  assert.equal(partnerCustomerContractLabel(first), partnerTrackingCode(first));
  assert.equal(partnerTrackingCode(first, 329), '۰۰۳۲۹');
  assert.equal(partnerCustomerContractLabel(first, null, 329), '۰۰۳۲۹');
});
