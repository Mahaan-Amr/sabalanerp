import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PartnerTechnicalProductSchema, PartnerTechnicalOperationSchema, PartnerTechnicalCatalogPageSchema } from '@sabalanerp/partner-sales-contracts';
import { FixturePartnerTechnicalCatalogAdapter } from '@sabalanerp/partner-sales-contracts/testing';

test('technical catalog preserves family eligibility and exact physical dimensions without accepting private prices', () => {
  const product = {
    catalogItemId: 'stone-1', catalogSnapshotVersion: '2026-08-27T10:00:00.000Z',
    code: 'STONE-1', name: 'سنگ سفید', families: ['longitudinal', 'stair', 'slab', 'prepared', 'volumetric'],
    dimensions: { motherWidthCentimeters: '40.25', thicknessCentimeters: '2' },
    attributes: { stoneType: 'تراورتن', mine: 'عباس‌آباد', finish: 'صیقلی', color: 'سفید', quality: 'ممتاز', cuttingDimension: 'طولی' },
    isAvailable: true,
  };
  const decoded = PartnerTechnicalProductSchema.parse(JSON.parse(JSON.stringify(product)));
  assert.equal(decoded.dimensions.motherWidthCentimeters, '40.25');
  assert.equal(decoded.dimensions.motherLengthMeters, undefined);
  assert.equal(PartnerTechnicalProductSchema.parse({ ...product,
    dimensions: { ...product.dimensions, motherLengthMeters: '3' },
  }).dimensions.motherLengthMeters, '3');
  assert.deepEqual(decoded.families, product.families);
  for (const extra of [{ basePrice: 'secret-rate' }, { pricingHash: 'secret-hash' }]) {
    assert.equal(PartnerTechnicalProductSchema.safeParse({ ...product, ...extra }).success, false);
  }
  assert.equal(PartnerTechnicalProductSchema.safeParse({ ...product,
    dimensions: { ...product.dimensions, materialRate: 'secret-rate' },
  }).success, false);
});

test('public catalog reader round-trips technical fixtures with family filtering and rejects authority fields', async () => {
  const catalog = new FixturePartnerTechnicalCatalogAdapter();
  const query = { schemaVersion: 1 as const, purpose: 'PARTNER_TECHNICAL_CATALOG' as const, kind: 'PRODUCT' as const, family: 'slab' as const };
  const result = await catalog.read(query);
  if (!result.ok) throw new Error(result.error.code);
  const decoded = PartnerTechnicalCatalogPageSchema.parse(JSON.parse(JSON.stringify(result.value)));
  assert.equal(decoded.kind, 'PRODUCT');
  if (decoded.kind !== 'PRODUCT') throw new Error('Unexpected catalog');
  assert.equal(decoded.items.length, 1);
  assert.equal(decoded.items[0].catalogItemId, 'fixture-technical-stone');
  const next = await catalog.read({ ...query, cursor: decoded.items[0].catalogItemId });
  if (!next.ok) throw new Error(next.error.code);
  assert.equal(next.value.items.length, 0);
  assert.equal((await catalog.read({ ...query, actorId: 'admin' } as typeof query)).ok, false);
  for (const kind of ['TOOL', 'FINISHING', 'LAYER'] as const) {
    const operations = await catalog.read({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind });
    if (!operations.ok) throw new Error(operations.error.code);
    assert.equal(PartnerTechnicalCatalogPageSchema.safeParse(operations.value).success, true);
    assert.equal(operations.value.items.length, 1);
    assert.equal(JSON.stringify(operations.value).includes('rateToman'), false);
  }
});

test('technical operation catalog retains units and incompatibilities without rates or permissive extra fields', () => {
  const identity = { catalogItemId: 'operation-1', catalogSnapshotVersion: '2026-08-27T10:00:00.000Z', name: 'ابزار' };
  for (const item of [
    { ...identity, kind: 'TOOL', unit: 'meter' },
    { ...identity, kind: 'FINISHING', unit: 'squareMeter', incompatibleCatalogItemIds: ['other-finishing'] },
    { ...identity, kind: 'LAYER', unit: 'physicalPiece' },
  ]) {
    assert.deepEqual(PartnerTechnicalOperationSchema.parse(item), item);
    assert.equal(PartnerTechnicalOperationSchema.safeParse({ ...item, rateToman: 'private-rate' }).success, false);
  }
  assert.equal(PartnerTechnicalOperationSchema.safeParse({ ...identity, kind: 'TOOL', unit: 'physicalPiece' }).success, false);
  assert.equal(PartnerTechnicalOperationSchema.safeParse({ ...identity, kind: 'FINISHING', unit: 'squareMeter' }).success, false);
});
