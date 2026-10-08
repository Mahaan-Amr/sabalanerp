import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partnerPaymentAllocation, partnerRetailSummary } from './partnerRetail';
const total = { amount: '0.3', currency: 'IRT' as const };
const payment = (amount: string, currency: 'IRT' | 'IRR' = 'IRT') => ({ amount: { amount, currency } });

test('payment totals distinguish empty, partial, exact, and excess allocations without floating point rounding', () => {
  assert.deepEqual(partnerPaymentAllocation(total, []), { paid: '0', remaining: '0.3', extra: '0', state: 'short' });
  assert.deepEqual(partnerPaymentAllocation(total, [payment('0.1')]), { paid: '0.1', remaining: '0.2', extra: '0', state: 'short' });
  assert.deepEqual(partnerPaymentAllocation(total, [payment('0.1'), payment('0.2')]), { paid: '0.3', remaining: '0', extra: '0', state: 'matched' });
  assert.deepEqual(partnerPaymentAllocation(total, [payment('0.4')]), { paid: '0.4', remaining: '-0.1', extra: '0.1', state: 'over' });
});

test('payment summary rejects mixed currency and invalid amounts rather than presenting a payable balance', () => {
  assert.equal(partnerPaymentAllocation(total, [payment('0.1', 'IRR')]), null);
  assert.equal(partnerPaymentAllocation(total, [payment('-1')]), null);
  assert.equal(partnerPaymentAllocation(total, [payment('bad')]), null);
});

test('undiscounted Partner service totals require the full retail amount and historical discounts remain explicit inputs', () => {
  const services = [{ serviceRowId: 'service', title: 'خدمت', quantity: '2', unit: 'count',
    retailUnitPrice: { amount: '1000', currency: 'IRT' as const } }];
  const undiscounted = partnerRetailSummary([], { amount: '0', currency: 'IRT' }, services);
  assert.equal(undiscounted.valid, true);
  if (!undiscounted.valid) return;
  assert.equal(undiscounted.retail, '2000');
  assert.equal(partnerPaymentAllocation({ amount: undiscounted.retail, currency: 'IRT' }, [payment('1800')])?.state, 'short');
  const historical = partnerRetailSummary([], { amount: '200', currency: 'IRT' }, services);
  assert.equal(historical.valid && historical.retail, '1800');
});
