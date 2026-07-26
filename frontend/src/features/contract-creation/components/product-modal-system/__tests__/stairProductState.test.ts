import assert from 'node:assert/strict';
import {
  applyStaircaseQuantityIntent,
  editStairPartQuantity,
  toStaircaseQuantityIntent,
  type StairQuantityState
} from '../StairProductSection';
import {
  createNewStairPartPolicyInput,
  copyStairPartOperations,
  copyStairPartPolicyFromTread,
  parseCanonicalDecimal,
  parseStableIdentity
} from '@sabalanerp/contract-product-graph';
import {
  createFreshStairPartDraft
} from '../../../utils/productConfigurationController';
import {
  applyInventoryLayerTypeSelection,
  createCanonicalStairDraftInput
} from '../../../services/stairCalculationService';
import {
  validateDraftRequiredFields
} from '../../../services/stairValidationService';
import type { Product } from '../../../types/contract.types';

const initial: StairQuantityState = {
  intent: { mode: 'steps', totalSteps: 1 },
  tread: { value: null, manuallyEdited: false },
  riser: { value: null, manuallyEdited: false },
  landing: { value: null, manuallyEdited: false }
};
const initialized = applyStaircaseQuantityIntent(initial, {
  mode: 'staircases',
  numberOfStaircases: 2,
  stepsPerStaircase: 15
});
assert.equal(initial.tread.value, null);
assert.equal(initialized.tread.value, 30);
assert.equal(initialized.riser.value, 30);
assert.equal(initialized.landing.value, null);

const manuallyChanged = editStairPartQuantity(initialized, 'riser', 28);
const quantityChanged = applyStaircaseQuantityIntent(manuallyChanged, {
  mode: 'steps',
  totalSteps: 32
});
assert.equal(quantityChanged.tread.value, 32);
assert.equal(quantityChanged.riser.value, 28);
assert.equal(quantityChanged.landing.value, null);

assert.deepEqual(
  toStaircaseQuantityIntent({
    mode: 'staircases',
    totalSteps: '',
    numberOfStaircases: '۲',
    stepsPerStaircase: '١٥'
  }),
  {
    mode: 'staircases',
    numberOfStaircases: 2,
    stepsPerStaircase: 15
  }
);

const versions = {
  calculation: 'calculation-v1',
  packing: 'packing-v1',
  pricing: 'pricing-v1',
  rounding: 'rounding-v1'
};
const stairSystemId = parseStableIdentity('stair-system', 'copy-system');
const tread = createNewStairPartPolicyInput(
  'tread',
  {
    stairSystemId,
    sourceBatchId: parseStableIdentity('source-batch', 'copy-tread-source')
  },
  versions
);
const riser = createNewStairPartPolicyInput(
  'riser',
  {
    stairSystemId,
    sourceBatchId: parseStableIdentity('source-batch', 'copy-riser-source')
  },
  versions
);
assert.equal(tread.crossDimensionMeters, '0.3');
assert.equal(riser.crossDimensionMeters, '0.17');
const copied = copyStairPartPolicyFromTread({
  tread: {
    ...tread,
    lengthMeters: parseCanonicalDecimal('1.2'),
    baseRateToman: parseCanonicalDecimal('5000')
  },
  target: riser
});
assert.equal(copied.part, 'riser');
assert.equal(copied.sourceBatchId, 'copy-riser-source');
assert.equal(copied.lengthMeters, '1.2');
assert.equal(copied.baseRateToman, '5000');
assert.equal(riser.lengthMeters, undefined);

const sourceGroupId = parseStableIdentity('operation-group', 'copy-source-group');
const copiedOperations = copyStairPartOperations({
  source: {
    policyVersion: 'calculation-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    productRowId: parseStableIdentity('product-row', 'copy-source-row'),
    lengthMeters: parseCanonicalDecimal('1.2'),
    widthMeters: parseCanonicalDecimal('0.3'),
    quantity: 10,
    groups: [{
      operationGroupId: sourceGroupId,
      scope: parseCanonicalDecimal('10')
    }],
    tools: [{
      toolSelectionId: parseStableIdentity('tool-selection', 'copy-source-tool'),
      operationGroupId: sourceGroupId,
      catalogItemId: 'tool-1',
      catalogSnapshotVersion: 'tool-v1',
      name: 'Edge',
      unit: 'meter',
      rateToman: parseCanonicalDecimal('100'),
      edges: ['front']
    }],
    finishings: []
  },
  targetProductRowId: parseStableIdentity('product-row', 'copy-target-row'),
  lengthMeters: parseCanonicalDecimal('1.5'),
  crossDimensionMeters: parseCanonicalDecimal('0.17'),
  quantity: 10,
  operationGroupIdentity: () =>
    parseStableIdentity('operation-group', 'copy-target-group'),
  toolSelectionIdentity: () =>
    parseStableIdentity('tool-selection', 'copy-target-tool'),
  finishingSelectionIdentity: () =>
    parseStableIdentity('finishing-selection', 'copy-target-finishing')
});
assert.equal(copiedOperations.productRowId, 'copy-target-row');
assert.equal(copiedOperations.lengthMeters, '1.5');
assert.equal(copiedOperations.quantity, 10);
assert.equal(copiedOperations.groups[0]?.operationGroupId, 'copy-target-group');
assert.equal(copiedOperations.tools[0]?.toolSelectionId, 'copy-target-tool');
assert.equal(copiedOperations.tools[0]?.rateToman, '100');
assert.notEqual(
  copiedOperations.tools[0]?.toolSelectionId,
  'copy-source-tool'
);

const stairStone = {
  id: 'catalog-longitudinal-stone',
  code: 'L-40',
  name: 'Longitudinal granite',
  namePersian: 'طولی گرانیت',
  widthValue: 40,
  motherLengthValue: 3,
  thicknessValue: 2,
  currency: 'تومان',
  isAvailable: true
} as Product;
const freshDraft = {
  ...createFreshStairPartDraft('tread'),
  stoneId: stairStone.id,
  stoneProduct: stairStone,
  lengthValue: 1.2,
  lengthUnit: 'm' as const,
  widthCm: 30,
  widthUnit: 'cm' as const,
  quantity: 4,
  pricePerSquareMeter: 100000
};
assert.equal(
  freshDraft.standardLengthValue,
  undefined,
  'new stair parts must not copy catalog mother length into the seller field'
);
const derivedInput = createCanonicalStairDraftInput(
  'tread',
  freshDraft,
  () => 0
);
assert.equal(derivedInput.motherLengthMeters, undefined);
assert.equal(derivedInput.motherLengthDisplayUnit, 'm');

const explicitInput = createCanonicalStairDraftInput(
  'tread',
  {
    ...freshDraft,
    standardLengthValue: 150,
    standardLengthUnit: 'cm'
  },
  () => 0
);
assert.equal(explicitInput.motherLengthMeters, '1.5');
assert.equal(explicitInput.motherLengthDisplayUnit, 'cm');

const invalidMotherLength = validateDraftRequiredFields('tread', {
  ...freshDraft,
  standardLengthValue: 100,
  standardLengthUnit: 'cm'
});
assert.equal(
  invalidMotherLength.motherLength,
  'طول مادر باید حداقل برابر طول نهایی باشد'
);

const unresolvedRemovedLayerSide = validateDraftRequiredFields('tread', {
  ...freshDraft,
  numberOfLayersPerStair: 1,
  layerTypeId: 'layer-type-1',
  layerSourceKind: 'parentMaterial',
  layerRemovedSideConflicts: ['left']
});
assert.equal(
  unresolvedRemovedLayerSide.layerSource,
  'عملیات سمت حذف‌شده را تعیین تکلیف کنید'
);

const missingLayerCatalogSelection = validateDraftRequiredFields('tread', {
  ...freshDraft,
  numberOfLayersPerStair: 1,
  layerWidthCm: 5,
  layerTypeId: null,
  layerTypePrice: null,
  layerSourceKind: 'parentMaterial'
}, []);
assert.equal(
  missingLayerCatalogSelection.layerType,
  'انتخاب نوع لایه الزامی است'
);

const historicalInactiveLayerType = validateDraftRequiredFields('tread', {
  ...freshDraft,
  numberOfLayersPerStair: 1,
  layerWidthCm: 5,
  layerTypeId: 'historical-inactive-layer',
  layerTypeName: 'لایه تاریخی',
  layerTypePrice: 80000,
  layerSourceKind: 'parentMaterial'
}, []);
assert.equal(historicalInactiveLayerType.layerType, undefined);

const missingHistoricalLayerRate = validateDraftRequiredFields('tread', {
  ...freshDraft,
  numberOfLayersPerStair: 1,
  layerWidthCm: 5,
  layerTypeId: 'historical-inactive-layer',
  layerTypeName: 'لایه تاریخی',
  layerTypePrice: null,
  layerSourceKind: 'parentMaterial'
}, []);
assert.equal(
  missingHistoricalLayerRate.layerType,
  'قیمت نوع لایه در انبار معتبر نیست'
);

const selectedInventoryLayer = applyInventoryLayerTypeSelection(freshDraft, {
  id: 'inventory-double-layer',
  name: 'لایه دوبل',
  pricePerLayer: 125000,
  calculationUnit: 'physicalPiece',
  isActive: true
});
assert.equal(selectedInventoryLayer.layerTypeId, 'inventory-double-layer');
assert.equal(selectedInventoryLayer.layerTypeName, 'لایه دوبل');
assert.equal(selectedInventoryLayer.layerTypePrice, 125000);
assert.equal(selectedInventoryLayer.layerTypeCalculationUnit, 'physicalPiece');

console.log('stair product state tests passed');
