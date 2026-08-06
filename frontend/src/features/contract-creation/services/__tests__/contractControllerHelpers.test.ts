import assert from 'node:assert/strict';
import { formatPrice, normalizeDigits, parseFormattedNumber } from '../../../../lib/numberFormat';
import {
  createDeliveryDraft,
  getDeliveryUnit,
  getDeliveryUnitLabel,
  syncDeliveryDefaults
} from '../../utils/deliveryScheduleController';
import {
  clampContractDraftStep,
  CONTRACT_DRAFT_TTL_MS,
  createContractAutosaveDraft,
  getContractDraftStorageKey,
  isContractDraftExpired,
  parseContractAutosaveDraft
} from '../../utils/contractDraftStorage';
import {
  adaptLegacyStairOperations,
  appendStairLayerConfiguration,
  createFreshStairPartDraft,
  getFreshContractProductDefaults,
  getContractQuantityInputPolicy,
  materializeStairLayerConfigurations,
  mergeEditedRemainingStoneState,
  removeStairLayerConfiguration,
  resolveExistingCalibrationCutEnabled,
  resolveLongitudinalOptimizerEditOwnership,
  resolveLongitudinalQuantityOptimizationFailure,
  resolveLongitudinalWidth,
  selectStairLayerConfiguration
} from '../../utils/productConfigurationController';
import { calculateProductOperations } from '@sabalanerp/contract-product-graph';
import { calculateSmartLongitudinalCutPlan } from '../remainingStoneService';
import { handleSmartCalculation } from '../../utils/productCalculations';
import {
  isValidIranianMobile,
  normalizeIranianMobile,
  validateOptionalIranianMobile,
  validateRequiredIranianMobile
} from '../../../../lib/phoneFormat';
import type { ContractProduct, ContractWizardData, Product, RemainingStone } from '../../types/contract.types';

const product = {
  id: 'p1',
  code: 'P1',
  name: 'Stone',
  namePersian: 'سنگ',
  currency: 'تومان',
  isAvailable: true,
  cuttingDimensionNamePersian: '',
  stoneTypeNamePersian: '',
  widthValue: 40,
  thicknessValue: 4,
  widthName: '',
  thicknessName: '',
  mineNamePersian: '',
  finishNamePersian: '',
  colorNamePersian: '',
  qualityNamePersian: ''
} satisfies Product;

const makeContractProduct = (overrides: Partial<ContractProduct> = {}): ContractProduct => ({
  productId: product.id,
  product,
  productType: 'longitudinal',
  stoneCode: product.code,
  stoneName: product.namePersian,
  diameterOrWidth: 40,
  length: 10,
  width: 20,
  quantity: 1,
  squareMeters: 2,
  pricePerSquareMeter: 1000,
  totalPrice: 2000,
  description: '',
  currency: 'تومان',
  lengthUnit: 'm',
  widthUnit: 'cm',
  isMandatory: false,
  mandatoryPercentage: 0,
  originalTotalPrice: 2000,
  isCut: true,
  cutType: 'longitudinal',
  originalWidth: 40,
  originalLength: 10,
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
  ...overrides
});

const makeWizardData = (overrides: Partial<ContractWizardData> = {}): ContractWizardData => ({
  contractDate: '',
  contractNumber: '',
  customerId: '',
  customer: {
    id: 'c1',
    firstName: '',
    lastName: '',
    companyName: '',
    customerType: 'PERSON',
    status: 'ACTIVE',
    projectAddresses: [],
    phoneNumbers: [],
    projectManagerName: 'مدیر پروژه',
    isBlacklisted: false,
    isLocked: false
  },
  projectId: '',
  project: {
    id: 'a1',
    address: 'آدرس',
    city: '',
    isActive: true,
    projectManagerName: 'مدیر پروژه'
  },
  selectedProductTypeForAddition: null,
  products: [],
  deliveries: [],
  payment: {
    payments: [],
    currency: 'تومان',
    totalContractAmount: 0
  },
  signature: {},
  ...overrides
} as ContractWizardData);

assert.equal(normalizeDigits('۱۲۳٬۴۵۶٫۷'), '123,456.7');
assert.equal(parseFormattedNumber('۱۲۳,۴۵۶'), 123456);
assert.equal(parseFormattedNumber('١٢٣٤.٥'), 1234.5);
assert.equal(formatPrice(9050120), '۹٬۰۵۰٬۱۲۰ تومان');

assert.deepEqual(
  resolveLongitudinalWidth({ length: 12, width: 0 }, product, 'cm', false),
  { length: 12, width: 40 }
);
assert.deepEqual(
  resolveLongitudinalWidth({ squareMeters: 4, width: 0 }, product, 'm', false),
  { squareMeters: 4, width: 0.4 }
);
assert.deepEqual(
  resolveLongitudinalWidth({ length: 10, squareMeters: 2, quantity: 1, width: 0 }, product, 'cm', false),
  { length: 10, squareMeters: 2, quantity: 1, width: 0 }
);

assert.deepEqual(getContractQuantityInputPolicy('longitudinal', 0), {
  minimum: 0,
  quantity: 0,
  calculationQuantity: 1,
  optimizerRequested: true
});
assert.deepEqual(getContractQuantityInputPolicy('longitudinal', undefined), {
  minimum: 0,
  quantity: 0,
  calculationQuantity: 1,
  optimizerRequested: true
});
for (const productType of ['slab', 'stair', 'prepared'] as const) {
  assert.deepEqual(getContractQuantityInputPolicy(productType, 0), {
    minimum: 1,
    quantity: 1,
    calculationQuantity: 1,
    optimizerRequested: false
  });
}
assert.deepEqual(getContractQuantityInputPolicy('longitudinal', 3), {
  minimum: 0,
  quantity: 3,
  calculationQuantity: 3,
  optimizerRequested: false
});

assert.deepEqual(resolveLongitudinalOptimizerEditOwnership({
  enteredQuantity: 6,
  inheritedDerivedQuantity: true,
  inheritedDerivedDimension: 'length',
  touchedFields: new Set()
}), {
  preserveDerivedQuantity: false,
  preserveDerivedLength: false,
  preserveDerivedWidth: false
});

assert.deepEqual(resolveLongitudinalOptimizerEditOwnership({
  enteredQuantity: 0,
  inheritedDerivedQuantity: true,
  inheritedDerivedDimension: 'width',
  touchedFields: new Set()
}), {
  preserveDerivedQuantity: true,
  preserveDerivedLength: false,
  preserveDerivedWidth: true
});
assert.deepEqual(getFreshContractProductDefaults('longitudinal'), {
  quantity: 0,
  calibrationCutEnabled: false
});
assert.deepEqual(getFreshContractProductDefaults('stair'), {
  quantity: 1,
  calibrationCutEnabled: false
});

const adaptedLegacyOperations = adaptLegacyStairOperations({
  product: makeContractProduct({
    rowId: 'stair-row-1',
    appliedSubServices: [{
      id: 'legacy-tool-selection-1',
      subServiceId: 'tool-1',
      subService: {
        id: 'tool-1',
        code: 'TOOL-1',
        name: 'Half bullnose',
        namePersian: 'نیم‌لول',
        description: '',
        pricePerMeter: 15000,
        calculationBase: 'length',
        isActive: true
      },
      meter: 30,
      cost: 450000,
      calculationBase: 'length',
      edges: { front: true, left: true }
    }],
    finishings: [{
      selectionId: 'legacy-finishing-selection-1',
      finishingId: 'finishing-1',
      name: 'ساب',
      calculationBase: 'squareMeters',
      unitPrice: 20000,
      automaticQuantity: 6,
      quantity: 6,
      quantityMode: 'manual',
      overrideStatus: 'current',
      cost: 120000
    }]
  }),
  productRowId: 'stair-row-1',
  lengthMeters: 1.5,
  widthMeters: 0.4,
  quantity: 20
});
assert.ok(adaptedLegacyOperations);
assert.deepEqual(adaptedLegacyOperations.tools[0].edges, ['front', 'left']);
assert.equal(adaptedLegacyOperations.tools[0].rateToman, '15000');
assert.equal(adaptedLegacyOperations.finishings[0].rateToman, '20000');
assert.equal(adaptedLegacyOperations.finishings[0].quantityOverride?.value, '6');

const unresolvedLegacyEdge = adaptLegacyStairOperations({
  product: makeContractProduct({
    appliedSubServices: [{
      id: 'legacy-tool-without-edge',
      subServiceId: 'tool-2',
      subService: {
        id: 'tool-2',
        code: 'TOOL-2',
        name: 'Legacy tool',
        namePersian: 'ابزار قدیمی',
        description: '',
        pricePerMeter: 10000,
        calculationBase: 'length',
        isActive: false
      },
      meter: 10,
      cost: 100000,
      calculationBase: 'length'
    }]
  }),
  productRowId: 'stair-row-2',
  lengthMeters: 1,
  widthMeters: 0.3,
  quantity: 10
});
assert.ok(unresolvedLegacyEdge);
const unresolvedCalculation = calculateProductOperations(unresolvedLegacyEdge);
assert.equal(unresolvedCalculation.ok, false);
if (!unresolvedCalculation.ok) {
  assert.equal(unresolvedCalculation.conflicts[0]?.code, 'tool-edge-required');
}
assert.deepEqual(getFreshContractProductDefaults('slab'), {
  quantity: 1
});
assert.deepEqual(createFreshStairPartDraft('riser'), {
  layerConfigurations: [],
  lengthUnit: 'm',
  widthUnit: 'cm',
  widthCm: 17,
  tools: [],
  layerSourceKind: null,
  layerSelectedRemainingStoneIds: [],
  finishingEnabled: false,
  calibrationCutEnabled: false,
  calibrationSelection: 'automatic',
  useMandatory: true,
  mandatoryPercentage: 20,
  description: ''
});
assert.equal(createFreshStairPartDraft('tread').widthCm, 30);
assert.equal(createFreshStairPartDraft('landing').widthCm, null);
{
  const parentDraft = {
    ...createFreshStairPartDraft('tread'),
    quantity: 10,
    numberOfLayersPerStair: 2,
    layerWidthCm: 4,
    layerTypeId: 'double',
    layerTypeName: 'Double',
    layerTypePrice: 80000,
    layerEdges: { front: true, left: true },
    layerSourceKind: 'contractRemainder' as const,
    layerSelectedRemainingStoneIds: ['remainder-1']
  };
  const appended = appendStairLayerConfiguration(parentDraft, 'layer-config-1');
  assert.equal(appended.layerConfigurations?.length, 1);
  assert.equal(
    appended.layerConfigurations?.[0]?.layerConfigurationDraftId,
    'layer-config-1'
  );
  assert.deepEqual(
    appended.layerConfigurations?.[0]?.layerSelectedRemainingStoneIds,
    ['remainder-1']
  );
  assert.equal(appended.numberOfLayersPerStair, null);
  assert.equal(appended.layerSourceKind, null);
  assert.deepEqual(appended.layerSelectedRemainingStoneIds, []);
}
{
  const firstLayer = {
    ...createFreshStairPartDraft('tread'),
    layerConfigurationDraftId: 'layer-1',
    numberOfLayersPerStair: 1,
    layerWidthCm: 4,
    layerTypeId: 'double'
  };
  const secondLayer = {
    ...createFreshStairPartDraft('tread'),
    layerConfigurationDraftId: 'layer-2',
    numberOfLayersPerStair: 2,
    layerWidthCm: 5,
    layerTypeId: 'triple'
  };
  const selected = selectStairLayerConfiguration({
    ...createFreshStairPartDraft('tread'),
    layerConfigurations: [firstLayer, secondLayer]
  }, 'layer-1');
  assert.equal(selected.activeLayerConfigurationDraftId, 'layer-1');
  assert.equal(selected.numberOfLayersPerStair, 1);
  assert.deepEqual(
    selected.layerConfigurations?.map(layer => layer.layerConfigurationDraftId),
    ['layer-1', 'layer-2']
  );

  const materialized = materializeStairLayerConfigurations({
    ...selected,
    numberOfLayersPerStair: 3
  });
  assert.equal(materialized.length, 2);
  assert.equal(materialized[0].numberOfLayersPerStair, 3);
  assert.equal(materialized[1].numberOfLayersPerStair, 2);

  const afterRemoval = removeStairLayerConfiguration(
    selected,
    'layer-1'
  );
  assert.equal(
    afterRemoval.activeLayerConfigurationDraftId,
    'layer-2'
  );
  assert.deepEqual(
    afterRemoval.layerConfigurations?.map(
      layer => layer.layerConfigurationDraftId
    ),
    ['layer-2']
  );
}
assert.equal(resolveExistingCalibrationCutEnabled(undefined), true);
assert.equal(resolveExistingCalibrationCutEnabled(true), true);
assert.equal(resolveExistingCalibrationCutEnabled(false), false);
const zeroQuantityPolicy = getContractQuantityInputPolicy('longitudinal', 0);
assert.equal(
  handleSmartCalculation(
    'quantity',
    zeroQuantityPolicy.quantity,
    { length: 50, width: 7, quantity: zeroQuantityPolicy.quantity },
    'm',
    'cm',
    zeroQuantityPolicy.calculationQuantity
  ).squareMeters,
  3.5
);

const impossibleQuantityOptimization = calculateSmartLongitudinalCutPlan({
  originalWidthCm: 40,
  enteredWidth: 45,
  enteredWidthUnit: 'cm',
  enteredLength: 50,
  enteredLengthUnit: 'm',
  quantity: 0
});
assert.ok(resolveLongitudinalQuantityOptimizationFailure(true, impossibleQuantityOptimization));
assert.equal(resolveLongitudinalQuantityOptimizationFailure(false, impossibleQuantityOptimization), null);

const usedStone: RemainingStone = {
  id: 'used-1',
  width: 10,
  length: 3,
  squareMeters: 0.3,
  isAvailable: false,
  sourceCutId: 'cut-1'
};
const nextAvailable: RemainingStone = {
  id: 'new-1',
  width: 15,
  length: 8,
  squareMeters: 1.2,
  isAvailable: true,
  sourceCutId: 'cut-2',
  quantity: 1
};
const merged = mergeEditedRemainingStoneState({
  geometryChanged: true,
  nextAvailableRemainingStones: [nextAvailable],
  previousProduct: makeContractProduct({
    remainingStones: [],
    usedRemainingStones: [usedStone],
    totalUsedRemainingWidth: 10,
    totalUsedRemainingLength: 3
  })
});
assert.deepEqual(merged.remainingStones, [nextAvailable]);
assert.equal(merged.remainingStones[0].quantity, 1);
assert.deepEqual(merged.usedRemainingStones, [usedStone]);
assert.equal(merged.totalUsedRemainingWidth, 10);
assert.equal(merged.totalUsedRemainingLength, 3);
assert.ok(merged.warning);

const wizardData = makeWizardData();
assert.equal(createDeliveryDraft(wizardData).projectManagerName, 'مدیر پروژه');
assert.equal(createDeliveryDraft(wizardData).receiverName, 'مدیر پروژه');
assert.deepEqual(
  syncDeliveryDefaults([
    {
      deliveryDate: '',
      projectManagerName: '',
      receiverName: '',
      deliveryAddress: '',
      products: []
    },
    {
      deliveryDate: '',
      projectManagerName: '',
      receiverName: 'تحویل گیرنده متفاوت',
      deliveryAddress: '',
      products: []
    }
  ], wizardData).map((delivery) => delivery.receiverName),
  ['مدیر پروژه', 'تحویل گیرنده متفاوت']
);
assert.deepEqual(
  syncDeliveryDefaults([
    {
      deliveryDate: '',
      projectManagerName: 'Ali ',
      receiverName: 'Ali Mohammadi',
      deliveryAddress: 'Tehran ',
      products: []
    }
  ], wizardData).map((delivery) => ({
    projectManagerName: delivery.projectManagerName,
    receiverName: delivery.receiverName,
    deliveryAddress: delivery.deliveryAddress
  })),
  [{
    projectManagerName: 'Ali ',
    receiverName: 'Ali Mohammadi',
    deliveryAddress: 'Tehran '
  }]
);

assert.equal(getDeliveryUnit(makeContractProduct({ productType: 'longitudinal' })), 'meter');
assert.equal(getDeliveryUnitLabel('meter'), 'متر طول');

assert.equal(normalizeIranianMobile('\u06F9\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'), '09123456789');
assert.equal(normalizeIranianMobile('+989123456789'), '09123456789');
assert.equal(normalizeIranianMobile('00989123456789'), '09123456789');
assert.equal(isValidIranianMobile('\u06F0\u06F9\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'), true);
assert.equal(validateRequiredIranianMobile('\u06F0\u06F9\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'), null);
assert.equal(validateRequiredIranianMobile('02112345678') !== null, true);
assert.equal(validateOptionalIranianMobile(''), null);
assert.equal(validateOptionalIranianMobile('\u06F0\u06F2\u06F1\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8') !== null, true);

{
  const now = 1_000_000;
  const draft = createContractAutosaveDraft({
    currentStep: 4,
    wizardData: makeWizardData()
  }, now);

  assert.equal(isContractDraftExpired(draft, now + CONTRACT_DRAFT_TTL_MS - 1), false);
  assert.equal(isContractDraftExpired(draft, now + CONTRACT_DRAFT_TTL_MS + 1), true);
  assert.equal(parseContractAutosaveDraft(JSON.stringify(draft), now + CONTRACT_DRAFT_TTL_MS - 1)?.currentStep, 4);
  assert.equal(parseContractAutosaveDraft(JSON.stringify(draft), now + CONTRACT_DRAFT_TTL_MS + 1), null);
  assert.equal(clampContractDraftStep(4, 7), 4);
  assert.equal(clampContractDraftStep('8', 7), 7);
  assert.equal(clampContractDraftStep(0, 7), 1);
  assert.equal(clampContractDraftStep('bad', 7), 1);
  assert.equal(
    getContractDraftStorageKey('draft-user-1'),
    'contractWizardAutosaveDraft:draft-user-1'
  );
  assert.equal(getContractDraftStorageKey(null), 'contractWizardAutosaveDraft');
}

console.log('contractControllerHelpers tests passed');
