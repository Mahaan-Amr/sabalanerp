import assert from 'node:assert/strict';
import type { Product } from '../../../types/contract.types';
import {
  changePreparedKind,
  changePreparedQuantity,
  changePreparedUnit,
  changePreparedUnitPrice,
  resolvePreparedProductPresentation
} from '../preparedProductState';

const product = {
  id: 'prepared-1',
  code: 'P-1',
  name: 'Cubic',
  namePersian: 'کیوبیک',
  basePrice: 120
} as Product;

const defaults = resolvePreparedProductPresentation({}, product);
assert.deepEqual(defaults, {
  kind: 'cubic',
  allowedUnits: ['squareMeter', 'ton', 'count'],
  unit: 'count',
  quantity: 1,
  unitPrice: 120,
  total: 120
});

assert.deepEqual(
  changePreparedKind({ preparedUnit: 'ton' }, 'readyPiece'),
  { preparedKind: 'readyPiece', preparedUnit: 'count' }
);
assert.deepEqual(
  changePreparedUnit({ preparedQuantity: 2.5 }, 'squareMeter'),
  { preparedQuantity: 2.5, preparedUnit: 'squareMeter', squareMeters: 2.5 }
);
assert.deepEqual(
  changePreparedQuantity({ preparedUnit: 'squareMeter' }, 3, 'squareMeter'),
  {
    preparedUnit: 'squareMeter',
    preparedQuantity: 3,
    quantity: 3,
    squareMeters: 3
  }
);
assert.deepEqual(
  changePreparedUnitPrice({ description: 'same payload' }, 80),
  {
    description: 'same payload',
    unitPrice: 80,
    pricePerSquareMeter: 80
  }
);

const ready = resolvePreparedProductPresentation({
  preparedKind: 'readyPiece',
  preparedUnit: 'ton',
  preparedQuantity: 2,
  unitPrice: 75
}, product);
assert.deepEqual(ready.allowedUnits, ['squareMeter', 'count']);
assert.equal(ready.unit, 'count');
assert.equal(ready.total, 150);

console.log('prepared product behavioral parity tests passed');
