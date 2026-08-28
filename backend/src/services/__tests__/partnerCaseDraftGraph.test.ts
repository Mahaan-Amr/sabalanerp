import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCanonicalDecimal as c } from '@sabalanerp/contract-product-graph';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { compilePartnerTechnicalGraph } from '../partnerSales/cases/technicalGraph';

test('private graph compilation preserves prepared and legacy volumetric identity and prices the exact selected measure', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const product = { ...catalog.products[0], families: ['prepared', 'volumetric'] as const };
  const context = { catalog: { ...catalog, products: [{ ...product, families: [...product.families] }] },
    policy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
      preparedRates: [{ kind: 'readyPiece' as const, unit: 'count' as const, rateToman: '123.4' },
        { kind: 'cubic' as const, unit: 'ton' as const, rateToman: '123.4' }] }] };
  const result = compilePartnerTechnicalGraph({ schemaVersion: 1, inputRevision: 4, rows: [
    { productRowId: 'prepared-a', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
      family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '3' } },
    { productRowId: 'legacy-b', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
      family: 'volumetric', configuration: { kind: 'cubic', unit: 'ton', quantity: '2.5' } },
  ] }, context);
  if (!result.ok) throw new Error(result.error.code);
  assert.deepEqual(result.value.graph.rows.map(row => [row.productRowId, row.productType, row.commercial.requestedQuantity,
    row.commercial.baseRateToman, row.commercial.totalAmountToman]),
  [['prepared-a', 'prepared', '3', '123.4', '370'], ['legacy-b', 'volumetric', '2.5', '123.4', '309']]);
  assert.equal(result.value.graph.rows[0].commercial.calculationSnapshot?.unit, 'count');
  assert.equal(result.value.graph.rows[1].commercial.calculationSnapshot?.unit, 'ton');
  assert.equal(result.value.graph.rows[1].commercial.calculationSnapshot?.kind, 'cubic');
  assert.deepEqual(result.value.measures, [
    { productRowId: 'prepared-a', quantity: '3', unit: 'count' },
    { productRowId: 'legacy-b', quantity: '2.5', unit: 'ton' },
  ]);
  assert.deepEqual(result.value.graph.sourceBatches, []);
  assert.deepEqual(result.value.graph.allocations, []);
  assert.equal(JSON.stringify(result.value.preview).includes('123.4'), false);
});

test('explicit different layer material binds its own catalog dimensions and never spends the parent remainder', () => {
  const fixture = createPartnerTechnicalCatalogFixtures(), parent = fixture.products[0], version = parent.catalogSnapshotVersion;
  const material = { ...parent, catalogItemId: 'layer-stone-b', name: 'سنگ دوم',
    dimensions: { motherLengthMeters: '1', motherWidthCentimeters: '20', thicknessCentimeters: '2' } };
  const catalog = { ...fixture, products: [parent, material] };
  const draft = { schemaVersion: 1, inputRevision: 12,
    stairSystems: [{ stairSystemId: 'new-stairs', quantity: { mode: 'steps', totalSteps: 1 } }], rows: [{
      productRowId: 'new-parent', catalogItemId: parent.catalogItemId, catalogSnapshotVersion: version, family: 'stair',
      configuration: { stairSystemId: 'new-stairs', part: 'tread', sourceBatchId: 'new-parent-stock', lengthMeters: '1',
        crossDimensionMeters: '0.3', quantity: 1, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
        sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
    }], dependents: [{ kind: 'layer', creationOrder: 5, layerConfigurationId: 'new-layer', parentProductRowId: 'new-parent',
      sourceBatchId: 'new-layer-stock', catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
      layersPerParentPiece: 2, widthMeters: '0.05', widthDisplayUnit: 'cm', targetSides: ['front'],
      source: { kind: 'new-material', catalogItemId: material.catalogItemId, catalogSnapshotVersion: version,
        sourceRows: [{ sourceRowId: 'new-source', lengthMeters: '1', widthMeters: '0.2', quantity: 1 }] },
      sawKerfEnabled: false, calibrationEnabled: false,
    }] };
  const context = { catalog, policy: { calculation: 'calc-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    products: [{ catalogItemId: parent.catalogItemId, catalogSnapshotVersion: version,
      stair: { baseRateToman: c('100000'), mandatoryEnabled: false, mandatoryPercentage: c('25'), rememberedMandatoryPercentage: c('25'),
        longitudinalCutRateToman: c('1000'), crossCutRateToman: c('1000'), calibrationCutRateToman: c('1000') } },
    { catalogItemId: material.catalogItemId, catalogSnapshotVersion: version, layerMaterialRateToman: c('200000') }],
    layers: [{ catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version, layerRateToman: c('100'),
      longitudinalCutRateToman: c('1000'), crossCutRateToman: c('1000'), calibrationCutRateToman: c('1000') }] };
  const result = compilePartnerTechnicalGraph(draft, context);
  if (!result.ok) throw new Error(result.error.code);
  const layer = result.value.graph.layerConfigurations[0];
  assert.equal(layer.result.materialAmountToman, '40000');
  assert.equal(layer.input.source.kind, 'new-material');
  assert.ok(result.value.graph.catalogSnapshots.some(item => item.catalogProductId === material.catalogItemId));
  assert.equal(result.value.graph.remainingStones.find(stock => stock.remainingStoneId === 'new-parent:base-remainder:1')?.widthMeters, '0.1');
  const invalid = compilePartnerTechnicalGraph({ ...draft, dependents: [{ ...draft.dependents[0],
    source: { ...draft.dependents[0].source, sourceRows: [{ ...draft.dependents[0].source.sourceRows[0], widthMeters: '0.3' }] } }] }, context);
  assert.equal(invalid.ok, false);
  assert.equal('value' in invalid, false);
});

test('invalid editing or ambiguous private evidence produces no partial graph and no private diagnostic values', () => {
  const catalog = createPartnerTechnicalCatalogFixtures(), product = catalog.products[0];
  const row = { productRowId: 'valid-row', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
    family: 'prepared', configuration: { kind: 'cubic', unit: 'ton', quantity: '2' } };
  const evidence = { catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
    preparedRates: [{ kind: 'cubic' as const, unit: 'ton' as const, rateToman: '12345' }] };
  const context = { catalog, policy: { calculation: 'calc-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' }, products: [evidence] };
  const inputs = [
    { schemaVersion: 1, inputRevision: 13, rows: [row], editingValues: [{ entityId: 'valid-row', field: 'quantity', text: '۲٫' }] },
    { schemaVersion: 1, inputRevision: 13, rows: [row, { ...row, productRowId: 'incomplete', configuration: { kind: 'cubic', unit: 'ton' } }] },
    { schemaVersion: 1, inputRevision: 13, rows: [row, row] },
    { schemaVersion: 1, inputRevision: 13, rows: [row], privatePrice: '12345' },
  ];
  for (const input of inputs) {
    const result = compilePartnerTechnicalGraph(input, context);
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
    assert.equal(JSON.stringify(result).includes('12345'), false);
  }
  for (const products of [[], [evidence, evidence], [{ ...evidence, preparedRates: [] }],
    [{ ...evidence, preparedRates: [{ ...evidence.preparedRates[0], rateToman: 'private-malformed-rate' }] }]]) {
    const result = compilePartnerTechnicalGraph({ schemaVersion: 1, inputRevision: 13, rows: [row] }, { ...context, products });
    assert.equal(result.ok, false);
    assert.equal('value' in result, false);
    assert.equal(JSON.stringify(result).includes('private-malformed-rate'), false);
  }
});

test('mixed layer supply uses paid stock before fresh parent material and retains the exact private material rate', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const product = catalog.products[0], version = product.catalogSnapshotVersion;
  const result = compilePartnerTechnicalGraph({ schemaVersion: 1, inputRevision: 11,
    stairSystems: [{ stairSystemId: 'mixed-stairs', quantity: { mode: 'steps', totalSteps: 2 } }], rows: [{
      productRowId: 'mixed-parent', catalogItemId: product.catalogItemId, catalogSnapshotVersion: version, family: 'stair',
      configuration: { stairSystemId: 'mixed-stairs', part: 'tread', sourceBatchId: 'mixed-parent-stock', lengthMeters: '1',
        crossDimensionMeters: '0.3', quantity: 2, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
        sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
    }], dependents: [{ kind: 'layer', creationOrder: 4, layerConfigurationId: 'mixed-layer', parentProductRowId: 'mixed-parent',
      sourceBatchId: 'mixed-layer-stock', catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
      layersPerParentPiece: 2, widthMeters: '0.1', widthDisplayUnit: 'cm', targetSides: ['front'],
      source: { kind: 'parent-material', catalogItemId: product.catalogItemId, catalogSnapshotVersion: version,
        selectedRemainingStoneIds: ['mixed-parent:base-remainder:1'],
        sourceRows: [{ sourceRowId: 'fresh-parent-material', lengthMeters: '1', widthMeters: '0.4', quantity: 1 }] },
      sawKerfEnabled: false, calibrationEnabled: false,
    }] }, { catalog, policy: { calculation: 'calc-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: version, layerMaterialRateToman: c('100000'),
      stair: { baseRateToman: c('100000'), mandatoryEnabled: false, mandatoryPercentage: c('25'), rememberedMandatoryPercentage: c('25'),
        longitudinalCutRateToman: c('1000'), crossCutRateToman: c('1000'), calibrationCutRateToman: c('1000') } }],
    layers: [{ catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version, layerRateToman: c('100'),
      longitudinalCutRateToman: c('1000'), crossCutRateToman: c('1000'), calibrationCutRateToman: c('1000') }] });
  if (!result.ok) throw new Error(result.error.code);
  const layer = result.value.graph.layerConfigurations[0];
  assert.equal(layer.result.materialPricingReason, 'mixed-material');
  assert.equal(layer.result.materialSourceSplit.paidSourceCount, 2);
  assert.equal(layer.result.materialSourceSplit.newSourceCount, 1);
  assert.equal(layer.result.materialSourceSplit.paidMaterialAmountToman, '0');
  assert.equal(layer.result.materialAmountToman, '40000');
  assert.equal(layer.result.layerAmountToman, '400');
  assert.equal(layer.result.physicalStripCount, 4);
  assert.equal('materialRateToman' in (result.value.preview.dependents[0].calculation as object), false);
});

test('stair layers consume paid parent material once and preserve independent side operation identities', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const product = catalog.products[0], version = product.catalogSnapshotVersion;
  const result = compilePartnerTechnicalGraph({ schemaVersion: 1, inputRevision: 10,
    stairSystems: [{ stairSystemId: 'layer-stairs', quantity: { mode: 'steps', totalSteps: 1 } }], rows: [{
      productRowId: 'layer-parent', catalogItemId: product.catalogItemId, catalogSnapshotVersion: version, family: 'stair',
      configuration: { stairSystemId: 'layer-stairs', part: 'tread', sourceBatchId: 'layer-parent-stock', lengthMeters: '1',
        crossDimensionMeters: '0.3', quantity: 1, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
        sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
    }], dependents: [{ kind: 'layer', creationOrder: 3, layerConfigurationId: 'layer-a', parentProductRowId: 'layer-parent',
      sourceBatchId: 'layer-stock', catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
      layersPerParentPiece: 1, widthMeters: '0.05', widthDisplayUnit: 'cm', targetSides: ['front', 'back'],
      source: { kind: 'paid-remainder', selectedRemainingStoneIds: ['layer-parent:base-remainder:1'] },
      sawKerfEnabled: false, calibrationEnabled: false,
      sideOperations: ['front', 'back'].map(side => ({ side, operationCollectionId: `layer-${side}`, scopeIntent: 'side',
        operations: { groups: [], tools: [], finishings: [] } })),
    }] }, { catalog, policy: { calculation: 'calc-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: version,
      stair: { baseRateToman: c('100000'), mandatoryEnabled: false, mandatoryPercentage: c('25'), rememberedMandatoryPercentage: c('25'),
        longitudinalCutRateToman: c('1000'), crossCutRateToman: c('1000'), calibrationCutRateToman: c('1000') } }],
    layers: [{ catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version, layerRateToman: c('100'),
      longitudinalCutRateToman: c('1000'), crossCutRateToman: c('1000'), calibrationCutRateToman: c('1000') }] });
  if (!result.ok) throw new Error(result.error.code);
  const layer = result.value.graph.layerConfigurations[0];
  assert.equal(layer.layerConfigurationId, 'layer-a');
  assert.equal(layer.parentProductRowId, 'layer-parent');
  assert.equal(layer.creationOrder, 3);
  assert.equal(layer.result.materialAmountToman, '0');
  assert.equal(layer.result.layerAmountToman, '200');
  assert.equal(layer.result.physicalStripCount, 2);
  assert.deepEqual(layer.result.sideOperationResults.map(side => side.result.groups[0].operationGroupId),
    ['layer-front:no-operations', 'layer-back:no-operations']);
  assert.equal(result.value.graph.remainingStones.length, 0);
});

test('remainder compilation preserves allocation order and source ownership while charging no second material amount', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const product = catalog.products[0];
  const result = compilePartnerTechnicalGraph({ schemaVersion: 1, inputRevision: 9, rows: [{
    productRowId: 'parent-a', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
    family: 'longitudinal', configuration: { sourceBatchId: 'parent-stock', lengthMeters: '1', widthMeters: '0.3', quantity: 1,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
  }], dependents: [{ kind: 'remainder', creationOrder: 7, allocationId: 'allocation-child', productRowId: 'child-a',
    selectedRemainingStoneId: 'parent-a:base-remainder:1',
    sourceProductRowId: 'parent-a', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
    lengthMeters: '0.5', widthMeters: '0.1', quantity: 2, lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
    sawKerfEnabled: false, calibrationEnabled: false }] },
  { catalog, policy: { calculation: 'calc-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
      longitudinal: { baseRateToman: c('100000'), mandatoryEnabled: false, mandatoryPercentage: c('25'),
        rememberedMandatoryPercentage: c('25'), longitudinalCutRateToman: c('10000'), calibrationCutRateToman: c('5000') },
      remainder: { mandatoryPercentage: c('25'), rememberedMandatoryPercentage: c('25'),
        longitudinalCutRateToman: c('10000'), crossCutRateToman: c('10000'), calibrationCutRateToman: c('5000') } }] });
  if (!result.ok) throw new Error(result.error.code);
  const child = result.value.graph.rows.find(row => row.productRowId === 'child-a')!;
  assert.equal(child.sourceProductRowId, 'parent-a');
  assert.equal(child.parentProductRowId, 'parent-a');
  assert.equal(child.commercial.baseAmountToman, '0');
  const allocation = result.value.graph.allocations[0];
  assert.equal(allocation.allocationId, 'allocation-child');
  assert.equal(allocation.allocationOrder, 7);
  assert.equal(allocation.targetProductRowId, 'child-a');
  assert.equal(allocation.consumedSourcePieces, 1);
  assert.equal(allocation.materialAmountToman, '0');
  assert.equal(child.commercial.requestedQuantity, '2');
  assert.equal(child.commercial.totalAmountToman, allocation.cuttingAmountToman);
});

test('stair graph keeps system quantity separate from manual sibling quantity and explicit mother length', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const product = catalog.products[0];
  const configuration = { stairSystemId: 'stairs-a', part: 'tread', sourceBatchId: 'tread-stock',
    lengthMeters: '1.2', crossDimensionMeters: '0.3', quantity: 999, quantityMode: 'system',
    lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm', sawKerfEnabled: false, calibrationEnabled: false,
    calibrationSelection: 'manual' };
  const result = compilePartnerTechnicalGraph({ schemaVersion: 1, inputRevision: 8,
    stairSystems: [{ stairSystemId: 'stairs-a', quantity: { mode: 'steps', totalSteps: 4 } }], rows: [
      { productRowId: 'tread-a', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
        family: 'stair', configuration },
      { productRowId: 'riser-b', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
        family: 'stair', configuration: { ...configuration, part: 'riser', sourceBatchId: 'riser-stock', crossDimensionMeters: '0.1',
          quantityMode: 'manual', quantity: 2, motherLengthMeters: '1.5', motherLengthDisplayUnit: 'm' } },
    ] }, { catalog, policy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
      stair: { baseRateToman: c('100000'), mandatoryEnabled: false, mandatoryPercentage: c('25'), rememberedMandatoryPercentage: c('25'),
        longitudinalCutRateToman: c('0'), crossCutRateToman: c('0'), calibrationCutRateToman: c('0') } }] });
  if (!result.ok) throw new Error(result.error.code);
  assert.equal(result.value.graph.stairSystems[0].stairSystemId, 'stairs-a');
  assert.equal(result.value.graph.stairSystems[0].totalSteps, 4);
  assert.deepEqual(result.value.graph.rows.map(row => [row.productRowId, row.commercial.requestedQuantity, row.stairPart?.motherLengthMode]),
    [['tread-a', '4', 'derived-from-finished'], ['riser-b', '2', 'explicit']]);
  assert.equal(result.value.graph.rows[0].commercial.baseAmountToman, '192000');
  assert.equal(result.value.graph.rows[1].commercial.calculationSnapshot?.motherLengthMeters, '1.5');
});

test('slab private graph preserves explicit mother rows and charges only consumed material with the selected cutting policy', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const product = catalog.products[0];
  const result = compilePartnerTechnicalGraph({ schemaVersion: 1, inputRevision: 7, rows: [{
    productRowId: 'slab-a', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
    family: 'slab', configuration: { sourceBatchId: 'slab-stock', lengthMeters: '1', widthMeters: '1', quantity: 4,
      lengthDisplayUnit: 'm', widthDisplayUnit: 'm', sawKerfEnabled: false, verticalCutSides: [],
      sourceRows: [{ sourceRowId: 'mother-a', lengthMeters: '2', widthMeters: '2', quantity: 2,
        lengthDisplayUnit: 'm', widthDisplayUnit: 'm' }] },
  }] }, { catalog, policy: { calculation: 'calc-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
      slab: { baseMaterialRateToman: c('100'), cuttingPricingMethod: 'squareMeter', squareMeterCutRateToman: c('25') } }] });
  if (!result.ok) throw new Error(result.error.code);
  const row = result.value.graph.rows[0];
  assert.equal(row.slab?.sourceRows[0].sourceRowId, 'mother-a');
  assert.equal(row.slab?.sourceRows[0].quantity, 2);
  assert.equal(row.commercial.baseAmountToman, '400');
  assert.equal(row.commercial.totalAmountToman, '500');
  assert.deepEqual(result.value.measures, [{ productRowId: row.productRowId, quantity: '4', unit: 'squareMeter' }]);
  const technical = result.value.preview.rows[0].calculation;
  if (!technical.ok || !('packingPlan' in technical.result)) throw new Error('Missing slab facts');
  assert.equal(technical.result.packingPlan.unusedSources[0].quantity, 1);
});

test('private operation pricing uses canonical child-independent scope and does not expose material or tool rates', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const product = catalog.products[0];
  const version = product.catalogSnapshotVersion;
  const result = compilePartnerTechnicalGraph({ schemaVersion: 1, inputRevision: 6, rows: [{
    productRowId: 'with-tool', catalogItemId: product.catalogItemId, catalogSnapshotVersion: version,
    family: 'longitudinal', configuration: { sourceBatchId: 'tools-stock', lengthMeters: '1', widthMeters: '0.4', quantity: 2,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
    operations: { groups: [{ operationGroupId: 'own-group', scope: '2' }],
      tools: [{ toolSelectionId: 'own-tool', operationGroupId: 'own-group', catalogItemId: 'fixture-technical-tool',
        catalogSnapshotVersion: version, edges: ['front'],
        quantityOverride: { value: '3', automaticQuantitySnapshot: '2', resolution: 'keep' } }], finishings: [] },
  }] }, { catalog, policy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: version,
      longitudinal: { baseRateToman: c('1000000'), mandatoryEnabled: false, mandatoryPercentage: c('25'),
        rememberedMandatoryPercentage: c('25'), longitudinalCutRateToman: c('20000'), calibrationCutRateToman: c('5000') } }],
    operations: [{ kind: 'TOOL', catalogItemId: 'fixture-technical-tool', catalogSnapshotVersion: version, rateToman: c('15000') }] });
  if (!result.ok) throw new Error(result.error.code);
  assert.equal(result.value.graph.rows[0].commercial.baseAmountToman, '800000');
  assert.equal(result.value.graph.rows[0].commercial.totalAmountToman, '845000');
  assert.deepEqual(result.value.measures, [{ productRowId: 'with-tool', quantity: '2', unit: 'meter' }]);
  const tool = result.value.graph.toolSelections[0];
  assert.equal(tool.toolSelectionId, 'own-tool');
  assert.equal(tool.automaticQuantity, '2');
  assert.equal(tool.finalQuantity, '3');
  assert.equal(tool.amountToman, '45000');
  const safe = result.value.preview.rows[0].operations;
  if (!safe?.ok) throw new Error('Missing safe operation');
  assert.equal(safe.result.tools[0].finalQuantity, '3');
  assert.equal('rateToman' in safe.result.tools[0], false);
});

test('longitudinal private graph uses canonical packing and costing without replacing the safe technical preview', () => {
  const fixtures = createPartnerTechnicalCatalogFixtures();
  const product = { ...fixtures.products[0], dimensions: { motherWidthCentimeters: '35' } };
  const result = compilePartnerTechnicalGraph({ schemaVersion: 1, inputRevision: 5, rows: [{
    productRowId: 'long-a', catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
    family: 'longitudinal', configuration: { sourceBatchId: 'long-stock', lengthMeters: '6.5', widthMeters: '0.12',
      requestedAreaSquareMeters: '0.78', lastManualField: 'length', lastManualDimension: 'length',
      lengthDisplayUnit: 'm', widthDisplayUnit: 'cm', sawKerfEnabled: false, calibrationEnabled: false,
      calibrationSelection: 'manual' },
  }] }, { catalog: { ...fixtures, products: [product] },
    policy: { calculation: 'longitudinal-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'half-up-toman-v1' },
    products: [{ catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
      longitudinal: { baseRateToman: c('1700000'), mandatoryEnabled: false, mandatoryPercentage: c('25'),
        rememberedMandatoryPercentage: c('25'), longitudinalCutRateToman: c('20000'), calibrationCutRateToman: c('5000') } }] });
  if (!result.ok) throw new Error(result.error.code);
  const row = result.value.graph.rows[0];
  assert.equal(row.commercial.requestedLengthMeters, '6.5');
  assert.equal(row.commercial.requestedAreaSquareMeters, '0.78');
  assert.equal(row.commercial.baseAmountToman, '1933750');
  assert.equal(row.commercial.totalAmountToman, '2063750');
  assert.deepEqual(result.value.measures, [{ productRowId: 'long-a', quantity: '6.5', unit: 'meter' }]);
  assert.equal(result.value.graph.sourceBatches[0].ownerProductRowId, 'long-a');
  assert.equal(result.value.graph.sourceBatches[0].sourceBatchId, 'long-stock');
  const technical = result.value.preview.rows[0].calculation;
  if (!technical.ok || !('packingPlan' in technical.result)) throw new Error('Missing canonical packing');
  assert.equal(technical.result.packingPlan.placements.length, 2);
  assert.equal(technical.result.packingPlan.placements[0].lengthMeters, '3.25');
  assert.equal(JSON.stringify(result.value.preview).includes('1700000'), false);
});
