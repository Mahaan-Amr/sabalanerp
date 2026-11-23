import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateOriginalReturnAmounts } from '../stoneReturnOriginalAmounts';

test('three fractional returns use the original remainder exactly', () => {
  const original = { quantity: '3', netRials: '100', taxRials: '10', costRials: '2' };
  const quantities = ['0', '1', '2'];
  assert.deepEqual(quantities.map(prior => allocateOriginalReturnAmounts(original, prior, '1')), [
    { netRials: 33n, taxRials: 3n, costRials: 1n },
    { netRials: 34n, taxRials: 4n, costRials: 0n },
    { netRials: 33n, taxRials: 3n, costRials: 1n },
  ]);
});
