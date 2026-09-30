import assert from 'node:assert/strict';
import test from 'node:test';
import { roundContractPayableTotal, sumContractMonetaryAmounts, verifyContractMonetaryRounding, multiplyContractMonetaryAmounts } from '../contractMonetaryRounding';
import { planLegacyProductGraphMigration } from '../legacyMigration';

test('sums exact rows before half-up rounding in the declared currency', () => {
  const source = sumContractMonetaryAmounts(['100.4', '100.4']);
  const evidence = roundContractPayableTotal(source, 'IRT');
  assert.equal(source, '200.8');
  assert.equal(evidence.roundedAmount, '201');
  assert.equal(evidence.difference, '0.2');
  assert.equal(roundContractPayableTotal('200.49', 'IRR').roundedAmount, '200');
  assert.equal(roundContractPayableTotal('200.5', 'IRR').roundedAmount, '201');
  assert.equal(roundContractPayableTotal('0.49', 'IRT').roundedAmount, '0');
  assert.equal(roundContractPayableTotal('0.5', 'IRT').roundedAmount, '1');
});

test('retains large amounts and half-unit boundaries without floating-point loss', () => {
  const source = sumContractMonetaryAmounts(['90071992547409931234.25', '90071992547409931234.25']);
  assert.equal(roundContractPayableTotal(source, 'IRT').roundedAmount, '180143985094819862469');
  assert.equal(roundContractPayableTotal('100.499999999999999999999', 'IRT').roundedAmount, '100');
  assert.equal(sumContractMonetaryAmounts([100.4, 100.4, -0.3]), '200.5');
  assert.equal(sumContractMonetaryAmounts([1e-7, -1e-7]), '0');
});

test('replay rejects changed currency, source, policy and hidden evidence changes', () => {
  const evidence = roundContractPayableTotal('200.8', 'IRT');
  assert.equal(verifyContractMonetaryRounding('200.8', 'IRT', evidence), '201');
  for (const changed of [{ ...evidence, policyVersion: 'unknown' }, { ...evidence, difference: '0' },
    { ...evidence, roundedAmount: '200' }, { ...evidence, hidden: true }]) {
    assert.throws(() => verifyContractMonetaryRounding('200.8', 'IRT', changed));
  }
  assert.throws(() => verifyContractMonetaryRounding('200.7', 'IRT', evidence));
  assert.throws(() => verifyContractMonetaryRounding('200.8', 'IRR', evidence));
  assert.throws(() => roundContractPayableTotal('-1', 'IRT'));
  assert.throws(() => roundContractPayableTotal(Infinity, 'IRT'));
});

test('new prepared graph policy keeps fractional rows instead of rejecting or rounding them', () => {
  const products = ['a', 'b'].map(rowId => ({ rowId, productId: 'catalog-prepared', productType: 'prepared',
    preparedUnit: 'count', preparedQuantity: 1, quantity: 1, unitPrice: 100.4,
    originalTotalPrice: 100.4, totalPrice: 100.4 }));
  const input = { contractId: 'precise-prepared', revision: 1, products,
    calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1',
      pricing: 'pricing-precise-prepared-v2', rounding: 'rounding-v2' } };
  const plan = planLegacyProductGraphMigration(input);
  assert.equal(plan.ok, true, JSON.stringify(plan));
  if (!plan.ok) return;
  assert.equal(plan.graph.rows[0].commercial.totalAmountToman, '100.4');
  assert.equal(plan.reconciliation.canonicalTotalAmountToman, '200.8');
  assert.equal(roundContractPayableTotal(plan.reconciliation.canonicalTotalAmountToman, 'IRT').roundedAmount, '201');
  assert.equal(planLegacyProductGraphMigration({ ...input,
    calculationPolicy: { ...input.calculationPolicy, pricing: 'pricing-v1' } }).ok, false,
    'historical policy keeps its original evidence requirements');
  assert.equal(multiplyContractMonetaryAmounts(1.23, 0.4), '0.492');
});
