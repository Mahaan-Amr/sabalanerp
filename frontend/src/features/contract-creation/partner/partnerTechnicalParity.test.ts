import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerTechnicalDraftSchema, previewPartnerTechnicalDraft, type PartnerTechnicalProduct } from '@sabalanerp/partner-sales-contracts';
import { addPartnerTechnicalProduct, removePartnerTechnicalProduct, duplicatePartnerTechnicalProduct, updatePartnerTechnicalPresentation } from './partnerTechnicalDraftAdapter';
import { partnerProductCartSummary } from './partnerProductCartSummary';

const product: PartnerTechnicalProduct = {
  catalogItemId: 'stone', catalogSnapshotVersion: '2026-10-03T00:00:00.000Z', code: '123', name: 'سنگ',
  families: ['prepared', 'longitudinal', 'stair', 'slab'], salesUnits: { prepared: 'count', volumetric: 'ton' },
  dimensions: { motherWidthCentimeters: '40', motherLengthMeters: '3', thicknessCentimeters: '2' },
  attributes: { stoneType: 'تراورتن', mine: 'یزد', finish: 'صیقل', color: 'روشن', quality: 'درجه یک', cuttingDimension: 'طولی' }, isAvailable: true,
};
const catalog = { products: [product], operations: [], sawKerfMeters: '0.003' };
const identity = { catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
  retailUnitPrice: { amount: '100', currency: 'IRT' } };

test('prepared defaults match ordinary count and quantity one, and metadata survives recovery serialization', () => {
  const draft = addPartnerTechnicalProduct({ schemaVersion: 1, inputRevision: 0, rows: [] }, product,
    { family: 'prepared', productRowId: 'product-row:prepared' });
  assert.deepEqual(draft.rows[0].configuration, { kind: 'cubic', unit: 'count', quantity: '1' });
  const changed = updatePartnerTechnicalPresentation(draft, 'product-row:prepared',
    { contractualTitle: 'عنوان قراردادی', description: 'توضیح مشتری' });
  const recovered = PartnerTechnicalDraftSchema.parse(JSON.parse(JSON.stringify(changed)));
  assert.equal(recovered.rows[0].contractualTitle, 'عنوان قراردادی');
  assert.equal(recovered.rows[0].description, 'توضیح مشتری');
  assert.equal(recovered.rows[0].productRowId, draft.rows[0].productRowId);
  assert.deepEqual(recovered.rows[0].configuration, draft.rows[0].configuration);
  const cleared = updatePartnerTechnicalPresentation(changed, 'product-row:prepared', { contractualTitle: '' });
  assert.equal(PartnerTechnicalDraftSchema.parse(cleared).rows[0].contractualTitle, '');
  assert.equal(updatePartnerTechnicalPresentation(cleared, 'product-row:prepared',
    { contractualTitle: 'عنوان جدید' }).rows[0].contractualTitle, 'عنوان جدید');
});

test('cart material subtotal uses ordinary area bases when source consumption exceeds finished geometry', () => {
  const draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1, rows: [
    { ...identity, family: 'longitudinal', productRowId: 'product-row:long', configuration: {
      sourceBatchId: 'source-batch:long', lengthMeters: '1', widthMeters: '0.2', quantity: 1,
      lastManualField: 'quantity', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } },
    { ...identity, family: 'stair', productRowId: 'product-row:stair', configuration: {
      stairSystemId: 'stair-system:test', part: 'tread', sourceBatchId: 'source-batch:stair', quantityMode: 'manual',
      lengthMeters: '1', crossDimensionMeters: '0.2', motherLengthMeters: '2', quantity: 2,
      lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm', sawKerfEnabled: false,
      calibrationEnabled: false, calibrationSelection: 'manual' } },
    { ...identity, family: 'slab', productRowId: 'product-row:slab', configuration: {
      sourceBatchId: 'source-batch:slab', lengthMeters: '1', widthMeters: '1', quantity: 1,
      lengthDisplayUnit: 'm', widthDisplayUnit: 'm', sawKerfEnabled: false, verticalCutSides: [],
      sourceRows: [{ sourceRowId: 'slab-source-row:test', lengthMeters: '3', widthMeters: '2', quantity: 1,
        lengthDisplayUnit: 'm', widthDisplayUnit: 'm' }] } },
    { ...identity, family: 'prepared', productRowId: 'product-row:prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '3' } },
  ] });
  const preview = previewPartnerTechnicalDraft(draft, catalog);
  assert.ok(preview.ok);
  for (const row of preview.value.rows) assert.ok(row.calculation.ok, JSON.stringify(row.calculation));
  const longitudinal = preview.value.rows.find(row => row.family === 'longitudinal')!;
  assert.ok(longitudinal.calculation.ok && 'result' in longitudinal.calculation && 'consumedMaterialAreaSquareMeters' in longitudinal.calculation.result);
  assert.equal(longitudinal.calculation.result.requestedAreaSquareMeters, '0.2');
  assert.equal(longitudinal.calculation.result.consumedMaterialAreaSquareMeters, '0.4');
  const stair = preview.value.rows.find(row => row.family === 'stair')!;
  assert.ok(stair.calculation.ok && 'result' in stair.calculation && 'consumedMotherAreaSquareMeters' in stair.calculation.result);
  assert.equal(stair.calculation.result.consumedMotherAreaSquareMeters, '0.8');
  assert.equal(partnerProductCartSummary(draft, preview)?.materialTotal, '1020');
  assert.equal(partnerProductCartSummary(draft, preview)?.area, '1.6');
  assert.equal(partnerProductCartSummary({ ...draft, inputRevision: 2 }, preview), null);
});


test('new products start without a customer rate and preserve rates already entered by the Partner', () => {
  const priced = { ...product, suggestedRetailUnitPrice: { amount: '750', currency: 'IRT' as const } };
  const draft = addPartnerTechnicalProduct({ schemaVersion: 1, inputRevision: 0, rows: [] }, priced,
    { family: 'prepared', productRowId: 'product-row:suggested' });
  assert.equal(draft.rows[0].retailUnitPrice, undefined);
  const manual = PartnerTechnicalDraftSchema.parse({ ...draft, rows: [{ ...draft.rows[0], retailUnitPrice: { amount: '900', currency: 'IRT' } }] });
  const next = addPartnerTechnicalProduct(manual, priced, { family: 'prepared', productRowId: 'product-row:new' });
  assert.equal(next.rows[0].retailUnitPrice?.amount, '900');
  assert.equal(next.rows[1].retailUnitPrice, undefined);
  for (const family of ['longitudinal', 'stair', 'slab'] as const) {
    const added = addPartnerTechnicalProduct(manual, priced, { family,
      productRowId: `product-row:${family}`, sourceBatchId: `source-batch:${family}`,
      stairSystemId: 'stair-system:new' });
    assert.equal(added.rows[1].retailUnitPrice, undefined);
    assert.equal(added.rows[0].retailUnitPrice?.amount, '900');
  }
});

test('duplicate stair and its paid-remainder layer regenerate identities and preserve the original graph', () => {
  const layerCatalog = { catalogItemId: 'layer', catalogSnapshotVersion: product.catalogSnapshotVersion,
    kind: 'LAYER' as const, name: 'لایه', unit: 'physicalPiece' as const };
  const graphCatalog = { ...catalog, operations: [layerCatalog] };
  let draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1, rows: [{ ...identity,
    family: 'stair', productRowId: 'product-row:stair', configuration: {
      stairSystemId: 'stair-system:test', part: 'tread', sourceBatchId: 'source-batch:stair', quantityMode: 'manual',
      lengthMeters: '1', crossDimensionMeters: '0.2', motherLengthMeters: '2', quantity: 1,
      lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm', sawKerfEnabled: false,
      calibrationEnabled: false, calibrationSelection: 'manual' } }],
    stairSystems: [{ stairSystemId: 'stair-system:test', quantity: { mode: 'steps', totalSteps: 1 } }],
  });
  const base = previewPartnerTechnicalDraft(draft, graphCatalog);
  assert.ok(base.ok);
  const stock = base.value.inventory.find(item => Number(item.lengthMeters) >= 1 && Number(item.widthMeters) >= 0.05)!;
  assert.ok(stock);
  draft = PartnerTechnicalDraftSchema.parse({ ...draft, dependents: [{ kind: 'layer', creationOrder: 1,
    layerConfigurationId: 'layer-configuration:test', parentProductRowId: 'product-row:stair', sourceBatchId: 'source-batch:layer',
    catalogItemId: 'layer', catalogSnapshotVersion: product.catalogSnapshotVersion, layersPerParentPiece: 1,
    widthMeters: '0.05', widthDisplayUnit: 'cm', targetSides: ['front'],
    source: { kind: 'paid-remainder', selectedRemainingStoneIds: [stock.remainingStoneId] },
    sawKerfEnabled: false, calibrationEnabled: false,
  }] });
  const snapshot = JSON.stringify(draft);
  let serial = 0;
  const duplicated = duplicatePartnerTechnicalProduct(draft, 'product-row:stair', graphCatalog, kind => `${kind}:clone-${++serial}`);
  assert.equal(JSON.stringify(draft), snapshot);
  assert.deepEqual(duplicated.rows[0], draft.rows[0]);
  assert.deepEqual(duplicated.dependents?.[0], draft.dependents?.[0]);
  assert.notEqual(duplicated.rows[1].productRowId, draft.rows[0].productRowId);
  assert.equal(duplicated.rows[1].retailUnitPrice?.amount, '100');
  const layer = duplicated.dependents?.[1];
  assert.ok(layer?.kind === 'layer' && layer.source?.kind === 'paid-remainder');
  assert.equal(layer.parentProductRowId, duplicated.rows[1].productRowId);
  assert.notEqual(layer.source.selectedRemainingStoneIds[0], stock.remainingStoneId);
  const preview = previewPartnerTechnicalDraft(duplicated, graphCatalog);
  assert.ok(preview.ok);
  assert.ok(preview.value.dependents.every(item => item.calculation.ok));
  assert.equal(duplicated.stairSystems?.length, 2);
});

test('duplication rejects incomplete geometry without changing the source', () => {
  const draft = addPartnerTechnicalProduct({ schemaVersion: 1, inputRevision: 0, rows: [] }, product,
    { family: 'longitudinal', productRowId: 'product-row:incomplete', sourceBatchId: 'source-batch:incomplete' });
  const snapshot = JSON.stringify(draft);
  assert.throws(() => duplicatePartnerTechnicalProduct(draft, 'product-row:incomplete', catalog));
  assert.equal(JSON.stringify(draft), snapshot);
});


test('source duplication keeps existing remainder children on their original owner and regenerates operation identities', () => {
  const tool = { catalogItemId: 'tool', catalogSnapshotVersion: product.catalogSnapshotVersion,
    kind: 'TOOL' as const, name: 'ابزار', unit: 'meter' as const };
  const graphCatalog = { ...catalog, operations: [tool] };
  let draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1, rows: [{ ...identity,
    family: 'longitudinal', productRowId: 'product-row:source', configuration: {
      sourceBatchId: 'source-batch:source', lengthMeters: '1', widthMeters: '0.2', quantity: 1,
      lastManualField: 'quantity', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' },
    operations: { groups: [{ operationGroupId: 'operation-group:source', scope: '1' }],
      tools: [{ toolSelectionId: 'tool-selection:source', operationGroupId: 'operation-group:source',
        catalogItemId: 'tool', catalogSnapshotVersion: product.catalogSnapshotVersion, edges: ['front'] }], finishings: [] },
  }] });
  const base = previewPartnerTechnicalDraft(draft, graphCatalog);
  assert.ok(base.ok);
  const stock = base.value.inventory[0];
  assert.ok(stock);
  draft = PartnerTechnicalDraftSchema.parse({ ...draft, dependents: [{ kind: 'remainder', creationOrder: 1,
    allocationId: 'allocation:child', productRowId: 'product-row:child', sourceProductRowId: 'product-row:source',
    selectedRemainingStoneId: stock.remainingStoneId, catalogItemId: 'stone', catalogSnapshotVersion: product.catalogSnapshotVersion,
    lengthMeters: '0.5', widthMeters: '0.1', quantity: 1, lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
    sawKerfEnabled: false, calibrationEnabled: false,
  }] });
  let serial = 0;
  const next = duplicatePartnerTechnicalProduct(draft, 'product-row:source', graphCatalog, kind => `${kind}:clone-${++serial}`);
  assert.deepEqual(next.dependents, draft.dependents);
  const duplicate = next.rows[1];
  assert.ok(duplicate.family === 'longitudinal' && duplicate.operations);
  assert.notEqual(duplicate.operations.groups[0].operationGroupId, 'operation-group:source');
  assert.equal(duplicate.operations.tools[0].operationGroupId, duplicate.operations.groups[0].operationGroupId);
  assert.notEqual(duplicate.operations.tools[0].toolSelectionId, 'tool-selection:source');
  assert.equal(duplicate.operations.tools[0].catalogItemId, 'tool');
});


test('prepared subtype defaults use ordinary catalog naming inference including cubic and ready pieces', () => {
  for (const [name, kind] of [['سنگ کیوبیک', 'cubic'], ['قطعات آماده', 'readyPiece']] as const) {
    const draft = addPartnerTechnicalProduct({ schemaVersion: 1, inputRevision: 0, rows: [] }, { ...product, name },
      { family: 'prepared', productRowId: 'product-row:kind' });
    assert.equal(draft.rows[0].configuration.kind, kind);
  }
});


test('removing the last stair product removes its unused group and preserves shared active groups', () => {
  const first = addPartnerTechnicalProduct({ schemaVersion: 1, inputRevision: 0, rows: [] }, product,
    { family: 'stair', productRowId: 'stair-first', sourceBatchId: 'batch-first', stairSystemId: 'system-first' });
  const second = addPartnerTechnicalProduct(first, product,
    { family: 'stair', productRowId: 'stair-second', sourceBatchId: 'batch-second', stairSystemId: 'system-second' });
  const shared = { ...second, rows: [...second.rows, { ...second.rows[0], productRowId: 'stair-shared' }] };
  const removed = removePartnerTechnicalProduct(shared, 'stair-first');
  assert.deepEqual(removed.stairSystems?.map(group => group.stairSystemId), ['system-first', 'system-second']);
  const last = removePartnerTechnicalProduct(removed, 'stair-shared');
  assert.deepEqual(last.stairSystems?.map(group => group.stairSystemId), ['system-second']);
  assert.deepEqual(last.rows.map(row => row.productRowId), ['stair-second']);
});
