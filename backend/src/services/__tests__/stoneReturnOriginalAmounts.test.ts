import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateOriginalReturnAmounts, calculateStoneReturnTaxProvenance } from '../stoneReturnOriginalAmounts';

test('three fractional returns use the original remainder exactly', () => {
  const original = { quantity: '3', netRials: '100', taxRials: '10', costRials: '2' };
  const quantities = ['0', '1', '2'];
  assert.deepEqual(quantities.map(prior => allocateOriginalReturnAmounts(original, prior, '1')), [
    { netRials: 33n, taxRials: 3n, costRials: 1n },
    { netRials: 34n, taxRials: 4n, costRials: 0n },
    { netRials: 33n, taxRials: 3n, costRials: 1n },
  ]);
});

test('raw VAT uses the original tax rule before return allocation rounds whole rials', () => {
  const source = {
    quantity: '3', rawBaseAmount: '105', recordedRawTaxAmount: '11',
    roundedTaxRials: '11', rateBasisPoints: 1000, exempt: false,
  };
  const first = calculateStoneReturnTaxProvenance(source, '0', '1');
  const second = calculateStoneReturnTaxProvenance(source, '1', '1');
  assert.equal(first.rawTaxAmount, '3.50000000');
  assert.equal(second.rawTaxAmount, '3.50000000');
  assert.equal(first.rawBaseAmount, '35.00000000');
  assert.equal(second.allocation.originalCalculatedRawTaxAmount, '10.5');
  assert.equal(second.allocation.originalRoundedTaxRials, '11');
  assert.equal(second.allocation.cumulativeReturnedQuantity, '2');
  assert.equal(allocateOriginalReturnAmounts({ quantity: '3', netRials: '105', taxRials: '11', costRials: '0' }, '1', '1').taxRials, 3n);
});
