import assert from 'node:assert/strict';
import { calculateSmartLongitudinalCutPlan, calculateSlabRemainingStones, hasLongitudinalGeometryChanged } from '../remainingStoneService';
import { allocateRemainingStonePartitions } from '../remainingStonePartitionService';
import { recalculateRemainingChildAddOns } from '../remainingStoneChildAddOnService';
import { calculateSlabCut, validateCutDimensions } from '../stoneCuttingService';
import { calculateLayerMetrics, calculateStairStoneUsage, computeTotalsV2 } from '../stairCalculationService';
import { validatePayment, validateWizardStep } from '../validationService';
import { calculateContractTotal, calculateFinalPrice } from '../pricingService';
import { buildSlabCutDetails, calculateSlabMetrics, handleSmartCalculation } from '../../utils/productCalculations';
import {
  activateFinishingSelection,
  calculateDefaultFinishingQuantity,
  calculateFinishingCost
} from '../../utils/finishingUtils';
import {
  createContractServiceRow,
  recalculateContractServiceRow
} from '../../utils/contractServiceRows';
import {
  getDeliveryTargetAmount,
  getDeliveryUnit,
  getServiceDeliveryTargetAmount
} from '../../utils/deliveryScheduleController';
import {
  mergeEditedRemainingStoneState,
  resolveLongitudinalWidth,
  restoreRemainingStoneAfterChildRemoval
} from '../../utils/productConfigurationController';
import { generateSlabContractProductName } from '../../utils/productUtils';
import { generateContractHTML } from '../../utils/contractHTMLGenerator';
import {
  getContractProductOperationGeometry,
  resolveLongitudinalCustomerFields,
  restoreLongitudinalCustomerRequest
} from '../../utils/longitudinalOptimizerGeometry';
import type {
  ContractProduct,
  ContractServiceRow,
  ContractWizardData,
  Product,
  RemainingStone,
  StonePartition
} from '../../types/contract.types';

const approx = (actual: number, expected: number, precision = 6) => {
  assert.equal(Number(actual.toFixed(precision)), Number(expected.toFixed(precision)));
};

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'stone-arsanjan-40',
  code: '1020810090900',
  name: 'Arsanjan marble 40',
  namePersian: 'طولی مرمریت 40 عرض ارسنجان',
  currency: 'تومان',
  isAvailable: true,
  cuttingDimensionNamePersian: 'طولی',
  stoneTypeNamePersian: 'مرمریت',
  widthValue: 40,
  thicknessValue: 2,
  widthName: '40',
  thicknessName: '2',
  mineNamePersian: 'ارسنجان',
  finishNamePersian: 'سندبلاست',
  colorNamePersian: '',
  qualityNamePersian: '',
  ...overrides
});

const contractProduct = (overrides: Partial<ContractProduct> = {}): ContractProduct => {
  const baseProduct = product();
  return {
    productId: baseProduct.id,
    product: baseProduct,
    productType: 'longitudinal',
    stoneCode: baseProduct.code,
    stoneName: baseProduct.namePersian,
    diameterOrWidth: 40,
    length: 18,
    width: 20,
    quantity: 1,
    squareMeters: 3.6,
    pricePerSquareMeter: 1_050_000,
    totalPrice: 4_140_000,
    description: '',
    currency: 'تومان',
    lengthUnit: 'm',
    widthUnit: 'cm',
    isMandatory: false,
    mandatoryPercentage: 0,
    originalTotalPrice: 3_780_000,
    isCut: true,
    cutType: 'longitudinal',
    originalWidth: 40,
    originalLength: 18,
    cuttingCost: 360_000,
    cuttingCostPerMeter: 40_000,
    cutDescription: 'smart longitudinal cut',
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
  };
};

const remainingStone = (overrides: Partial<RemainingStone> = {}): RemainingStone => ({
  id: 'remaining-9x2',
  width: 9,
  length: 2,
  squareMeters: 0.18,
  isAvailable: true,
  sourceCutId: 'cut-1',
  quantity: 1,
  ...overrides
});

const partition = (id: string, width: number, length: number, quantity = 1): StonePartition => ({
  id,
  width,
  length,
  quantity,
  squareMeters: (width * length * quantity) / 100
});

const serviceRow = (overrides: Partial<ContractServiceRow> = {}): ContractServiceRow => ({
  id: 'service-tool-1',
  sourceType: 'tool',
  sourceId: 'tool-1',
  sourceCode: 'ABZ-1',
  title: 'ابزار سه لبه',
  description: '',
  unit: 'meter',
  quantity: 24,
  unitPrice: 45_000,
  totalPrice: 1_080_000,
  currency: 'تومان',
  images: ['catalog-tool.jpg'],
  ...overrides
});

const wizardData = (overrides: Partial<ContractWizardData> = {}): ContractWizardData => ({
  contractDate: '1405/04/02',
  contractNumber: 'SAL-000999',
  customerId: 'customer-1',
  customer: {
    id: 'customer-1',
    firstName: 'Ali',
    lastName: 'Ahmadi',
    customerType: 'PERSON',
    status: 'ACTIVE',
    projectAddresses: [],
    phoneNumbers: [{ id: 'phone-1', phoneNumber: '09123456789', type: 'MOBILE', isPrimary: true }],
    isBlacklisted: false,
    isLocked: false
  },
  projectId: 'project-1',
  project: {
    id: 'project-1',
    address: 'Tehran project address',
    city: 'Tehran',
    isActive: true,
    projectManagerName: 'Project Manager'
  },
  selectedProductTypeForAddition: 'longitudinal',
  products: [],
  serviceRows: [],
  deliveries: [],
  payment: {
    payments: [],
    currency: 'تومان',
    totalContractAmount: 0
  },
  signature: {
    phoneNumber: '09123456789',
    confirmationStatus: 'VERIFIED'
  },
  ...overrides
} as ContractWizardData);

{
  const result = handleSmartCalculation(
    'squareMeters',
    3.6,
    { width: 20, quantity: 1 },
    'm',
    'cm'
  );

  approx(result.length, 18);
  approx(result.width, 20);
  approx(result.squareMeters, 3.6);
}

{
  const smartPlan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 20,
    enteredWidthUnit: 'cm',
    enteredLength: 18,
    enteredLengthUnit: 'm',
    quantity: 1,
    allowPhysicalSplitting: true,
    longitudinalRatePerMeter: 40_000,
    seed: 101
  });
  const pricing = calculateFinalPrice({
    basePrice: smartPlan.consumedAreaSqm * 1_050_000,
    isMandatory: false,
    mandatoryPercentage: 0,
    cuttingCost: smartPlan.totalCuttingCost
  });

  assert.equal(smartPlan.mode, 'optimized');
  assert.deepEqual(smartPlan.productionPieces, [{ widthCm: 20, lengthM: 9, quantity: 2 }]);
  approx(smartPlan.sourceLengthConsumedM, 9);
  approx(smartPlan.requestedAreaSqm, 3.6);
  approx(smartPlan.consumedAreaSqm, 3.6);
  assert.equal(smartPlan.remainingStones.length, 0);
  approx(smartPlan.totalCuttingCost, 720_000);
  approx(pricing.originalPrice, 3_780_000);
  approx(pricing.totalWithCutting, 4_500_000);
}

{
  const fullWidthPlan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 40,
    enteredWidthUnit: 'cm',
    enteredLength: 18,
    enteredLengthUnit: 'm',
    quantity: 1,
    longitudinalRatePerMeter: 40_000,
    seed: 102
  });

  assert.equal(fullWidthPlan.enabled, false);
  approx(fullWidthPlan.requestedAreaSqm, 7.2);
  assert.equal(fullWidthPlan.remainingStones.length, 0);
  assert.equal(fullWidthPlan.totalCuttingCost, 0);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 15,
    enteredWidthUnit: 'cm',
    enteredLength: 18,
    enteredLengthUnit: 'm',
    quantity: 1,
    longitudinalRatePerMeter: 40_000,
    seed: 103
  });

  assert.deepEqual(plan.productionPieces, [{ widthCm: 15, lengthM: 18, quantity: 1 }]);
  approx(plan.consumedAreaSqm, 7.2);
  approx(plan.requestedAreaSqm, 2.7);
  assert.equal(plan.remainingStones.length, 1);
  approx(plan.remainingStones[0].width, 25);
  approx(plan.remainingStones[0].length, 18);
  approx(plan.remainingStones[0].squareMeters, 4.5);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 13,
    enteredWidthUnit: 'cm',
    enteredLength: 2,
    enteredLengthUnit: 'm',
    quantity: 2,
    sawKerfEnabled: true,
    sawKerfCm: 0.3,
    longitudinalRatePerMeter: 20_000,
    seed: 104
  });

  approx(plan.consumedWidthCm, 13.3);
  assert.equal(plan.stripsPerSource, 2);
  approx(plan.sourceLengthConsumedM, 2);
  approx(plan.remainingStones[0].width, 13.4);
  approx(plan.remainingStones[0].length, 2);
}

{
  const widthResolved = resolveLongitudinalWidth({ squareMeters: 7.2, width: 0 }, product(), 'cm', false);
  assert.equal(widthResolved.width, 40);

  assert.equal(validateCutDimensions(40, 18, 41, 18).isValid, false);
  assert.equal(validateCutDimensions(40, 18, 20, 19).isValid, false);
  assert.equal(validateCutDimensions(40, 18, 20, 18).isValid, true);
}

{
  const allocation = allocateRemainingStonePartitions(
    [partition('long-partition', 3, 6, 1)],
    remainingStone({ width: 9, length: 2, squareMeters: 0.18, quantity: 1 })
  );

  assert.equal(allocation.rowErrors.size, 0);
  assert.equal(allocation.consumedSourcePieces, 1);
  assert.equal(allocation.physicalPiecesByRow.get('long-partition')?.length, 3);
  approx(allocation.remainingAreas.reduce((sum, stone) => sum + stone.squareMeters, 0), 0);
}

{
  const tooLarge = allocateRemainingStonePartitions(
    [partition('too-large', 5, 2, 2)],
    remainingStone({ width: 9, length: 2, squareMeters: 0.18, quantity: 1 })
  );

  assert.equal(tooLarge.rowErrors.size, 1);
  assert.match(tooLarge.summaryError, /پارتیشن|ظرفیت|مشکل/);
}

{
  const slabMetrics = calculateSlabMetrics({
    length: 200,
    lengthUnit: 'cm',
    width: 120,
    widthUnit: 'cm',
    quantity: 3,
    pricePerSquareMeter: 1_000_000,
    standardDimensions: [
      { id: 'std-existing-1', standardLengthCm: 300, standardWidthCm: 160, quantity: 1 },
      { id: 'std-existing-2', standardLengthCm: 280, standardWidthCm: 140, quantity: 2 }
    ],
    cuttingCostPerMeterLongitudinal: 100_000,
    cuttingCostPerMeterCross: 50_000,
    slabCuttingMode: 'lineBased'
  });
  const slabRemaining = calculateSlabRemainingStones({
    requestedLengthCm: 200,
    requestedWidthCm: 120,
    standardDimensions: [
      { id: 'std-existing-1', standardLengthCm: 300, standardWidthCm: 160, quantity: 1 },
      { id: 'std-existing-2', standardLengthCm: 280, standardWidthCm: 140, quantity: 2 }
    ],
    seed: 201
  });
  const slabCut = calculateSlabCut({
    originalLength: 300,
    originalWidth: 160,
    desiredLength: 200,
    desiredWidth: 120,
    lengthUnit: 'cm',
    widthUnit: 'cm',
    cuttingCostPerMeterLongitudinal: 100_000,
    cuttingCostPerMeterCross: 50_000
  });

  approx(slabMetrics.squareMeters, 7.2);
  approx(slabMetrics.originalTotalPrice, 12_640_000);
  approx(slabMetrics.cuttingCost, 780_000);
  assert.equal(slabRemaining.remainingStones.length, 6);
  approx(slabRemaining.remainingStones.reduce((sum, stone) => sum + stone.squareMeters, 0), 5.44);
  assert.equal(slabCut.remainingPieces.length, 3);
  approx(slabCut.totalCuttingCost, 260_000);
}

{
  const slabCutDetails = buildSlabCutDetails({
    requestedLengthCm: 180,
    requestedWidthCm: 110,
    standardDimensions: [
      { id: 'std-1', standardLengthCm: 200, standardWidthCm: 120, quantity: 4 },
      { id: 'std-2', standardLengthCm: 250, standardWidthCm: 130, quantity: 2 }
    ],
    slabCuttingMode: 'lineBased',
    cuttingCostPerMeterLongitudinal: 100_000,
    cuttingCostPerMeterCross: 50_000,
    verticalCutCostPerMeter: 20_000,
    verticalCutSides: { top: true, bottom: true, left: true, right: true },
    seed: 301
  });

  assert.equal(slabCutDetails.length, 6);
  assert.deepEqual(slabCutDetails.map(cut => cut.type), [
    'longitudinal',
    'cross',
    'vertical',
    'longitudinal',
    'cross',
    'vertical'
  ]);
  approx(slabCutDetails[0].meters || 0, 2);
  approx(slabCutDetails[0].cost || 0, 800_000);
  approx(slabCutDetails[1].meters || 0, 1.1);
  approx(slabCutDetails[1].cost || 0, 220_000);
  approx(slabCutDetails[2].meters || 0, 25.6);
  approx(slabCutDetails[2].cost || 0, 512_000);
  approx(slabCutDetails[5].meters || 0, 15.2);
  approx(slabCutDetails[5].cost || 0, 304_000);
  assert.equal(slabCutDetails[5].description?.includes('250×130cm × 2'), true);
  assert.deepEqual(slabCutDetails[5].selectedSides, ['بالا', 'پایین', 'چپ', 'راست']);
}

{
  const activatedWithoutChoice = activateFinishingSelection({
    finishingEnabled: false,
    finishingId: null,
    finishingName: null,
    finishingLabel: null,
    finishingPricePerSquareMeter: null,
    finishingUnitPrice: null,
    finishingCalculationBase: null,
    finishingQuantity: null
  });
  const activatedWithSavedChoice = activateFinishingSelection({
    finishingEnabled: false,
    finishingId: 'finish-matte-40',
    finishingName: 'Ù…Ø§Øª Ø¹ 40',
    finishingLabel: 'Ù…Ø§Øª Ø¹ 40',
    finishingPricePerSquareMeter: 150_000,
    finishingUnitPrice: 150_000,
    finishingCalculationBase: 'squareMeters' as const,
    finishingQuantity: 3.6
  });

  assert.equal(activatedWithoutChoice.finishingEnabled, true);
  assert.equal(activatedWithoutChoice.finishingId, null);
  assert.equal(activatedWithoutChoice.finishingName, null);
  assert.equal(activatedWithoutChoice.finishingPricePerSquareMeter, null);
  assert.equal(activatedWithoutChoice.finishingUnitPrice, null);
  assert.equal(activatedWithoutChoice.finishingCalculationBase, null);
  assert.equal(activatedWithoutChoice.finishingQuantity, null);
  assert.equal(calculateFinishingCost(activatedWithoutChoice.finishingQuantity, activatedWithoutChoice.finishingUnitPrice), 0);
  assert.equal(activatedWithSavedChoice.finishingEnabled, true);
  assert.equal(activatedWithSavedChoice.finishingId, 'finish-matte-40');
  assert.equal(activatedWithSavedChoice.finishingName, 'Ù…Ø§Øª Ø¹ 40');
  approx(calculateFinishingCost(activatedWithSavedChoice.finishingQuantity, activatedWithSavedChoice.finishingUnitPrice), 540_000);
}

{
  const meterFinishingQty = calculateDefaultFinishingQuantity({
    calculationBase: 'length',
    productType: 'longitudinal',
    length: 18,
    lengthUnit: 'm',
    quantity: 1,
    squareMeters: 3.6
  });
  const sqmFinishingQty = calculateDefaultFinishingQuantity({
    calculationBase: 'squareMeters',
    productType: 'longitudinal',
    length: 18,
    lengthUnit: 'm',
    quantity: 1,
    squareMeters: 3.6
  });

  approx(meterFinishingQty, 18);
  approx(sqmFinishingQty, 3.6);
  approx(calculateFinishingCost(meterFinishingQty, 80_000), 1_440_000);
  approx(calculateFinishingCost(sqmFinishingQty, 150_000), 540_000);
}

{
  const toolRow = createContractServiceRow(
    'tool',
    { id: 'tool-1', namePersian: 'ابزار سه لبه', pricePerMeter: 45_000, calculationBase: 'length', isActive: true } as any,
    24
  );
  const editedToolRow = recalculateContractServiceRow(toolRow, { quantity: 30, unitPrice: 50_000 });
  const finishingRow = createContractServiceRow(
    'finishing',
    { id: 'finish-1', namePersian: 'مات', unitPrice: 150_000, calculationBase: 'squareMeters', isActive: true } as any,
    3.6
  );

  assert.equal(toolRow.unit, 'meter');
  approx(toolRow.totalPrice, 1_080_000);
  assert.equal(editedToolRow.sourceId, toolRow.sourceId);
  approx(editedToolRow.totalPrice, 1_500_000);
  assert.equal(finishingRow.unit, 'squareMeter');
  approx(finishingRow.totalPrice, 540_000);
}

{
  const stairProduct = product({ id: 'stair-stone', widthValue: 40, thicknessValue: 3 });
  const totals = computeTotalsV2('tread', {
    stoneProduct: stairProduct,
    lengthValue: 1.2,
    lengthUnit: 'm',
    widthCm: 20,
    quantity: 10,
    pricePerSquareMeter: 1_000_000,
    useMandatory: false,
    tools: [
      { toolId: 'tool-1', name: 'three edges', pricePerMeter: 100_000, front: true, left: true, right: true }
    ]
  }, (code) => code === 'LONG' ? 50_000 : 25_000);
  const layerMetrics = calculateLayerMetrics({
    totalLayers: 5,
    layerWidthCm: 10,
    layerLengthM: 2,
    availableRemainingStones: [
      remainingStone({ id: 'layer-source', width: 10, length: 2, squareMeters: 0.2, quantity: 2 })
    ],
    cuttingCostPerMeter: 100_000
  });

  approx(totals.sqm, 2.4);
  approx(totals.pricingSquareMeters, 2.4);
  assert.equal(totals.piecesPerStone, 2);
  assert.equal(totals.baseStoneQuantity, 5);
  approx(totals.toolsTotal, 1_600_000);
  approx(totals.cuttingMetersLongitudinalProduction, 12);
  approx(totals.cuttingMetersLongitudinalCalibration, 6);
  approx(totals.cuttingMetersLongitudinal, 18);
  approx(totals.cuttingCost, 900_000);
  approx(totals.partTotal, 4_900_000);
  assert.equal(layerMetrics.layersFromRemainingStones, 2);
  assert.equal(layerMetrics.layersFromNewStones, 3);
  approx(layerMetrics.squareMetersFromRemaining || 0, 0.4);
  approx(layerMetrics.squareMetersFromNew || 0, 0.6);
}

{
  const stairProduct = product({ id: 'stair-remainder-30', widthValue: 30, thicknessValue: 2 });
  const usage = (quantity: number, widthCm = 10) => calculateStairStoneUsage({
    stoneProduct: stairProduct,
    lengthValue: 1.2,
    lengthUnit: 'm',
    widthCm,
    quantity,
    pricePerSquareMeter: 1_000_000
  });

  assert.equal(usage(1).piecesPerStone, 3);
  assert.equal(usage(1).baseStoneQuantity, 1);
  assert.equal(usage(1).leftoverWidthCm, 20);
  assert.equal(usage(1).remainingStoneQuantity, 1);
  assert.deepEqual(usage(1).remainingStoneGroups, [{ widthCm: 20, quantity: 1 }]);

  assert.equal(usage(2).baseStoneQuantity, 1);
  assert.equal(usage(2).leftoverWidthCm, 10);
  assert.equal(usage(2).remainingStoneQuantity, 1);

  assert.equal(usage(3).baseStoneQuantity, 1);
  assert.equal(usage(3).leftoverWidthCm, 0);
  assert.equal(usage(3).remainingStoneQuantity, 0);
  assert.deepEqual(usage(3).remainingStoneGroups, []);

  assert.equal(usage(4).baseStoneQuantity, 2);
  assert.equal(usage(4).leftoverWidthCm, 20);
  assert.equal(usage(4).remainingStoneQuantity, 1);

  assert.equal(usage(5).baseStoneQuantity, 2);
  assert.equal(usage(5).leftoverWidthCm, 10);
  assert.equal(usage(5).remainingStoneQuantity, 1);

  assert.equal(usage(2, 20).piecesPerStone, 1);
  assert.equal(usage(2, 20).baseStoneQuantity, 2);
  assert.equal(usage(2, 20).leftoverWidthCm, 10);
  assert.equal(usage(2, 20).remainingStoneQuantity, 2);
  assert.deepEqual(usage(2, 20).remainingStoneGroups, [{ widthCm: 10, quantity: 2 }]);

  const mixedRemainderProduct = product({ id: 'stair-remainder-35', widthValue: 35, thicknessValue: 2 });
  const mixedUsage = calculateStairStoneUsage({
    stoneProduct: mixedRemainderProduct,
    lengthValue: 1.2,
    lengthUnit: 'm',
    widthCm: 10,
    quantity: 4,
    pricePerSquareMeter: 1_000_000
  });
  assert.equal(mixedUsage.baseStoneQuantity, 2);
  assert.equal(mixedUsage.remainingStoneQuantity, 2);
  assert.deepEqual(mixedUsage.remainingStoneGroups, [
    { widthCm: 5, quantity: 1 },
    { widthCm: 25, quantity: 1 }
  ]);
}

{
  const stairProduct = product({ id: 'stair-cut-meters-35', widthValue: 35, thicknessValue: 3 });
  const totals = computeTotalsV2('tread', {
    stoneProduct: stairProduct,
    lengthValue: 0.72,
    lengthUnit: 'm',
    standardLengthValue: 1.1,
    standardLengthUnit: 'm',
    widthCm: 10,
    quantity: 7,
    pricePerSquareMeter: 4_500_000,
    useMandatory: false,
    calibrationCutEnabled: true,
    tools: []
  }, () => 20_000);

  assert.equal(totals.piecesPerStone, 3);
  assert.equal(totals.baseStoneQuantity, 3);
  assert.deepEqual(totals.remainingStoneGroups, [
    { widthCm: 5, quantity: 2 },
    { widthCm: 25, quantity: 1 }
  ]);
  approx(totals.cuttingMetersLongitudinalProduction, 5.04);
  approx(totals.cuttingMetersLongitudinalCalibration, 2.16);
  approx(totals.cuttingMetersLongitudinal, 7.2);
  approx(totals.cuttingCostLongitudinal, 144_000);
  approx(totals.cuttingMetersCross, 1.05);
  approx(totals.cuttingCostCross, 21_000);
}

{
  const stairProduct = product({ id: 'mandatory-stair-stone', widthValue: 40, thicknessValue: 3 });
  const totals = computeTotalsV2('tread', {
    stoneProduct: stairProduct,
    lengthValue: 1.2,
    lengthUnit: 'm',
    widthCm: 20,
    quantity: 10,
    pricePerSquareMeter: 1_000_000,
    useMandatory: true,
    mandatoryPercentage: 20,
    calibrationCutEnabled: true,
    tools: []
  }, (code) => code === 'LONG' ? 50_000 : 25_000);

  approx(totals.cuttingMetersLongitudinalProduction, 12);
  approx(totals.cuttingMetersLongitudinalCalibration, 6);
  approx(totals.cuttingMetersLongitudinal, 18);
  approx(totals.cuttingCostLongitudinal, 900_000);
  approx(totals.billableCuttingCostLongitudinal, 0);
  assert.equal(totals.shouldChargeCuttingCost, false);
}

{
  const source = contractProduct({
    remainingStones: [remainingStone({ id: 'old-remaining', width: 20, length: 18, squareMeters: 3.6 })],
    usedRemainingStones: [remainingStone({ id: 'used-old-remaining', width: 10, length: 2, squareMeters: 0.2, isAvailable: false })],
    totalUsedRemainingWidth: 10,
    totalUsedRemainingLength: 2
  });
  const unchanged = hasLongitudinalGeometryChanged({
    previousProduct: source,
    nextOriginalWidthCm: 40,
    nextWidthValue: 20,
    nextWidthUnit: 'cm',
    nextLengthValue: 18,
    nextLengthUnit: 'm',
    nextQuantity: 1
  });
  const changed = hasLongitudinalGeometryChanged({
    previousProduct: source,
    nextOriginalWidthCm: 40,
    nextWidthValue: 15,
    nextWidthUnit: 'cm',
    nextLengthValue: 18,
    nextLengthUnit: 'm',
    nextQuantity: 1
  });
  const merge = mergeEditedRemainingStoneState({
    geometryChanged: changed,
    nextAvailableRemainingStones: [remainingStone({ id: 'new-remaining', width: 10, length: 9, squareMeters: 0.9 })],
    previousProduct: source
  });

  assert.equal(unchanged, false);
  assert.equal(changed, true);
  assert.equal(merge.remainingStones[0].id, 'new-remaining');
  assert.equal(merge.usedRemainingStones[0].id, 'used-old-remaining');
  assert.ok(merge.warning);
}

{
  const originalRemaining = remainingStone({
    id: 'source-remaining-9x2',
    width: 9,
    length: 2,
    squareMeters: 0.18,
    sourceCutId: 'source-cut-9x2',
    quantity: 1
  });
  const sourceProduct = contractProduct({
    remainingStones: [originalRemaining],
    usedRemainingStones: [],
    totalUsedRemainingWidth: 0,
    totalUsedRemainingLength: 0
  });
  const firstAllocation = allocateRemainingStonePartitions(
    [partition('partition-reuse', 3, 6, 1)],
    originalRemaining
  );
  const generatedRemainingIds = firstAllocation.remainingAreas.map(area => area.id);
  const usedStone = remainingStone({
    id: 'used_partition_seed_partition-reuse',
    width: 3,
    length: 6,
    squareMeters: 0.18,
    isAvailable: false,
    sourceCutId: originalRemaining.sourceCutId,
    quantity: 1,
    physicalPieces: firstAllocation.physicalPiecesByRow.get('partition-reuse')?.map(piece => ({
      width: piece.width,
      length: piece.length,
      quantity: piece.quantity,
      squareMeters: piece.squareMeters
    }))
  });
  const sourceAfterUse = {
    ...sourceProduct,
    remainingStones: firstAllocation.remainingAreas.map(area => ({
      ...area,
      sourceCutId: originalRemaining.sourceCutId
    })),
    usedRemainingStones: [usedStone],
    totalUsedRemainingWidth: 3,
    totalUsedRemainingLength: 6
  };
  const childFromRemaining = contractProduct({
    stoneCode: `${sourceProduct.stoneCode}-R`,
    stoneName: `${sourceProduct.stoneName} (از سنگ باقی‌مانده)`,
    width: 3,
    length: 6,
    squareMeters: 0.18,
    pricePerSquareMeter: 0,
    totalPrice: 0,
    originalTotalPrice: 0,
    parentProductIndex: 0,
    meta: {
      remainingSource: {
        sourceProductIndex: 0,
        sourceRemainingStoneId: originalRemaining.id,
        sourceRemainingStone: originalRemaining,
        partitionId: 'partition-reuse',
        allocatedQuantity: 1,
        generatedRemainingStoneIds: generatedRemainingIds,
        physicalPieces: firstAllocation.physicalPiecesByRow.get('partition-reuse')?.map(piece => ({
          width: piece.width,
          length: piece.length,
          quantity: piece.quantity,
          squareMeters: piece.squareMeters
        }))
      }
    } as any
  });
  const restoredProducts = restoreRemainingStoneAfterChildRemoval([sourceAfterUse, childFromRemaining], 1);
  const restoredSource = restoredProducts[0];
  const restoredRemaining = restoredSource.remainingStones[0];
  const secondAllocation = allocateRemainingStonePartitions(
    [partition('partition-reuse-again', 3, 6, 1)],
    restoredRemaining
  );

  assert.equal(firstAllocation.rowErrors.size, 0);
  assert.equal(restoredProducts.length, 1);
  assert.equal(restoredSource.usedRemainingStones.length, 0);
  assert.equal(restoredSource.remainingStones.length, 1);
  assert.equal(restoredRemaining.id, originalRemaining.id);
  approx(restoredRemaining.width, 9);
  approx(restoredRemaining.length, 2);
  approx(restoredRemaining.squareMeters, 0.18);
  assert.equal(restoredRemaining.quantity, 1);
  assert.equal(secondAllocation.rowErrors.size, 0);
  assert.equal(secondAllocation.physicalPiecesByRow.get('partition-reuse-again')?.length, 3);
  assert.equal(secondAllocation.consumedSourcePieces, 1);
}

{
  const originalRemaining = remainingStone({
    id: 'source-remaining-10x9',
    width: 10,
    length: 9,
    squareMeters: 0.9,
    sourceCutId: 'source-cut-10x9',
    quantity: 1
  });
  const sourceProduct = contractProduct({
    remainingStones: [originalRemaining],
    usedRemainingStones: []
  });
  const allocation = allocateRemainingStonePartitions(
    [partition('partial-partition', 5, 9, 1)],
    originalRemaining
  );
  const generatedRemaining = allocation.remainingAreas.map(area => ({
    ...area,
    sourceCutId: originalRemaining.sourceCutId
  }));
  const childFromRemaining = contractProduct({
    width: 5,
    length: 9,
    squareMeters: 0.45,
    pricePerSquareMeter: 0,
    totalPrice: 0,
    originalTotalPrice: 0,
    parentProductIndex: 0,
    meta: {
      remainingSource: {
        sourceProductIndex: 0,
        sourceRemainingStoneId: originalRemaining.id,
        sourceRemainingStone: originalRemaining,
        partitionId: 'partial-partition',
        allocatedQuantity: 1,
        generatedRemainingStoneIds: generatedRemaining.map(stone => stone.id),
        physicalPieces: allocation.physicalPiecesByRow.get('partial-partition')?.map(piece => ({
          width: piece.width,
          length: piece.length,
          quantity: piece.quantity,
          squareMeters: piece.squareMeters
        }))
      }
    } as any
  });
  const restoredProducts = restoreRemainingStoneAfterChildRemoval([
    {
      ...sourceProduct,
      remainingStones: generatedRemaining,
      usedRemainingStones: [remainingStone({
        id: 'used_partition_seed_partial-partition',
        width: 5,
        length: 9,
        squareMeters: 0.45,
        isAvailable: false,
        sourceCutId: originalRemaining.sourceCutId
      })]
    },
    childFromRemaining
  ], 1);
  const restoredSource = restoredProducts[0];
  const restoredRemaining = restoredSource.remainingStones[0];

  assert.equal(allocation.rowErrors.size, 0);
  assert.equal(allocation.remainingAreas.length, 1);
  approx(allocation.remainingAreas[0].width, 5);
  approx(allocation.remainingAreas[0].length, 9);
  assert.equal(restoredSource.usedRemainingStones.length, 0);
  assert.equal(restoredSource.remainingStones.length, 1);
  assert.equal(restoredRemaining.id, originalRemaining.id);
  approx(restoredRemaining.width, 10);
  approx(restoredRemaining.length, 9);
  approx(restoredRemaining.squareMeters, 0.9);
}

{
  const longitudinal = contractProduct();
  const prepared = contractProduct({
    productType: 'prepared',
    preparedKind: 'readyPiece',
    preparedUnit: 'ton',
    preparedQuantity: 2.5,
    quantity: 2.5,
    length: 0,
    width: 0,
    squareMeters: 0,
    totalPrice: 7_500_000,
    pricePerSquareMeter: 1
  });
  const tool = serviceRow();

  assert.equal(getDeliveryUnit(longitudinal), 'meter');
  approx(getDeliveryTargetAmount(longitudinal), 18);
  assert.equal(getDeliveryUnit(prepared), 'ton');
  approx(getDeliveryTargetAmount(prepared), 2.5);
  approx(getServiceDeliveryTargetAmount(tool), 24);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 7,
    enteredWidthUnit: 'cm',
    enteredLength: 50,
    enteredLengthUnit: 'm',
    quantity: 0,
    requestedAreaSqm: 3.5,
    calibrationCutEnabled: false,
    seed: 15
  });
  const optimizedProduct = contractProduct({
    length: plan.totalRequestedLengthM,
    width: plan.requestedWidthCm,
    quantity: 0,
    squareMeters: plan.requestedAreaSqm,
    smartCutPlan: plan,
    smartCutDerivedQuantity: true,
    appliedSubServices: [{
      id: 'edge-left',
      subServiceId: 'tool-edge',
      subService: {
        id: 'tool-edge',
        code: 'EDGE',
        namePersian: 'لبه کوتاه',
        pricePerMeter: 100_000,
        calculationBase: 'length',
        isActive: true
      },
      meter: 0.07,
      cost: 7_000,
      calculationBase: 'length',
      edges: { left: true }
    }],
    finishingId: 'finish-1',
    finishingName: 'پرداخت سطح',
    finishingUnitPrice: 200_000,
    finishingPricePerSquareMeter: 200_000,
    finishingCalculationBase: 'squareMeters',
    finishingQuantity: 3.5,
    finishingCost: 700_000,
    finishingSquareMeters: 3.5
  });
  const recalculated = recalculateRemainingChildAddOns(optimizedProduct);

  assert.equal(recalculated.ok, true);
  approx(recalculated.product.appliedSubServices?.[0]?.meter || 0, 0.35);
  approx(recalculated.product.totalSubServiceCost || 0, 35_000);
  approx(recalculated.product.finishingQuantity || 0, 3.5);
  approx(recalculated.product.finishingCost || 0, 700_000);
  approx(getDeliveryTargetAmount(recalculated.product), 50);
  const customerHtml = generateContractHTML({
    products: [recalculated.product],
    contractNumber: 'TEST-1',
    contractDate: '1405/04/23',
    customer: { firstName: 'Test', lastName: 'Customer' }
  });
  assert.ok(customerHtml.includes('۵۰m × ۷cm'));
  assert.ok(!customerHtml.includes('خروجی فیزیکی تولید'));
  assert.ok(customerHtml.includes('سنگ مصرفی برای'));
  assert.ok(customerHtml.includes('عرض ۴۰cm × طول ۱۰m × ۱ عدد، جمع ۴ متر مربع'));

  const legacySavedProduct = contractProduct({
    length: plan.requestedLengthM,
    width: plan.requestedWidthCm,
    quantity: plan.requestedQuantity,
    squareMeters: plan.requestedAreaSqm,
    smartCutPlan: plan,
    smartCutDerivedQuantity: true
  });
  const restoredCustomerRequest = restoreLongitudinalCustomerRequest(legacySavedProduct);
  assert.equal(restoredCustomerRequest.quantity, 0);
  approx(restoredCustomerRequest.length, 50);
  approx(restoredCustomerRequest.width, 7);
  assert.equal(legacySavedProduct.quantity, 5);
  approx(legacySavedProduct.length, 10);
  const legacyCustomerHtml = generateContractHTML({
    products: [legacySavedProduct],
    contractNumber: 'TEST-LEGACY',
    contractDate: '1405/04/23',
    customer: { firstName: 'Test', lastName: 'Customer' }
  });
  assert.ok(legacyCustomerHtml.includes('۵۰m × ۷cm'));
  assert.ok(legacyCustomerHtml.includes('>۰ عدد</td>'));
  assert.equal(hasLongitudinalGeometryChanged({
    previousProduct: restoredCustomerRequest,
    nextOriginalWidthCm: 40,
    nextWidthValue: 7,
    nextWidthUnit: 'cm',
    nextLengthValue: 50,
    nextLengthUnit: 'm',
    nextQuantity: 0
  }), false);

  assert.deepEqual(resolveLongitudinalCustomerFields({
    enteredLength: 50,
    enteredLengthUnit: 'm',
    enteredWidth: 7,
    enteredQuantity: 0,
    plan
  }), { length: 50, width: 7, quantity: 0 });

  const explicitTwoPieces = contractProduct({
    productType: 'longitudinal',
    length: 50,
    lengthUnit: 'm',
    width: 7,
    widthUnit: 'cm',
    quantity: 2,
    smartCutDerivedQuantity: false,
    smartCutPlan: null
  });
  assert.deepEqual(resolveLongitudinalCustomerFields({
    enteredLength: 50,
    enteredLengthUnit: 'm',
    enteredWidth: 7,
    enteredQuantity: 2,
    plan: null
  }), { length: 50, width: 7, quantity: 2 });
  approx(getContractProductOperationGeometry(explicitTwoPieces).totalLengthMeters, 100);
}

{
  const productRow = contractProduct();
  const tool = serviceRow();
  const total = calculateContractTotal([productRow, tool]);
  const validWizard = wizardData({
    products: [productRow],
    serviceRows: [tool],
    deliveries: [
      {
        deliveryDate: '1405/04/10',
        projectManagerName: 'Project Manager',
        receiverName: 'Receiver A',
        deliveryAddress: 'Tehran',
        products: [
          { productIndex: 0, quantity: 9, amount: 9, unit: 'meter' },
          { rowType: 'service', serviceRowId: tool.id, quantity: 12, amount: 12, unit: 'meter' }
        ]
      },
      {
        deliveryDate: '1405/04/20',
        projectManagerName: 'Project Manager',
        receiverName: 'Receiver B',
        deliveryAddress: 'Tehran',
        products: [
          { productIndex: 0, quantity: 9, amount: 9, unit: 'meter' },
          { rowType: 'service', serviceRowId: tool.id, quantity: 12, amount: 12, unit: 'meter' }
        ]
      }
    ],
    payment: {
      payments: [
        { id: 'pay-1', method: 'CASH_CARD', amount: 2_000_000, paymentDate: '1405/04/02' },
        {
          id: 'pay-2',
          method: 'CHECK',
          amount: total - 2_000_000,
          checkOwnerName: 'Ali Ahmadi',
          handoverDate: '1405/04/02',
          paymentDate: '1405/05/02'
        }
      ],
      currency: 'تومان',
      totalContractAmount: total
    }
  });
  const underDeliveredWizard = wizardData({
    products: [productRow],
    serviceRows: [tool],
    deliveries: [
      {
        deliveryDate: '1405/04/10',
        receiverName: 'Receiver A',
        products: [{ productIndex: 0, quantity: 17, amount: 17, unit: 'meter' }]
      }
    ],
    payment: validWizard.payment
  });

  approx(total, 5_220_000);
  assert.equal(validateWizardStep(4, validWizard).isValid, true);
  assert.equal(validateWizardStep(5, validWizard).isValid, true);
  assert.equal(validateWizardStep(6, validWizard).isValid, true);
  assert.equal(validateWizardStep(7, validWizard).isValid, true);
  assert.equal(validateWizardStep(5, underDeliveredWizard).isValid, false);
}

{
  const slabProduct = product({
    name: 'Azna polished white slab',
    namePersian: 'اسلب - مرمریت',
    cuttingDimensionNamePersian: 'اسلب',
    stoneTypeNamePersian: 'اسلب',
    widthValue: 0,
    thicknessValue: 2,
    mineNamePersian: 'ازنا',
    finishNamePersian: 'صیقل',
    colorNamePersian: 'سفید',
    qualityNamePersian: 'استاندارد'
  });

  assert.equal(
    generateSlabContractProductName(slabProduct),
    'اسلب - اسلب - عرض 0×ضخامت 2cm - ازنا - صیقل - سفید - استاندارد'
  );
}

{
  const invalidPayment = validatePayment({
    payments: [
      { id: 'pay-1', method: 'CASH_SHIBA', amount: 1_000_000 },
      { id: 'pay-2', method: 'CHECK', amount: 2_000_000, paymentDate: '1405/05/01' }
    ],
    currency: 'تومان',
    totalContractAmount: 5_220_000
  }, 5_220_000);

  assert.equal(invalidPayment.isValid, false);
  assert.ok(invalidPayment.errors.some((error) => error.includes('جمع پرداخت')));
  assert.ok(invalidPayment.errors.some((error) => error.includes('تاریخ پرداخت')));
  assert.ok(invalidPayment.errors.some((error) => error.includes('نام صاحب چک')));
  assert.ok(invalidPayment.errors.some((error) => error.includes('تاریخ تحویل چک')));
}

{
  const total = 5_000_000;
  const underPaid = validatePayment({
    payments: [
      { id: 'pay-1', method: 'CASH_CARD', amount: total - 1, paymentDate: '1405/04/02' }
    ],
    currency: 'تومان',
    totalContractAmount: total
  }, total);

  const overPaidWithoutReason = validatePayment({
    payments: [
      { id: 'pay-1', method: 'CASH_CARD', amount: total + 1_000_000, paymentDate: '1405/04/02' }
    ],
    currency: 'تومان',
    totalContractAmount: total
  }, total);

  const overPaidWithReason = validatePayment({
    payments: [
      { id: 'pay-1', method: 'CASH_CARD', amount: total + 1_000_000, paymentDate: '1405/04/02' }
    ],
    currency: 'تومان',
    totalContractAmount: total,
    extraPaymentReason: 'PREVIOUS_DEBT'
  }, total);

  const customerBalance = validatePayment({
    payments: [
      { id: 'pay-1', method: 'CUSTOMER_BALANCE', amount: total, paymentDate: '1405/04/02' }
    ],
    currency: 'تومان',
    totalContractAmount: total
  }, total);

  assert.equal(underPaid.isValid, false);
  assert.ok(underPaid.errors.some((error) => error.includes('نباید کمتر')));
  assert.equal(overPaidWithoutReason.isValid, false);
  assert.ok(overPaidWithoutReason.errors.some((error) => error.includes('توضیحات')));
  assert.equal(overPaidWithReason.isValid, true);
  assert.equal(customerBalance.isValid, true);
}

console.log('contractCreationComplexScenarios tests passed');
