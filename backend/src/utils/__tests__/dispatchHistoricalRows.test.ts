import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDispatchProductRows } from '../printTemplate';

// Public dispatch projection boundary: layer grouping must retain each operation's evidence.
test('grouped layer cuts keep the historical rate attached to their own row', () => {
  const rows = createDispatchProductRows({ products: [{
    rowId: 'layer', productType: 'stair', quantity: 3, length: 1, width: 5,
    meta: { isLayer: true, layerInfo: { layerSetQuantity: 3 } },
    cuttingBreakdown: [
      { type: 'longitudinal', meters: 1, rate: 10, cost: 10, dispatchHistoricalRate: '10' },
      { type: 'longitudinal', meters: 1, rate: 10, cost: 10, dispatchHistoricalRate: '10' },
      { type: 'cross', meters: 1, rate: 20, cost: 20, dispatchHistoricalRate: '20' },
    ],
  }] }, { currency: 'TOMAN' })('layer').filter(row => row.category === 'برش');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].linearMeasurement, '۲');
  assert.equal(rows[0].rate, '۱۰ / متر طول');
  assert.equal(rows[1].rate, '۲۰ / متر طول');
});
