import assert from 'node:assert/strict';
import {
  calculateSlab, calculateStairPart, calculateStairLayerConfiguration,
  multiplyContractMonetaryAmounts, parseCanonicalDecimal as c, parseStableIdentity as id,
  planLegacyProductGraphMigration, type SlabPolicyInput, type StairPartPolicyInput,
  type StairLayerConfigurationInput, type ProductOperationsInput
} from '@sabalanerp/contract-product-graph';
import { canonicalProductSavePricing } from '../../utils/canonicalProductSavePricing';
import { getContractPayableTotal, getContractProductPriceComponents, reconcileContractProductPricing } from '../../utils/contractProductPricing';
import { recalculateRemainingChildAddOns } from '../remainingStoneChildAddOnService';
import type { ContractProduct } from '../../types/contract.types';

const versions = { calculationPolicyVersion: 'calculation-v1', packingPolicyVersion: 'packing-v1', pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'rounding-v1' };
const graphPolicy = { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-precise-prepared-v2', rounding: 'rounding-v2' };
const stairInput: StairPartPolicyInput = {
  ...versions, stairSystemId: id('stair-system', 'stairs'), part: 'tread', sourceBatchId: id('source-batch', 'stairs'),
  motherWidthMeters: c('0.4'), motherLengthMeters: c('1'), lengthMeters: c('1'), crossDimensionMeters: c('0.4'),
  lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm', quantity: 1, baseRateToman: c('250'),
  mandatoryEnabled: true, mandatoryPercentage: c('20.2'), rememberedMandatoryPercentage: c('20.2'),
  sawKerfEnabled: false, sawKerfMeters: c('0'), calibrationEnabled: false, calibrationSelection: 'manual',
  longitudinalCutRateToman: c('10'), crossCutRateToman: c('10'), calibrationCutRateToman: c('10')
};
for (const part of ['tread', 'riser', 'landing'] as const) {
  const input = { ...stairInput, part };
  const calculated = calculateStairPart(input);
  assert.ok(calculated.ok);
  if (!calculated.ok) throw new Error('Invalid test stair');
  const result = calculated.result;
  const pricing = canonicalProductSavePricing({ materialBase: result.baseAmountToman, mandatoryAmount: result.mandatoryAmountToman,
    cuttingCost: '0', totalAmount: result.totalAmountToman });
  assert.equal(pricing.totalPrice, 120);
  assert.notEqual(Number(result.baseAmountToman) * (1 + 20.2 / 100), pricing.totalPrice,
    'the old percentage writer must exercise the canonical/saved mismatch');
  const row = { rowId: `stairs-${part}`, productId: 'stone', productType: 'stair', stairPartPolicyInput: input,
    originalTotalPrice: pricing.materialBase, totalPrice: pricing.totalPrice, isMandatory: true, mandatoryPercentage: 20.2,
    meta: { pricing } } as ContractProduct;
  assert.equal(getContractProductPriceComponents(row).mandatoryAmount, 20);
  assert.equal(reconcileContractProductPricing(row).totalPrice, 120);
  assert.ok(planLegacyProductGraphMigration({ contractId: 'pricing-test', revision: 1, calculationPolicy: graphPolicy, products: [row] }).ok);
  assert.equal(planLegacyProductGraphMigration({ contractId: 'pricing-test', revision: 1, calculationPolicy: graphPolicy,
    products: [{ ...row, totalPrice: 121 }] }).ok, false, 'real discrepancies remain blocked');
}
const slabInput: SlabPolicyInput = {
  ...versions, sourceBatchId: id('source-batch', 'slab'), lengthMeters: c('1'), widthMeters: c('1'), quantity: 1,
  lengthDisplayUnit: 'm', widthDisplayUnit: 'm', sourceRows: [{ sourceRowId: id('slab-source-row', 'mother'),
    lengthMeters: c('2'), widthMeters: c('2'), quantity: 1, lengthDisplayUnit: 'm', widthDisplayUnit: 'm' }],
  baseMaterialRateToman: c('250'), kerfMeters: c('0'), cuttingPricingMethod: 'lineBased',
  longitudinalCutRateToman: c('10'), crossCutRateToman: c('10'), squareMeterCutRateToman: c('10'), verticalCutSides: []
};
for (const cuttingPricingMethod of ['lineBased', 'squareMeter'] as const) {
  const input = { ...slabInput, cuttingPricingMethod };
  const calculated = calculateSlab(input);
  assert.ok(calculated.ok);
  if (!calculated.ok) throw new Error('Invalid test slab');
  const result = calculated.result;
  const pricing = canonicalProductSavePricing({ materialBase: result.materialAmountToman,
    cuttingCost: result.cuttingAmountToman, totalAmount: result.totalAmountToman });
  const row = { rowId: 'slab', productId: 'stone', productType: 'slab', slabPolicyInput: input,
    originalTotalPrice: pricing.materialBase, totalPrice: pricing.totalPrice, meta: { pricing } } as ContractProduct;
  assert.ok(planLegacyProductGraphMigration({ contractId: 'pricing-test', revision: 1, calculationPolicy: graphPolicy, products: [row] }).ok);
}
const precise = canonicalProductSavePricing({ materialBase: '100', cuttingCost: '0.4', totalAmount: '100.4' }, '0.2');
const exactSlab = reconcileContractProductPricing({ productType: 'slab', originalTotalPrice: 100,
  cuttingCost: 0.4, totalSubServiceCost: 0.2, totalPrice: precise.totalPrice, meta: { pricing: precise } } as ContractProduct);
assert.equal(exactSlab.totalPrice, 100.6, 'component reconciliation must not introduce a float residue');
for (const preparedKind of ['cubic', 'readyPiece'] as const) {
  for (const preparedUnit of ['count', 'squareMeter', 'ton'] as const) {
    const amount = multiplyContractMonetaryAmounts('1', '100.4');
    const pricing = canonicalProductSavePricing({ materialBase: amount, cuttingCost: 0, totalAmount: amount });
    const row = { rowId: `${preparedKind}-${preparedUnit}`, productId: 'stone', productType: 'prepared',
      preparedKind, preparedUnit, preparedQuantity: 1, quantity: 1, unitPrice: 100.4, pricePerSquareMeter: 100.4,
      originalTotalPrice: pricing.materialBase, totalPrice: pricing.totalPrice, meta: { pricing } } as ContractProduct;
    assert.ok(planLegacyProductGraphMigration({ contractId: 'pricing-test', revision: 1, calculationPolicy: graphPolicy, products: [row] }).ok);
    assert.equal(row.totalPrice, 100.4);
    assert.equal(getContractPayableTotal([row, { ...row, rowId: `${row.rowId}-2` }]), 201, 'sum before rounding the payable');
  }
}
const layerInput: StairLayerConfigurationInput = {
  ...versions, layerConfigurationId: id('layer-configuration', 'layer'), parentProductRowId: id('product-row', 'stairs'),
  sourceBatchId: id('source-batch', 'layer'), creationOrder: 1, layerCatalogItemId: 'layer', layerCatalogSnapshotVersion: 'v1',
  layerTitle: 'Layer', layerUnit: 'set', layerRateToman: c('10'), layersPerParentPiece: 1, widthMeters: c('0.04'),
  widthDisplayUnit: 'cm', targetSides: ['front'], source: { kind: 'new-material', catalogProductId: 'stone',
    catalogSnapshotVersion: 'v1', materialRateToman: c('250'), sourceRows: [{ sourceRowId: id('layer-source-row', 'mother'),
      lengthMeters: c('1'), widthMeters: c('0.4'), quantity: 1 }] }, kerfMeters: c('0'), calibrationEnabled: false,
  longitudinalCutRateToman: c('0'), crossCutRateToman: c('0'), calibrationCutRateToman: c('0'), sideOperations: []
};
const layer = calculateStairLayerConfiguration({ input: layerInput,
  parent: { lengthMeters: c('1'), crossDimensionMeters: c('0.4'), quantity: 1 }, availableInventory: [] });
assert.ok(layer.ok);
if (layer.ok) {
  const pricing = canonicalProductSavePricing({ materialBase: layer.result.materialAmountToman,
    cuttingCost: layer.result.cuttingAmountToman, totalAmount: layer.result.totalAmountToman });
  assert.equal(String(pricing.totalPrice), layer.result.totalAmountToman);
}
const operationInput: ProductOperationsInput = {
  policyVersion: 'operations-v1', pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'rounding-v1',
  productRowId: id('product-row', 'child'), lengthMeters: c('0.3'), widthMeters: c('0.1'), quantity: 1,
  groups: [{ operationGroupId: id('operation-group', 'group'), scope: c('1') }], tools: [{
    toolSelectionId: id('tool-selection', 'tool'), operationGroupId: id('operation-group', 'group'), catalogItemId: 'tool',
    catalogSnapshotVersion: 'v1', name: 'Tool', unit: 'meter', rateToman: c('100.4'), edges: ['front'] }],
  finishings: []
};
const child = recalculateRemainingChildAddOns({ productType: 'longitudinal', operationPolicyInput: operationInput,
  appliedSubServices: [{ id: 'tool', subServiceId: 'tool', meter: 0.3, cost: 30, calculationBase: 'length',
    subService: { id: 'tool', pricePerMeter: 100.4 }, edges: { front: true } }], totalSubServiceCost: 30 } as ContractProduct);
assert.ok(child.ok);
assert.equal(child.product.totalSubServiceCost, 30, 'remaining-child replay must retain the canonical rounded charge instead of 30.12');
console.log('canonicalProductSavePricing all-family tests passed');
