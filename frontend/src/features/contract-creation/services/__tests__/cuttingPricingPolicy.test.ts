import assert from 'node:assert/strict';
import type { ContractProduct } from '../../types/contract.types';
import {
  getBillableCuttingBreakdown,
  getBillableCuttingCost,
  getPhysicalCuttingCost,
  normalizeMandatoryLongitudinalCuttingPricing
} from '../../utils/mandatoryCuttingPricing';

const product = {
  productType: 'longitudinal',
  isMandatory: true,
  mandatoryPercentage: 20,
  cuttingCost: 600,
  physicalCuttingCost: 600,
  cuttingBreakdown: [{ type: 'longitudinal', meters: 6, rate: 100, cost: 600 }],
  totalPrice: 1800
} as ContractProduct;

const normalized = normalizeMandatoryLongitudinalCuttingPricing(product);
assert.equal(getPhysicalCuttingCost(normalized), 600);
assert.equal(getBillableCuttingCost(normalized), 600);
assert.equal(normalized.cuttingCost, 600);
assert.equal(normalized.physicalCuttingCost, 600);
assert.equal(normalized.cuttingBreakdown?.[0].meters, 6);
assert.equal(normalized.cuttingBreakdown?.[0].cost, 600);
assert.equal(normalized.totalPrice, 1800);

const mandatoryMixed = {
  ...product,
  cuttingCost: 800,
  physicalCuttingCost: 800,
  cuttingBreakdown: [
    { type: 'longitudinal' as const, meters: 6, rate: 100, cost: 600 },
    { type: 'cross' as const, meters: 2, rate: 100, cost: 200 }
  ],
  totalPrice: 2000
};
const normalizedMixed = normalizeMandatoryLongitudinalCuttingPricing(mandatoryMixed);
assert.equal(getPhysicalCuttingCost(normalizedMixed), 800);
assert.equal(getBillableCuttingCost(normalizedMixed), 600);
assert.equal(normalizedMixed.cuttingCost, 600);
assert.equal(normalizedMixed.totalPrice, 1800);
assert.deepEqual(getBillableCuttingBreakdown(mandatoryMixed), [
  { type: 'longitudinal', meters: 6, rate: 100, cost: 600 },
  { type: 'cross', meters: 2, rate: 0, cost: 0 }
]);

const ordinary = { ...product, isMandatory: false };
assert.equal(getBillableCuttingCost(ordinary), 600);
assert.deepEqual(getBillableCuttingBreakdown({ ...mandatoryMixed, isMandatory: false }), mandatoryMixed.cuttingBreakdown);
assert.equal(normalizeMandatoryLongitudinalCuttingPricing(ordinary), ordinary);

console.log('cuttingPricingPolicy tests passed');

// Verify the modal prices the physical split validated by the allocation planner.
import { allocateRemainingStonePartitions } from '../remainingStonePartitionService';
import { calculateRemainingChildCuttingBreakdown } from '../remainingStoneCuttingService';
import type { RemainingStone, StonePartition } from '../../types/contract.types';
for (const scenario of [
  { stockWidth: 9, stockLength: 2, width: 3, length: 6, rate: 100, expected: 400 },
  { stockWidth: 29, stockLength: 1, width: 29, length: 0.5, rate: 50, expected: 15 }
]) {
  const stock = { id: 'merge-stock', width: scenario.stockWidth, length: scenario.stockLength,
    quantity: 1, squareMeters: scenario.stockWidth * scenario.stockLength / 100, isAvailable: true } as RemainingStone;
  const row = { id: 'merge-row', width: scenario.width, length: scenario.length, quantity: 1,
    squareMeters: scenario.width * scenario.length / 100 } as StonePartition;
  const allocation = allocateRemainingStonePartitions([row], stock);
  assert.equal(allocation.rowErrors.size, 0);
  const breakdown = calculateRemainingChildCuttingBreakdown({ row, stock, rate: scenario.rate,
    physicalPieces: allocation.physicalPiecesByRow.get(row.id),
    sourcePieceQuantities: allocation.sourcePieceQuantitiesByRow.get(row.id) });
  assert.ok(breakdown);
  assert.equal(breakdown.reduce((sum, line) => sum + line.cost, 0), scenario.expected);
}
