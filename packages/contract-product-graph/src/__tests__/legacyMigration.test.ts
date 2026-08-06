import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { planLegacyProductGraphMigration } from '../legacyMigration';
import {
  calculateLongitudinalProduct,
  createNewLongitudinalProductInput
} from '../longitudinalPolicy';
import { parseCanonicalDecimal } from '../canonicalDecimal';
import { parseStableIdentity } from '../stableIdentity';
import { readLegacyProductGraph } from '../legacyReadAdapter';
import {
  calculateStairPart,
  type StairPartPolicyInput
} from '../stairPolicy';
import {
  calculateStairLayerConfiguration,
  type StairLayerConfigurationInput
} from '../stairLayerPolicy';
import { materializePaidRemainderStocks } from '../remainderPolicy';
import { calculateProductOperations } from '../operationsPolicy';
import { repairLegacyProductOperationIdentities } from '../operationIdentityRepair';

const policy = {
  calculation: 'calculation-v1',
  packing: 'packing-v1',
  remainder: 'remainder-v1',
  pricing: 'pricing-v1',
  rounding: 'rounding-v1'
};
const product = {
  productRowId: 'row-1',
  productId: 'catalog-1',
  productType: 'longitudinal',
  name: 'Stone',
  totalPrice: 1250
};

const longitudinalPolicyInput = ({
  sourceBatchId,
  lengthMeters,
  widthMeters
}: {
  sourceBatchId: string;
  lengthMeters: string;
  widthMeters: string;
}) => ({
  calculationPolicyVersion: policy.calculation,
  packingPolicyVersion: policy.packing,
  pricingPolicyVersion: policy.pricing,
  roundingPolicyVersion: policy.rounding,
  sourceBatchId,
  motherWidthMeters: '0.35',
  lengthMeters,
  widthMeters,
  requestedAreaSquareMeters: new Decimal(lengthMeters).times(widthMeters).toFixed(),
  lastManualField: 'length',
  lastManualDimension: 'length',
  lengthDisplayUnit: 'm',
  widthDisplayUnit: 'cm',
  baseRateToman: '1700000',
  mandatoryEnabled: false,
  mandatoryPercentage: '20',
  rememberedMandatoryPercentage: '20',
  sawKerfEnabled: false,
  sawKerfMeters: '0.003',
  calibrationEnabled: false,
  calibrationSelection: 'manual',
  longitudinalCutRateToman: '20000',
  calibrationCutRateToman: '20000'
});

{
  const derivedGroupIdentity = 'derived-owner:no-operations';
  const operationInput = (
    productRowId: string,
    groups: Readonly<Record<string, unknown>>[],
    tools: Readonly<Record<string, unknown>>[]
  ) => ({
    policyVersion: policy.calculation,
    pricingPolicyVersion: policy.pricing,
    roundingPolicyVersion: policy.rounding,
    productRowId,
    lengthMeters: '4',
    widthMeters: '0.23',
    groups,
    tools,
    finishings: []
  });
  const products = [{
    rowId: 'derived-owner',
    productRowId: 'derived-owner',
    productId: 'catalog-1',
    productType: 'longitudinal',
    name: 'No operations',
    totalPrice: 0,
    operationPolicyInput: operationInput('derived-owner', [], [])
  }, {
    rowId: 'explicit-owner',
    productRowId: 'explicit-owner',
    productId: 'catalog-1',
    productType: 'longitudinal',
    name: 'Half round',
    totalPrice: 200000,
    operationPolicyInput: operationInput('explicit-owner', [{
      operationGroupId: derivedGroupIdentity,
      scope: '4'
    }], [{
      toolSelectionId: 'explicit-tool',
      operationGroupId: derivedGroupIdentity,
      catalogItemId: 'tool-1',
      catalogSnapshotVersion: 'catalog-v1',
      name: 'Half round',
      unit: 'meter',
      rateToman: '50000',
      edges: ['front']
    }]),
    appliedSubServices: [{
      id: 'explicit-tool',
      subServiceId: 'tool-1',
      meter: 4,
      cost: 200000
    }]
  }];

  const repair = repairLegacyProductOperationIdentities(products);
  assert.deepEqual(repair.blockedProductRowIds, []);
  assert.deepEqual(repair.repairedProductRowIds, ['explicit-owner']);
  assert.deepEqual(repair.evidence, [{
    productRowId: 'explicit-owner',
    collisionKinds: ['derived-no-operation-group-collision'],
    collisionCount: 1
  }]);
  assert.notEqual(
    repair.products[1].operationPolicyInput.groups[0]?.operationGroupId,
    derivedGroupIdentity
  );
  assert.equal(
    repair.products[1].appliedSubServices?.[0]?.id,
    repair.products[1].operationPolicyInput.tools[0]?.toolSelectionId
  );

  const retry = repairLegacyProductOperationIdentities(repair.products);
  assert.deepEqual(retry.repairedProductRowIds, []);
  assert.equal(
    retry.products[1].operationPolicyInput.groups[0]?.operationGroupId,
    repair.products[1].operationPolicyInput.groups[0]?.operationGroupId
  );
  const graphRead = readLegacyProductGraph({
    contractId: 'repaired-derived-operation-identity',
    revision: 0,
    calculationPolicy: policy,
    products: repair.products
  });
  assert.equal(
    graphRead.ok,
    true,
    graphRead.ok ? undefined : JSON.stringify(graphRead.conflicts)
  );

  const ambiguous = structuredClone(products[1]);
  ambiguous.rowId = 'ambiguous-owner';
  ambiguous.productRowId = 'ambiguous-owner';
  ambiguous.operationPolicyInput = {
    ...ambiguous.operationPolicyInput,
    productRowId: 'ambiguous-owner',
    groups: [
      {
        operationGroupId: 'contradictory-group',
        scope: '1'
      },
      {
        operationGroupId: 'contradictory-group',
        scope: '2'
      }
    ],
    tools: [{
      ...ambiguous.operationPolicyInput.tools[0],
      operationGroupId: 'contradictory-group'
    }]
  };
  const blocked = repairLegacyProductOperationIdentities([ambiguous]);
  assert.deepEqual(blocked.repairedProductRowIds, []);
  assert.deepEqual(blocked.blockedProductRowIds, ['ambiguous-owner']);

  const orphanedSnapshot = structuredClone(products[1]);
  orphanedSnapshot.rowId = 'orphaned-snapshot-owner';
  orphanedSnapshot.productRowId = 'orphaned-snapshot-owner';
  orphanedSnapshot.operationPolicyInput = {
    ...orphanedSnapshot.operationPolicyInput,
    productRowId: 'orphaned-snapshot-owner'
  };
  orphanedSnapshot.appliedSubServices = [{
    id: 'tool-selection-without-an-owner',
    subServiceId: 'tool-1',
    meter: 4,
    cost: 200000
  }];
  const blockedSnapshot = repairLegacyProductOperationIdentities([
    orphanedSnapshot
  ]);
  assert.deepEqual(blockedSnapshot.repairedProductRowIds, []);
  assert.deepEqual(
    blockedSnapshot.blockedProductRowIds,
    ['orphaned-snapshot-owner']
  );
}

{
  const result = planLegacyProductGraphMigration({
    contractId: 'contract-1',
    revision: 0,
    calculationPolicy: policy,
    products: [product]
  }, 1250);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected migration');
  assert.equal(result.reconciliation.matches, true);
  assert.equal(result.graph.rows[0]?.commercial.totalAmountToman, '1250');
  assert.ok(result.provenanceHash);
}

{
  const input = {
    ...createNewLongitudinalProductInput({
      calculationPolicyVersion: policy.calculation,
      packingPolicyVersion: policy.packing,
      pricingPolicyVersion: policy.pricing,
      roundingPolicyVersion: policy.rounding,
      sourceBatchId: parseStableIdentity('source-batch', 'source-1'),
      motherWidthMeters: parseCanonicalDecimal('0.4'),
      defaultMandatoryPercentage: parseCanonicalDecimal('20'),
      sawKerfMeters: parseCanonicalDecimal('0.003'),
      longitudinalCutRateToman: parseCanonicalDecimal('20000')
    }),
    lengthMeters: parseCanonicalDecimal('1.5'),
    widthMeters: parseCanonicalDecimal('0.12'),
    quantity: 20,
    baseRateToman: parseCanonicalDecimal('100000')
  };
  const calculated = calculateLongitudinalProduct(input);
  assert.equal(calculated.ok, true);
  if (!calculated.ok) throw new Error('expected longitudinal calculation');
  const result = planLegacyProductGraphMigration({
    contractId: 'contract-with-policy',
    revision: 3,
    calculationPolicy: policy,
    products: [{
      ...product,
      totalPrice: Number(calculated.result.totalAmountToman),
      longitudinalPolicyInput: input
    }]
  }, calculated.result.totalAmountToman);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected canonical policy migration');
  assert.equal(
    result.graph.rows[0]?.commercial.requestedAreaSquareMeters,
    calculated.result.requestedAreaSquareMeters
  );
  assert.equal(
    result.graph.rows[0]?.commercial.totalAmountToman,
    calculated.result.totalAmountToman
  );
  assert.equal(result.graph.sourceBatches.length, 1);
  assert.equal(
    result.graph.remainingStones.reduce(
      (quantity, remainder) => quantity + remainder.quantity,
      0
    ),
    calculated.result.remainders.length
  );
}

{
  const result = planLegacyProductGraphMigration({
    contractId: 'contract-1',
    revision: 0,
    calculationPolicy: policy,
    products: [product]
  }, 1300);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected drift');
  assert.equal(result.conflicts[0]?.code, 'legacy-financial-drift');
}

{
  const parentRowId = parseStableIdentity('product-row', 'stair-parent');
  const stairSystemId = parseStableIdentity('stair-system', 'stair-system-1');
  const stairSourceBatchId = parseStableIdentity(
    'source-batch',
    'stair-source-1'
  );
  const stairInput: StairPartPolicyInput = {
    calculationPolicyVersion: policy.calculation,
    packingPolicyVersion: policy.packing,
    pricingPolicyVersion: policy.pricing,
    roundingPolicyVersion: policy.rounding,
    stairSystemId,
    part: 'tread',
    sourceBatchId: stairSourceBatchId,
    motherLengthMeters: parseCanonicalDecimal('3'),
    motherWidthMeters: parseCanonicalDecimal('0.4'),
    lengthMeters: parseCanonicalDecimal('1.2'),
    crossDimensionMeters: parseCanonicalDecimal('0.3'),
    lengthDisplayUnit: 'm',
    crossDimensionDisplayUnit: 'cm',
    quantity: 2,
    baseRateToman: parseCanonicalDecimal('1000000'),
    mandatoryEnabled: false,
    mandatoryPercentage: parseCanonicalDecimal('25'),
    rememberedMandatoryPercentage: parseCanonicalDecimal('25'),
    sawKerfEnabled: false,
    sawKerfMeters: parseCanonicalDecimal('0.003'),
    calibrationEnabled: false,
    calibrationSelection: 'automatic',
    longitudinalCutRateToman: parseCanonicalDecimal('100'),
    crossCutRateToman: parseCanonicalDecimal('100'),
    calibrationCutRateToman: parseCanonicalDecimal('100')
  };
  const stairCalculation = calculateStairPart(stairInput);
  assert.equal(stairCalculation.ok, true);
  if (!stairCalculation.ok) throw new Error('expected stair calculation');

  {
    const treadInput: StairPartPolicyInput = {
      ...stairInput,
      sourceBatchId: parseStableIdentity('source-batch', 'mixed-stair-tread-source'),
      motherWidthMeters: parseCanonicalDecimal('0.35'),
      crossDimensionMeters: parseCanonicalDecimal('0.35'),
      quantity: 12
    };
    const riserInput: StairPartPolicyInput = {
      ...stairInput,
      part: 'riser',
      sourceBatchId: parseStableIdentity('source-batch', 'mixed-stair-riser-source'),
      motherWidthMeters: parseCanonicalDecimal('0.4'),
      crossDimensionMeters: parseCanonicalDecimal('0.4'),
      quantity: 6
    };
    const secondTreadInput: StairPartPolicyInput = {
      ...treadInput,
      sourceBatchId: parseStableIdentity(
        'source-batch',
        'mixed-stair-second-tread-source'
      ),
      lengthMeters: parseCanonicalDecimal('1.3'),
      quantity: 38
    };
    const secondRiserInput: StairPartPolicyInput = {
      ...riserInput,
      sourceBatchId: parseStableIdentity(
        'source-batch',
        'mixed-stair-second-riser-source'
      ),
      lengthMeters: parseCanonicalDecimal('1.3'),
      quantity: 19
    };
    const treadCalculation = calculateStairPart(treadInput);
    const riserCalculation = calculateStairPart(riserInput);
    const secondTreadCalculation = calculateStairPart(secondTreadInput);
    const secondRiserCalculation = calculateStairPart(secondRiserInput);
    assert.equal(treadCalculation.ok, true);
    assert.equal(riserCalculation.ok, true);
    assert.equal(secondTreadCalculation.ok, true);
    assert.equal(secondRiserCalculation.ok, true);
    if (
      !treadCalculation.ok ||
      !riserCalculation.ok ||
      !secondTreadCalculation.ok ||
      !secondRiserCalculation.ok
    ) {
      throw new Error('expected mixed-catalog stair calculations');
    }
    const totalAmountToman =
      Number(treadCalculation.result.totalAmountToman) +
      Number(riserCalculation.result.totalAmountToman) +
      Number(secondTreadCalculation.result.totalAmountToman) +
      Number(secondRiserCalculation.result.totalAmountToman);
    const mixedCatalogStairMigration = planLegacyProductGraphMigration({
      contractId: 'mixed-catalog-stair',
      revision: 0,
      calculationPolicy: policy,
      products: [{
        productRowId: parseStableIdentity('product-row', 'mixed-stair-tread'),
        productId: 'catalog-stair-35cm',
        productType: 'stair',
        name: '35 cm tread',
        totalPrice: Number(treadCalculation.result.totalAmountToman),
        stairPartPolicyInput: treadInput
      }, {
        productRowId: parseStableIdentity('product-row', 'mixed-stair-riser'),
        productId: 'catalog-stair-40cm',
        productType: 'stair',
        name: '40 cm riser',
        totalPrice: Number(riserCalculation.result.totalAmountToman),
        stairPartPolicyInput: riserInput
      }, {
        productRowId: parseStableIdentity('product-row', 'mixed-stair-second-tread'),
        productId: 'catalog-stair-35cm',
        productType: 'stair',
        name: 'Second 35 cm tread',
        totalPrice: Number(secondTreadCalculation.result.totalAmountToman),
        stairPartPolicyInput: secondTreadInput
      }, {
        productRowId: parseStableIdentity('product-row', 'mixed-stair-second-riser'),
        productId: 'catalog-stair-40cm',
        productType: 'stair',
        name: 'Second 40 cm riser',
        totalPrice: Number(secondRiserCalculation.result.totalAmountToman),
        stairPartPolicyInput: secondRiserInput
      }]
    }, totalAmountToman);
    assert.equal(
      mixedCatalogStairMigration.ok,
      true,
      JSON.stringify(mixedCatalogStairMigration)
    );
    if (!mixedCatalogStairMigration.ok) {
      throw new Error('expected repeated mixed-catalog stair rows to migrate');
    }
    assert.equal(mixedCatalogStairMigration.graph.rows.length, 4);
    assert.deepEqual(
      mixedCatalogStairMigration.graph.rows.map(row => row.catalogProductId),
      [
        'catalog-stair-35cm',
        'catalog-stair-40cm',
        'catalog-stair-35cm',
        'catalog-stair-40cm'
      ]
    );
  }

  const operationGroupId = parseStableIdentity(
    'operation-group',
    'stair-parent-operations'
  );
  const stairOperations = {
    policyVersion: policy.calculation,
    pricingPolicyVersion: policy.pricing,
    roundingPolicyVersion: policy.rounding,
    productRowId: parentRowId,
    lengthMeters: parseCanonicalDecimal('1.2'),
    widthMeters: parseCanonicalDecimal('0.3'),
    quantity: 2,
    groups: [{
      operationGroupId,
      scope: parseCanonicalDecimal('2')
    }],
    tools: [{
      toolSelectionId: parseStableIdentity(
        'tool-selection',
        'stair-parent-tool'
      ),
      operationGroupId,
      catalogItemId: 'tool-half-round',
      catalogSnapshotVersion: 'tool-catalog-v1',
      name: 'Half round',
      unit: 'meter' as const,
      rateToman: parseCanonicalDecimal('50000'),
      edges: ['front' as const]
    }],
    finishings: []
  };
  const stairOperationsCalculation =
    calculateProductOperations(stairOperations);
  assert.equal(stairOperationsCalculation.ok, true);
  if (!stairOperationsCalculation.ok) {
    throw new Error('expected stair operations calculation');
  }
  const stairWithOperationsTotal =
    Number(stairCalculation.result.totalAmountToman) +
    Number(stairOperationsCalculation.result.totalAmountToman);
  const stairWithOperationsMigration = planLegacyProductGraphMigration({
    contractId: 'legacy-stair-with-operations',
    revision: 0,
    calculationPolicy: policy,
    products: [{
      productRowId: parentRowId,
      productId: 'catalog-1',
      productType: 'stair',
      name: 'Stair tread with tool',
      totalPrice: stairWithOperationsTotal,
      stairPartPolicyInput: stairInput,
      operationPolicyInput: stairOperations
    }]
  }, stairWithOperationsTotal);
  assert.equal(
    stairWithOperationsMigration.ok,
    true,
    JSON.stringify(stairWithOperationsMigration)
  );
  const sharedToolSelectionId = stairOperations.tools[0].toolSelectionId;
  const repeatedToolIdentity = readLegacyProductGraph({
    contractId: 'legacy-operation-identity-conflict',
    revision: 0,
    calculationPolicy: policy,
    products: ['first', 'second'].map(label => {
      const rowId = parseStableIdentity('product-row', `${label}-row`);
      const groupId = parseStableIdentity('operation-group', `${label}-group`);
      return {
        productRowId: rowId,
        productId: 'catalog-1',
        productType: 'longitudinal',
        name: `${label} row with repeated tool identity`,
        totalPrice: 50000,
        operationPolicyInput: {
          policyVersion: policy.calculation,
          pricingPolicyVersion: policy.pricing,
          roundingPolicyVersion: policy.rounding,
          productRowId: rowId,
          lengthMeters: parseCanonicalDecimal('1'),
          widthMeters: parseCanonicalDecimal('0.4'),
          quantity: 1,
          groups: [{
            operationGroupId: groupId,
            scope: parseCanonicalDecimal('1')
          }],
          tools: [{
            ...stairOperations.tools[0],
            toolSelectionId: sharedToolSelectionId,
            operationGroupId: groupId
          }],
          finishings: []
        }
      };
    })
  });
  assert.equal(repeatedToolIdentity.ok, false);
  if (repeatedToolIdentity.ok) {
    throw new Error('expected repeated tool identity conflict');
  }
  assert.deepEqual(repeatedToolIdentity.conflicts[0]?.path, [
    'toolSelections',
    sharedToolSelectionId
  ]);
  assert.equal(
    repeatedToolIdentity.conflicts[0]?.causeCode,
    'duplicate-stable-identity'
  );

  const layerConfigurationId = parseStableIdentity(
    'layer-configuration',
    'layer-row'
  );
  const layerInput: StairLayerConfigurationInput = {
    calculationPolicyVersion: policy.calculation,
    packingPolicyVersion: policy.packing,
    pricingPolicyVersion: policy.pricing,
    roundingPolicyVersion: policy.rounding,
    layerConfigurationId,
    parentProductRowId: parentRowId,
    sourceBatchId: parseStableIdentity('source-batch', 'layer-source-1'),
    creationOrder: 1,
    layerCatalogItemId: 'layer-double',
    layerCatalogSnapshotVersion: 'layer-catalog-v1',
    layerTitle: 'Double layer',
    layerUnit: 'set',
    layerRateToman: parseCanonicalDecimal('80000'),
    layersPerParentPiece: 1,
    widthMeters: parseCanonicalDecimal('0.04'),
    widthDisplayUnit: 'cm',
    targetSides: ['front', 'left'],
    source: {
      kind: 'new-material',
      catalogProductId: 'catalog-1',
      catalogSnapshotVersion: 'catalog-layer-source-v1',
      materialRateToman: parseCanonicalDecimal('500000'),
      sourceRows: [{
        sourceRowId: parseStableIdentity(
          'layer-source-row',
          'layer-source-row-1'
        ),
        lengthMeters: parseCanonicalDecimal('3'),
        widthMeters: parseCanonicalDecimal('0.4'),
        quantity: 1
      }]
    },
    kerfMeters: parseCanonicalDecimal('0'),
    calibrationEnabled: false,
    longitudinalCutRateToman: parseCanonicalDecimal('100'),
    crossCutRateToman: parseCanonicalDecimal('100'),
    calibrationCutRateToman: parseCanonicalDecimal('100'),
    sideOperations: []
  };
  const expectedLayer = calculateStairLayerConfiguration({
    input: layerInput,
    parent: {
      lengthMeters: stairCalculation.result.lengthMeters,
      crossDimensionMeters: stairCalculation.result.crossDimensionMeters,
      quantity: stairCalculation.result.quantity
    },
    availableInventory: materializePaidRemainderStocks({
      ownerProductRowId: parentRowId,
      catalogProductId: 'catalog-1',
      sourceBatchId: stairSourceBatchId,
      remainders: stairCalculation.result.packingPlan.remainders,
      startingCreationOrder: 0
    })
  });
  assert.equal(expectedLayer.ok, true);
  if (!expectedLayer.ok) throw new Error('expected layer calculation');

  const result = readLegacyProductGraph({
    contractId: 'contract-with-layer',
    revision: 4,
    calculationPolicy: policy,
    products: [{
      productRowId: parentRowId,
      productId: 'catalog-1',
      productType: 'stair',
      name: 'Stair tread',
      totalPrice: 1,
      stairPartPolicyInput: stairInput
    }, {
      productRowId: layerConfigurationId,
      productId: 'catalog-1',
      productType: 'stair',
      parentProductRowId: parentRowId,
      name: 'Double layer',
      totalPrice: 1,
      meta: {
        isLayer: true,
        layerSourcePlan: {
          canonicalInput: layerInput,
          canonicalResultHash: 'untrusted-client-result'
        }
      }
    }]
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('expected canonical layer migration');
  assert.equal(result.graph.stairSystems.length, 1);
  assert.equal(result.graph.layerConfigurations.length, 1);
  assert.equal(
    result.graph.layerConfigurations[0]?.result.resultHash,
    expectedLayer.result.resultHash
  );
  assert.equal(
    result.graph.rows[1]?.commercial.totalAmountToman,
    expectedLayer.result.totalAmountToman
  );
  assert.notEqual(
    result.graph.layerConfigurations[0]?.result.resultHash,
    'untrusted-client-result'
  );
  assert.equal(
    result.graph.layerConfigurations[0]?.result.sideOperationResults.length,
    0
  );

  const {
    motherLengthMeters: _historicalMotherLength,
    ...stairWithoutStoredMotherLength
  } = stairInput;
  const derived = readLegacyProductGraph({
    contractId: 'legacy-stair-without-mother-length',
    revision: 2,
    calculationPolicy: policy,
    products: [{
      productRowId: parseStableIdentity(
        'product-row',
        'legacy-stair-derived-row'
      ),
      productId: 'catalog-1',
      productType: 'stair',
      name: 'Historical stair tread',
      totalPrice: 1,
      stairPartPolicyInput: stairWithoutStoredMotherLength
    }]
  });
  assert.equal(derived.ok, true, JSON.stringify(derived));
  if (!derived.ok) throw new Error('expected derived historical stair');
  assert.equal(
    derived.graph.rows[0]?.stairPart?.motherLengthMode,
    'derived-from-finished'
  );
  assert.equal(
    derived.graph.rows[0]?.stairPart?.motherLengthDisplayUnit,
    'm'
  );

  const ambiguousLayerOperations = readLegacyProductGraph({
    contractId: 'legacy-layer-ambiguous-operations',
    revision: 3,
    calculationPolicy: policy,
    products: [{
      productRowId: parentRowId,
      productId: 'catalog-1',
      productType: 'stair',
      name: 'Stair tread',
      totalPrice: 1,
      stairPartPolicyInput: stairInput
    }, {
      productRowId: parseStableIdentity(
        'product-row',
        'legacy-layer-ambiguous-row'
      ),
      productId: 'catalog-1',
      productType: 'stair',
      parentProductRowId: parentRowId,
      name: 'Historical layer',
      totalPrice: 1,
      meta: { isLayer: true },
      operationPolicyInput: {
        tools: [{ legacyToolId: 'unknown-side-tool' }],
        finishings: []
      }
    }]
  });
  assert.equal(ambiguousLayerOperations.ok, false);
  if (ambiguousLayerOperations.ok) {
    throw new Error('expected ambiguous layer operation conflict');
  }
  assert.equal(
    ambiguousLayerOperations.conflicts.some(
      conflict => conflict.code === 'legacy-layer-operation-ambiguous'
    ),
    true
  );
}

{
  const optimizedRow = {
    rowId: 'optimized-total-length',
    productRowId: 'optimized-total-length',
    productId: 'catalog-1',
    productType: 'longitudinal',
    name: 'Optimized total length',
    length: 6.5,
    lengthUnit: 'm',
    width: 12,
    widthUnit: 'cm',
    quantity: 0,
    squareMeters: 0.78,
    smartCutDerivedQuantity: true,
    smartCutPlan: {
      derivedQuantity: true,
      totalRequestedLengthM: 6.5,
      requestedAreaSqm: 0.78
    },
    totalPrice: 2063750,
    longitudinalPolicyInput: longitudinalPolicyInput({
      sourceBatchId: 'source-optimized',
      lengthMeters: '6.5',
      widthMeters: '0.12'
    }),
    operationPolicyInput: {
      policyVersion: policy.calculation,
      pricingPolicyVersion: policy.pricing,
      roundingPolicyVersion: policy.rounding,
      productRowId: 'optimized-total-length',
      lengthMeters: '6.5',
      widthMeters: '0.12',
      groups: [],
      tools: [],
      finishings: []
    }
  };
  const staleWholeOperationRow = {
    rowId: 'stale-whole-operation',
    productRowId: 'stale-whole-operation',
    productId: 'catalog-1',
    productType: 'longitudinal',
    name: 'Stale whole operation',
    length: 6.5,
    lengthUnit: 'm',
    width: 23,
    widthUnit: 'cm',
    quantity: 0,
    squareMeters: 1.495,
    smartCutDerivedQuantity: true,
    smartCutPlan: {
      derivedQuantity: true,
      totalRequestedLengthM: 6.5,
      requestedAreaSqm: 1.495
    },
    totalPrice: 4322500,
    longitudinalPolicyInput: {
      ...longitudinalPolicyInput({
        sourceBatchId: 'source-stale',
        lengthMeters: '4',
        widthMeters: '0.23'
      }),
      lastManualField: 'width',
      lastManualDimension: 'width',
      requestedAreaSquareMeters: undefined
    },
    operationPolicyInput: {
      policyVersion: policy.calculation,
      pricingPolicyVersion: policy.pricing,
      roundingPolicyVersion: policy.rounding,
      productRowId: 'stale-whole-operation',
      lengthMeters: '6.5',
      widthMeters: '0.23',
      groups: [{
        operationGroupId: 'stale-whole-group',
        scope: '4'
      }],
      tools: [{
        toolSelectionId: 'stale-whole-tool',
        operationGroupId: 'stale-whole-group',
        catalogItemId: 'tool-half-round',
        catalogSnapshotVersion: 'catalog-v1',
        name: 'Half round',
        unit: 'meter',
        rateToman: '50000',
        edges: ['front']
      }],
      finishings: []
    }
  };

  const repaired = planLegacyProductGraphMigration({
    contractId: 'reported-four-row-regression',
    revision: 0,
    calculationPolicy: policy,
    products: [optimizedRow, staleWholeOperationRow]
  });
  assert.equal(
    repaired.ok,
    true,
    repaired.ok ? undefined : JSON.stringify(repaired.conflicts)
  );
  if (repaired.ok) {
    assert.equal(repaired.reconciliation.canonicalTotalAmountToman, '6386250');
    assert.equal(repaired.reconciliation.differenceToman, '0');
    assert.deepEqual(repaired.semanticRepairEvidence, [{
      productRowId: 'stale-whole-operation',
      repairKinds: [
        'longitudinal-customer-geometry',
        'unsplit-whole-row-operation-scope'
      ],
      repairedFields: [
        'longitudinalPolicyInput.lengthMeters',
        'longitudinalPolicyInput.requestedAreaSquareMeters',
        'operationPolicyInput.groups.0.scope'
      ],
      legacyTotalAmountToman: '4322500',
      canonicalTotalAmountToman: '4322500'
    }]);
  }

  const moneyChanging = planLegacyProductGraphMigration({
    contractId: 'money-changing-repair-blocked',
    revision: 0,
    calculationPolicy: policy,
    products: [{
      ...staleWholeOperationRow,
      totalPrice: 4322501
    }]
  });
  assert.equal(moneyChanging.ok, false);
  if (!moneyChanging.ok) {
    assert.equal(moneyChanging.semanticRepairEvidence, undefined);
    assert.equal(moneyChanging.conflicts[0]?.code, 'legacy-financial-drift');
    assert.equal(
      (moneyChanging.conflicts[0] as { productRowId?: string }).productRowId,
      'stale-whole-operation'
    );
  }
}

console.log('legacy migration tests passed');
