import test from 'node:test';
import assert from 'node:assert/strict';
import { previewPartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { buildPartnerProductionTechnicalDraft } from '../../contract-creation/partner/partnerProductionTechnicalDraft';
import { configurePartnerRemainder } from '../../contract-creation/partner/PartnerRemainderConfigurationFlow';

const fixture = () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const product = catalog.products.find(item => item.families.includes('longitudinal'))!;
  const draft = buildPartnerProductionTechnicalDraft({ family: 'longitudinal', product, quantity: '2',
    lengthMeters: '1', widthMeters: '0.1', sourceLengthMeters: '2', sourceWidthMeters: '1',
    products: catalog.products, operationsCatalog: catalog.operations, includeRemainder: false,
  }, kind => `remainder-${kind}`);
  const result = previewPartnerTechnicalDraft(draft, catalog);
  assert.ok(result.ok);
  const stock = result.value.inventory[0];
  assert.ok(stock);
  return { catalog, product, draft, stock, inventory: result.value.inventory,
    selection: { parentProductRowId: stock.ownerProductRowId,
      remainingStoneId: String(stock.remainingStoneId), quantity: stock.quantity } };
};

test('completed remainder configuration is atomic and canonical consumption restores on deletion', () => {
  const { catalog, product, draft, stock, selection, inventory } = fixture();
  const before = JSON.stringify(draft);
  const next = configurePartnerRemainder(draft, product, selection, [{ id: 'child-one', length: Number(stock.lengthMeters),
    width: Number(stock.widthMeters) * 100, quantity: 1, squareMeters: 0 }], false, {}, catalog);
  assert.equal(JSON.stringify(draft), before, 'Cancel leaves the original draft intact');
  const result = previewPartnerTechnicalDraft(next, catalog);
  assert.ok(result.ok);
  const child = result.value.dependents.find(item => item.kind === 'remainder');
  assert.ok(child?.calculation.ok, JSON.stringify(child));
  const restored = previewPartnerTechnicalDraft({ ...next, dependents: [] }, catalog);
  assert.ok(restored.ok);
  assert.deepEqual(restored.value.inventory, inventory);
});

test('remainder editing preserves identity and rejects dimensions that exceed its source', () => {
  const { catalog, product, draft, stock, selection } = fixture();
  const rows = [{ id: 'child-one', length: Number(stock.lengthMeters), width: Number(stock.widthMeters) * 100, quantity: 1, squareMeters: 0 }];
  const next = configurePartnerRemainder(draft, product, selection, rows, false, {}, catalog);
  const child = next.dependents?.find(item => item.kind === 'remainder');
  assert.ok(child?.kind === 'remainder');
  const edited = configurePartnerRemainder(next, product, selection, [{ ...rows[0], width: rows[0].width * 2 }], false, {}, catalog, child);
  assert.equal(edited.dependents?.length, 1);
  assert.equal(edited.dependents?.[0].kind === 'remainder' && edited.dependents[0].allocationId, child.allocationId);
  const result = previewPartnerTechnicalDraft(edited, catalog);
  assert.ok(result.ok);
  assert.equal(result.value.dependents[0].calculation.ok, false);
});

test('multiple cut rows can share one selected source piece through its secondary remainders', () => {
  const { catalog, product, draft, stock, selection } = fixture();
  const rows = ['first-cut', 'second-cut'].map(id => ({ id, length: Number(stock.lengthMeters),
    width: Number(stock.widthMeters) * 100 / 2, quantity: 1, squareMeters: 0 }));
  const next = configurePartnerRemainder(draft, product, { ...selection, quantity: 1 }, rows, false, {}, catalog);
  const result = previewPartnerTechnicalDraft(next, catalog);
  assert.ok(result.ok);
  assert.ok(result.value.dependents.every(item => item.calculation.ok), JSON.stringify(result.value.dependents));
});
