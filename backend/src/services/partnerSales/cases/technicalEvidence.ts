import { Prisma, type PrismaClient } from '@prisma/client';
import { parseCanonicalDecimal, type CalculationPolicySnapshot } from '@sabalanerp/contract-product-graph';
import { canonicalHash, InquiryIdentitySchema, partnerError, type InquiryIdentity,
  type PartnerTechnicalDraft, type PartnerTechnicalOperation, type PartnerTechnicalProduct, type Result } from '@sabalanerp/partner-sales-contracts';
import { projectPartnerTechnicalOperation, projectPartnerTechnicalProduct } from '../crm/technicalCatalog';
import type { PartnerTechnicalSaveDependencies } from './technicalSave';
import type { PartnerTechnicalGraphContext } from './technicalGraph';

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
    verticalCutRateToman: string;
    squareMeterCutRateToman: string;
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
      !exactKeys(rates, rateKeys) || terms.schemaVersion !== 1 || terms.purpose !== 'PARTNER_TECHNICAL_PRICING' ||
      terms.currency !== 'IRT' || typeof terms.mandatoryEnabled !== 'boolean' ||
      !['lineBased', 'squareMeter'].includes(String(terms.slabCuttingPricingMethod)) ||
      !versionKeys.every(key => typeof calculationPolicy[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(calculationPolicy[key] as string))) {
    return undefined;
  }
  const mandatoryPercentage = decimal(terms.mandatoryPercentage), sawKerfMeters = decimal(terms.sawKerfMeters),
    materialRateScale = decimal(terms.materialRateScale, true);
  const parsedRates = Object.fromEntries(rateKeys.map(key => [key, decimal(rates[key])])) as Record<typeof rateKeys[number], string | undefined>;
  if (mandatoryPercentage === undefined || new Prisma.Decimal(mandatoryPercentage).gt(100) || sawKerfMeters === undefined ||
      materialRateScale === undefined || rateKeys.some(key => parsedRates[key] === undefined)) return undefined;
  return {
    policyId: identity.id, version: identity.version,
    effectiveDate: typeof identity.effectiveDate === 'string' ? identity.effectiveDate : identity.effectiveDate.toISOString().slice(0, 10),
    integrityHash: identity.integrityHash,
    calculationPolicy: calculationPolicy as unknown as CalculationPolicySnapshot,
    mandatoryPercentage, mandatoryEnabled: terms.mandatoryEnabled,
    slabCuttingPricingMethod: terms.slabCuttingPricingMethod as SlabCuttingPricingMethod,
    sawKerfMeters, materialRateScale, currency: 'IRT',
    rates: parsedRates as PartnerTechnicalSalesPolicy['rates'],
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
    const expectedHash = await canonicalHash({ accountId: candidate.accountId, version: candidate.version,
      effectiveDate: candidate.effectiveDate.toISOString().slice(0, 10), terms: candidate.terms,
      actorId: candidate.actorId, reason: candidate.reason });
    if (candidate.integrityHash !== expectedHash) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const policy = parsePartnerTechnicalSalesPolicySnapshot(candidate.terms, candidate);
    return policy ? { ok: true, value: { policy, accountVersion } } : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  return { ok: false, error: partnerError('STATE_CONFLICT') };
}

/** Approval identity ignores requested quantity and display-only editing
 * preferences. Geometry, sources, technical operations and pricing-affecting
 * overrides remain part of the identity. */
export async function technicalConfigurationHash(row: PartnerTechnicalDraft['rows'][number]): Promise<string> {
  const value = JSON.parse(JSON.stringify(row)) as Record<string, any>;
  const configuration = value.configuration as Record<string, any>;
  delete configuration.quantity;
  delete configuration.quantityMode;
  delete configuration.lastManualField;
  delete configuration.lastManualDimension;
  delete configuration.lengthDisplayUnit;
  delete configuration.widthDisplayUnit;
  delete configuration.crossDimensionDisplayUnit;
  delete configuration.motherLengthDisplayUnit;
  return canonicalHash(value);
}

async function technicalDraftRowConfigurationHash(row: PartnerTechnicalDraft['rows'][number], draft: PartnerTechnicalDraft) {
  const rowHash = await technicalConfigurationHash(row);
  const layers = (draft.dependents ?? []).filter(dependent => dependent.kind === 'layer' && dependent.parentProductRowId === row.productRowId);
  return layers.length ? canonicalHash({ rowHash, layers }) : rowHash;
}

export type PartnerTechnicalDatabase = Pick<PrismaClient, '$transaction'>;

const scaled = (value: Prisma.Decimal.Value, scale: string): string =>
  parseCanonicalDecimal(new Prisma.Decimal(value).mul(scale).toFixed());

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

function productReferences(draft: PartnerTechnicalDraft): Array<{ catalogItemId: string; catalogSnapshotVersion: string }> {
  const values = [...draft.rows, ...(draft.dependents ?? []).flatMap(dependent => {
    if (dependent.kind === 'remainder') return [{ catalogItemId: dependent.catalogItemId,
      catalogSnapshotVersion: dependent.catalogSnapshotVersion }];
    return dependent.source && dependent.source.kind !== 'paid-remainder'
      ? [{ catalogItemId: dependent.source.catalogItemId, catalogSnapshotVersion: dependent.source.catalogSnapshotVersion }]
      : [];
  })];
  const unique = new Map(values.map(value => [`${value.catalogItemId}\0${value.catalogSnapshotVersion}`, value]));
  return [...unique.values()];
}

function identityUnit(row: PartnerTechnicalDraft['rows'][number] | Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'remainder' }>)
  : InquiryIdentity['unit'] {
  if (!('family' in row)) return 'meter';
  if (row.family === 'prepared' || row.family === 'volumetric') return row.configuration.unit;
  if (row.family === 'slab') return 'squareMeter';
  if (row.family === 'stair') return 'count';
  return 'meter';
}

async function dependentConfigurationHash(row: Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'remainder' }>) {
  const value = JSON.parse(JSON.stringify(row)) as Record<string, any>;
  delete value.quantity;
  delete value.lengthDisplayUnit;
  delete value.widthDisplayUnit;
  return canonicalHash(value);
}

/** Real private evidence producer. Every source revision must equal the public
 * technical snapshot selected by the draft. Rates and policy never cross the
 * save interface. */
export function createPartnerTechnicalEvidenceResolver(): PartnerTechnicalSaveDependencies['resolveEvidence'] {
  return async (tx, input) => {
    const policy = await readPartnerTechnicalSalesPolicy(tx, input.actorId);
    if (!policy.ok) return policy;
    const previousContext = input.previous?.context as Partial<PartnerTechnicalGraphContext> | undefined;
    const priorPolicy = previousContext?.technicalPolicy;
    const parsedPriorPolicy = priorPolicy && parsePartnerTechnicalSalesPolicySnapshot({
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_PRICING', calculationPolicy: priorPolicy.calculationPolicy,
      mandatoryPercentage: priorPolicy.mandatoryPercentage, mandatoryEnabled: priorPolicy.mandatoryEnabled,
      slabCuttingPricingMethod: priorPolicy.slabCuttingPricingMethod, sawKerfMeters: priorPolicy.sawKerfMeters,
      materialRateScale: priorPolicy.materialRateScale, currency: priorPolicy.currency, rates: priorPolicy.rates,
    }, { id: priorPolicy.policyId, version: priorPolicy.version,
      effectiveDate: priorPolicy.effectiveDate, integrityHash: priorPolicy.integrityHash });
    const frozenPolicy = parsedPriorPolicy ?? policy.value;
    const references = productReferences(input.draft);
    const products = await tx.product.findMany({ where: { id: { in: references.map(item => item.catalogItemId) } },
      select: { id: true, code: true, namePersian: true, updatedAt: true, widthValue: true, motherLengthValue: true,
        thicknessValue: true, stoneTypeNamePersian: true, mineNamePersian: true, finishNamePersian: true,
        colorNamePersian: true, qualityNamePersian: true, cuttingDimensionNamePersian: true, isActive: true,
        deletedAt: true, isAvailable: true, availableInLongitudinalContracts: true, availableInStairContracts: true,
        availableInSlabContracts: true, availableInVolumetricContracts: true, basePrice: true, currency: true } });
    if (products.length !== references.length) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const publicProducts: PartnerTechnicalProduct[] = [];
    for (const source of products) {
      const reference = references.find(item => item.catalogItemId === source.id);
      if (!reference || source.updatedAt.toISOString() !== reference.catalogSnapshotVersion || source.basePrice === null) {
        return { ok: false, error: partnerError('ROW_STALE') };
      }
      const projected = projectPartnerTechnicalProduct(source);
      if (!projected.ok) return projected;
      publicProducts.push(projected.value);
    }
    const selections = operationsFromDraft(input.draft);
    const toolIds = [...new Set(selections.tools.map(item => item.catalogItemId))];
    const finishingIds = [...new Set(selections.finishings.map(item => item.catalogItemId))];
    const layerIds = [...new Set(selections.layers.map(item => item.catalogItemId))];
    const [tools, finishings, layers] = await Promise.all([
      tx.subService.findMany({ where: { id: { in: toolIds } }, select: { id: true, updatedAt: true, isActive: true,
        namePersian: true, calculationBase: true, pricePerMeter: true } }),
      tx.stoneFinishing.findMany({ where: { id: { in: finishingIds } }, select: { id: true, updatedAt: true,
        isActive: true, namePersian: true, calculationBase: true, pricePerSquareMeter: true, unitPrice: true } }),
      tx.layerType.findMany({ where: { id: { in: layerIds } }, select: { id: true, updatedAt: true, isActive: true,
        name: true, calculationUnit: true, pricePerLayer: true } }),
    ]);
    if (tools.length !== toolIds.length || finishings.length !== finishingIds.length || layers.length !== layerIds.length) {
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
    const publicOperations: PartnerTechnicalOperation[] = [];
    const operationEvidence: Array<{ kind: 'TOOL' | 'FINISHING'; catalogItemId: string;
      catalogSnapshotVersion: string; rateToman: string }> = [];
    for (const source of tools) {
      const selected = selections.tools.find(item => item.catalogItemId === source.id);
      if (!selected || source.updatedAt.toISOString() !== selected.catalogSnapshotVersion) return { ok: false, error: partnerError('ROW_STALE') };
      const projected = projectPartnerTechnicalOperation({ ...source, kind: 'TOOL' });
      if (!projected.ok) return projected;
      publicOperations.push(projected.value);
      operationEvidence.push({ kind: 'TOOL', catalogItemId: source.id, catalogSnapshotVersion: source.updatedAt.toISOString(), rateToman: source.pricePerMeter.toString() });
    }
    for (const source of finishings) {
      const selected = selections.finishings.find(item => item.catalogItemId === source.id);
      if (!selected || source.updatedAt.toISOString() !== selected.catalogSnapshotVersion) return { ok: false, error: partnerError('ROW_STALE') };
      const projected = projectPartnerTechnicalOperation({ ...source, kind: 'FINISHING', incompatibleCatalogItemIds: [] });
      if (!projected.ok) return projected;
      publicOperations.push(projected.value);
      operationEvidence.push({ kind: 'FINISHING', catalogItemId: source.id, catalogSnapshotVersion: source.updatedAt.toISOString(),
        rateToman: (source.unitPrice.isZero() ? source.pricePerSquareMeter : source.unitPrice).toString() });
    }
    const layerEvidence: Array<{ catalogItemId: string; catalogSnapshotVersion: string; layerRateToman: string;
      longitudinalCutRateToman: string; crossCutRateToman: string; calibrationCutRateToman: string }> = [];
    for (const source of layers) {
      const selected = selections.layers.find(item => item.catalogItemId === source.id);
      if (!selected || source.updatedAt.toISOString() !== selected.catalogSnapshotVersion) return { ok: false, error: partnerError('ROW_STALE') };
      const projected = projectPartnerTechnicalOperation({ ...source, kind: 'LAYER' });
      if (!projected.ok) return projected;
      publicOperations.push(projected.value);
      layerEvidence.push({ catalogItemId: source.id, catalogSnapshotVersion: source.updatedAt.toISOString(),
        layerRateToman: source.pricePerLayer.toString(), longitudinalCutRateToman: policy.value.rates.longitudinalCutRateToman,
        crossCutRateToman: policy.value.rates.crossCutRateToman, calibrationCutRateToman: policy.value.rates.calibrationCutRateToman });
    }
    const context = createContext(frozenPolicy, publicProducts, publicOperations, products, operationEvidence, layerEvidence, input.draft);
    if (previousContext?.products && Array.isArray(previousContext.products)) context.products = context.products.map(current =>
      previousContext.products!.find(previous => previous.catalogItemId === current.catalogItemId &&
        previous.catalogSnapshotVersion === current.catalogSnapshotVersion) ?? current);
    if (previousContext?.operations && Array.isArray(previousContext.operations)) context.operations = (context.operations ?? []).map(current =>
      previousContext.operations!.find(previous => previous.kind === current.kind && previous.catalogItemId === current.catalogItemId &&
        previous.catalogSnapshotVersion === current.catalogSnapshotVersion) ?? current);
    if (previousContext?.layers && Array.isArray(previousContext.layers)) context.layers = (context.layers ?? []).map(current =>
      previousContext.layers!.find(previous => previous.catalogItemId === current.catalogItemId &&
        previous.catalogSnapshotVersion === current.catalogSnapshotVersion) ?? current);
    const identityRows = [
      ...input.draft.rows.map(row => ({ productRowId: row.productRowId, catalogItemId: row.catalogItemId,
        family: row.family, unit: identityUnit(row), hash: technicalDraftRowConfigurationHash(row, input.draft) })),
      ...(input.draft.dependents ?? []).filter((item): item is Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'remainder' }> => item.kind === 'remainder')
        .map(row => ({ productRowId: row.productRowId, catalogItemId: row.catalogItemId,
          family: 'longitudinal' as const, unit: identityUnit(row), hash: dependentConfigurationHash(row) })),
    ];
    const identities: Array<{ productRowId: string; identity: InquiryIdentity }> = [];
    for (const row of identityRows) {
      const prior = input.previous?.identities.find(item => item.productRowId === row.productRowId);
      const configurationHash = await row.hash;
      if (prior?.identity.configuration.some(item => item.key === 'technicalConfigurationHash' && item.value === configurationHash)) {
        identities.push(prior);
        continue;
      }
      const product = products.find(item => item.id === row.catalogItemId)!;
      const privateProductEvidence = context.products.find(item => item.catalogItemId === row.catalogItemId &&
        item.catalogSnapshotVersion === product.updatedAt.toISOString());
      if (!privateProductEvidence) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const materialRateHash = await canonicalHash({ policyId: frozenPolicy.policyId, productId: product.id,
        productRevision: product.updatedAt.toISOString(), evidence: privateProductEvidence, currency: frozenPolicy.currency });
      const { policyId: _policyIdentity, ...policySnapshot } = frozenPolicy;
      const rowIntent = input.draft.rows.find(item => item.productRowId === row.productRowId);
      const remainderIntent = (input.draft.dependents ?? []).find(item => item.kind === 'remainder' && item.productRowId === row.productRowId);
      const ownOperations = rowIntent && 'operations' in rowIntent ? rowIntent.operations : remainderIntent?.kind === 'remainder' ? remainderIntent.operations : undefined;
      const attachedLayers = (input.draft.dependents ?? []).filter((item): item is Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'layer' }> =>
        item.kind === 'layer' && item.parentProductRowId === row.productRowId);
      const selectedOperationIds = new Set([
        ...(ownOperations?.tools.map(item => `TOOL\0${item.catalogItemId}`) ?? []),
        ...(ownOperations?.finishings.map(item => `FINISHING\0${item.catalogItemId}`) ?? []),
        ...attachedLayers.flatMap(layer => (layer.sideOperations ?? []).flatMap(side => [
          ...side.operations.tools.map(item => `TOOL\0${item.catalogItemId}`),
          ...side.operations.finishings.map(item => `FINISHING\0${item.catalogItemId}`),
        ])),
      ]);
      const privateComponents = {
        operations: (context.operations ?? []).filter(item => selectedOperationIds.has(`${item.kind}\0${item.catalogItemId}`)),
        layers: (context.layers ?? []).filter(item => attachedLayers.some(layer => layer.catalogItemId === item.catalogItemId &&
          layer.catalogSnapshotVersion === item.catalogSnapshotVersion)),
        layerMaterials: context.products.filter(item => attachedLayers.some(layer => layer.source && layer.source.kind !== 'paid-remainder' &&
          layer.source.catalogItemId === item.catalogItemId && layer.source.catalogSnapshotVersion === item.catalogSnapshotVersion)),
      };
      const components = [{ componentId: `technical-policy:${frozenPolicy.policyId}`,
        evidenceHash: await canonicalHash(policySnapshot) },
      ...(privateComponents.operations.length || privateComponents.layers.length || privateComponents.layerMaterials.length
        ? [{ componentId: `technical-components:${row.productRowId}`, evidenceHash: canonicalHash(privateComponents) }] : [])];
      const resolvedComponents: Array<{ componentId: string; evidenceHash: string }> = [];
      for (const component of components) resolvedComponents.push({ componentId: component.componentId,
        evidenceHash: typeof component.evidenceHash === 'string' ? component.evidenceHash : await component.evidenceHash });
      const identity = InquiryIdentitySchema.safeParse({ schemaVersion: 1, partnerSellerId: input.actorId,
        catalogProductId: row.catalogItemId, family: row.family, unit: row.unit,
        configuration: [{ key: 'technicalConfigurationHash', value: configurationHash }],
        materialRateEvidenceId: `partner-terms:${frozenPolicy.policyId}:${product.id}`, materialRateHash,
        components: resolvedComponents, currency: frozenPolicy.currency,
        calculationPolicyVersion: frozenPolicy.calculationPolicy.calculation,
        roundingPolicyVersion: frozenPolicy.calculationPolicy.rounding });
      if (!identity.success) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      identities.push({ productRowId: row.productRowId, identity: identity.data });
    }
    return { ok: true, value: { context, identities } };
  };
}

function createContext(policy: PartnerTechnicalSalesPolicy, publicProducts: PartnerTechnicalProduct[],
  publicOperations: PartnerTechnicalOperation[], products: Array<{ id: string; updatedAt: Date; basePrice: Prisma.Decimal | null }>,
  operations: Array<{ kind: 'TOOL' | 'FINISHING'; catalogItemId: string; catalogSnapshotVersion: string; rateToman: string }>,
  layers: Array<{ catalogItemId: string; catalogSnapshotVersion: string; layerRateToman: string;
    longitudinalCutRateToman: string; crossCutRateToman: string; calibrationCutRateToman: string }>, draft: PartnerTechnicalDraft): PartnerTechnicalGraphContext {
  const amount = (value: string) => parseCanonicalDecimal(value);
  return { technicalPolicy: policy,
    catalog: { products: publicProducts, operations: publicOperations, sawKerfMeters: policy.sawKerfMeters },
    policy: policy.calculationPolicy,
    products: products.map(product => {
      const rate = scaled(product.basePrice!, policy.materialRateScale);
      const preparedRates = draft.rows.flatMap(row => (row.family === 'prepared' || row.family === 'volumetric') && row.catalogItemId === product.id
        ? [{ kind: row.configuration.kind, unit: row.configuration.unit, rateToman: rate }] : []);
      return { catalogItemId: product.id, catalogSnapshotVersion: product.updatedAt.toISOString(), layerMaterialRateToman: rate,
        preparedRates: preparedRates.map(item => ({ ...item, rateToman: amount(item.rateToman) })),
        longitudinal: { baseRateToman: amount(rate), mandatoryEnabled: policy.mandatoryEnabled,
          mandatoryPercentage: amount(policy.mandatoryPercentage), rememberedMandatoryPercentage: amount(policy.mandatoryPercentage),
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman), calibrationCutRateToman: amount(policy.rates.calibrationCutRateToman) },
        slab: { baseMaterialRateToman: amount(rate), cuttingPricingMethod: policy.slabCuttingPricingMethod,
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman), crossCutRateToman: amount(policy.rates.crossCutRateToman),
          squareMeterCutRateToman: amount(policy.rates.squareMeterCutRateToman), verticalCutRateToman: amount(policy.rates.verticalCutRateToman) },
        stair: { baseRateToman: amount(rate), mandatoryEnabled: policy.mandatoryEnabled,
          mandatoryPercentage: amount(policy.mandatoryPercentage), rememberedMandatoryPercentage: amount(policy.mandatoryPercentage),
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman), crossCutRateToman: amount(policy.rates.crossCutRateToman),
          calibrationCutRateToman: amount(policy.rates.calibrationCutRateToman) },
        remainder: { mandatoryPercentage: amount(policy.mandatoryPercentage), rememberedMandatoryPercentage: amount(policy.mandatoryPercentage),
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman), crossCutRateToman: amount(policy.rates.crossCutRateToman),
          calibrationCutRateToman: amount(policy.rates.calibrationCutRateToman) } };
    }), operations: operations.map(item => ({ ...item, rateToman: amount(item.rateToman) })),
    layers: layers.map(item => ({ ...item, layerRateToman: amount(item.layerRateToman),
      longitudinalCutRateToman: amount(item.longitudinalCutRateToman), crossCutRateToman: amount(item.crossCutRateToman),
      calibrationCutRateToman: amount(item.calibrationCutRateToman) })) };
}
