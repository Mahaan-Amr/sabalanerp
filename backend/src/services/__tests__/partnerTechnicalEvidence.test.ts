import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash, PartnerTechnicalDraftSchema, type PartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';
import { Prisma } from '@prisma/client';
import { createPartnerTechnicalEvidenceResolver, readPartnerTechnicalSalesPolicy,
  technicalConfigurationHash } from '../partnerSales/cases/technicalEvidence';

const terms = {
  schemaVersion: 1 as const,
  purpose: 'PARTNER_TECHNICAL_PRICING' as const,
  calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v2' },
  mandatoryPercentage: '20', mandatoryEnabled: true,
  slabCuttingPricingMethod: 'lineBased' as const,
  sawKerfMeters: '0.005', materialRateScale: '0.1', currency: 'IRT' as const,
  rates: { longitudinalCutRateToman: '1200', crossCutRateToman: '1400', calibrationCutRateToman: '900',
    verticalCutRateToman: '1600', squareMeterCutRateToman: '4500' },
};

test('technical sales policy accepts only the latest effective append-only terms with a matching integrity hash', async () => {
  const effectiveDate = new Date('2026-08-29T00:00:00.000Z');
  const record = { id: 'terms-v2', accountId: 'account-1', version: 2, effectiveDate, terms,
    actorId: 'sales-manager', reason: 'سیاست فنی مصوب فروش', integrityHash: '' };
  record.integrityHash = await canonicalHash({ accountId: record.accountId, version: record.version,
    effectiveDate: '2026-08-29', terms: record.terms, actorId: record.actorId, reason: record.reason });
  const transaction = {
    $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: 'account-1' } }) },
    partnerCommercialTerms: { findMany: async () => [record] },
  } as any;
  const result = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.ok(result.ok);
  assert.equal(result.value.policyId, record.id);
  assert.equal(result.value.mandatoryPercentage, '20');
  record.integrityHash = 'sha256-v1:' + '0'.repeat(64);
  const corrupted = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.equal(corrupted.ok, false);
  if (corrupted.ok) throw new Error('Corrupted policy was accepted');
  assert.equal(corrupted.error.code, 'INTEGRITY_CONFLICT');
});

test('technical configuration identity excludes requested quantity but changes with priced geometry', async () => {
  const row: PartnerTechnicalDraft['rows'][number] = {
    productRowId: 'row-1', catalogItemId: 'stone-1', catalogSnapshotVersion: '2026-08-29T08:00:00.000Z',
    family: 'longitudinal', configuration: { sourceBatchId: 'stock-1', lengthMeters: '2', widthMeters: '0.4',
      quantity: 2, lastManualField: 'quantity', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'm',
      sawKerfEnabled: true, calibrationEnabled: false, calibrationSelection: 'automatic' },
  };
  const initial = await technicalConfigurationHash(row);
  assert.equal(await technicalConfigurationHash({ ...row, configuration: { ...row.configuration, quantity: 7 } }), initial);
  assert.notEqual(await technicalConfigurationHash({ ...row, configuration: { ...row.configuration, widthMeters: '0.5' } }), initial);
});

test('real evidence resolver binds current private rates and reuses frozen identity for quantity-only successors', async () => {
  const effectiveDate = new Date('2026-08-29T00:00:00.000Z');
  const record = { id: 'terms-v2', accountId: 'account-1', version: 2, effectiveDate, terms,
    actorId: 'sales-manager', reason: 'سیاست فنی مصوب فروش', integrityHash: '' };
  record.integrityHash = await canonicalHash({ accountId: record.accountId, version: record.version,
    effectiveDate: '2026-08-29', terms: record.terms, actorId: record.actorId, reason: record.reason });
  const updatedAt = new Date('2026-08-29T08:00:00.000Z');
  const product = { id: 'stone-1', code: 'S-1', namePersian: 'سنگ تست', updatedAt,
    widthValue: new Prisma.Decimal('40'), motherLengthValue: new Prisma.Decimal('2'), thicknessValue: new Prisma.Decimal('2'),
    stoneTypeNamePersian: 'تراورتن', mineNamePersian: 'معدن', finishNamePersian: 'سابیده', colorNamePersian: 'کرم',
    qualityNamePersian: 'درجه یک', cuttingDimensionNamePersian: 'طولی', isActive: true, deletedAt: null,
    isAvailable: true, availableInLongitudinalContracts: true, availableInStairContracts: true,
    availableInSlabContracts: true, availableInVolumetricContracts: true, basePrice: new Prisma.Decimal('12000000'), currency: 'ریال' };
  const transaction = {
    $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: 'account-1' } }) },
    partnerCommercialTerms: { findMany: async () => [record] },
    product: { findMany: async () => [product] },
    subService: { findMany: async () => [] }, stoneFinishing: { findMany: async () => [] }, layerType: { findMany: async () => [] },
  } as any;
  const draft: PartnerTechnicalDraft = { schemaVersion: 1, inputRevision: 1, rows: [{
    productRowId: 'row-1', catalogItemId: product.id, catalogSnapshotVersion: updatedAt.toISOString(),
    family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' },
  }] };
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(transaction, { actorId: 'partner-1', recoveryId: 'draft-1', draft, previous: null });
  assert.ok(first.ok);
  assert.equal(first.value.context.products[0].preparedRates?.[0].rateToman, '1200000');
  assert.equal(first.value.identities[0].identity.currency, 'IRT');
  const changedRates = { ...record, terms: { ...terms, materialRateScale: '0.2' } };
  changedRates.integrityHash = await canonicalHash({ accountId: changedRates.accountId, version: changedRates.version,
    effectiveDate: '2026-08-29', terms: changedRates.terms, actorId: changedRates.actorId, reason: changedRates.reason });
  transaction.partnerCommercialTerms.findMany = async () => [changedRates];
  const successorDraft = PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: 2,
    rows: [{ ...draft.rows[0], configuration: { ...draft.rows[0].configuration, quantity: '7' } }] });
  const successor = await resolver(transaction, { actorId: 'partner-1', recoveryId: 'draft-1',
    draft: successorDraft,
    previous: { identities: first.value.identities, context: first.value.context } as any });
  assert.ok(successor.ok);
  assert.deepEqual(successor.value.identities, first.value.identities);
  assert.equal(successor.value.context.products[0].preparedRates?.[0].rateToman, '1200000');
});
