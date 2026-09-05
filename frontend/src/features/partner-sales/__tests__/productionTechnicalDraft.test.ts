import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { previewPartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';
import { buildPartnerProductionTechnicalDraft } from '../../contract-creation/partner/partnerProductionTechnicalDraft';

test('production composition submits every Partner family and retains operation/remainder intent without rates', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  for (const family of ['prepared', 'volumetric', 'longitudinal', 'slab', 'stair'] as const) {
    let sequence = 0;
    const product = catalog.products.find(item => item.families.includes(family))!;
    const draft = buildPartnerProductionTechnicalDraft({ family, product, quantity: '2', lengthMeters: '1',
      widthMeters: family === 'longitudinal' ? '0.1' : '0.2', sourceLengthMeters: '2', sourceWidthMeters: '1',
      tool: catalog.operations.find(item => item.kind === 'TOOL') as never,
      finishing: catalog.operations.find(item => item.kind === 'FINISHING') as never,
      products: catalog.products, operationsCatalog: catalog.operations,
      includeRemainder: !['prepared', 'volumetric'].includes(family),
    }, kind => `production-${family}-${kind}-${++sequence}`);
    assert.equal(draft.rows[0].family, family);
    assert.doesNotMatch(JSON.stringify(draft), /rate|price/i);
    if (family === 'longitudinal') {
      assert.equal('motherLengthMeters' in draft.rows[0].configuration, false,
        'longitudinal input must not imply a persisted mother-stone length');
    }
    if (!['prepared', 'volumetric'].includes(family)) {
      assert.equal('operations' in draft.rows[0] && draft.rows[0].operations?.tools.length, 1);
      const dependent = draft.dependents?.[0];
      assert.equal(dependent?.kind, 'remainder');
      const parentOnly = previewPartnerTechnicalDraft({ ...draft, dependents: [] }, catalog);
      assert.equal(parentOnly.ok, true);
      if (!parentOnly.ok || dependent?.kind !== 'remainder') throw new Error('expected canonical remainder');
      const stock = parentOnly.value.inventory.find(item => item.ownerProductRowId === draft.rows[0].productRowId);
      assert.ok(stock);
      assert.deepEqual({ selectedRemainingStoneId: dependent.selectedRemainingStoneId,
        sourceProductRowId: dependent.sourceProductRowId, catalogItemId: dependent.catalogItemId,
        lengthMeters: dependent.lengthMeters, widthMeters: dependent.widthMeters, quantity: dependent.quantity }, {
        selectedRemainingStoneId: stock.remainingStoneId, sourceProductRowId: stock.ownerProductRowId,
        catalogItemId: stock.catalogProductId, lengthMeters: stock.lengthMeters,
        widthMeters: stock.widthMeters, quantity: stock.quantity });
    }
    assert.equal(previewPartnerTechnicalDraft(draft, catalog).ok, true);
  }
});
