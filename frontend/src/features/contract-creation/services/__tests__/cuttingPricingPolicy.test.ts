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
assert.equal(getBillableCuttingCost(normalized), 0);
assert.equal(normalized.cuttingCost, 0);
assert.equal(normalized.physicalCuttingCost, 600);
assert.equal(normalized.cuttingBreakdown?.[0].meters, 6);
assert.equal(normalized.cuttingBreakdown?.[0].cost, 600);
assert.equal(normalized.totalPrice, 1200);

const ordinary = { ...product, isMandatory: false };
assert.equal(getBillableCuttingCost(ordinary), 600);
assert.equal(normalizeMandatoryLongitudinalCuttingPricing(ordinary), ordinary);

console.log('cuttingPricingPolicy tests passed');
