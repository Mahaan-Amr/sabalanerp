import assert from 'node:assert/strict';
import { buildSellerProductHistory } from '../sellerProductHistory';

const result = buildSellerProductHistory([
  {
    createdAt: new Date('2026-07-25T09:00:00.000Z'),
    contractData: {
      products: [
        { productId: 'catalog-1' },
        { productId: 'catalog-1' },
        { productId: 'catalog-2' }
      ]
    }
  },
  {
    createdAt: new Date('2026-07-24T09:00:00.000Z'),
    contractData: {
      products: [
        { productId: 'catalog-1' },
        { product: { id: 'catalog-3' } }
      ]
    }
  },
  {
    createdAt: new Date('2026-07-23T09:00:00.000Z'),
    contractData: null
  }
]);

assert.deepEqual(result, {
  'catalog-1': {
    selectionCount: 3,
    lastSelectedAt: '2026-07-25T09:00:00.000Z'
  },
  'catalog-2': {
    selectionCount: 1,
    lastSelectedAt: '2026-07-25T09:00:00.000Z'
  },
  'catalog-3': {
    selectionCount: 1,
    lastSelectedAt: '2026-07-24T09:00:00.000Z'
  }
});

console.log('sellerProductHistory tests passed');
