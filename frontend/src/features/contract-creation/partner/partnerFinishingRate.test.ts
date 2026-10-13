import assert from 'node:assert/strict';
import test from 'node:test';
import type { PartnerTechnicalServiceCatalogItem } from '@sabalanerp/partner-sales-contracts';
import { partnerFinishingRate, partnerProductHasMissingFinishingRate } from './partnerFinishingRate';
import { addPartnerTechnicalProduct } from './partnerTechnicalDraftAdapter';

const selection = { catalogItemId: 'finish', catalogSnapshotVersion: '2026-10-03T00:00:00.000Z', unit: 'meter' as const };
const catalog: PartnerTechnicalServiceCatalogItem[] = [{ ...selection, sourceType: 'finishing', name: 'پرداخت',
  suggestedRetailUnitPrice: { amount: '100000', currency: 'IRT' } }];

test('meter finishing follows ordinary product and main stair rate boundaries', () => {
  assert.equal(partnerFinishingRate(selection, catalog, false), undefined);
  assert.equal(partnerFinishingRate(selection, catalog, true), '100000');
  assert.equal(partnerFinishingRate({ ...selection, catalogSnapshotVersion: 'other' }, catalog, true), undefined);
  const square = { ...selection, unit: 'squareMeter' as const };
  assert.equal(partnerFinishingRate(square, [{ ...catalog[0], unit: 'squareMeter' }], false), '100000');
});

test('selecting a meter finishing blocks ordinary-shaped Partner product save without mutating its technical draft', () => {
  const draft = addPartnerTechnicalProduct({ schemaVersion: 1, inputRevision: 0, rows: [] }, {
    catalogItemId: 'stone', catalogSnapshotVersion: selection.catalogSnapshotVersion, code: '123', name: 'سنگ',
    families: ['longitudinal'], salesUnits: { prepared: 'count', volumetric: 'ton' }, dimensions: { motherWidthCentimeters: '40' },
    attributes: { stoneType: '', mine: '', finish: '', color: '', quality: '', cuttingDimension: '' }, isAvailable: true,
  }, { family: 'longitudinal', productRowId: 'product-row:stone', sourceBatchId: 'source-batch:stone' });
  const row = draft.rows[0];
  if (row.family !== 'longitudinal') throw new Error('Expected longitudinal');
  row.operations = { groups: [{ operationGroupId: 'operation-group:test', scope: '1' }], tools: [],
    finishings: [{ ...selection, finishingSelectionId: 'finishing-selection:test', operationGroupId: 'operation-group:test' }] };
  const original = JSON.stringify(draft);
  assert.equal(partnerProductHasMissingFinishingRate(draft, row.productRowId, catalog), true);
  assert.equal(JSON.stringify(draft), original);
  row.operations.finishings = [];
  assert.equal(partnerProductHasMissingFinishingRate(draft, row.productRowId, catalog), false);
});
