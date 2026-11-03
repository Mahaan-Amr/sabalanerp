import assert from 'node:assert/strict';
import { parseCanonicalDecimal as c, parseStableIdentity as id } from '@sabalanerp/contract-product-graph';
import {
  orderRemainderStocks,
  remainderStockSummary
} from '../ContractRemaindersSection';

const stocks = [
  {
    remainingStoneId: id('remaining-stone', 'later-same'),
    ownerProductRowId: id('product-row', 'source-1'),
    catalogProductId: 'same',
    sourceBatchId: id('source-batch', 'batch-1'),
    lengthMeters: c('1.5'),
    widthMeters: c('0.16'),
    quantity: 3,
    creationOrder: 5,
    materialPaid: true as const
  },
  {
    remainingStoneId: id('remaining-stone', 'earlier-other'),
    ownerProductRowId: id('product-row', 'source-2'),
    catalogProductId: 'other',
    sourceBatchId: id('source-batch', 'batch-2'),
    lengthMeters: c('1'),
    widthMeters: c('0.2'),
    quantity: 1,
    creationOrder: 1,
    materialPaid: true as const
  },
  {
    remainingStoneId: id('remaining-stone', 'earlier-same'),
    ownerProductRowId: id('product-row', 'source-1'),
    catalogProductId: 'same',
    sourceBatchId: id('source-batch', 'batch-1'),
    lengthMeters: c('1.5'),
    widthMeters: c('0.04'),
    quantity: 2,
    creationOrder: 2,
    materialPaid: true as const
  }
];

assert.deepEqual(
  orderRemainderStocks(stocks, 'same').map(stock => stock.remainingStoneId),
  [
    id('remaining-stone', 'earlier-same'),
    id('remaining-stone', 'later-same'),
    id('remaining-stone', 'earlier-other')
  ]
);
assert.deepEqual(remainderStockSummary(stocks[0]), {
  geometry: '16cm × 1.5m = 0.24m²',
  quantity: '3 عدد'
});

console.log('remainder modal state tests passed');
