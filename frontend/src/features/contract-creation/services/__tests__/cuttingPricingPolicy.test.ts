import assert from 'node:assert/strict';
import type { ContractProduct } from '../../types/contract.types';
import {
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

const ordinary = { ...product, isMandatory: false };
assert.equal(getBillableCuttingCost(ordinary), 600);
assert.equal(normalizeMandatoryLongitudinalCuttingPricing(ordinary), ordinary);

console.log('cuttingPricingPolicy tests passed');
