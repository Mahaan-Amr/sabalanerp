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

test('technical sales policy accepts an integrity-checked bootstrap projection linked to its source policy', async () => {
  const effectiveDate = new Date('2026-08-29T00:00:00.000Z');
  const source = { id: 'bootstrap-policy', purpose: 'PARTNER_TECHNICAL_PRICING' as const,
    label: 'شرایط شروع فروش همکار', effectiveDate, expiresAt: null,
    issuedAt: new Date('2026-08-28T00:00:00.000Z'), revokedAt: null, terms, integrityHash: '' };
  source.integrityHash = await canonicalHash({ purpose: source.purpose, label: source.label,
    effectiveDate: '2026-08-29', terms: source.terms });
  const projection = { id: 'projected-terms', accountId: 'account-1', version: 1, effectiveDate,
    terms: { ...terms, policyId: source.id }, actorId: 'sales-manager', reason: 'شروع فروش همکار',
    integrityHash: source.integrityHash };
  const transaction = {
    $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: 'account-1' } }) },
    partnerCommercialTerms: { findMany: async () => [projection] },
    partnerTermsPolicy: { findUnique: async () => source },
  } as any;
  const result = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.ok(result.ok);
  assert.equal(result.value.policyId, projection.id);

  source.integrityHash = 'sha256-v1:' + '0'.repeat(64);
  const corrupted = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.equal(corrupted.ok, false);
  if (corrupted.ok) throw new Error('Corrupted bootstrap policy was accepted');
  assert.equal(corrupted.error.code, 'INTEGRITY_CONFLICT');
});

test('obsolete local-QA pricing placeholders cannot shadow a newer-schema valid account policy', async () => {
  const effectiveDate = new Date('2026-08-29T00:00:00.000Z');
  const valid = { id: 'terms-v3', accountId: 'account-1', version: 3, effectiveDate, terms,
    actorId: 'sales-manager', reason: 'سیاست فنی معتبر', integrityHash: '' };
  valid.integrityHash = await canonicalHash({ accountId: valid.accountId, version: valid.version,
    effectiveDate: '2026-08-29', terms: valid.terms, actorId: valid.actorId, reason: valid.reason });
  const legacySourceTerms = { localQa: true, calculationPolicyVersion: 'partner-v1' };
  const legacySource = { id: 'partner-local-qa-commercial-v1', purpose: 'PARTNER_TECHNICAL_PRICING' as const,
    label: 'شرایط استاندارد آزمون محلی', effectiveDate, expiresAt: null,
    issuedAt: new Date('2026-08-28T00:00:00.000Z'), revokedAt: null, terms: legacySourceTerms, integrityHash: '' };
  legacySource.integrityHash = await canonicalHash({ purpose: legacySource.purpose, label: legacySource.label,
    effectiveDate: '2026-08-29', terms: legacySource.terms });
  const legacyProjection = { id: 'legacy-terms-v4', accountId: valid.accountId, version: 4, effectiveDate,
    terms: { ...legacySourceTerms, purpose: legacySource.purpose, policyId: legacySource.id },
    actorId: 'sales-manager', reason: 'legacy local QA bootstrap', integrityHash: legacySource.integrityHash };
  const transaction = {
    $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: valid.accountId } }) },
    partnerCommercialTerms: { findMany: async () => [legacyProjection, valid] },
    partnerTermsPolicy: { findUnique: async () => legacySource },
  } as any;
  const result = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.ok(result.ok);
  assert.equal(result.value.policyId, valid.id);
});

test('directly activated Partner uses the current central technical policy without account terms', async () => {
  const effectiveDate = new Date('2026-08-29T00:00:00.000Z');
  const source = { id: 'central-policy', purpose: 'PARTNER_TECHNICAL_PRICING' as const,
    label: 'سیاست فنی سراسری', effectiveDate, expiresAt: null,
    issuedAt: new Date('2026-08-28T00:00:00.000Z'), revokedAt: null, terms, integrityHash: '' };
  source.integrityHash = await canonicalHash({ purpose: source.purpose, label: source.label,
    effectiveDate: '2026-08-29', terms: source.terms });
  const transaction = {
    $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: 'account-1' } }) },
    partnerCommercialTerms: { findMany: async () => [] },
    partnerTermsPolicy: { findMany: async () => [source] },
  } as any;
  const result = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.ok(result.ok);
  assert.equal(result.value.policyId, source.id);
});

test('main-stone inquiry identity survives quantity, dimension and operation changes', async () => {
  const row: PartnerTechnicalDraft['rows'][number] = {
    productRowId: 'row-1', catalogItemId: 'stone-1', catalogSnapshotVersion: '2026-08-29T08:00:00.000Z',
    family: 'longitudinal', configuration: { sourceBatchId: 'stock-1', lengthMeters: '2', widthMeters: '0.4',
      quantity: 2, lastManualField: 'quantity', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'm',
      sawKerfEnabled: true, calibrationEnabled: false, calibrationSelection: 'automatic' },
  };
  const initial = await technicalConfigurationHash(row);
  assert.equal(await technicalConfigurationHash({ ...row, configuration: { ...row.configuration, quantity: 7 } }), initial);
  assert.equal(await technicalConfigurationHash({ ...row, configuration: { ...row.configuration, widthMeters: '0.5' } }), initial);
  assert.notEqual(await technicalConfigurationHash({ ...row, catalogItemId: 'stone-2' }), initial);
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
    availableInSlabContracts: true, availableInVolumetricContracts: true, preparedSalesUnit: 'count', volumetricSalesUnit: 'ton',
    basePrice: new Prisma.Decimal('12000000'), currency: 'ریال' };
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
  product.updatedAt = new Date('2026-08-29T13:00:00.000Z');
  product.basePrice = new Prisma.Decimal('99000000');
  const successorDraft = PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: 2,
    rows: [{ ...draft.rows[0], configuration: { ...draft.rows[0].configuration, quantity: '7' } }] });
  const successor = await resolver(transaction, { actorId: 'partner-1', recoveryId: 'draft-1',
    draft: successorDraft,
    previous: { identities: first.value.identities, context: first.value.context } as any });
  assert.ok(successor.ok);
  assert.deepEqual(successor.value.identities, first.value.identities);
  assert.equal(successor.value.context.products[0].preparedRates?.[0].rateToman, '1200000');
});
