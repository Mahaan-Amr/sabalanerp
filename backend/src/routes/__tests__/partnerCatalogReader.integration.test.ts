import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { createPartnerTechnicalCatalogReader } from '../../services/partnerSales/crm/technicalCatalogReader';

async function fixture(run: (tx: Prisma.TransactionClient, actorId: string, prefix: string) => Promise<void>) {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const rollback = new Error('rollback technical catalog fixtures');
  try {
    await db.$transaction(async tx => {
      const prefix = `technical-catalog-${randomUUID()}`, actorId = prefix;
      await tx.user.create({ data: { id: actorId, username: actorId, email: `${actorId}@example.invalid`, password: 'not-a-login',
        firstName: 'Fixture', lastName: 'Catalog authority' } });
      await tx.partnerProfile.create({ data: { id: actorId, userId: actorId, state: 'ACTIVE' } });
      await tx.partnerReleaseCohort.create({ data: { id: actorId, name: actorId, activationEnabled: true,
        enrollmentPaused: false, operationalPaused: false } });
      await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: {
        cohortId: actorId, enrollmentPaused: false, operationalPaused: false } });
      await tx.partnerCohortMembership.create({ data: { id: actorId, profileId: actorId, cohortId: actorId,
        actorId, eligibilityEvidence: { fixture: true } } });
      await run(tx, actorId, prefix); throw rollback;
    }, { timeout: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.$disconnect(); }
}

function product(id: string): Prisma.ProductCreateInput {
  return { id, code: id, name: id, namePersian: `سنگ ${id}`, cuttingDimensionCode: 'longitudinal', cuttingDimensionName: 'Longitudinal',
    cuttingDimensionNamePersian: 'طولی', stoneTypeCode: 'marble', stoneTypeName: 'Marble', stoneTypeNamePersian: 'مرمریت',
    widthCode: 'w40', widthValue: '40', widthName: '40', motherLengthValue: '2.5', thicknessCode: 't2', thicknessValue: '2', thicknessName: '2',
    mineCode: 'mine', mineName: 'Mine', mineNamePersian: 'معدن', finishCode: 'polish', finishName: 'Polish', finishNamePersian: 'صیقلی',
    colorCode: 'white', colorName: 'White', colorNamePersian: 'سفید', qualityCode: 'q1', qualityName: 'Grade1', qualityNamePersian: 'درجه یک',
    images: [], basePrice: '87654321', description: 'private-catalog-note' };
}

test('real catalog filters before pagination and projects technical dimensions without prices or raw inventory fields', async () => {
  await fixture(async (tx, actorId, prefix) => {
    await tx.product.create({ data: { ...product(`${prefix}-0`), isActive: false } });
    await tx.product.create({ data: product(`${prefix}-1`) });
    await tx.product.create({ data: product(`${prefix}-2`) });
    const reader = createPartnerTechnicalCatalogReader(tx, { actorId, correlationId: prefix });
    const query = { schemaVersion: 1 as const, purpose: 'PARTNER_TECHNICAL_CATALOG' as const, kind: 'PRODUCT' as const,
      family: 'longitudinal' as const, search: prefix, limit: 1 };
    const first = await reader.read(query);
    assert.equal(first.ok, true);
    if (!first.ok || first.value.kind !== 'PRODUCT') throw new Error('Catalog read failed');
    assert.deepEqual(first.value.items.map(item => item.catalogItemId), [`${prefix}-1`]);
    assert.deepEqual(first.value.items[0].dimensions, { motherWidthCentimeters: '40', motherLengthMeters: '2.5', thicknessCentimeters: '2' });
    assert.equal(first.value.nextCursor, `${prefix}-1`);
    assert.equal(JSON.stringify(first).includes('87654321'), false);
    assert.equal(JSON.stringify(first).includes('private-catalog-note'), false);
    const next = await reader.read({ ...query, cursor: first.value.nextCursor });
    if (!next.ok || next.value.kind !== 'PRODUCT') throw new Error('Next page failed');
    assert.deepEqual(next.value.items.map(item => item.catalogItemId), [`${prefix}-2`]);
    assert.equal(next.value.nextCursor, undefined);
  });
});

test('operation catalogs expose canonical units and identities without their stored rates', async () => {
  await fixture(async (tx, actorId, prefix) => {
    await tx.subService.create({ data: { id: `${prefix}-tool`, code: `${prefix}-tool`, namePersian: prefix,
      pricePerMeter: '1234567', calculationBase: 'length' } });
    await tx.stoneFinishing.create({ data: { id: `${prefix}-finish`, code: `${prefix}-finish`, namePersian: prefix,
      pricePerSquareMeter: '2345678', unitPrice: '2345678', calculationBase: 'squareMeters' } });
    await tx.layerType.create({ data: { id: `${prefix}-layer`, code: `${prefix}-layer`, name: prefix,
      pricePerLayer: '3456789', calculationUnit: 'physicalPiece' } });
    const reader = createPartnerTechnicalCatalogReader(tx, { actorId, correlationId: prefix });
    for (const [kind, unit, suffix] of [['TOOL', 'meter', 'tool'], ['FINISHING', 'squareMeter', 'finish'], ['LAYER', 'physicalPiece', 'layer']] as const) {
      const result = await reader.read({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind, search: prefix });
      assert.equal(result.ok, true);
      if (!result.ok || result.value.kind === 'PRODUCT') throw new Error('Operation catalog failed');
      assert.equal(result.value.items.length, 1);
      assert.equal(result.value.items[0].unit, unit);
      assert.equal(result.value.items[0].catalogItemId, `${prefix}-${suffix}`);
      for (const privateField of ['pricePerMeter', 'pricePerLayer', 'pricePerSquareMeter', 'unitPrice']) {
        assert.equal(JSON.stringify(result).includes(privateField), false);
      }
    }
  });
});

test('family eligibility and empty results are exact, and private description text is not a search channel', async () => {
  await fixture(async (tx, actorId, prefix) => {
    await tx.product.create({ data: { ...product(`${prefix}-prepared`), availableInLongitudinalContracts: false,
      availableInStairContracts: false, availableInSlabContracts: false, availableInVolumetricContracts: true,
      description: `${prefix}-hidden-note` } });
    await tx.product.create({ data: { ...product(`${prefix}-deleted`), deletedAt: new Date() } });
    const reader = createPartnerTechnicalCatalogReader(tx, { actorId, correlationId: prefix });
    const query = { schemaVersion: 1 as const, purpose: 'PARTNER_TECHNICAL_CATALOG' as const, kind: 'PRODUCT' as const, search: prefix };
    for (const family of ['prepared', 'volumetric'] as const) {
      const result = await reader.read({ ...query, family });
      if (!result.ok || result.value.kind !== 'PRODUCT') throw new Error('Prepared catalog failed');
      assert.deepEqual(result.value.items.map(item => item.catalogItemId), [`${prefix}-prepared`]);
    }
    for (const input of [{ ...query, family: 'longitudinal' as const }, { ...query, search: `${prefix}-hidden-note` }]) {
      const result = await reader.read(input);
      assert.equal(result.ok, true);
      if (result.ok) { assert.deepEqual(result.value.items, []); assert.equal(result.value.nextCursor, undefined); }
    }
  });
});

test('catalog authority is current for every request and cannot be supplied in the query or gained through internal ADMIN', async () => {
  await fixture(async (tx, actorId, prefix) => {
    const reader = createPartnerTechnicalCatalogReader(tx, { actorId, correlationId: prefix });
    const query = { schemaVersion: 1 as const, purpose: 'PARTNER_TECHNICAL_CATALOG' as const, kind: 'PRODUCT' as const, search: prefix };
    const forged = await reader.read({ ...query, actorId: 'some-other-partner' } as typeof query);
    assert.equal(forged.ok ? null : forged.error.code, 'INVALID_PAYLOAD');
    const internalId = `${prefix}-internal`;
    await tx.user.create({ data: { id: internalId, username: internalId, email: `${internalId}@example.invalid`, password: 'not-a-login',
      firstName: 'Fixture', lastName: 'Admin', role: 'ADMIN' } });
    const internal = createPartnerTechnicalCatalogReader(tx, { actorId: internalId, correlationId: prefix });
    assert.equal((await internal.read(query)).ok, false);
    assert.equal((await reader.read(query)).ok, true);
    await tx.partnerReleaseCohort.update({ where: { id: actorId }, data: { activationEnabled: false } });
    const outsideCohort = await reader.read(query);
    assert.equal(outsideCohort.ok ? null : outsideCohort.error.code, 'COHORT_NOT_READY');
    await tx.partnerReleaseCohort.update({ where: { id: actorId }, data: { activationEnabled: true, operationalPaused: true } });
    assert.equal((await reader.read(query)).ok, true, 'operational pause keeps enrolled read-only catalog access');
    await tx.partnerProfile.update({ where: { id: actorId }, data: { state: 'SUSPENDED', revision: { increment: 1 } } });
    assert.equal((await reader.read(query)).ok, true);
    await tx.partnerProfile.update({ where: { id: actorId }, data: { state: 'TERMINATED', revision: { increment: 1 } } });
    assert.equal((await reader.read(query)).ok, false);
  });
});
