import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalDraftSchema, previewPartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';

test('generated no-operation groups cannot collide with another product explicit group', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const row = (id: string) => ({ productRowId: id, catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'longitudinal', configuration: { sourceBatchId: `${id}-stock`, lengthMeters: '1', widthMeters: '0.1', quantity: 1,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } });
  const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 28, rows: [
    { ...row('auto-a'), operations: { groups: [], tools: [], finishings: [] } },
    { ...row('explicit-b'), operations: { groups: [{ operationGroupId: 'auto-a:no-operations', scope: '1' }], tools: [], finishings: [] } },
    row('unaffected'),
  ] }, catalog);
  if (!preview.ok) throw new Error(preview.error.code);
  assert.ok(preview.value.conflicts.filter(conflict => conflict.entityId === 'auto-a:no-operations').length >= 2);
  assert.deepEqual(preview.value.rows.map(row => row.calculation.ok), [false, false, true]);
  assert.deepEqual(preview.value.inventory.map(stock => stock.ownerProductRowId), ['unaffected']);
});

test('independent layer sides receive canonical scope-specific no-operation identities', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const parent = { productRowId: 'scope-parent', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'stair', configuration: { stairSystemId: 'stairs', part: 'tread', sourceBatchId: 'parent-stock',
      lengthMeters: '1', crossDimensionMeters: '0.3', quantity: 1, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  const layer = { kind: 'layer', creationOrder: 0, layerConfigurationId: 'scoped-layer', parentProductRowId: 'scope-parent',
    sourceBatchId: 'layer-stock', catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
    layersPerParentPiece: 1, widthMeters: '0.04', widthDisplayUnit: 'cm', targetSides: ['front', 'back'],
    source: { kind: 'new-material', catalogItemId: parent.catalogItemId, catalogSnapshotVersion: version,
      sourceRows: [{ sourceRowId: 'fresh', lengthMeters: '1', widthMeters: '0.1', quantity: 1 }] },
    sawKerfEnabled: false, calibrationEnabled: false, sideOperations: ['front', 'back'].map(side => ({ side,
      operationCollectionId: `collection-${side}`, scopeIntent: 'side', operations: { groups: [], tools: [], finishings: [] } })) };
  const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 29, rows: [parent], dependents: [layer] }, catalog);
  if (!preview.ok) throw new Error(preview.error.code);
  assert.deepEqual(preview.value.conflicts, []);
  const first = preview.value.dependents[0];
  if (first.kind !== 'layer' || !first.calculation.ok) throw new Error('Layer failed');
  assert.deepEqual(first.calculation.result.sideOperationResults.map(side => side.result.groups[0].operationGroupId),
    ['collection-front:no-operations', 'collection-back:no-operations']);

  const collision = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 30, rows: [parent, {
    ...parent, productRowId: 'other-parent', configuration: { ...parent.configuration, sourceBatchId: 'other-stock' },
    operations: { groups: [{ operationGroupId: 'collection-front:no-operations', scope: '1' }], tools: [], finishings: [] },
  }], dependents: [layer] }, catalog);
  if (!collision.ok) throw new Error(collision.error.code);
  assert.equal(collision.value.conflicts.filter(conflict => conflict.entityId === 'collection-front:no-operations').length, 2);
  assert.deepEqual(collision.value.rows.map(row => row.calculation.ok), [true, false]);
  assert.equal(collision.value.dependents[0].calculation.ok, false);
  assert.ok(collision.value.inventory.every(stock => stock.sourceBatchId === 'parent-stock'));
});

test('operation and collection identity collisions mark every owner across rows, remainders and layer scopes', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const operations = (suffix: string) => ({ groups: [{ operationGroupId: `group-${suffix}`, scope: '1' }],
    tools: [{ toolSelectionId: `tool-${suffix}`, operationGroupId: `group-${suffix}`, catalogItemId: 'fixture-technical-tool',
      catalogSnapshotVersion: version, edges: ['front'] }],
    finishings: [{ finishingSelectionId: `finishing-${suffix}`, operationGroupId: `group-${suffix}`,
      catalogItemId: 'fixture-technical-finishing', catalogSnapshotVersion: version }] });
  const row = (suffix: string) => ({ productRowId: `row-${suffix}`, catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'longitudinal', configuration: { sourceBatchId: `source-${suffix}`, lengthMeters: '1', widthMeters: '0.1', quantity: 1,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' }, operations: operations(suffix) });
  const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 27,
    rows: [row('a'), { ...row('b'), operations: operations('a') }, row('independent')],
    dependents: [{ kind: 'remainder', creationOrder: 0, productRowId: 'child', allocationId: 'child-cut', sourceProductRowId: 'row-a',
      catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version, lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, operations: operations('a') },
    ...['a', 'b'].map(suffix => ({ kind: 'layer', creationOrder: 1, layerConfigurationId: `layer-${suffix}`, parentProductRowId: 'row-a',
      sourceBatchId: `layer-stock-${suffix}`, catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
      widthDisplayUnit: 'cm', targetSides: ['front'], sawKerfEnabled: false, calibrationEnabled: false,
      sideOperations: [{ side: 'front', operationCollectionId: 'shared-collection', scopeIntent: 'side', operations: operations(`layer-${suffix}`) }] })),
    ],
  }, catalog);
  if (!preview.ok) throw new Error(preview.error.code);
  for (const identity of ['group-a', 'tool-a', 'finishing-a', 'shared-collection']) {
    assert.ok(preview.value.conflicts.filter(conflict => conflict.entityId === identity).length >= 2, identity);
  }
  assert.deepEqual(preview.value.rows.map(item => item.calculation.ok), [false, false, true]);
  assert.ok(preview.value.dependents.every(item => !item.calculation.ok));
});

test('parent-material replay never relabels a different-stone remainder produced by an earlier layer', () => {
  const fixtures = createPartnerTechnicalCatalogFixtures();
  const catalog = { ...fixtures, products: [...fixtures.products, { ...fixtures.products[0], catalogItemId: 'stone-b' }] };
  const version = catalog.products[0].catalogSnapshotVersion;
  const parent = { productRowId: 'parent-a', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'stair', configuration: { stairSystemId: 'stairs', part: 'tread', sourceBatchId: 'parent-stock',
      lengthMeters: '1', crossDimensionMeters: '0.3', quantity: 1, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  const first = { kind: 'layer', creationOrder: 0, layerConfigurationId: 'layer-b', parentProductRowId: 'parent-a',
    sourceBatchId: 'layer-b-stock', catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
    layersPerParentPiece: 1, widthMeters: '0.1', widthDisplayUnit: 'cm', targetSides: ['front'],
    sawKerfEnabled: false, calibrationEnabled: false,
    source: { kind: 'new-material', catalogItemId: 'stone-b', catalogSnapshotVersion: version,
      sourceRows: [{ sourceRowId: 'fresh-b', lengthMeters: '3', widthMeters: '0.1', quantity: 1 }] } };
  const second = { ...first, creationOrder: 1, layerConfigurationId: 'layer-a', sourceBatchId: 'layer-a-stock',
    source: { kind: 'parent-material', catalogItemId: parent.catalogItemId, catalogSnapshotVersion: version,
      selectedRemainingStoneIds: ['layer-b:remainder:1'], sourceRows: [] } };
  const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 26, rows: [parent], dependents: [first, second] }, catalog);
  if (!preview.ok) throw new Error(preview.error.code);
  assert.equal(preview.value.dependents[0].calculation.ok, true);
  assert.equal(preview.value.dependents[1].calculation.ok, false);
  const retained = preview.value.inventory.find(stock => stock.remainingStoneId === 'layer-b:remainder:1');
  assert.equal(retained?.catalogProductId, 'stone-b');
  assert.equal(retained?.lengthMeters, '2');
});

test('system stair quantity is canonical while a manually edited sibling remains independent after reload', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const tread = { productRowId: 'system-tread', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'stair', configuration: { stairSystemId: 'quantity-system', part: 'tread', sourceBatchId: 'tread-stock',
      lengthMeters: '1', crossDimensionMeters: '0.3', quantity: 999, quantityMode: 'system',
      lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm', sawKerfEnabled: false,
      calibrationEnabled: false, calibrationSelection: 'manual' } };
  const riser = { ...tread, productRowId: 'system-riser', configuration: { ...tread.configuration,
    part: 'riser', sourceBatchId: 'riser-stock', crossDimensionMeters: '0.17', quantity: 4, quantityMode: 'manual' } };
  const draft = { schemaVersion: 1, inputRevision: 25, rows: [tread, riser], stairSystems: [{
    stairSystemId: 'quantity-system', quantity: { mode: 'staircases', numberOfStaircases: 2, stepsPerStaircase: 3 },
  }] };
  assert.deepEqual(PartnerTechnicalDraftSchema.parse(JSON.parse(JSON.stringify(draft))), draft);
  const result = previewPartnerTechnicalDraft(draft, catalog);
  if (!result.ok) throw new Error(result.error.code);
  assert.deepEqual(result.value.conflicts, []);
  const quantities = result.value.rows.map(row => row.family === 'stair' && row.calculation.ok ? row.calculation.result.quantity : null);
  assert.deepEqual(quantities, [6, 4]);
  const incomplete = previewPartnerTechnicalDraft({ ...draft, stairSystems: [{
    stairSystemId: 'quantity-system', quantity: { mode: 'staircases', numberOfStaircases: 2 },
  }] }, catalog);
  if (!incomplete.ok) throw new Error(incomplete.error.code);
  assert.equal(incomplete.value.rows[0].calculation.ok, false);
  assert.equal(incomplete.value.rows[1].calculation.ok, true);
  assert.ok(incomplete.value.conflicts.some(conflict => conflict.code === 'stair-system-incomplete'));
});

test('unfinished numeric text survives a checkpoint round trip and blocks validation without discarding valid sibling facts', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const row = { productRowId: 'editing', catalogItemId: 'fixture-technical-stone',
    catalogSnapshotVersion: catalog.products[0].catalogSnapshotVersion, family: 'prepared',
    configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' } };
  const draft = { schemaVersion: 1, inputRevision: 24, rows: [row],
    editingValues: [{ entityId: 'editing', field: 'quantity', text: '۲٫' }] };
  assert.deepEqual(PartnerTechnicalDraftSchema.parse(JSON.parse(JSON.stringify(draft))), draft);
  const preview = previewPartnerTechnicalDraft(draft, catalog);
  if (!preview.ok) throw new Error(preview.error.code);
  assert.equal(preview.value.rows[0].calculation.ok, true, 'retain last canonical facts while typing');
  assert.ok(preview.value.conflicts.some(conflict => conflict.code === 'editing-value-pending' && conflict.entityId === 'editing'));
  const committed = previewPartnerTechnicalDraft({ ...draft, editingValues: [], rows: [{ ...row,
    configuration: { ...row.configuration, quantity: '2.5' } }] }, catalog);
  if (!committed.ok) throw new Error(committed.error.code);
  assert.deepEqual(committed.value.conflicts, []);
  assert.equal(PartnerTechnicalDraftSchema.safeParse({ ...draft,
    editingValues: [{ entityId: 'editing', field: 'baseRateToman', text: 'private' }] }).success, false);
});

test('mixed layer supply consumes paid stock first and distinguishes parent material from an explicitly different stone', () => {
  const fixtures = createPartnerTechnicalCatalogFixtures();
  const catalog = { ...fixtures, products: [...fixtures.products, { ...fixtures.products[0], catalogItemId: 'different-stone' }] };
  const version = catalog.products[0].catalogSnapshotVersion;
  const parent = { productRowId: 'mixed-parent', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'stair', configuration: { stairSystemId: 'stairs', part: 'tread', sourceBatchId: 'parent-stock',
      lengthMeters: '3', crossDimensionMeters: '0.3', quantity: 1, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  const source = { kind: 'parent-material', catalogItemId: parent.catalogItemId, catalogSnapshotVersion: version,
    selectedRemainingStoneIds: ['mixed-parent:base-remainder:1'],
    sourceRows: [{ sourceRowId: 'fresh', lengthMeters: '3', widthMeters: '0.1', quantity: 1 }] };
  const layer = { kind: 'layer', creationOrder: 0, layerConfigurationId: 'mixed-layer', parentProductRowId: 'mixed-parent',
    sourceBatchId: 'layer-stock', catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
    layersPerParentPiece: 2, widthMeters: '0.1', widthDisplayUnit: 'cm', targetSides: ['front'],
    sawKerfEnabled: false, calibrationEnabled: false, source };
  const run = (selection: unknown) => {
    const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 23,
      rows: [parent], dependents: [{ ...layer, source: selection }] }, catalog);
    if (!preview.ok) throw new Error(preview.error.code);
    const first = preview.value.dependents[0];
    if (first.kind !== 'layer') throw new Error('Layer required');
    return first.calculation;
  };
  const mixed = run(source);
  if (!mixed.ok) throw new Error('Mixed layer failed');
  assert.deepEqual(mixed.result.materialSourceSplit, { paidSourceCount: 1, paidMaterialSquareMeters: '0.3',
    newSourceCount: 1, newMaterialSquareMeters: '0.3' });
  assert.equal(run({ ...source, catalogItemId: 'different-stone' }).ok, false);
  assert.equal(run({ kind: 'new-material', catalogItemId: 'different-stone', catalogSnapshotVersion: version,
    sourceRows: [{ ...source.sourceRows[0], quantity: 2 }] }).ok, true);
});

test('stair mother length is independently explicit or derived from finished length, never seeded from catalog length', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const row = { productRowId: 'independent-tread', catalogItemId: 'fixture-technical-stone',
    catalogSnapshotVersion: catalog.products[0].catalogSnapshotVersion, family: 'stair',
    configuration: { stairSystemId: 'system', part: 'tread', sourceBatchId: 'source',
      lengthMeters: '1', crossDimensionMeters: '0.3', quantity: 1,
      lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm', motherLengthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  const run = (configuration: unknown) => {
    const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 22, rows: [{ ...row, configuration }] }, catalog);
    if (!preview.ok) throw new Error(preview.error.code);
    const first = preview.value.rows[0];
    if (first.family !== 'stair') throw new Error('Stair required');
    return first.calculation;
  };
  const derived = run(row.configuration);
  if (!derived.ok) throw new Error('Derived calculation failed');
  assert.equal(derived.result.motherLengthMeters, '1');
  assert.equal(derived.result.motherLengthMode, 'derived-from-finished');
  const explicit = run({ ...row.configuration, motherLengthMeters: '3', lengthMeters: '2' });
  if (!explicit.ok) throw new Error('Explicit calculation failed');
  assert.equal(explicit.result.motherLengthMeters, '3');
  assert.equal(explicit.result.motherLengthDisplayUnit, 'cm');
  const cleared = run({ ...row.configuration, lengthMeters: '2' });
  if (!cleared.ok) throw new Error('Cleared calculation failed');
  assert.equal(cleared.result.motherLengthMeters, '2');
  assert.equal(run({ ...row.configuration, motherLengthMeters: '0.5' }).ok, false);
});

test('duplicate row identity cannot mint double remainder inventory while independent rows still preview', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const row = { productRowId: 'duplicated', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'longitudinal', configuration: { sourceBatchId: 'first-stock', lengthMeters: '1', widthMeters: '0.1', quantity: 1,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  const result = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 21, rows: [row,
    { ...row, configuration: { ...row.configuration, sourceBatchId: 'second-stock' } },
    { productRowId: 'independent', catalogItemId: row.catalogItemId, catalogSnapshotVersion: version,
      family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '1' } },
  ] }, catalog);
  if (!result.ok) throw new Error(result.error.code);
  assert.deepEqual(result.value.inventory, [], 'ambiguous parent identities cannot own usable stock');
  assert.ok(result.value.conflicts.some(conflict => conflict.code === 'duplicate-identity' && conflict.entityId === 'duplicated'));
  assert.equal(result.value.rows[0].calculation.ok, false);
  assert.equal(result.value.rows[2].calculation.ok, true);
});

test('remainder child operations use finished child dimensions, not the consumed mother stock', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const parent = { productRowId: 'op-parent', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'longitudinal', configuration: { sourceBatchId: 'stock', lengthMeters: '2', widthMeters: '0.2', quantity: 1,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  const child = { kind: 'remainder', creationOrder: 0, allocationId: 'op-cut', productRowId: 'op-child',
    sourceProductRowId: 'op-parent', selectedRemainingStoneId: 'op-parent:base-remainder:1',
    catalogItemId: parent.catalogItemId, catalogSnapshotVersion: version,
    lengthMeters: '1', widthMeters: '0.1', quantity: 2, lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
    sawKerfEnabled: false, calibrationEnabled: false,
    operations: { groups: [{ operationGroupId: 'child-group', scope: '2' }], finishings: [], tools: [{
      toolSelectionId: 'child-tool', operationGroupId: 'child-group', catalogItemId: 'fixture-technical-tool',
      catalogSnapshotVersion: version, edges: ['front'],
    }] } };
  const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 20, rows: [parent], dependents: [child] }, catalog);
  if (!preview.ok) throw new Error(preview.error.code);
  const first = preview.value.dependents[0];
  if (first.kind !== 'remainder' || !first.calculation.ok || !first.operations?.ok) throw new Error('Child operations failed');
  assert.equal(first.calculation.result.allocations[0].consumedSourcePieces, 1);
  assert.equal(first.operations.result.tools[0].automaticQuantity, '2');
  assert.equal(first.operations.result.productRowId, 'op-child');
});

test('layer tool quantities come from canonical physical strips and retain partial geometry when an override becomes stale', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const parent = { productRowId: 'layer-parent', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'stair', configuration: { stairSystemId: 'stairs', part: 'tread', sourceBatchId: 'parent-stock',
      lengthMeters: '1', crossDimensionMeters: '0.3', quantity: 1, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  const layer = { kind: 'layer', creationOrder: 0, layerConfigurationId: 'tool-layer', parentProductRowId: 'layer-parent',
    sourceBatchId: 'layer-stock', catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
    layersPerParentPiece: 1, widthMeters: '0.04', widthDisplayUnit: 'cm', targetSides: ['front'],
    source: { kind: 'new-material', catalogItemId: parent.catalogItemId, catalogSnapshotVersion: version,
      sourceRows: [{ sourceRowId: 'new-stock', lengthMeters: '2', widthMeters: '0.04', quantity: 1 }] },
    sawKerfEnabled: false, calibrationEnabled: false,
    sideOperations: [{ side: 'front', operationCollectionId: 'front-collection', scopeIntent: 'side',
      operations: { groups: [{ operationGroupId: 'front-group', scope: '1' }], finishings: [], tools: [{
        toolSelectionId: 'front-tool', operationGroupId: 'front-group', catalogItemId: 'fixture-technical-tool',
        catalogSnapshotVersion: version, edges: ['front'], quantityOverride: { value: '1.5', automaticQuantitySnapshot: '1' },
      }] } }],
  };
  const run = (lengthMeters: string) => {
    const result = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 19,
      rows: [{ ...parent, configuration: { ...parent.configuration, lengthMeters } }], dependents: [layer] }, catalog);
    if (!result.ok) throw new Error(result.error.code);
    const first = result.value.dependents[0];
    if (first.kind !== 'layer') throw new Error('Expected layer');
    return first.calculation;
  };
  const first = run('1');
  if (!first.ok) throw new Error('Layer operations failed');
  assert.equal(first.result.sideOperationResults[0].operationCollectionId, 'front-collection');
  assert.equal(first.result.sideOperationResults[0].result.tools[0].automaticQuantity, '1');
  assert.equal(first.result.sideOperationResults[0].result.tools[0].finalQuantity, '1.5');
  const changed = run('2');
  if (changed.ok) assert.fail('Changed strip length must invalidate the old override snapshot');
  assert.equal(changed.result?.physicalStrips[0].lengthMeters, '2');
  assert.ok(changed.conflicts.some(conflict => conflict.code === 'layer-operation-invalid'));
});

test('a layer cannot consume another product parent remainder even when the catalog stone matches', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const parent = { productRowId: 'owner', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'stair', configuration: { stairSystemId: 'system-a', part: 'tread', sourceBatchId: 'owner-source',
      lengthMeters: '3', crossDimensionMeters: '0.3', quantity: 1, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  const other = { ...parent, productRowId: 'other', configuration: { ...parent.configuration,
    stairSystemId: 'system-b', sourceBatchId: 'other-source' } };
  const layer = { kind: 'layer', creationOrder: 0, layerConfigurationId: 'foreign-layer', parentProductRowId: 'other',
    sourceBatchId: 'layer-source', catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
    layersPerParentPiece: 1, widthMeters: '0.04', widthDisplayUnit: 'cm', targetSides: ['front'],
    source: { kind: 'paid-remainder', selectedRemainingStoneIds: ['owner:base-remainder:1'] },
    sawKerfEnabled: false, calibrationEnabled: false };
  const result = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 18,
    rows: [parent, other], dependents: [layer] }, catalog);
  if (!result.ok) throw new Error(result.error.code);
  const calculation = result.value.dependents[0].calculation;
  if (calculation.ok) assert.fail('Foreign parent stock must not be eligible');
  assert.ok(calculation.conflicts.some(conflict => conflict.code === 'layer-parent-mismatch'));
  assert.equal(result.value.inventory.length, 2);
  assert.ok(result.value.inventory.every(stock => stock.widthMeters === '0.1'));
});

test('stair layers use canonical strips, consume parent remainder once and retain the later conflicting child intent', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const parent = { productRowId: 'tread', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'stair', configuration: { stairSystemId: 'system', part: 'tread', sourceBatchId: 'tread-source',
      lengthMeters: '3', crossDimensionMeters: '0.3', quantity: 1, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  const layer = { kind: 'layer', creationOrder: 0, layerConfigurationId: 'layer-a', parentProductRowId: 'tread',
    sourceBatchId: 'layer-source', catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
    layersPerParentPiece: 1, widthMeters: '0.04', widthDisplayUnit: 'cm', targetSides: ['front'],
    source: { kind: 'paid-remainder', selectedRemainingStoneIds: ['tread:base-remainder:1'] },
    sawKerfEnabled: false, calibrationEnabled: false };
  // Canonical equal-order replay uses kind/identity, never UI array order.
  const child = { kind: 'remainder', creationOrder: 0, allocationId: 'late-cut', productRowId: 'late-child',
    sourceProductRowId: 'tread', selectedRemainingStoneId: 'tread:base-remainder:1',
    catalogItemId: parent.catalogItemId, catalogSnapshotVersion: version,
    lengthMeters: '3', widthMeters: '0.1', quantity: 1, lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
    sawKerfEnabled: false, calibrationEnabled: false };
  const draft = { schemaVersion: 1, inputRevision: 17, rows: [parent], dependents: [child, layer] };
  assert.deepEqual(PartnerTechnicalDraftSchema.parse(JSON.parse(JSON.stringify(draft))), draft);
  const result = previewPartnerTechnicalDraft(draft, catalog);
  if (!result.ok) throw new Error(result.error.code);
  const first = result.value.dependents[0];
  if (first.kind !== 'layer' || !first.calculation.ok) throw new Error('Layer preview failed');
  assert.equal(first.calculation.result.physicalStripCount, 1);
  assert.equal(first.calculation.result.catalogQuantity, '1');
  assert.equal(first.calculation.result.physicalStrips[0].lengthMeters, '3');
  assert.equal(first.calculation.result.materialSourceSplit.paidSourceCount, 1);
  assert.equal(result.value.dependents[1].calculation.ok, false, 'consumed stock cannot be reused');
  assert.deepEqual(result.value.inventory.map(stock => ({ owner: stock.ownerProductRowId, width: stock.widthMeters })),
    [{ owner: 'tread', width: '0.06' }]);
  assert.equal(JSON.stringify(result).includes('RateToman'), false);
});

test('remainder preview consumes only canonical parent stock and preserves child linkage without accepting a client inventory', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const parent = { productRowId: 'parent', catalogItemId: 'fixture-technical-stone',
    catalogSnapshotVersion: catalog.products[0].catalogSnapshotVersion, family: 'longitudinal',
    configuration: { sourceBatchId: 'parent-source', lengthMeters: '1', widthMeters: '0.1', quantity: 2,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
  };
  const child = { kind: 'remainder', creationOrder: 0, allocationId: 'cut-child', productRowId: 'child',
    sourceProductRowId: 'parent', selectedRemainingStoneId: 'parent:base-remainder:1',
    catalogItemId: parent.catalogItemId, catalogSnapshotVersion: parent.catalogSnapshotVersion,
    lengthMeters: '1', widthMeters: '0.1', quantity: 1, lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
    sawKerfEnabled: false, calibrationEnabled: false,
  };
  const draft = { schemaVersion: 1, inputRevision: 16, rows: [parent], dependents: [child] };
  const preview = previewPartnerTechnicalDraft(draft, catalog);
  if (!preview.ok) throw new Error(preview.error.code);
  const dependent = preview.value.dependents[0];
  if (dependent.kind !== 'remainder' || !dependent.calculation.ok) throw new Error('Child preview failed');
  const allocation = dependent.calculation.result.allocations[0];
  assert.equal(allocation.sourceProductRowId, 'parent');
  assert.equal(allocation.targetProductRowId, 'child');
  assert.equal(allocation.consumedSourcePieces, 1);
  assert.deepEqual(preview.value.inventory.map(stock => ({ id: stock.remainingStoneId,
    owner: stock.ownerProductRowId, width: stock.widthMeters, quantity: stock.quantity })),
  [{ id: 'cut-child:secondary:1', owner: 'child', width: '0.1', quantity: 1 }]);
  const missingParent = previewPartnerTechnicalDraft({ ...draft, rows: [] }, catalog);
  if (!missingParent.ok) throw new Error(missingParent.error.code);
  assert.equal(missingParent.value.dependents[0].calculation.ok, false);
  assert.deepEqual(missingParent.value.inventory, []);
  assert.equal(PartnerTechnicalDraftSchema.safeParse({ ...draft, inventory: preview.value.inventory }).success, false);
});

test('incomplete prepared editing intent survives recovery without becoming inquiry-ready; real canonical preview resolves completed quantity', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const row = { productRowId: 'prepared-row', catalogItemId: 'fixture-technical-stone',
    catalogSnapshotVersion: catalog.products[0].catalogSnapshotVersion,
    family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count' } };
  const draft = { schemaVersion: 1, inputRevision: 7, rows: [row] };
  const decoded = PartnerTechnicalDraftSchema.parse(JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(decoded, draft);
  const incomplete = previewPartnerTechnicalDraft(decoded, catalog);
  if (!incomplete.ok) throw new Error(incomplete.error.code);
  assert.equal(incomplete.value.inputRevision, 7);
  assert.equal(incomplete.value.rows[0].calculation.ok, false);
  const complete = previewPartnerTechnicalDraft({ ...draft, rows: [{ ...row,
    configuration: { ...row.configuration, quantity: '2.5' },
  }] }, catalog);
  if (!complete.ok) throw new Error(complete.error.code);
  const result = complete.value.rows[0];
  if (result.family !== 'prepared' || !result.calculation.ok) throw new Error('Prepared preview failed');
  assert.equal(result.calculation.result.quantity, '2.5');
  assert.equal(result.calculation.result.squareMeters, '0');
  assert.equal(PartnerTechnicalDraftSchema.safeParse({ ...draft, rows: [{ ...row,
    configuration: { ...row.configuration, baseRateToman: 'private' },
  }] }).success, false);
  assert.equal('configurationRef' in complete.value.rows[0], false, 'preview must not issue save authority');
});

test('operation override uses real automatic quantities and stale keep/use-calculation rules without catalog rates', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const tool = { toolSelectionId: 'tool-a', operationGroupId: 'group-a', catalogItemId: 'fixture-technical-tool',
    catalogSnapshotVersion: version, edges: ['front'], quantityOverride: { value: '3', automaticQuantitySnapshot: '2' } };
  const row = { productRowId: 'operations-row', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
    family: 'longitudinal', configuration: { sourceBatchId: 'operations-source', lengthMeters: '1', widthMeters: '0.1', quantity: 2,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
    operations: { groups: [{ operationGroupId: 'group-a', scope: '2' }], tools: [tool], finishings: [] },
  };
  const calculate = (value: unknown) => {
    const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 15, rows: [value] }, catalog);
    if (!preview.ok) throw new Error(preview.error.code);
    return preview.value.rows[0];
  };
  const initial = calculate(row);
  if (!initial.operations?.ok) throw new Error('Operations preview failed');
  assert.equal(initial.operations.result.tools[0].automaticQuantity, '2');
  assert.equal(initial.operations.result.tools[0].finalQuantity, '3');
  const changed = { ...row, configuration: { ...row.configuration, lengthMeters: '2' } };
  assert.equal(calculate(changed).operations?.ok, false);
  const kept = calculate({ ...changed, operations: { ...row.operations, tools: [{ ...tool,
    quantityOverride: { ...tool.quantityOverride, resolution: 'keep' },
  }] } });
  if (!kept.operations?.ok) throw new Error('Resolved operation failed');
  assert.equal(kept.operations.result.tools[0].automaticQuantity, '4');
  assert.equal(kept.operations.result.tools[0].finalQuantity, '3');
  assert.equal(kept.operations.result.tools[0].overrideStatus, 'kept');
  assert.equal(JSON.stringify(kept).includes('rateToman'), false);
});

test('stair preview preserves part and system identity and enforces the catalog mother geometry without private rates', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const row = { productRowId: 'tread-row', catalogItemId: 'fixture-technical-stone',
    catalogSnapshotVersion: catalog.products[0].catalogSnapshotVersion, family: 'stair',
    configuration: { stairSystemId: 'stairs-1', part: 'tread', sourceBatchId: 'tread-source',
      lengthMeters: '1', crossDimensionMeters: '0.3', quantity: 2, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
  };
  const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 11, rows: [row] }, catalog);
  if (!preview.ok) throw new Error(preview.error.code);
  const first = preview.value.rows[0];
  if (first.family !== 'stair' || !first.calculation.ok) throw new Error('Stair preview failed');
  assert.equal(first.calculation.result.stairPart.stairSystemId, 'stairs-1');
  assert.equal(first.calculation.result.stairPart.part, 'tread');
  assert.equal(first.calculation.result.requestedAreaSquareMeters, '0.6');
  assert.equal(first.calculation.result.motherLengthMeters, '1');
  assert.equal(first.calculation.result.motherWidthMeters, '0.4');
  const excessive = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 12,
    rows: [{ ...row, configuration: { ...row.configuration, crossDimensionMeters: '0.5' } }],
  }, catalog);
  if (!excessive.ok) throw new Error(excessive.error.code);
  assert.equal(excessive.value.rows[0].calculation.ok, false);
});

test('slab draft preserves source row identities, placements and vertical edge facts through canonical preview', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const row = { productRowId: 'slab-row', catalogItemId: 'fixture-technical-stone',
    catalogSnapshotVersion: catalog.products[0].catalogSnapshotVersion, family: 'slab',
    configuration: { sourceBatchId: 'slab-source', lengthMeters: '1', widthMeters: '0.5', quantity: 2,
      lengthDisplayUnit: 'm', widthDisplayUnit: 'cm', sawKerfEnabled: false,
      sourceRows: [{ sourceRowId: 'slab-stock-a', lengthMeters: '2', widthMeters: '1', quantity: 1,
        lengthDisplayUnit: 'm', widthDisplayUnit: 'cm' }], verticalCutSides: ['top', 'bottom'] },
  };
  const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 10, rows: [row] }, catalog);
  if (!preview.ok) throw new Error(preview.error.code);
  const first = preview.value.rows[0];
  if (first.family !== 'slab' || !first.calculation.ok) throw new Error('Slab preview failed');
  assert.equal(first.calculation.result.finishedAreaSquareMeters, '1');
  assert.equal(first.calculation.result.sourceRows[0].sourceRowId, 'slab-stock-a');
  assert.equal(first.calculation.result.packingPlan.placements.length, 2);
  // Vertical edges belong to the single consumed 2m × 1m mother slab,
  // not to each of the two finished tiles: top + bottom = 2 metres.
  assert.equal(first.calculation.result.verticalCutMeters, '2');
});

test('longitudinal draft uses canonical geometry and server-projected stock width while an incomplete sibling stays editable', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const row = { productRowId: 'long-row', catalogItemId: 'fixture-technical-stone',
    catalogSnapshotVersion: catalog.products[0].catalogSnapshotVersion, family: 'longitudinal',
    configuration: { sourceBatchId: 'long-source', lengthMeters: '1', widthMeters: '0.1', quantity: 2,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
  };
  const result = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 8, rows: [row,
    { ...row, productRowId: 'incomplete-row', configuration: { ...row.configuration, sourceBatchId: 'incomplete-source', lengthMeters: undefined } },
  ] }, catalog);
  if (!result.ok) throw new Error(result.error.code);
  const first = result.value.rows[0];
  if (first.family !== 'longitudinal' || !first.calculation.ok) throw new Error('Longitudinal preview failed');
  assert.equal(first.calculation.result.requestedAreaSquareMeters, '0.2');
  assert.equal(first.calculation.result.sourcePiecesConsumed, 1);
  assert.equal(first.calculation.result.packingPlan.remainders[0].widthMeters, '0.2');
  assert.equal(result.value.rows[1].calculation.ok, false);
  const missingWidth = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 9, rows: [row] },
    { ...catalog, products: [{ ...catalog.products[0], dimensions: {} }] });
  if (!missingWidth.ok) throw new Error(missingWidth.error.code);
  assert.equal(missingWidth.value.rows[0].calculation.ok, false);
  assert.equal(JSON.stringify(result).includes('AmountToman'), false);
});
