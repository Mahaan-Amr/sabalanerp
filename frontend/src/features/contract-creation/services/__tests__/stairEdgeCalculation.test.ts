import assert from 'node:assert/strict';
import {
  computeLayerSqmV2,
  computeToolMetersForTool,
  calculateCanonicalLayerDraft,
  calculateLayerSourcePlan,
  computeTotalsV2,
  createCanonicalStairDraftInput,
  formatCanonicalLayerConflict,
  getLayerEdgeDemands,
  getTotalLayerLengthPerStairM,
  normalizeAutomaticLayerOperationGroups,
  toCanonicalLayerInventory
} from '../stairCalculationService';
import {
  parseCanonicalDecimal,
  parseStableIdentity,
  type ProductOperationsInput
} from '@sabalanerp/contract-product-graph';
import { deriveLayerEdgesFromTools } from '../../utils/stairSystemHelpers';
import type {
  Product,
  StairPartDraftV2,
  StairStepperPart,
  ToolSelectionV2
} from '../../types/contract.types';

const approx = (actual: number, expected: number, precision = 6) => {
  assert.equal(Number(actual.toFixed(precision)), Number(expected.toFixed(precision)));
};

const stairDraft = (overrides: Partial<StairPartDraftV2> = {}): StairPartDraftV2 => ({
  lengthValue: 1.2,
  lengthUnit: 'm',
  widthCm: 17.5,
  quantity: 4,
  ...overrides
});

const tool = (edges: Partial<ToolSelectionV2>): ToolSelectionV2 => ({
  toolId: 'tool-edge',
  name: 'edge tool',
  pricePerMeter: 35_000,
  ...edges
});

{
  const inventory = toCanonicalLayerInventory({
    stones: [
      {
        id: 'physical-remainder-1',
        length: 1,
        width: 40,
        squareMeters: 0.4,
        quantity: 1,
        isAvailable: true,
        sourceCutId: 'source-cut-1'
      },
      {
        id: 'physical-remainder-1',
        length: 1,
        width: 40,
        squareMeters: 0.4,
        quantity: 1,
        isAvailable: true,
        sourceCutId: 'source-cut-1'
      }
    ],
    ownerProductRowId: 'parent-product-row',
    catalogProductId: 'catalog-product'
  });
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0]?.remainingStoneId, 'physical-remainder-1');
}

for (const part of ['tread', 'riser', 'landing'] as StairStepperPart[]) {
  approx(computeToolMetersForTool(part, stairDraft(), tool({ front: true })), 4.8);
  approx(computeToolMetersForTool(part, stairDraft(), tool({ back: true })), 4.8);
  approx(computeToolMetersForTool(part, stairDraft(), tool({ left: true })), 0.7);
  approx(computeToolMetersForTool(part, stairDraft(), tool({ right: true })), 0.7);
  approx(computeToolMetersForTool(part, stairDraft(), tool({ perimeter: true })), 11);
  approx(computeToolMetersForTool(part, stairDraft(), tool({
    front: true,
    back: true,
    left: true,
    right: true
  })), 11);
}

{
  const draft = stairDraft({ lengthValue: 1.5, widthCm: 40, quantity: 25 });
  approx(
    computeToolMetersForTool(
      'tread',
      draft,
      tool({ front: true, calculationBase: 'length', coveredQuantity: 10 })
    ),
    15
  );
  approx(
    computeToolMetersForTool(
      'tread',
      draft,
      tool({ calculationBase: 'squareMeters', coveredQuantity: 10 })
    ),
    6
  );
  approx(
    computeToolMetersForTool(
      'tread',
      draft,
      tool({
        front: true,
        calculationBase: 'length',
        coveredQuantity: 10,
        manualValue: 12.5
      })
    ),
    12.5
  );
}

for (const part of ['tread', 'riser', 'landing'] as StairStepperPart[]) {
  const derived = deriveLayerEdgesFromTools(stairDraft({
    tools: [tool({ back: true, perimeter: true })]
  }), part);

  assert.equal(derived.layerEdges?.back, false);
  assert.equal(derived.layerEdges?.perimeter, true);

  const backOnly = deriveLayerEdgesFromTools(stairDraft({
    tools: [tool({ back: true })]
  }), part);

  assert.equal(backOnly.layerEdges?.back, true);
  assert.equal(backOnly.layerEdges?.perimeter, false);
}

{
  const draft = stairDraft({
    layerWidthCm: 3,
    numberOfLayersPerStair: 1,
    layerEdges: { front: true, back: true, left: true, right: true }
  });

  approx(getTotalLayerLengthPerStairM('tread', draft), 2.63);
  approx(computeLayerSqmV2('tread', draft), 0.3156);

  const demands = getLayerEdgeDemands('tread', draft);
  assert.deepEqual(demands.map((demand) => demand.edge), ['front', 'back', 'left', 'right']);
  approx(demands.find((demand) => demand.edge === 'front')?.lengthM || 0, 1.17);
  approx(demands.find((demand) => demand.edge === 'left')?.lengthM || 0, 0.145);
}

{
  // Contract 100156 shape: 32 layer sets, each containing front + left.
  const demands = [
    { edge: 'front' as const, lengthM: 1.13, quantity: 32 },
    { edge: 'left' as const, lengthM: 0.30, quantity: 32 }
  ];
  const withoutKerf = calculateLayerSourcePlan({
    demands,
    sourceWidthCm: 35,
    sourceLengthM: 1.2,
    layerWidthCm: 5
  });
  assert.equal(withoutKerf.columnsPerStone, 7);
  assert.equal(withoutKerf.physicalPieceQuantity, 64);
  assert.equal(withoutKerf.sourceStoneQuantity, 6);
  approx(withoutKerf.sourceAreaSqm, 2.52);

  const withKerf = calculateLayerSourcePlan({
    demands,
    sourceWidthCm: 35,
    sourceLengthM: 1.2,
    layerWidthCm: 5,
    sawKerfEnabled: true,
    sawKerfCm: 0.3
  });
  assert.equal(withKerf.columnsPerStone, 6);
  assert.equal(withKerf.physicalPieceQuantity, 64);
  assert.equal(withKerf.sourceStoneQuantity, 8);
  approx(withKerf.sourceAreaSqm, 3.36);
}

{
  const sourceProduct = {
    id: 'layer-stone-1',
    code: 'LAYER-1',
    name: 'Layer stone',
    namePersian: 'سنگ لایه',
    currency: 'تومان',
    isAvailable: true,
    widthValue: 40,
    motherLengthValue: 1.5
  } as Product;
  const canonicalLayer = calculateCanonicalLayerDraft({
    part: 'tread',
    draft: stairDraft({
      layerConfigurationDraftId: 'layer-configuration-1',
      numberOfLayersPerStair: 1,
      layerWidthCm: 4,
      layerTypeId: 'layer-type-1',
      layerTypeName: 'دوبل',
      layerTypePrice: 80_000,
      layerEdges: { front: true, left: true },
      layerSourceKind: 'newMaterial',
      layerStoneProductId: sourceProduct.id,
      layerStoneProduct: sourceProduct,
      layerPricePerSquareMeter: 500_000,
      quantity: 2,
      lengthValue: 1.2,
      widthCm: 30
    }),
    parentProductRowId: 'stair-parent-1',
    creationOrder: 0,
    availableInventory: [],
    parentRemainingStoneIds: [],
    layerUnit: 'set',
    getCuttingTypePricePerMeter: () => 10_000
  });
  assert.equal(canonicalLayer.ok, true);
  if (canonicalLayer.ok) {
    assert.equal(canonicalLayer.result.commercialLayerSets, 2);
    assert.equal(canonicalLayer.result.physicalStripCount, 4);
    assert.deepEqual(
      canonicalLayer.result.physicalStrips.map(strip => strip.side),
      ['front', 'left']
    );
    assert.ok(
      canonicalLayer.result.packingPlan.consumedSources.length <
      canonicalLayer.result.physicalStripCount
    );
  }
}

{
  const sourceProduct = {
    id: 'stair-rate-stone',
    code: 'STAIR-RATE',
    name: 'Stair rate stone',
    namePersian: 'سنگ نرخ برش',
    currency: 'تومان',
    isAvailable: true,
    widthValue: 30,
    motherLengthValue: 1.6
  } as Product;
  const rateDraft = stairDraft({
    stoneId: sourceProduct.id,
    stoneProduct: sourceProduct,
    lengthValue: 1.5,
    standardLengthValue: 1.6,
    standardLengthUnit: 'm',
    widthCm: 30,
    quantity: 10,
    pricePerSquareMeter: 1_500_000
  });
  const onlyLong = (code: string) => code === 'LONG' ? 20_000 : null;
  const missingCross = computeTotalsV2('tread', rateDraft, onlyLong);
  assert.equal(
    missingCross.cuttingCostPerMeterCross,
    0,
    'legacy totals must never substitute LONG for a missing CROSS rate'
  );
  assert.equal(missingCross.canonicalCalculation.ok, false);
  if (missingCross.canonicalCalculation.ok) {
    throw new Error('Expected missing CROSS to block canonical stair calculation.');
  }
  assert.deepEqual(
    missingCross.canonicalCalculation.conflicts.map(conflict => [
      conflict.code,
      conflict.field
    ]),
    [['stair-cut-rate-missing', 'crossCutRateToman']]
  );

  const zeroRates = computeTotalsV2('tread', rateDraft, () => 0);
  assert.equal(zeroRates.canonicalCalculation.ok, true, JSON.stringify(zeroRates));
  assert.equal(zeroRates.cuttingCostCross, 0);
  assert.ok(zeroRates.cuttingMetersCross > 0);

  const editedInput = createCanonicalStairDraftInput(
    'tread',
    {
      ...rateDraft,
      cutRateSnapshots: {
        longitudinal: 12_000,
        cross: 34_000
      }
    },
    () => 99_000
  );
  assert.equal(editedInput.longitudinalCutRateToman, '12000');
  assert.equal(editedInput.crossCutRateToman, '34000');
  assert.equal(editedInput.calibrationCutRateToman, '12000');
}

{
  assert.equal(
    formatCanonicalLayerConflict({
      code: 'layer-cut-rate-missing',
      field: 'crossCutRateToman',
      message: 'Cross layer cutting rate is missing.'
    }),
    'نرخ برش عرضی در موجودی ثبت نشده است'
  );
}

{
  assert.equal(
    formatCanonicalLayerConflict({
      code: 'invalid-layer-input',
      field: 'layer',
      message: 'layerCatalogItemId must be a normalized non-empty string.'
    }),
    'نوع لایه را انتخاب کنید'
  );
}

{
  const emptyGroupId = parseStableIdentity(
    'operation-group',
    'stale-empty-layer-group'
  );
  const deliberateGroupId = parseStableIdentity(
    'operation-group',
    'deliberate-layer-group'
  );
  const operationInput: ProductOperationsInput = {
    policyVersion: 'calculation-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    productRowId: parseStableIdentity('product-row', 'layer-parent-row'),
    lengthMeters: parseCanonicalDecimal('1.5'),
    widthMeters: parseCanonicalDecimal('0.05'),
    quantity: 22,
    groups: [
      { operationGroupId: emptyGroupId, scope: parseCanonicalDecimal('22') },
      { operationGroupId: deliberateGroupId, scope: parseCanonicalDecimal('10') }
    ],
    tools: [{
      toolSelectionId: parseStableIdentity(
        'tool-selection',
        'deliberate-layer-tool'
      ),
      operationGroupId: deliberateGroupId,
      catalogItemId: 'tool-1',
      catalogSnapshotVersion: 'tool-v1',
      name: 'Tool',
      unit: 'meter',
      rateToman: parseCanonicalDecimal('0'),
      edges: ['front']
    }],
    finishings: []
  };
  const normalized = normalizeAutomaticLayerOperationGroups(operationInput, 32);
  assert.equal(normalized.quantity, 32);
  assert.deepEqual(
    normalized.groups.map(group => [
      group.operationGroupId,
      group.scope
    ]),
    [[deliberateGroupId, '10']],
    'empty stale scope must disappear while deliberate operation scope remains'
  );
}

console.log('stairEdgeCalculation tests passed');
