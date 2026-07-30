import assert from 'node:assert/strict';
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

console.log('legacy migration tests passed');
