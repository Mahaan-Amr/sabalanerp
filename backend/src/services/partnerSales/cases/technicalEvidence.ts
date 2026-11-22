import { Prisma, type PrismaClient } from '@prisma/client';
import { parseCanonicalDecimal, type CalculationPolicySnapshot } from '@sabalanerp/contract-product-graph';
import { canonicalHash, InquiryIdentitySchema, partnerError, type InquiryIdentity,
  type PartnerTechnicalDraft, type PartnerTechnicalOperation, type PartnerTechnicalProduct, type Result } from '@sabalanerp/partner-sales-contracts';
import { catalogMaterialRateToman, projectPartnerTechnicalOperation, projectPartnerTechnicalProduct } from '../crm/technicalCatalog';
import type { PartnerTechnicalSaveDependencies } from './technicalSave';
import type { PartnerTechnicalGraphContext } from './technicalGraph';
import { samePartnerTechnicalIntent, technicalComponentFailure } from './technicalRateRefresh';

type SlabCuttingPricingMethod = 'lineBased' | 'squareMeter';

export interface PartnerTechnicalSalesPolicy {
  policyId: string;
  version: number;
  effectiveDate: string;
  integrityHash: string;
  calculationPolicy: CalculationPolicySnapshot;
  mandatoryPercentage: string;
  mandatoryEnabled: boolean;
  slabCuttingPricingMethod: SlabCuttingPricingMethod;
  sawKerfMeters: string;
  materialRateScale: string;
  currency: 'IRT';
  rates: {
    longitudinalCutRateToman: string;
    crossCutRateToman: string;
    calibrationCutRateToman: string;
    verticalCutRateToman?: string;
    squareMeterCutRateToman?: string;
  };
}

const policyKeys = ['schemaVersion', 'purpose', 'calculationPolicy', 'mandatoryPercentage', 'mandatoryEnabled',
  'slabCuttingPricingMethod', 'sawKerfMeters', 'materialRateScale', 'currency', 'rates'] as const;
const versionKeys = ['calculation', 'packing', 'pricing', 'rounding'] as const;
const rateKeys = ['longitudinalCutRateToman', 'crossCutRateToman', 'calibrationCutRateToman',
  'verticalCutRateToman', 'squareMeterCutRateToman'] as const;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function decimal(value: unknown, positive = false): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = parseCanonicalDecimal(value);
    if (parsed !== value || new Prisma.Decimal(parsed).isNegative() || (positive && new Prisma.Decimal(parsed).isZero())) return undefined;
    return parsed;
  } catch { return undefined; }
}

export function parsePartnerTechnicalSalesPolicySnapshot(value: unknown,
  identity: { id: string; version: number; effectiveDate: Date | string; integrityHash: string }): PartnerTechnicalSalesPolicy | undefined {
  const terms = record(value), calculationPolicy = record(terms?.calculationPolicy), rates = record(terms?.rates);
  if (!terms || !calculationPolicy || !rates || !exactKeys(terms, policyKeys) || !exactKeys(calculationPolicy, versionKeys) ||
      !rateKeys.slice(0, 3).every(key => Object.prototype.hasOwnProperty.call(rates, key)) ||
      !Object.keys(rates).every(key => (rateKeys as readonly string[]).includes(key)) ||
      terms.schemaVersion !== 1 || terms.purpose !== 'PARTNER_TECHNICAL_PRICING' ||
      terms.currency !== 'IRT' || typeof terms.mandatoryEnabled !== 'boolean' ||
      !['lineBased', 'squareMeter'].includes(String(terms.slabCuttingPricingMethod)) ||
      !versionKeys.every(key => typeof calculationPolicy[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(calculationPolicy[key] as string))) {
    return undefined;
  }
  const mandatoryPercentage = decimal(terms.mandatoryPercentage), sawKerfMeters = decimal(terms.sawKerfMeters),
    materialRateScale = decimal(terms.materialRateScale, true);
  const parsedRates = Object.fromEntries(rateKeys.map(key => [key, decimal(rates[key])])) as Record<typeof rateKeys[number], string | undefined>;
  if (mandatoryPercentage === undefined || new Prisma.Decimal(mandatoryPercentage).gt(100) || sawKerfMeters === undefined ||
      materialRateScale === undefined || rateKeys.some((key, index) => parsedRates[key] === undefined &&
        (index < 3 || Object.prototype.hasOwnProperty.call(rates, key)))) return undefined;
  return {
    policyId: identity.id, version: identity.version,
    effectiveDate: typeof identity.effectiveDate === 'string' ? identity.effectiveDate : identity.effectiveDate.toISOString().slice(0, 10),
    integrityHash: identity.integrityHash,
    calculationPolicy: calculationPolicy as unknown as CalculationPolicySnapshot,
    mandatoryPercentage, mandatoryEnabled: terms.mandatoryEnabled,
    slabCuttingPricingMethod: terms.slabCuttingPricingMethod as SlabCuttingPricingMethod,
    sawKerfMeters, materialRateScale, currency: 'IRT',
    rates: Object.fromEntries(Object.entries(parsedRates).filter(([, value]) => value !== undefined)) as PartnerTechnicalSalesPolicy['rates'],
  };
}

/** Reads the latest effective, append-only commercial terms for this Partner.
 * The integrity definition is intentionally local to this purpose. Other
 * commercial terms are skipped and never reinterpreted as pricing authority. */
export async function readPartnerTechnicalSalesPolicy(tx: Prisma.TransactionClient, actorId: string): Promise<Result<PartnerTechnicalSalesPolicy>> {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const profile = await tx.partnerProfile.findUnique({ where: { userId: actorId },
    select: { commercialAccount: { select: { id: true } } } });
  const accountId = profile?.commercialAccount?.id;
  if (!accountId) return { ok: false, error: partnerError('NOT_FOUND') };
  const result = await readTechnicalPolicyForAccount(tx, accountId, clock.now);
  return result.ok ? { ok: true, value: result.value.policy } : result;
}

export async function readPartnerTechnicalSalesPolicyForProfile(tx: Prisma.TransactionClient, profileId: string): Promise<Result<{
  policy: PartnerTechnicalSalesPolicy; accountVersion: number;
}>> {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const profile = await tx.partnerProfile.findUnique({ where: { id: profileId },
    select: { commercialAccount: { select: { id: true } } } });
  const accountId = profile?.commercialAccount?.id;
  return accountId ? readTechnicalPolicyForAccount(tx, accountId, clock.now)
    : { ok: false, error: partnerError('NOT_FOUND') };
}

async function readTechnicalPolicyForAccount(tx: Prisma.TransactionClient, accountId: string, now: Date): Promise<Result<{
  policy: PartnerTechnicalSalesPolicy; accountVersion: number;
}>> {
  const candidates = await tx.partnerCommercialTerms.findMany({ where: { accountId },
    orderBy: { version: 'desc' }, select: { id: true, accountId: true, version: true, effectiveDate: true, terms: true,
      actorId: true, reason: true, integrityHash: true } });
  const accountVersion = candidates[0]?.version ?? 0;
  for (const candidate of candidates) {
    if (candidate.effectiveDate.getTime() > now.getTime()) continue;
    const raw = record(candidate.terms);
    if (raw?.purpose !== 'PARTNER_TECHNICAL_PRICING') continue;
    let policyTerms: unknown = candidate.terms;
    if (typeof raw.policyId === 'string') {
      // Bootstrap projects an immutable, centrally issued terms policy into the
      // Partner account and deliberately retains the source policy hash. Later
      // account-local policy publications use the account-stream hash below.
      // Accepting only one hash convention here made every correctly bootstrapped
      // Partner fail their first validated technical save.
      const source = await tx.partnerTermsPolicy.findUnique({ where: { id: raw.policyId }, select: {
        id: true, purpose: true, label: true, effectiveDate: true, expiresAt: true, issuedAt: true, revokedAt: true,
        terms: true, integrityHash: true,
      } });
      const sourceTerms = source && record(source.terms);
      if (!source || !sourceTerms || source.purpose !== 'PARTNER_TECHNICAL_PRICING' || source.revokedAt || source.issuedAt > now ||
          (source.expiresAt && source.expiresAt <= now) || source.effectiveDate.getTime() !== candidate.effectiveDate.getTime()) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      const sourceHash = await canonicalHash({ purpose: source.purpose, label: source.label,
        effectiveDate: source.effectiveDate.toISOString().slice(0, 10), terms: source.terms });
      const projected = { ...sourceTerms, purpose: source.purpose, policyId: source.id };
      if (source.integrityHash !== sourceHash || candidate.integrityHash !== source.integrityHash ||
          await canonicalHash(projected) !== await canonicalHash(candidate.terms)) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      // The retired v1 local-QA bootstrap carried only an activation marker,
      // not a calculable pricing policy. Keep its append-only history, but do
      // not let that authenticated marker shadow a valid account or central policy.
      const obsoleteLocalQaPlaceholder = raw.policyId === 'partner-local-qa-commercial-v1' &&
        exactKeys(raw, ['localQa', 'purpose', 'policyId', 'calculationPolicyVersion']) && raw.localQa === true &&
        raw.calculationPolicyVersion === 'partner-v1' && exactKeys(sourceTerms, ['localQa', 'calculationPolicyVersion']) &&
        sourceTerms.localQa === true && sourceTerms.calculationPolicyVersion === 'partner-v1';
      if (obsoleteLocalQaPlaceholder) continue;
      policyTerms = { ...sourceTerms, purpose: source.purpose };
    } else {
      const expectedHash = await canonicalHash({ accountId: candidate.accountId, version: candidate.version,
        effectiveDate: candidate.effectiveDate.toISOString().slice(0, 10), terms: candidate.terms,
        actorId: candidate.actorId, reason: candidate.reason });
      if (candidate.integrityHash !== expectedHash) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
    const policy = parsePartnerTechnicalSalesPolicySnapshot(policyTerms, candidate);
    return policy ? { ok: true, value: { policy, accountVersion } } : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  // Direct activation deliberately creates no Partner-specific commercial
  // terms. In that case the ordinary, centrally issued pricing policy is the
  // authority for cuts, tools and finishing. It is read, verified and frozen
  // into the recovery snapshot exactly like an account projection.
  const sources = await tx.partnerTermsPolicy.findMany({ where: {
    purpose: 'PARTNER_TECHNICAL_PRICING', issuedAt: { lte: now }, effectiveDate: { lte: now },
    revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }, orderBy: [{ effectiveDate: 'desc' }, { issuedAt: 'desc' }], select: {
    id: true, purpose: true, label: true, effectiveDate: true, expiresAt: true,
    issuedAt: true, revokedAt: true, terms: true, integrityHash: true,
  } });
  for (const source of sources) {
    const sourceHash = await canonicalHash({ purpose: source.purpose, label: source.label,
      effectiveDate: source.effectiveDate.toISOString().slice(0, 10), terms: source.terms });
    if (source.integrityHash !== sourceHash) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const policy = parsePartnerTechnicalSalesPolicySnapshot({ ...(record(source.terms) ?? {}), purpose: source.purpose },
      { id: source.id, version: 1, effectiveDate: source.effectiveDate, integrityHash: source.integrityHash });
    if (policy) return { ok: true, value: { policy, accountVersion } };
  }
  // Only an unconfigured Partner inherits ordinary Sabalan Sale defaults.
  // Never substitute ordinary prices for a future, expired, revoked or invalid
  // explicit Partner pricing policy.
  if (candidates.some(candidate => record(candidate.terms)?.purpose === 'PARTNER_TECHNICAL_PRICING') ||
      await tx.partnerTermsPolicy.count({ where: { purpose: 'PARTNER_TECHNICAL_PRICING' } })) {
    return { ok: false, error: partnerError('STATE_CONFLICT') };
  }
  const cuts = await tx.cuttingType.findMany({ where: { code: { in: ['LONG', 'CROSS'] }, isActive: true },
    select: { id: true, code: true, pricePerMeter: true, updatedAt: true } });
  const longitudinal = cuts.find(cut => cut.code === 'LONG'), cross = cuts.find(cut => cut.code === 'CROSS');
  if (!longitudinal?.pricePerMeter || !cross?.pricePerMeter ||
      longitudinal.pricePerMeter.isNegative() || cross.pricePerMeter.isNegative()) {
    return { ok: false, error: partnerError('STATE_CONFLICT') };
  }
  const terms = { schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_PRICING',
    calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    mandatoryEnabled: false, mandatoryPercentage: '20', slabCuttingPricingMethod: 'lineBased',
    sawKerfMeters: '0.003', materialRateScale: '1', currency: 'IRT',
    rates: { longitudinalCutRateToman: longitudinal.pricePerMeter.toFixed(),
      crossCutRateToman: cross.pricePerMeter.toFixed(), calibrationCutRateToman: longitudinal.pricePerMeter.toFixed() } };
  const integrityHash = await canonicalHash({ source: 'SABALAN_SALE', terms,
    cuttingTypes: [longitudinal, cross].map(cut => ({ id: cut.id, code: cut.code,
      updatedAt: cut.updatedAt.toISOString(), rateToman: cut.pricePerMeter!.toFixed() })) });
  const effectiveDate = new Date(Math.max(longitudinal.updatedAt.getTime(), cross.updatedAt.getTime()));
  const policy = parsePartnerTechnicalSalesPolicySnapshot(terms, {
    id: `sabalan-sale-${integrityHash.replace('sha256-v1:', '')}`, version: 1, effectiveDate, integrityHash });
  return policy ? { ok: true, value: { policy, accountVersion } }
    : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
}

/** Main-stone approval identity is independent from quantity, geometry,
 * operations and Customer rates. Their current calculation/evidence is owned
 * by the technical graph, not by the responder's material unit rate. */
export async function technicalConfigurationHash(row: PartnerTechnicalDraft['rows'][number]): Promise<string> {
  return canonicalHash({ schemaVersion: 2, pricingSubject: 'MAIN_CATALOG_STONE', pricingBasis: 'ordinary-sale-v1',
    catalogItemId: row.catalogItemId, family: row.family, unit: identityUnit(row) });
}

async function technicalDraftRowConfigurationHash(row: PartnerTechnicalDraft['rows'][number], draft: PartnerTechnicalDraft) {
  void draft;
  return technicalConfigurationHash(row);
}

export type PartnerTechnicalDatabase = Pick<PrismaClient, '$transaction'>;

function enteredMaterialPrice(draft: PartnerTechnicalDraft, catalogItemId: string) {
  const root = draft.rows.find(row => row.catalogItemId === catalogItemId && row.retailUnitPrice)?.retailUnitPrice;
  if (root) return root;
  for (const dependent of draft.dependents ?? []) {
    if (dependent.kind === 'layer' && dependent.source?.kind === 'new-material' &&
        dependent.source.catalogItemId === catalogItemId && dependent.source.retailUnitPrice) return dependent.source.retailUnitPrice;
  }
  return undefined;
}

function operationsFromDraft(draft: PartnerTechnicalDraft) {
  const intents = [
    ...draft.rows.flatMap(row => 'operations' in row && row.operations ? [row.operations] : []),
    ...(draft.dependents ?? []).flatMap(dependent => dependent.kind === 'remainder' && dependent.operations ? [dependent.operations]
      : dependent.kind === 'layer' ? (dependent.sideOperations ?? []).map(side => side.operations) : []),
  ];
  return {
    tools: intents.flatMap(intent => intent.tools),
    finishings: intents.flatMap(intent => intent.finishings),
    layers: (draft.dependents ?? []).filter((item): item is Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'layer' }> => item.kind === 'layer'),
  };
}

function uniqueCatalogReferences<T extends { catalogItemId: string; catalogSnapshotVersion: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map(value => [`${value.catalogItemId}\0${value.catalogSnapshotVersion}`, value])).values()];
}

function productReferences(draft: PartnerTechnicalDraft): Array<{ catalogItemId: string; catalogSnapshotVersion: string }> {
  const values = [...draft.rows, ...(draft.dependents ?? []).flatMap(dependent => {
    if (dependent.kind === 'remainder') return [{ catalogItemId: dependent.catalogItemId,
      catalogSnapshotVersion: dependent.catalogSnapshotVersion }];
    return dependent.source && dependent.source.kind !== 'paid-remainder'
      ? [{ catalogItemId: dependent.source.catalogItemId, catalogSnapshotVersion: dependent.source.catalogSnapshotVersion }]
      : [];
  })];
  return uniqueCatalogReferences(values);
}

function identityUnit(row: PartnerTechnicalDraft['rows'][number] | Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'remainder' }>)
  : InquiryIdentity['unit'] {
  if (!('family' in row)) return 'squareMeter';
  if (row.family === 'prepared' || row.family === 'volumetric') return row.configuration.unit;
  return 'squareMeter';
}

async function dependentConfigurationHash(row: Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'remainder' }>) {
  return canonicalHash({ schemaVersion: 2, pricingSubject: 'MAIN_CATALOG_STONE', pricingBasis: 'ordinary-sale-v1',
    catalogItemId: row.catalogItemId, family: 'longitudinal', unit: identityUnit(row) });
}

/** Real private evidence producer. Every source revision must equal the public
 * technical snapshot selected by the draft. Rates and policy never cross the
 * save interface. */
export function createPartnerTechnicalEvidenceResolver(): PartnerTechnicalSaveDependencies['resolveEvidence'] {
  return async (tx, input) => {
    const previousContext = input.previous?.context as Partial<PartnerTechnicalGraphContext> | undefined;
    const priorPolicy = previousContext?.technicalPolicy;
    const parsedPriorPolicy = priorPolicy && parsePartnerTechnicalSalesPolicySnapshot({
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_PRICING', calculationPolicy: priorPolicy.calculationPolicy,
      mandatoryPercentage: priorPolicy.mandatoryPercentage, mandatoryEnabled: priorPolicy.mandatoryEnabled,
      slabCuttingPricingMethod: priorPolicy.slabCuttingPricingMethod, sawKerfMeters: priorPolicy.sawKerfMeters,
      materialRateScale: priorPolicy.materialRateScale, currency: priorPolicy.currency, rates: priorPolicy.rates,
    }, { id: priorPolicy.policyId, version: priorPolicy.version,
      effectiveDate: priorPolicy.effectiveDate, integrityHash: priorPolicy.integrityHash });
    const identityRows = [
      ...input.draft.rows.map(row => ({ productRowId: row.productRowId, catalogItemId: row.catalogItemId, catalogSnapshotVersion: row.catalogSnapshotVersion,
        family: row.family, unit: identityUnit(row), hash: technicalDraftRowConfigurationHash(row, input.draft) })),
      ...(input.draft.dependents ?? []).filter((item): item is Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'remainder' }> => item.kind === 'remainder')
        .map(row => ({ productRowId: row.productRowId, catalogItemId: row.catalogItemId, catalogSnapshotVersion: row.catalogSnapshotVersion,
          family: 'longitudinal' as const, unit: identityUnit(row), hash: dependentConfigurationHash(row) })),
      ...(input.draft.dependents ?? []).filter((item): item is Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'layer' }> => {
        if (item.kind !== 'layer' || item.source?.kind !== 'new-material') return false;
        const parent = input.draft.rows.find(row => row.productRowId === item.parentProductRowId);
        return Boolean(parent && parent.catalogItemId !== item.source.catalogItemId);
      }).map(row => ({ productRowId: `layer-material:${row.layerConfigurationId}`,
        catalogItemId: row.source?.kind === 'new-material' ? row.source.catalogItemId : '',
        catalogSnapshotVersion: row.source?.kind === 'new-material' ? row.source.catalogSnapshotVersion : '', family: 'stair' as const,
        unit: 'squareMeter' as const, hash: canonicalHash({ schemaVersion: 2, pricingSubject: 'MAIN_CATALOG_STONE', pricingBasis: 'ordinary-sale-v1',
          catalogItemId: row.source?.kind === 'new-material' ? row.source.catalogItemId : '', family: 'stair', unit: 'squareMeter' }) })),
    ];
    // Main-stone inquiry identity intentionally excludes operations. It cannot
    // authorize reusing the complete technical context after a product edit.
    if (parsedPriorPolicy && previousContext && input.previous?.draft &&
        samePartnerTechnicalIntent(input.draft, input.previous.draft)) {
      return { ok: true, value: { context: previousContext as PartnerTechnicalGraphContext,
        identities: input.previous.identities } };
    }
    const policy = await readPartnerTechnicalSalesPolicy(tx, input.actorId);
    if (!policy.ok) return policy;
    const currentPolicy = policy.value;
    const references = productReferences(input.draft);
    const products = await tx.product.findMany({ where: { id: { in: references.map(item => item.catalogItemId) } },
      select: { id: true, code: true, namePersian: true, updatedAt: true, widthValue: true, motherLengthValue: true,
        thicknessValue: true, stoneTypeNamePersian: true, mineNamePersian: true, finishNamePersian: true,
        colorNamePersian: true, qualityNamePersian: true, cuttingDimensionNamePersian: true, isActive: true,
        deletedAt: true, isAvailable: true, availableInLongitudinalContracts: true, availableInStairContracts: true,
        availableInSlabContracts: true, availableInVolumetricContracts: true,
        preparedSalesUnit: true, volumetricSalesUnit: true, basePrice: true, currency: true } });
    for (const reference of references) {
      if (!products.some(source => source.id === reference.catalogItemId)) {
        const row = input.draft.rows.find(row => row.catalogItemId === reference.catalogItemId);
        return technicalComponentFailure('PRODUCT', row?.contractualTitle ?? 'سنگ انتخاب‌شده', 'MISSING');
      }
    }
    if (new Set(products.map(item => item.id)).size !== products.length ||
        products.length !== new Set(references.map(item => item.catalogItemId)).size) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const publicProducts: PartnerTechnicalProduct[] = [];
    for (const reference of references) {
      const source = products.find(item => item.id === reference.catalogItemId)!;
      const matches = previousContext?.catalog?.products.filter(item => item.catalogItemId === source.id &&
        item.catalogSnapshotVersion === reference.catalogSnapshotVersion) ?? [];
      if (matches.length > 1) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const retained = matches[0];
      if (!source.isActive || source.deletedAt) return technicalComponentFailure('PRODUCT', source.namePersian, 'INACTIVE');
      if (!reference || (source.updatedAt.toISOString() !== reference.catalogSnapshotVersion && !retained)) {
        return { ok: false, error: partnerError('ROW_STALE') };
      }
      // Ordinary Sale accepts the seller's row price even when the imported
      // catalog has no commercial price. It is not a stale catalog version.
      // Keep the technical context calculable using genuine commercial intent;
      // the compiler applies each row's current price independently below.
      if (source.basePrice === null) {
        const entered = enteredMaterialPrice(input.draft, source.id);
        if (!entered || new Prisma.Decimal(entered.amount).lte(0))
          return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      }
      const projected = projectPartnerTechnicalProduct(source);
      if (!projected.ok) return projected;
      publicProducts.push(retained ?? projected.value);
    }
    const selections = operationsFromDraft(input.draft);
    const toolIds = [...new Set(selections.tools.map(item => item.catalogItemId))];
    const finishingIds = [...new Set(selections.finishings.map(item => item.catalogItemId))];
    const layerIds = [...new Set(selections.layers.map(item => item.catalogItemId))];
    const [tools, finishings, layers] = await Promise.all([
      tx.subService.findMany({ where: { id: { in: toolIds } }, select: { id: true, updatedAt: true, isActive: true,
        namePersian: true, calculationBase: true, minimumQuantity: true, pricePerMeter: true } }),
      tx.stoneFinishing.findMany({ where: { id: { in: finishingIds } }, select: { id: true, updatedAt: true,
        isActive: true, namePersian: true, calculationBase: true, minimumQuantity: true, pricePerSquareMeter: true, unitPrice: true } }),
      tx.layerType.findMany({ where: { id: { in: layerIds } }, select: { id: true, updatedAt: true, isActive: true,
        name: true, calculationUnit: true, pricePerLayer: true } }),
    ]);
    for (const [kind, selected, sources] of [
      ['TOOL', selections.tools, tools], ['FINISHING', selections.finishings, finishings], ['LAYER', selections.layers, layers],
    ] as const) {
      for (const item of selected) if (!sources.some(source => source.id === item.catalogItemId)) {
        const retained = previousContext?.catalog?.operations.find(source => source.kind === kind &&
          source.catalogItemId === item.catalogItemId && source.catalogSnapshotVersion === item.catalogSnapshotVersion);
        return technicalComponentFailure(kind, retained?.name ?? 'عملیات انتخاب‌شده', 'MISSING');
      }
      if (new Set(sources.map(item => item.id)).size !== sources.length ||
          sources.length !== new Set(selected.map(item => item.catalogItemId)).size) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
    }
    const publicOperation = (source: PartnerTechnicalOperation, selectedVersion: string): Result<PartnerTechnicalOperation> => {
      const matches = previousContext?.catalog?.operations.filter(item => item.kind === source.kind &&
        item.catalogItemId === source.catalogItemId && item.catalogSnapshotVersion === selectedVersion) ?? [];
      if (matches.length > 1) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const retained = matches[0];
      if (source.catalogSnapshotVersion !== selectedVersion && !retained) return { ok: false, error: partnerError('ROW_STALE') };
      if (retained && retained.unit !== source.unit) return technicalComponentFailure(source.kind, retained.name, 'UNIT');
      return { ok: true, value: retained ?? source };
    };
    const publicOperations: PartnerTechnicalOperation[] = [];
    const operationEvidence: Array<{ kind: 'TOOL' | 'FINISHING'; catalogItemId: string;
      catalogSnapshotVersion: string; rateCatalogSnapshotVersion: string; rateToman: string }> = [];
    for (const selected of uniqueCatalogReferences(selections.tools)) {
      const source = tools.find(item => item.id === selected.catalogItemId)!;
      if (!source.isActive) return technicalComponentFailure('TOOL', source.namePersian, 'INACTIVE');
      if (!source.pricePerMeter || source.pricePerMeter.isNegative()) return technicalComponentFailure('TOOL', source.namePersian, 'RATE');
      if (!['length', 'squareMeters'].includes(source.calculationBase)) return technicalComponentFailure('TOOL', source.namePersian, 'UNIT');
      const projected = projectPartnerTechnicalOperation({ ...source, kind: 'TOOL' });
      if (!projected.ok) return projected;
      const selectedOperation = publicOperation(projected.value, selected.catalogSnapshotVersion);
      if (!selectedOperation.ok) return selectedOperation;
      publicOperations.push(selectedOperation.value);
      operationEvidence.push({ kind: 'TOOL', catalogItemId: source.id, catalogSnapshotVersion: selected.catalogSnapshotVersion,
        rateCatalogSnapshotVersion: source.updatedAt.toISOString(), rateToman: source.pricePerMeter.toString() });
    }
    for (const selected of uniqueCatalogReferences(selections.finishings)) {
      const source = finishings.find(item => item.id === selected.catalogItemId)!;
      if (!source.isActive) return technicalComponentFailure('FINISHING', source.namePersian, 'INACTIVE');
      const rate = source.unitPrice?.isZero() ? source.pricePerSquareMeter : source.unitPrice;
      if (!rate || rate.isNegative()) return technicalComponentFailure('FINISHING', source.namePersian, 'RATE');
      if (!['length', 'squareMeters'].includes(source.calculationBase)) return technicalComponentFailure('FINISHING', source.namePersian, 'UNIT');
      const projected = projectPartnerTechnicalOperation({ ...source, kind: 'FINISHING', incompatibleCatalogItemIds: [] });
      if (!projected.ok) return projected;
      const selectedOperation = publicOperation(projected.value, selected.catalogSnapshotVersion);
      if (!selectedOperation.ok) return selectedOperation;
      publicOperations.push(selectedOperation.value);
      operationEvidence.push({ kind: 'FINISHING', catalogItemId: source.id, catalogSnapshotVersion: selected.catalogSnapshotVersion,
        rateCatalogSnapshotVersion: source.updatedAt.toISOString(), rateToman: rate.toString() });
    }
    const layerEvidence: Array<{ catalogItemId: string; catalogSnapshotVersion: string; rateCatalogSnapshotVersion: string; layerRateToman: string;
      longitudinalCutRateToman: string; crossCutRateToman: string; calibrationCutRateToman: string }> = [];
    for (const selected of uniqueCatalogReferences(selections.layers)) {
      const source = layers.find(item => item.id === selected.catalogItemId)!;
      if (!source.isActive) return technicalComponentFailure('LAYER', source.name, 'INACTIVE');
      if (!source.pricePerLayer || source.pricePerLayer.lte(0)) return technicalComponentFailure('LAYER', source.name, 'RATE');
      if (!['set', 'physicalPiece', 'meter', 'squareMeter'].includes(source.calculationUnit)) return technicalComponentFailure('LAYER', source.name, 'UNIT');
      const projected = projectPartnerTechnicalOperation({ ...source, kind: 'LAYER' });
      if (!projected.ok) return projected;
      const selectedOperation = publicOperation(projected.value, selected.catalogSnapshotVersion);
      if (!selectedOperation.ok) return selectedOperation;
      publicOperations.push(selectedOperation.value);
      layerEvidence.push({ catalogItemId: source.id, catalogSnapshotVersion: selected.catalogSnapshotVersion,
        rateCatalogSnapshotVersion: source.updatedAt.toISOString(),
        layerRateToman: source.pricePerLayer.toString(), longitudinalCutRateToman: policy.value.rates.longitudinalCutRateToman,
        crossCutRateToman: policy.value.rates.crossCutRateToman, calibrationCutRateToman: policy.value.rates.calibrationCutRateToman });
    }
    // The catalog snapshot still describes the selected physical product. New
    // system rates carry their own current source version in the private context.
    const selectedProducts = references.map(reference => ({
      ...products.find(source => source.id === reference.catalogItemId)!, updatedAt: new Date(reference.catalogSnapshotVersion) }));
    const context = createContext(currentPolicy, publicProducts, publicOperations, selectedProducts, operationEvidence, layerEvidence, input.draft);
    context.products = context.products.map(current => {
      const old = previousContext?.products?.find(item => item.catalogItemId === current.catalogItemId &&
        item.catalogSnapshotVersion === current.catalogSnapshotVersion);
      if (!old) return current;
      // Material agreements are independent from system ancillary rates.
      return { ...current, layerMaterialRateToman: old.layerMaterialRateToman,
        preparedRates: current.preparedRates?.map(rate => ({ ...rate, rateToman: old.preparedRates?.find(item =>
          item.kind === rate.kind && item.unit === rate.unit)?.rateToman ?? rate.rateToman })),
        longitudinal: current.longitudinal && { ...current.longitudinal, baseRateToman: old.longitudinal?.baseRateToman ?? current.longitudinal.baseRateToman },
        stair: current.stair && { ...current.stair, baseRateToman: old.stair?.baseRateToman ?? current.stair.baseRateToman },
        slab: current.slab && { ...current.slab, baseMaterialRateToman: old.slab?.baseMaterialRateToman ?? current.slab.baseMaterialRateToman } };
    });
    const identities: Array<{ productRowId: string; identity: InquiryIdentity }> = [];
    for (const row of identityRows) {
      const prior = input.previous?.identities.find(item => item.productRowId === row.productRowId);
      const configurationHash = await row.hash;
      if (prior?.identity.configuration.some(item => item.key === 'pricingSubjectHash' && item.value === configurationHash)) {
        identities.push(prior);
        continue;
      }
      const product = products.find(item => item.id === row.catalogItemId)!;
      const privateProductEvidence = context.products.find(item => item.catalogItemId === row.catalogItemId &&
        item.catalogSnapshotVersion === row.catalogSnapshotVersion);
      if (!privateProductEvidence) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const materialRateHash = await canonicalHash({ schemaVersion: 2, pricingSubject: 'MAIN_CATALOG_STONE',
        productId: product.id, family: row.family, unit: row.unit, currency: currentPolicy.currency });
      const identity = InquiryIdentitySchema.safeParse({ schemaVersion: 1, partnerSellerId: input.actorId,
        catalogProductId: row.catalogItemId, family: row.family, unit: row.unit,
        configuration: [{ key: 'pricingSubjectHash', value: configurationHash }],
        materialRateEvidenceId: `catalog-product:${product.id}`, materialRateHash,
        components: [], currency: currentPolicy.currency,
        calculationPolicyVersion: 'partner-main-stone-rate-v2',
        roundingPolicyVersion: 'partner-main-stone-rate-v2' });
      if (!identity.success) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      identities.push({ productRowId: row.productRowId, identity: identity.data });
    }
    return { ok: true, value: { context, identities } };
  };
}

function createContext(policy: PartnerTechnicalSalesPolicy, publicProducts: PartnerTechnicalProduct[],
  publicOperations: PartnerTechnicalOperation[], products: Array<{ id: string; updatedAt: Date; basePrice: Prisma.Decimal | null; currency: string }>,
  operations: Array<{ kind: 'TOOL' | 'FINISHING'; catalogItemId: string; catalogSnapshotVersion: string; rateCatalogSnapshotVersion: string; rateToman: string }>,
  layers: Array<{ catalogItemId: string; catalogSnapshotVersion: string; rateCatalogSnapshotVersion: string; layerRateToman: string;
    longitudinalCutRateToman: string; crossCutRateToman: string; calibrationCutRateToman: string }>, draft: PartnerTechnicalDraft): PartnerTechnicalGraphContext {
  const amount = (value: string) => parseCanonicalDecimal(value);
  // The canonical product graph retains the last positive mandatory percentage
  // even while mandatory cutting is disabled. Older activation policies used
  // zero to mean "disabled" and therefore need a harmless remembered default;
  // this does not enable or price a mandatory cut.
  const rememberedMandatoryPercentage = !policy.mandatoryEnabled && new Prisma.Decimal(policy.mandatoryPercentage).isZero()
    ? '20' : policy.mandatoryPercentage;
  return { technicalPolicy: policy,
    catalog: { products: publicProducts, operations: publicOperations, sawKerfMeters: policy.sawKerfMeters },
    policy: policy.calculationPolicy,
    products: products.map(product => {
      const entered = enteredMaterialPrice(draft, product.id);
      const rate = product.basePrice === null
        ? parseCanonicalDecimal(new Prisma.Decimal(entered!.amount).div(entered!.currency === 'IRR' ? 10 : 1).toFixed())
        : catalogMaterialRateToman(product.basePrice, product.currency);
      const preparedRates = [...new Map(draft.rows.flatMap(row => (row.family === 'prepared' || row.family === 'volumetric') && row.catalogItemId === product.id
        ? [[`${row.configuration.kind}:${row.configuration.unit}`, { kind: row.configuration.kind, unit: row.configuration.unit, rateToman: rate }] as const] : [])).values()];
      return { catalogItemId: product.id, catalogSnapshotVersion: product.updatedAt.toISOString(), layerMaterialRateToman: rate,
        preparedRates: preparedRates.map(item => ({ ...item, rateToman: amount(item.rateToman) })),
        longitudinal: { baseRateToman: amount(rate), mandatoryEnabled: policy.mandatoryEnabled,
          mandatoryPercentage: amount(rememberedMandatoryPercentage), rememberedMandatoryPercentage: amount(rememberedMandatoryPercentage),
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman), calibrationCutRateToman: amount(policy.rates.calibrationCutRateToman) },
        slab: { baseMaterialRateToman: amount(rate), cuttingPricingMethod: policy.slabCuttingPricingMethod,
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman), crossCutRateToman: amount(policy.rates.crossCutRateToman),
          ...(policy.rates.squareMeterCutRateToman === undefined ? {} : { squareMeterCutRateToman: amount(policy.rates.squareMeterCutRateToman) }),
          ...(policy.rates.verticalCutRateToman === undefined ? {} : { verticalCutRateToman: amount(policy.rates.verticalCutRateToman) }) },
        stair: { baseRateToman: amount(rate), mandatoryEnabled: policy.mandatoryEnabled,
          mandatoryPercentage: amount(rememberedMandatoryPercentage), rememberedMandatoryPercentage: amount(rememberedMandatoryPercentage),
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman), crossCutRateToman: amount(policy.rates.crossCutRateToman),
          calibrationCutRateToman: amount(policy.rates.calibrationCutRateToman) },
        remainder: { mandatoryPercentage: amount(rememberedMandatoryPercentage), rememberedMandatoryPercentage: amount(rememberedMandatoryPercentage),
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman), crossCutRateToman: amount(policy.rates.crossCutRateToman),
          calibrationCutRateToman: amount(policy.rates.calibrationCutRateToman) } };
    }), operations: operations.map(item => ({ ...item, rateToman: amount(item.rateToman) })),
    layers: layers.map(item => ({ ...item, layerRateToman: amount(item.layerRateToman),
      longitudinalCutRateToman: amount(item.longitudinalCutRateToman), crossCutRateToman: amount(item.crossCutRateToman),
      calibrationCutRateToman: amount(item.calibrationCutRateToman) })) };
}
