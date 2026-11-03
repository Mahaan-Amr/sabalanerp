import assert from 'node:assert/strict';
import {
  buildContractCartRows,
  resolveContractRowIndex
} from '../contractCartRows';
import type { ContractProduct } from '../../../types/contract.types';

const row = (
  rowId: string,
  productType: ContractProduct['productType'],
  parentProductRowId?: string
): ContractProduct => ({
  rowId,
  productId: `catalog-${rowId}`,
  product: {} as ContractProduct['product'],
  productType,
  stoneCode: rowId,
  stoneName: rowId,
  diameterOrWidth: 40,
  length: 1,
  width: 40,
  quantity: 1,
  squareMeters: 0.4,
  pricePerSquareMeter: 100,
  totalPrice: 40,
  description: '',
  currency: 'تومان',
  lengthUnit: 'm',
  widthUnit: 'cm',
  isMandatory: false,
  mandatoryPercentage: 25,
  originalTotalPrice: 40,
  isCut: false,
  cutType: null,
  originalWidth: 40,
  originalLength: 1,
  cuttingCost: 0,
  cuttingCostPerMeter: 0,
  cutDescription: '',
  remainingStones: [],
  cutDetails: [],
  usedRemainingStones: [],
  totalUsedRemainingWidth: 0,
  totalUsedRemainingLength: 0,
  appliedSubServices: [],
  totalSubServiceCost: 0,
  usedLengthForSubServices: 0,
  usedSquareMetersForSubServices: 0,
  parentProductRowId
});

const source = row('source', 'longitudinal');
const unrelated = row('unrelated', 'prepared');
const remainderChild = row('child', 'longitudinal', source.rowId);
const stair = row('stair', 'stair');
const layer = {
  ...row('layer', 'stair', stair.rowId),
  meta: { isLayer: true }
};
const products = [source, unrelated, remainderChild, stair, layer];

{
  const projected = buildContractCartRows(products);
  assert.deepEqual(
    projected.map(item => item.product.rowId),
    ['source', 'unrelated', 'stair'],
    'top-level rows must retain explicit creation order'
  );
  assert.deepEqual(projected[0]?.children.map(item => item.rowId), ['child']);
  assert.deepEqual(projected[2]?.children.map(item => item.rowId), ['layer']);
}

{
  const reordered = [unrelated, source, remainderChild];
  assert.equal(resolveContractRowIndex(reordered, 'source'), 1);
  assert.equal(resolveContractRowIndex(reordered, 'missing'), -1);
}

console.log('contractCartRows tests passed');
