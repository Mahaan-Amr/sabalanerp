import assert from 'node:assert/strict';
import test from 'node:test';
import type { PartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import {
  addPartnerTechnicalDependent,
  addPartnerTechnicalProduct,
  commitPartnerTechnicalField,
  removePartnerTechnicalProduct,
  retainPartnerTechnicalFieldText,
} from '../../contract-creation/partner/partnerTechnicalDraftAdapter';

const catalog = createPartnerTechnicalCatalogFixtures();
const empty: PartnerTechnicalDraft = { schemaVersion: 1, inputRevision: 0, rows: [] };

test('all Partner product families enter one revisioned canonical draft', () => {
  let draft = empty;
  const families = ['prepared', 'volumetric', 'longitudinal', 'slab', 'stair'] as const;
  for (let index = 0; index < families.length; index += 1) {
    const family = families[index];
    const product = catalog.products.find(item => item.families.includes(family))!;
    draft = addPartnerTechnicalProduct(draft, product, family, {
      productRowId: `product-row-${index}`,
      sourceBatchId: `source-batch-${index}`,
      stairSystemId: `stair-system-${index}`,
    });
  }
  assert.deepEqual(draft.rows.map(row => row.family), families);
  assert.equal(draft.inputRevision, families.length);
  assert.deepEqual(draft.rows.map(row => row.productRowId), families.map((_, index) => `product-row-${index}`));
  assert.equal(draft.rows.some(row => 'baseRateToman' in row.configuration), false);
});

test('remainder and layer adapters bind stable parent identity and cascade only with that parent', () => {
  const product = catalog.products.find(item => item.families.includes('stair'))!;
  let draft = addPartnerTechnicalProduct(empty, product, 'stair', {
    productRowId: 'parent-row', sourceBatchId: 'parent-source', stairSystemId: 'stairs-1',
  });
  draft = addPartnerTechnicalDependent(draft, {
    kind: 'remainder', parentProductRowId: 'parent-row', product,
    allocationId: 'allocation-1', productRowId: 'child-row', sourceBatchId: 'child-source', creationOrder: 0,
  });
  draft = addPartnerTechnicalDependent(draft, {
    kind: 'layer', parentProductRowId: 'parent-row', layer: catalog.operations.find(item => item.kind === 'LAYER')!,
    layerConfigurationId: 'layer-1', sourceBatchId: 'layer-source', creationOrder: 1,
  });
  assert.deepEqual(draft.dependents?.map(item => [item.kind,
    item.kind === 'layer' ? item.parentProductRowId : item.sourceProductRowId]), [
    ['remainder', 'parent-row'], ['layer', 'parent-row'],
  ]);
  const removed = removePartnerTechnicalProduct(draft, 'parent-row');
  assert.equal(removed.rows.length, 0);
  assert.equal(removed.dependents?.length, 0);
});

test('invalid field text blocks save until the same entity field commits canonically', () => {
  const product = catalog.products.find(item => item.families.includes('longitudinal'))!;
  let draft = addPartnerTechnicalProduct(empty, product, 'longitudinal', {
    productRowId: 'row-1', sourceBatchId: 'source-1', stairSystemId: 'unused',
  });
  draft = retainPartnerTechnicalFieldText(draft, 'row-1', 'lengthMeters', '۱٫۲x');
  assert.deepEqual(draft.editingValues, [{ entityId: 'row-1', field: 'lengthMeters', text: '۱٫۲x' }]);
  const committed = commitPartnerTechnicalField(draft, 'row-1', 'lengthMeters', '1.2');
  assert.equal(committed.editingValues?.length ?? 0, 0);
  const row = committed.rows[0];
  assert.equal(row.family === 'longitudinal' ? row.configuration.lengthMeters : null, '1.2');
  assert.equal(committed.inputRevision, draft.inputRevision + 1);
});
