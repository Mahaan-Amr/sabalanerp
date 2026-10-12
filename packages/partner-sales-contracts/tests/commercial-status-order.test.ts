import test from 'node:test';
import assert from 'node:assert/strict';
import { partnerCommercialStatus } from '../src/commercial-lifecycle';
test('partner main status follows sales approval customer acceptance offer and finality', () => {
  const initial = { salesApproved: false, customerAccepted: false, pricingAccepted: false };
  assert.equal(partnerCommercialStatus(initial), 'NOTE');
  assert.equal(partnerCommercialStatus({ ...initial, salesApproved: true }), 'DRAFT');
  assert.equal(partnerCommercialStatus({ ...initial, salesApproved: true }), 'DRAFT');
  assert.equal(partnerCommercialStatus({ ...initial, salesApproved: true, customerAccepted: true }), 'CUSTOMER_SIGNED');
  assert.equal(partnerCommercialStatus({ ...initial, customerAccepted: true, pricingReceived: true }), 'QUOTED');
  assert.equal(partnerCommercialStatus({ ...initial, pricingAccepted: true }), 'QUOTED');
  assert.equal(partnerCommercialStatus({ ...initial, salesApproved: true, customerAccepted: true, pricingAccepted: true }), 'FINAL');
  assert.equal(partnerCommercialStatus({ ...initial, salesApproved: true, customerAccepted: true, pricingReceived: true }), 'QUOTED');
  assert.equal(partnerCommercialStatus({ ...initial, pricingReceived: true, expired: true }), 'EXPIRED');
  assert.equal(partnerCommercialStatus({ ...initial, pricingReceived: true, cancelled: true }), 'CANCELLED');
});

test('post-edit note wins until Partner confirmation, including existing customer acceptance and complete answers', () => {
  const edited = { edited: true, salesApproved: false, customerAccepted: true, pricingAccepted: false, pricingReceived: true };
  assert.equal(partnerCommercialStatus(edited), 'NOTE');
  assert.equal(partnerCommercialStatus({ ...edited, salesApproved: true }), 'QUOTED');
  assert.equal(partnerCommercialStatus({ ...edited, inquiryWaiting: true }), 'NOTE');
  assert.equal(partnerCommercialStatus({ ...edited, salesApproved: true, pricingReceived: false, inquiryWaiting: true }), 'WAITING');
  assert.equal(partnerCommercialStatus({ ...edited, expired: true }), 'EXPIRED');
  assert.equal(partnerCommercialStatus({ ...edited, cancelled: true }), 'CANCELLED');
});
