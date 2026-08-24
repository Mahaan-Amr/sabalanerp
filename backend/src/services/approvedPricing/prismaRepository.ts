import {
  ApprovedPricingVersionOrigin,
  Prisma,
} from '@prisma/client';
import {
  parseCanonicalProductGraph,
  projectCanonicalProductGraph,
} from '@sabalanerp/contract-product-graph';
import {
  canonicalOptimizerDerivedLengthWitness,
  optimizerQuantityPolicyProvenanceFromAudit,
} from '../optimizerDerivedQuantityEvidence';
import { sanitizeContractDataCustomerSnapshot } from '../contractSnapshotBoundary';
import type {
  ApprovalLeaf,
  ApprovedPricingPersistenceContext,
  ApprovedPricingRepository,
  ApprovedPricingSource,
  ApprovedPricingVersionInsert,
  ApprovedPricingVersionRecord,
} from './types';
import { createHash } from 'node:crypto';
import { ApprovedPricingEvidenceError } from './evidenceError';

// Deliberate validation failures in this evidence adapter are typed; Prisma/runtime failures are not intercepted.

const pricingVersionInclude = { rows: { orderBy: { ordinal: 'asc' as const } } };
const stableAudit = (value: unknown): unknown => Array.isArray(value) ? value.map(stableAudit)
  : value instanceof Date ? value.toISOString()
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableAudit(item)])) : value;
export const approvedPricingLifecycleAuditHash = (input: { aggregateType: 'APPROVED_PRICING_VERSION'; aggregateId: string;
  eventType: 'APPROVED_PRICING_VERSION_CREATED'; payload: unknown; actorId: string; recordedAt: Date; previousHash: string | null }) =>
  createHash('sha256').update(JSON.stringify(stableAudit(input))).digest('hex');
const canonicalEvidenceHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(stableAudit(value))).digest('hex');
export const financialCommercialSnapshotMatches = (input: {
  snapshot: Record<string, any>;
  current: { customerId: string; currency: string; totalAmount: Prisma.Decimal | null; contractData: unknown };
}) => {
  if (String(input.snapshot.customerId ?? '') !== input.current.customerId ||
    String(input.snapshot.currency ?? '') !== input.current.currency ||
    canonicalEvidenceHash(sanitizeContractDataCustomerSnapshot(input.snapshot.contractData)) !==
      canonicalEvidenceHash(sanitizeContractDataCustomerSnapshot(input.current.contractData))) return false;
  const snapshotTotal = input.snapshot.totalAmount;
  if (snapshotTotal == null || input.current.totalAmount == null) return snapshotTotal == null && input.current.totalAmount == null;
  try { return new Prisma.Decimal(String(snapshotTotal)).eq(input.current.totalAmount); } catch { return false; }
};
export type ApprovedPricingAuditContext = { reason: string; correlationId: string; idempotencyKey: string;
  effectiveAuthority: { actorRole: string; workspace: string; workspacePermission: string; feature?: string; featurePermission?: string } };

type PersistedVersion = Prisma.ContractApprovedPricingVersionGetPayload<{ include: typeof pricingVersionInclude }>;

const jsonRecord = (value: Prisma.JsonValue): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApprovedPricingEvidenceError('Persisted approved pricing JSON evidence is invalid');
  return value as Readonly<Record<string, unknown>>;
};

type LeafRecord = Prisma.AccountingFinancialRecordGetPayload<{ include: { invoiceItems: true } }>;

type ContractItemIdentity = {
  id: string;
  productId: string;
  productRowId: string | null;
  productType: string | null;
};

export const rebindFrozenContractItemIdentities = (input: {
  snapshotItems: readonly ContractItemIdentity[];
  liveItems: readonly ContractItemIdentity[];
  invoiceItems: readonly { id: string; contractItemId: string | null }[];
}) => {
  const liveById = new Map(input.liveItems.map(item => [item.id, item]));
  const liveByProductRowId = new Map<string, ContractItemIdentity>();
  for (const item of input.liveItems) {
    if (!item.productRowId) continue;
    if (liveByProductRowId.has(item.productRowId)) {
      throw new ApprovedPricingEvidenceError(`Live contract product row ${item.productRowId} is duplicated`);
    }
    liveByProductRowId.set(item.productRowId, item);
  }
  const invoiceByContractItemId = new Map<string, { id: string; contractItemId: string | null }>();
  for (const item of input.invoiceItems) {
    if (item.contractItemId) invoiceByContractItemId.set(item.contractItemId, item);
  }
  const rebindings: Array<{
    sourceContractItemId: string;
    linkedContractItemId: string;
    invoiceItemId: string;
    productRowId: string;
    rule: 'FROZEN_STABLE_PRODUCT_ROW_LIVE_ITEM_REBINDING_V1';
  }> = [];
  const idMap = new Map<string, string>();
  for (const snapshotItem of input.snapshotItems) {
    if (liveById.has(snapshotItem.id)) continue;
    if (!snapshotItem.productRowId) {
      throw new ApprovedPricingEvidenceError(`Frozen contract item ${snapshotItem.id} has no stable product row identity`);
    }
    const liveItem = liveByProductRowId.get(snapshotItem.productRowId);
    const invoiceItem = invoiceByContractItemId.get(snapshotItem.id);
    if (!liveItem || !invoiceItem || liveItem.productId !== snapshotItem.productId ||
      liveItem.productType !== snapshotItem.productType) {
      throw new ApprovedPricingEvidenceError(`Frozen contract item ${snapshotItem.id} cannot bind to a live stable product row`);
    }
    idMap.set(snapshotItem.id, liveItem.id);
    rebindings.push({
      sourceContractItemId: snapshotItem.id,
      linkedContractItemId: liveItem.id,
      invoiceItemId: invoiceItem.id,
      productRowId: snapshotItem.productRowId,
      rule: 'FROZEN_STABLE_PRODUCT_ROW_LIVE_ITEM_REBINDING_V1',
    });
  }
  return { idMap, rebindings };
};

const mapLeaf = (leaf: LeafRecord): ApprovalLeaf => ({
  id: leaf.id,
  contractId: leaf.contractId,
  kind: leaf.kind,
  status: leaf.status,
  financiallyApprovedAt: leaf.financiallyApprovedAt,
  financiallyApprovedBy: leaf.financiallyApprovedBy,
  amount: leaf.amount.toString(),
  currency: leaf.currency,
  sourceId: leaf.sourceId,
  sourceSnapshot: leaf.sourceSnapshot,
  metadata: leaf.metadata,
  invoiceItems: leaf.invoiceItems.map(item => ({
    id: item.id,
    contractItemId: item.contractItemId,
    productId: item.productId,
    quantity: item.quantity.toString(),
    totalPrice: item.totalPrice.toString(),
  })),
});

const unknownRecord = (value: unknown, label: string): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApprovedPricingEvidenceError(`${label} is missing or null`);
  return value as Record<string, any>;
};

const optionalRecord = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;

type ProductGraphStateEvidence = {
  schemaVersion: number;
  revision: number;
  graph: unknown;
  inputHash: string;
  resultHash: string;
  totalAmountToman: unknown;
};

export const resolveFinancialApprovalGraphEvidence = (input: {
  snapshotGraphState: unknown;
  currentGraphState: ProductGraphStateEvidence | null;
  migrationAudit: { commandId: string; resultRevision: number; inputHash: string; resultHash: string; command: unknown } | null;
}) => {
  const snapshotState = optionalRecord(input.snapshotGraphState);
  if (snapshotState) return { graphState: snapshotState, compatibility: null };
  const current = input.currentGraphState;
  const auditCommand = optionalRecord(input.migrationAudit?.command);
  if (!current || !input.migrationAudit ||
    !['legacy-migration', 'canonical-wizard-save'].includes(String(auditCommand?.kind ?? '')) ||
    input.migrationAudit.resultRevision !== current.revision ||
    input.migrationAudit.inputHash !== current.inputHash ||
    input.migrationAudit.resultHash !== current.resultHash) {
    throw new ApprovedPricingEvidenceError('Invoice candidate canonical graph snapshot is missing and no matching deterministic legacy migration exists');
  }
  return {
    graphState: current as unknown as Record<string, any>,
    compatibility: {
      evidenceOrigin: auditCommand?.kind === 'legacy-migration'
        ? 'POST_SNAPSHOT_DETERMINISTIC_LEGACY_GRAPH_MIGRATION' as const
        : 'POST_SNAPSHOT_DETERMINISTIC_CANONICAL_GRAPH_BINDING' as const,
      migrationAuditCommandId: input.migrationAudit.commandId,
      snapshotOriginallyMissing: true as const,
    },
  };
};

export const bindLegacyRowsToMigratedGraph = (input: {
  contractData: unknown;
  snapshotItems: readonly Record<string, any>[];
  currentItems: readonly Record<string, any>[];
  graphRows: readonly { productRowId: string; catalogProductId: string }[];
}) => {
  const data = optionalRecord(input.contractData);
  const products = Array.isArray(data?.products) ? data.products.map(optionalRecord) : [];
  if (!data || products.some(product => !product) || products.length !== input.graphRows.length ||
    input.snapshotItems.length !== input.graphRows.length || input.currentItems.length !== input.graphRows.length) {
    throw new ApprovedPricingEvidenceError('Legacy row identity migration cannot reconcile product, item, and graph row counts');
  }
  const assignments = input.graphRows.map((graphRow, ordinal) => {
    const product = products[ordinal]!;
    const snapshotItem = input.snapshotItems[ordinal]!;
    const currentItem = input.currentItems[ordinal]!;
    const productId = String(product!.productId ?? product!.id ?? '');
    const rawProductRowId = product!.rowId ?? product!.productRowId;
    const rawSnapshotRowId = snapshotItem.productRowId;
    if (!graphRow.productRowId || !graphRow.catalogProductId ||
      productId !== graphRow.catalogProductId ||
      String(snapshotItem.productId ?? '') !== graphRow.catalogProductId ||
      String(currentItem.id ?? '') !== String(snapshotItem.id ?? '') ||
      String(currentItem.productId ?? '') !== graphRow.catalogProductId ||
      (rawProductRowId != null && String(rawProductRowId) !== '' && String(rawProductRowId) !== graphRow.productRowId) ||
      (rawSnapshotRowId != null && String(rawSnapshotRowId) !== '' && String(rawSnapshotRowId) !== graphRow.productRowId)) {
      throw new ApprovedPricingEvidenceError(`Legacy row ${ordinal + 1} does not match the deterministically migrated graph identity`);
    }
    return {
      contractItemId: String(snapshotItem.id ?? ''),
      productRowId: graphRow.productRowId,
      rawContractItemProductRowId: rawSnapshotRowId == null || String(rawSnapshotRowId) === '' ? null : String(rawSnapshotRowId),
      rawProductSnapshotRowId: rawProductRowId == null || String(rawProductRowId) === '' ? null : String(rawProductRowId),
      rule: 'MIGRATED_GRAPH_ORDINAL_PRODUCT_IDENTITY_V1' as const,
    };
  });
  return {
    contractData: {
      ...data,
      products: products.map((product, ordinal) => ({
        ...product!,
        rowId: input.graphRows[ordinal]!.productRowId,
        productRowId: input.graphRows[ordinal]!.productRowId,
      })),
    },
    snapshotItems: input.snapshotItems.map((item, ordinal) => ({
      ...item,
      productRowId: input.graphRows[ordinal]!.productRowId,
    })),
    currentItems: input.currentItems.map((item, ordinal) => ({
      ...item,
      productRowId: input.graphRows[ordinal]!.productRowId,
    })),
    assignments,
  };
};

export const bindFrozenRowsToPostSnapshotCanonicalGraph = (input: {
  contractData: unknown;
  snapshotItems: readonly Record<string, any>[];
  graphRows: readonly {
    productRowId: string;
    catalogProductId: string;
    productType: string;
    legacySnapshot: unknown;
  }[];
}) => {
  const data = optionalRecord(input.contractData);
  const products = Array.isArray(data?.products) ? data.products.map(optionalRecord) : [];
  if (!data || products.some(product => !product) || products.length !== input.snapshotItems.length ||
    input.snapshotItems.length !== input.graphRows.length) {
    throw new ApprovedPricingEvidenceError('Frozen row identity recovery cannot reconcile product, item, and graph row counts');
  }
  const usedRows = new Set<string>();
  const assignments = input.snapshotItems.map((item, ordinal) => {
    const product = products[ordinal]!;
    const productId = String(product.productId ?? product.id ?? '');
    const productType = String(product.productType ?? item.productType ?? '');
    const rawQuantity = productType === 'prepared'
      ? product.preparedQuantity ?? product.quantity
      : product.quantity;
    const rawTotal = product.totalPrice;
    const matches = input.graphRows.filter(row => {
      const legacy = optionalRecord(row.legacySnapshot);
      if (!legacy || usedRows.has(row.productRowId)) return false;
      try {
        return row.catalogProductId === productId && row.productType === productType &&
          String(item.productId ?? '') === productId &&
          new Prisma.Decimal(String(item.quantity ?? '')).eq(String(rawQuantity ?? '')) &&
          new Prisma.Decimal(String(item.totalPrice ?? '')).eq(String(rawTotal ?? '')) &&
          String(legacy.productId ?? optionalRecord(legacy.product)?.id ?? '') === productId &&
          String(legacy.productType ?? '') === productType &&
          new Prisma.Decimal(String(legacy.quantity ?? '')).eq(String(rawQuantity ?? '')) &&
          new Prisma.Decimal(String(legacy.totalPrice ?? '')).eq(String(rawTotal ?? ''));
      } catch {
        return false;
      }
    });
    if (matches.length !== 1) {
      throw new ApprovedPricingEvidenceError(`Frozen row ${ordinal + 1} has no unique canonical graph witness`);
    }
    const graphRow = matches[0]!;
    usedRows.add(graphRow.productRowId);
    return {
      contractItemId: String(item.id ?? ''),
      productRowId: graphRow.productRowId,
      rawContractItemProductRowId: item.productRowId == null ? null : String(item.productRowId),
      rawProductSnapshotRowId: product.rowId == null && product.productRowId == null
        ? null
        : String(product.rowId ?? product.productRowId),
      rule: 'FROZEN_ITEM_AND_PRODUCT_UNIQUE_COMMERCIAL_TUPLE_V1' as const,
    };
  });
  const assignmentByItem = new Map(assignments.map(assignment => [assignment.contractItemId, assignment]));
  return {
    contractData: {
      ...data,
      products: products.map((product, ordinal) => ({
        ...product!,
        rowId: assignments[ordinal]!.productRowId,
        productRowId: assignments[ordinal]!.productRowId,
      })),
    },
    snapshotItems: input.snapshotItems.map(item => ({
      ...item,
      productRowId: assignmentByItem.get(String(item.id ?? ''))!.productRowId,
    })),
    assignments,
  };
};

export const reconstructLegacyV1DiscountEligibility = (input: {
  contractData: unknown;
  graphRows: readonly { productRowId: string }[];
  layerConfigurationCount: number;
}) => {
  const data = optionalRecord(input.contractData);
  const products = Array.isArray(data?.products) ? data.products.map(optionalRecord) : [];
  if (!data || products.some(product => !product) || products.length !== input.graphRows.length) {
    throw new ApprovedPricingEvidenceError('Legacy discount eligibility cannot reconcile product and graph row counts');
  }
  const missingOrdinals = products.flatMap((product, ordinal) =>
    typeof optionalRecord(product!.meta)?.isLayer === 'boolean' ? [] : [ordinal]);
  if (missingOrdinals.length === 0) return { contractData: data, assignments: [] };
  if (input.layerConfigurationCount !== 0) {
    throw new ApprovedPricingEvidenceError('Legacy discount eligibility is missing while canonical layer configurations exist');
  }
  const missing = new Set(missingOrdinals);
  return {
    contractData: {
      ...data,
      products: products.map((product, ordinal) => missing.has(ordinal) ? {
        ...product!,
        meta: { ...(optionalRecord(product!.meta) ?? {}), isLayer: false },
      } : product),
    },
    assignments: missingOrdinals.map(ordinal => ({
      productRowId: input.graphRows[ordinal]!.productRowId,
      rawIsLayer: null as null,
      sealedIsLayer: false as const,
      rule: 'LEGACY_GRAPH_V1_EMPTY_LAYER_CONFIGURATION_NON_LAYER' as const,
    })),
  };
};

const legacyMoney = (value: unknown, label: string) => {
  if (value == null || value === '') throw new ApprovedPricingEvidenceError(`${label} is missing`);
  try {
    const parsed = new Prisma.Decimal(String(value));
    if (!parsed.isFinite() || parsed.lt(0)) throw new ApprovedPricingEvidenceError();
    return parsed;
  } catch {
    throw new ApprovedPricingEvidenceError(`${label} is invalid`);
  }
};

export const reconstructLegacyV1Pricing = (input: {
  productRowId: string;
  productSnapshot: Record<string, any>;
  rawTotalAmountToman: string;
}) => {
  const product = input.productSnapshot;
  const currency = String(product.currency ?? '').trim().toLowerCase();
  if (!['تومان', 'toman'].includes(currency)) throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} legacy currency is not Toman`);
  const material = legacyMoney(product.originalTotalPrice, `Product ${input.productRowId} legacy material amount`);
  const rawCutting = product.cuttingCost != null
    ? legacyMoney(product.cuttingCost, `Product ${input.productRowId} legacy cutting amount`)
    : product.isCut === false ? new Prisma.Decimal(0) : (() => { throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} legacy cutting evidence is incomplete`); })();
  const stair = optionalRecord(optionalRecord(product.meta)?.stair);
  const isLegacyStair = String(product.productType ?? '').toLowerCase() === 'stair';
  if (isLegacyStair) legacyMoney(stair?.baseStoneQuantity, `Product ${input.productRowId} legacy stair base-stone quantity`);
  const stairTools = isLegacyStair && Array.isArray(optionalRecord(product.meta)?.tools)
    ? optionalRecord(product.meta)!.tools as unknown[]
    : [];
  const duplicatedCuttingTool = stairTools.reduce<Prisma.Decimal>((sum, value) => {
    const tool = optionalRecord(value);
    return typeof tool?.toolId === 'string' && tool.toolId.startsWith('cut-')
      ? sum.plus(legacyMoney(tool.totalPrice, `Product ${input.productRowId} legacy stair cutting tool amount`))
      : sum;
  }, new Prisma.Decimal(0));
  if (!duplicatedCuttingTool.isZero() && !duplicatedCuttingTool.eq(rawCutting)) {
    throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} legacy stair physical and tool cutting lines conflict`);
  }
  const cutting = rawCutting.plus(duplicatedCuttingTool);
  const tooling = product.totalSubServiceCost != null
    ? legacyMoney(product.totalSubServiceCost, `Product ${input.productRowId} legacy tooling amount`)
    : Array.isArray(product.appliedSubServices) && product.appliedSubServices.length === 0
      ? new Prisma.Decimal(0)
      : (() => { throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} legacy tooling evidence is incomplete`); })();
  const meta = optionalRecord(product.meta);
  const hasFinishing = Boolean(product.finishingId || (Array.isArray(product.finishings) && product.finishings.length) || meta?.finishing);
  const finishing = product.finishingCost != null
    ? legacyMoney(product.finishingCost, `Product ${input.productRowId} legacy finishing amount`)
    : !hasFinishing ? new Prisma.Decimal(0) : (() => { throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} legacy finishing evidence is incomplete`); })();
  if (typeof product.isMandatory !== 'boolean') throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} legacy mandatory evidence is incomplete`);
  const mandatory = product.isMandatory
    ? material.mul(legacyMoney(product.mandatoryPercentage, `Product ${input.productRowId} legacy mandatory percentage`)).div(100)
    : new Prisma.Decimal(0);
  const rawTotal = legacyMoney(input.rawTotalAmountToman, `Product ${input.productRowId} legacy total`);
  const round = (value: Prisma.Decimal) => value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const components = [
    { id: 'base-material', kind: 'base-material', amount: round(material) },
    { id: 'legacy-mandatory', kind: 'legacy-mandatory', amount: round(mandatory) },
    { id: 'legacy-cutting', kind: 'legacy-cutting', amount: round(cutting) },
    { id: 'legacy-tooling', kind: 'legacy-tooling', amount: round(tooling) },
    { id: 'legacy-finishing', kind: 'legacy-finishing', amount: round(finishing) },
  ];
  const sealedTotal = round(rawTotal);
  const componentTotal = components.reduce((sum, component) => sum.plus(component.amount), new Prisma.Decimal(0));
  if (!componentTotal.eq(sealedTotal)) {
    throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} legacy pricing components do not reconcile after the historical conversion rule`);
  }
  return {
    baseAmountToman: components[0]!.amount.toFixed(0),
    totalAmountToman: sealedTotal.toFixed(0),
    pricingComponents: components
      .filter(component => component.kind === 'base-material' || !component.amount.isZero())
      .map(component => ({ id: component.id, kind: component.kind, amountToman: component.amount.toFixed(0) })),
    normalization: {
      productRowId: input.productRowId,
      rawTotalAmountToman: rawTotal.toString(),
      sealedTotalAmountToman: sealedTotal.toFixed(0),
      difference: sealedTotal.minus(rawTotal).toFixed(rawTotal.decimalPlaces()),
      rule: 'LEGACY_GRAPH_V1_ROUND_HALF_UP_TOMAN' as const,
      ...(isLegacyStair && !duplicatedCuttingTool.isZero() ? {
        componentConversions: [{
          component: 'cutting' as const,
          rawValue: rawCutting.toString(),
          duplicatedToolValue: duplicatedCuttingTool.toString(),
          sealedValue: cutting.toString(),
          difference: cutting.minus(rawCutting).toString(),
          rule: 'LEGACY_STAIR_V1_CUTTING_PHYSICAL_AND_TOOL_LINES' as const,
        }],
      } : {}),
    },
  };
};

type ProjectedLegacyV1Pricing = {
  baseAmountToman: string | null;
  totalAmountToman: string;
  pricingComponents: ReadonlyArray<{ id: string; kind: string; amountToman: string }>;
};

export const resolveLegacyV1PricingProjection = (input: {
  canReconstructLegacyV1: boolean;
  productRowId: string;
  productSnapshot: Record<string, any> | null;
  pricing: ProjectedLegacyV1Pricing;
}) => {
  const projectedTotal = new Prisma.Decimal(input.pricing.totalAmountToman ?? 0);
  const requiresPricingReconstruction = input.pricing.baseAmountToman == null || !projectedTotal.isInteger();
  let snapshotRawTotal: Prisma.Decimal | null = null;
  if (input.productSnapshot?.totalPrice != null && input.productSnapshot.totalPrice !== '') {
    try {
      const candidate = new Prisma.Decimal(String(input.productSnapshot.totalPrice));
      if (candidate.isFinite() && candidate.gte(0) && !candidate.eq(projectedTotal) &&
        candidate.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).eq(projectedTotal)) {
        snapshotRawTotal = candidate;
      }
    } catch {
      snapshotRawTotal = null;
    }
  }
  const needsLegacyProjection = requiresPricingReconstruction || snapshotRawTotal != null;
  if (!input.canReconstructLegacyV1 || !needsLegacyProjection) {
    return { pricing: input.pricing, normalization: null };
  }
  if (!input.productSnapshot) {
    throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} legacy pricing snapshot is missing`);
  }
  const reconstructed = reconstructLegacyV1Pricing({
    productRowId: input.productRowId,
    productSnapshot: input.productSnapshot,
    rawTotalAmountToman: snapshotRawTotal?.toString() ?? String(input.pricing.totalAmountToman ?? ''),
  });
  if (snapshotRawTotal != null && !requiresPricingReconstruction) {
    if (!new Prisma.Decimal(reconstructed.baseAmountToman).eq(input.pricing.baseAmountToman!)) {
      throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} legacy material amount conflicts with canonical pricing`);
    }
    return { pricing: input.pricing, normalization: reconstructed.normalization };
  }
  return { pricing: reconstructed, normalization: reconstructed.normalization };
};

export const reconstructLegacyV1Quantity = (input: {
  productRowId: string;
  productType: string;
  productSnapshot: Record<string, any>;
}) => {
  const product = input.productSnapshot;
  const type = input.productType.toLowerCase();
  let raw: Prisma.Decimal;
  let unit: string;
  let longitudinalLength: Prisma.Decimal | null = null;
  let longitudinalCount: Prisma.Decimal | null = null;
  if (type === 'longitudinal') {
    const length = legacyMoney(product.length, `Product ${input.productRowId} legacy length`);
    const count = legacyMoney(product.quantity, `Product ${input.productRowId} legacy count`);
    const lengthUnit = String(product.lengthUnit ?? '').toLowerCase();
    if (!['m', 'cm'].includes(lengthUnit)) throw new ApprovedPricingEvidenceError(`Product ${input.productRowId} legacy length unit is invalid`);
    longitudinalLength = lengthUnit === 'cm' ? length.div(100) : length;
    longitudinalCount = count;
    raw = longitudinalLength.mul(count);
    unit = 'meter';
  } else if (type === 'slab') {
    raw = legacyMoney(product.squareMeters, `Product ${input.productRowId} legacy area`);
    unit = 'squareMeter';
  } else if (type === 'prepared') {
    raw = legacyMoney(product.preparedQuantity ?? product.quantity, `Product ${input.productRowId} legacy prepared quantity`);
    unit = String(product.preparedUnit ?? product.unit ?? 'count');
  } else {
    raw = legacyMoney(product.quantity, `Product ${input.productRowId} legacy quantity`);
    unit = 'count';
  }
  const sealed = raw.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3);
  return {
    requestedQuantity: type === 'longitudinal'
      ? longitudinalCount!.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3)
      : type === 'slab' ? null : sealed,
    requestedLengthMeters: type === 'longitudinal'
      ? longitudinalLength!.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP).toFixed(3)
      : null,
    requestedAreaSquareMeters: type === 'slab' ? sealed : null,
    normalization: {
      productRowId: input.productRowId,
      productType: input.productType,
      rawValue: raw.toString(),
      sealedValue: sealed,
      unit,
      rule: 'LEGACY_GRAPH_V1_ROUND_HALF_UP_SCALE_THREE' as const,
    },
  };
};

const mapVersion = (version: PersistedVersion): ApprovedPricingVersionRecord => ({
  id: version.id,
  contractId: version.contractId,
  versionNumber: version.versionNumber,
  sourceFinancialRecordId: version.sourceFinancialRecordId,
  approvedAt: version.approvedAt,
  approvedBy: version.approvedBy,
  schemaVersion: version.schemaVersion,
  currency: version.currency,
  grossAmount: version.grossAmount.toFixed(12),
  discountAmount: version.discountAmount.toFixed(12),
  netAmount: version.netAmount.toFixed(12),
  sourceEvidence: jsonRecord(version.sourceEvidence),
  integrityHash: version.integrityHash,
  rows: version.rows.map(row => ({
    id: row.id,
    contractItemId: row.contractItemId,
    productRowId: row.productRowId,
    ordinal: row.ordinal,
    contractedQuantity: row.contractedQuantity.toFixed(3),
    unit: row.unit,
    canonicalAllInTotal: row.canonicalAllInTotal.toFixed(12),
    discountEligible: row.discountEligible,
    componentEvidence: jsonRecord(row.componentEvidence) as Readonly<Record<string, string>>,
    integrityHash: row.integrityHash,
  })),
});

export class PrismaApprovedPricingRepository implements ApprovedPricingRepository {
  constructor(private readonly tx: Prisma.TransactionClient, private readonly auditContext?: ApprovedPricingAuditContext) {}

  async readApprovalLeaf(financialRecordId: string) {
    const leaf = await this.tx.accountingFinancialRecord.findUnique({
      where: { id: financialRecordId },
      include: { invoiceItems: true },
    });
    return leaf ? mapLeaf(leaf) : null;
  }

  async withContractLock<T>(contractId: string, work: () => Promise<T>): Promise<T> {
    const locked = await this.tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "sales_contracts" WHERE "id" = ${contractId} FOR UPDATE`,
    );
    if (locked.length !== 1) throw new ApprovedPricingEvidenceError('Approved pricing contract was not found');
    return work();
  }

  async findByApproval(contractId: string, financialRecordId: string) {
    const existing = await this.tx.contractApprovedPricingVersion.findUnique({
      where: { sourceFinancialRecordId_contractId: { sourceFinancialRecordId: financialRecordId, contractId } },
      include: pricingVersionInclude,
    });
    return existing ? mapVersion(existing) : null;
  }

  async loadSource(financialRecordId: string): Promise<ApprovedPricingSource | null> {
    const leaf = await this.tx.accountingFinancialRecord.findUnique({
      where: { id: financialRecordId }, include: { invoiceItems: true },
    });
    if (!leaf?.contractId) return null;
    const contract = await this.tx.salesContract.findUnique({
      where: { id: leaf.contractId },
      include: { items: true, productGraphState: true },
    });
    if (!contract) return null;
    const snapshot = unknownRecord(leaf.sourceSnapshot, 'Invoice candidate source snapshot');
    if (snapshot.id !== contract.id || leaf.sourceId !== contract.id) {
      throw new ApprovedPricingEvidenceError('Invoice candidate source identities conflict with contract');
    }
    const frozenGraphState = optionalRecord(snapshot.productGraphState);
    const evidenceRevision = frozenGraphState
      ? Number(frozenGraphState.revision)
      : contract.productGraphState?.revision;
    const migrationAudit = Number.isInteger(evidenceRevision)
      ? await this.tx.salesContractProductGraphAudit.findUnique({
          where: {
            contractId_resultRevision: {
              contractId: contract.id,
              resultRevision: evidenceRevision!,
            },
          },
          select: {
            commandId: true,
            resultRevision: true,
            inputHash: true,
            resultHash: true,
            command: true,
          },
        })
      : null;
    const resolvedGraph = resolveFinancialApprovalGraphEvidence({
      snapshotGraphState: frozenGraphState,
      currentGraphState: contract.productGraphState,
      migrationAudit,
    });
    const graphState = resolvedGraph.graphState;
    if (!frozenGraphState && (!contract.productGraphState ||
      contract.productGraphState.revision !== Number(graphState.revision) ||
      contract.productGraphState.inputHash !== String(graphState.inputHash ?? '') ||
      contract.productGraphState.resultHash !== String(graphState.resultHash ?? ''))) {
      throw new ApprovedPricingEvidenceError('Canonical product graph changed after invoice candidate snapshot');
    }
    const snapshotItems = Array.isArray(snapshot.items) ? snapshot.items.map((item: unknown) => {
      const row = unknownRecord(item, 'Invoice candidate contract item snapshot');
      return {
        id: String(row.id ?? ''), productId: String(row.productId ?? ''),
        productRowId: row.productRowId == null ? null : String(row.productRowId),
        productType: row.productType == null ? null : String(row.productType),
        quantity: String(row.quantity ?? ''), totalPrice: String(row.totalPrice ?? ''),
      };
    }) : [];
    const liveItems = contract.items.map(item => ({
          id: item.id, productId: item.productId, productRowId: item.productRowId, productType: item.productType,
          quantity: item.quantity.toString(), totalPrice: item.totalPrice.toString(),
        }));
    const frozenIdentityBinding = frozenGraphState
      ? rebindFrozenContractItemIdentities({
          snapshotItems,
          liveItems,
          invoiceItems: leaf.invoiceItems,
        })
      : { idMap: new Map<string, string>(), rebindings: [] };
    const currentItems = frozenGraphState
      ? snapshotItems.map(item => ({ ...item }))
      : liveItems;
    let effectiveContractData = snapshot.contractData;
    let effectiveSnapshotItems = snapshotItems;
    let effectiveCurrentItems = currentItems;
    let effectiveLeaf = mapLeaf(leaf);
    let productGraph: ApprovedPricingSource['contract']['productGraph'] = null;
    if (graphState.graph) {
      let graph: ReturnType<typeof parseCanonicalProductGraph>;
      try {
        graph = parseCanonicalProductGraph(graphState.graph);
      } catch (error) {
        throw new ApprovedPricingEvidenceError(`Canonical product graph is malformed: ${
          error instanceof globalThis.Error ? error.message : String(error)
        }`);
      }
      if (graph.schemaVersion !== Number(graphState.schemaVersion) || graph.revision !== Number(graphState.revision)) {
        throw new ApprovedPricingEvidenceError('Canonical product graph version evidence conflicts with persisted state');
      }
      const projection = projectCanonicalProductGraph(graph, 'accounting');
      const rawProducts = optionalRecord(snapshot.contractData)?.products;
      const canReconstructLegacyV1 = graph.schemaVersion === 1 && graph.calculationPolicy.rounding === 'rounding-v1';
      const migrationCommand = optionalRecord(migrationAudit?.command);
      const hasMatchingLegacyMigration = canReconstructLegacyV1 && Boolean(migrationAudit) &&
        migrationCommand?.kind === 'legacy-migration' &&
        migrationAudit!.resultRevision === Number(graphState.revision) &&
        migrationAudit!.inputHash === String(graphState.inputHash ?? '') &&
        migrationAudit!.resultHash === String(graphState.resultHash ?? '');
      const hasMatchingCanonicalWriter = Boolean(migrationAudit) &&
        migrationCommand?.kind === 'canonical-wizard-save' &&
        migrationAudit!.resultRevision === Number(graphState.revision) &&
        migrationAudit!.inputHash === String(graphState.inputHash ?? '') &&
        migrationAudit!.resultHash === String(graphState.resultHash ?? '');
      const quantityPolicyProvenance: NonNullable<ApprovedPricingSource['contract']['productGraph']>['quantityPolicyProvenance'] =
        (hasMatchingLegacyMigration || hasMatchingCanonicalWriter) && migrationAudit
          ? optimizerQuantityPolicyProvenanceFromAudit({
              graphSchemaVersion: graph.schemaVersion,
              roundingPolicy: graph.calculationPolicy.rounding,
              graphAuditCommandId: migrationAudit.commandId,
              graphAuditCommand: migrationAudit.command,
            })
          : null;
      let compatibility: NonNullable<ApprovedPricingSource['contract']['productGraph']>['compatibility'] =
        resolvedGraph.compatibility ?? undefined;
      if (frozenIdentityBinding.rebindings.length > 0) {
        if (!migrationAudit || migrationAudit.inputHash !== String(graphState.inputHash ?? '') ||
          migrationAudit.resultHash !== String(graphState.resultHash ?? '')) {
          throw new ApprovedPricingEvidenceError('Frozen contract item live rebinding has no matching canonical graph audit');
        }
        compatibility = {
          ...(compatibility ?? {
            evidenceOrigin: 'POST_SNAPSHOT_DETERMINISTIC_CANONICAL_GRAPH_BINDING' as const,
            snapshotOriginallyMissing: false as const,
          }),
          ...(migrationAudit ? { migrationAuditCommandId: migrationAudit.commandId } : {}),
          liveContractItemRebindings: frozenIdentityBinding.rebindings,
        };
      }
      const monetaryNormalizations: Array<NonNullable<NonNullable<NonNullable<ApprovedPricingSource['contract']['productGraph']>['compatibility']>['monetaryNormalizations']>[number]> = [];
      const legacyQuantityNormalizations: Array<NonNullable<NonNullable<NonNullable<ApprovedPricingSource['contract']['productGraph']>['compatibility']>['legacyQuantityNormalizations']>[number]> = [];
      const graphRows = projection.products.map((row, ordinal) => {
        const canonicalRow = graph.rows.find(item => item.productRowId === row.productRowId);
        const productSnapshot = Array.isArray(rawProducts) ? optionalRecord(rawProducts[ordinal]) : null;
        let pricing = {
          baseAmountToman: row.baseAmountToman ?? null,
          totalAmountToman: row.totalAmountToman ?? null,
          pricingComponents: row.pricingComponents,
        };
        const resolvedPricing = resolveLegacyV1PricingProjection({
          canReconstructLegacyV1,
          productRowId: row.productRowId,
          productSnapshot,
          pricing,
        });
        pricing = resolvedPricing.pricing;
        const legacyRawTotalAmountToman = resolvedPricing.normalization?.rawTotalAmountToman ?? null;
        if (resolvedPricing.normalization) monetaryNormalizations.push(resolvedPricing.normalization);
        let requestedQuantity = row.quantity ?? null;
        let requestedLengthMeters = canonicalOptimizerDerivedLengthWitness(canonicalRow, row.lengthMeters) ?? null;
        let requestedAreaSquareMeters = row.areaSquareMeters ?? null;
        const quantityMissing = row.productType === 'longitudinal'
          ? requestedLengthMeters == null || requestedQuantity == null
          : row.productType === 'slab'
            ? requestedAreaSquareMeters == null
            : requestedQuantity == null;
        if (canReconstructLegacyV1 && quantityMissing) {
          if (!productSnapshot) throw new ApprovedPricingEvidenceError(`Product ${row.productRowId} legacy quantity snapshot is missing`);
          const reconstructedQuantity = reconstructLegacyV1Quantity({
            productRowId: row.productRowId,
            productType: row.productType,
            productSnapshot,
          });
          requestedQuantity = reconstructedQuantity.requestedQuantity;
          requestedLengthMeters = reconstructedQuantity.requestedLengthMeters;
          requestedAreaSquareMeters = reconstructedQuantity.requestedAreaSquareMeters;
          legacyQuantityNormalizations.push(reconstructedQuantity.normalization);
        }
        return {
          productRowId: row.productRowId,
          catalogProductId: canonicalRow?.catalogProductId ?? '',
          contractualTitle: row.contractualTitle,
          productType: row.productType,
          baseAmountToman: pricing.baseAmountToman,
          totalAmountToman: pricing.totalAmountToman,
          ...(legacyRawTotalAmountToman != null ? { legacyRawTotalAmountToman } : {}),
          requestedQuantity,
          requestedLengthMeters,
          requestedAreaSquareMeters,
          pricingComponents: pricing.pricingComponents,
          operations: row.operations.map(operation => ({
            id: operation.id,
            kind: operation.kind,
            amountToman: operation.amountToman,
          })),
        };
      });
      const identityCompatibility = resolvedGraph.compatibility ?? (hasMatchingLegacyMigration ? {
        evidenceOrigin: 'POST_SNAPSHOT_DETERMINISTIC_LEGACY_GRAPH_MIGRATION' as const,
        migrationAuditCommandId: migrationAudit!.commandId,
        snapshotOriginallyMissing: false as const,
      } : null);
      let recoveredMissingAccountingRows = false;
      if (hasMatchingLegacyMigration && snapshotItems.length === 0 && currentItems.length === 0 &&
        leaf.invoiceItems.length === 0 && Array.isArray(rawProducts) && rawProducts.length === graphRows.length &&
        graphRows.length > 0 && String(optionalRecord(leaf.metadata)?.mode ?? '') === 'FROM_CONTRACT_TOTAL') {
        const contractCurrency = String(snapshot.currency ?? '').trim().toLowerCase();
        const invoiceCurrency = String(leaf.currency ?? '').trim().toLowerCase();
        const currencyFactor = ['تومان', 'toman'].includes(contractCurrency) && ['ریال', 'rial'].includes(invoiceCurrency)
          ? new Prisma.Decimal(10)
          : contractCurrency === invoiceCurrency
            ? new Prisma.Decimal(1)
            : null;
        if (!currencyFactor) throw new ApprovedPricingEvidenceError('Frozen graph accounting row currency conversion is unsupported');
        const recoveredRows = graphRows.map((graphRow, ordinal) => {
          const product = optionalRecord(rawProducts[ordinal]);
          if (!product || String(product.productId ?? product.id ?? '') !== graphRow.catalogProductId ||
            String(product.productType ?? '') !== graphRow.productType) {
            throw new ApprovedPricingEvidenceError(`Frozen graph row ${ordinal + 1} cannot recover accounting identity`);
          }
          const rawQuantity = graphRow.productType === 'prepared'
            ? product.preparedQuantity ?? product.quantity
            : product.quantity;
          const rawTotal = product.totalPrice;
          let quantityValue: Prisma.Decimal;
          let totalValue: Prisma.Decimal;
          try {
            quantityValue = new Prisma.Decimal(String(rawQuantity ?? ''));
            totalValue = new Prisma.Decimal(String(rawTotal ?? ''));
          } catch {
            throw new ApprovedPricingEvidenceError(`Frozen graph row ${ordinal + 1} accounting evidence is malformed`);
          }
          const contractItemId = `recovered-contract-item:${contract.id}:${graphRow.productRowId}`;
          const invoiceItemId = `recovered-invoice-item:${leaf.id}:${graphRow.productRowId}`;
          return {
            contractItem: {
              id: contractItemId,
              productId: graphRow.catalogProductId,
              productRowId: graphRow.productRowId,
              productType: graphRow.productType,
              quantity: quantityValue.toString(),
              totalPrice: totalValue.toString(),
            },
            invoiceItem: {
              id: invoiceItemId,
              contractItemId,
              productId: graphRow.catalogProductId,
              quantity: quantityValue.toString(),
              totalPrice: totalValue.mul(currencyFactor).toString(),
            },
            audit: {
              contractItemId,
              invoiceItemId,
              productRowId: graphRow.productRowId,
              rule: 'FROZEN_GRAPH_ROW_ACCOUNTING_EVIDENCE_V1' as const,
            },
          };
        });
        const recoveredContractTotal = recoveredRows.reduce(
          (sum, row) => sum.plus(row.contractItem.totalPrice),
          new Prisma.Decimal(0),
        );
        const sealedContractTotal = new Prisma.Decimal(String(snapshot.totalAmount ?? ''));
        if (!recoveredContractTotal.eq(sealedContractTotal) ||
          !new Prisma.Decimal(String(graphState.totalAmountToman ?? '')).eq(sealedContractTotal)) {
          throw new ApprovedPricingEvidenceError('Frozen graph row totals do not seal to the frozen contract total');
        }
        if (!new Prisma.Decimal(effectiveLeaf.amount).eq(0)) {
          throw new ApprovedPricingEvidenceError('Missing accounting rows may only recover a zero-sentinel invoice amount');
        }
        const recoveredInvoiceAmount = sealedContractTotal.mul(currencyFactor);
        effectiveSnapshotItems = recoveredRows.map(row => row.contractItem);
        effectiveCurrentItems = recoveredRows.map(row => row.contractItem);
        effectiveLeaf = {
          ...effectiveLeaf,
          amount: recoveredInvoiceAmount.toString(),
          invoiceItems: recoveredRows.map(row => row.invoiceItem),
        };
        effectiveContractData = {
          ...(optionalRecord(effectiveContractData) ?? {}),
          products: rawProducts.map((rawProduct, ordinal) => ({
            ...(optionalRecord(rawProduct) ?? {}),
            rowId: graphRows[ordinal]!.productRowId,
            productRowId: graphRows[ordinal]!.productRowId,
          })),
        };
        compatibility = {
          ...(identityCompatibility ?? {
            evidenceOrigin: 'POST_SNAPSHOT_DETERMINISTIC_LEGACY_GRAPH_MIGRATION' as const,
            snapshotOriginallyMissing: true as const,
          }),
          recoveredAccountingRows: recoveredRows.map(row => row.audit),
          recoveredInvoiceAmount: {
            rawFinancialRecordAmount: '0',
            sealedContractTotal: sealedContractTotal.toString(),
            recoveredInvoiceAmount: recoveredInvoiceAmount.toString(),
            currencyFactor: currencyFactor.toString(),
            rule: 'ZERO_SENTINEL_FROM_FROZEN_CONTRACT_TOTAL_V1' as const,
          },
        };
        recoveredMissingAccountingRows = true;
      }
      const snapshotProductsMissingRowIdentity = Array.isArray(rawProducts) && rawProducts.some(product => {
        const row = optionalRecord(product);
        return row && (row.rowId == null || String(row.rowId) === '') &&
          (row.productRowId == null || String(row.productRowId) === '');
      });
      if (resolvedGraph.compatibility?.evidenceOrigin === 'POST_SNAPSHOT_DETERMINISTIC_CANONICAL_GRAPH_BINDING') {
        const binding = bindFrozenRowsToPostSnapshotCanonicalGraph({
          contractData: snapshot.contractData,
          snapshotItems,
          graphRows: graph.rows.map(row => ({
            productRowId: row.productRowId,
            catalogProductId: row.catalogProductId,
            productType: row.productType,
            legacySnapshot: optionalRecord(row.commercial)?.legacySnapshot,
          })),
        });
        effectiveContractData = binding.contractData;
        effectiveSnapshotItems = binding.snapshotItems as typeof snapshotItems;
        effectiveCurrentItems = binding.snapshotItems as typeof currentItems;
        compatibility = { ...resolvedGraph.compatibility, rowIdentityAssignments: binding.assignments };
      } else if (!recoveredMissingAccountingRows && identityCompatibility && (snapshotItems.some(item => !item.productRowId) ||
        currentItems.some(item => !item.productRowId) || snapshotProductsMissingRowIdentity)) {
        const binding = bindLegacyRowsToMigratedGraph({
          contractData: snapshot.contractData,
          snapshotItems,
          currentItems,
          graphRows,
        });
        effectiveContractData = binding.contractData;
        effectiveSnapshotItems = binding.snapshotItems as typeof snapshotItems;
        effectiveCurrentItems = binding.currentItems as typeof currentItems;
        compatibility = { ...identityCompatibility, rowIdentityAssignments: binding.assignments };
      }
      if (canReconstructLegacyV1) {
        const eligibility = reconstructLegacyV1DiscountEligibility({
          contractData: effectiveContractData,
          graphRows,
          layerConfigurationCount: graph.layerConfigurations.length,
        });
        effectiveContractData = eligibility.contractData;
        if (eligibility.assignments.length > 0) {
          compatibility = compatibility ?? {
            evidenceOrigin: 'GRAPH_V1_LEGACY_SNAPSHOT_RECONSTRUCTION',
            snapshotOriginallyMissing: false,
          };
          compatibility = { ...compatibility, discountEligibilityAssignments: eligibility.assignments };
        }
      }
      if (!compatibility && (monetaryNormalizations.length > 0 || legacyQuantityNormalizations.length > 0)) {
        compatibility = {
          evidenceOrigin: 'GRAPH_V1_LEGACY_SNAPSHOT_RECONSTRUCTION',
          snapshotOriginallyMissing: false,
        };
      }
      if (compatibility && monetaryNormalizations.length > 0) {
        compatibility = { ...compatibility, monetaryNormalizations };
      }
      if (compatibility && legacyQuantityNormalizations.length > 0) {
        compatibility = { ...compatibility, legacyQuantityNormalizations };
      }
      productGraph = {
        schemaVersion: Number(graphState.schemaVersion),
        roundingPolicy: graph.calculationPolicy.rounding,
        revision: Number(graphState.revision),
        inputHash: String(graphState.inputHash ?? ''),
        resultHash: String(graphState.resultHash ?? ''),
        totalAmountToman: String(graphState.totalAmountToman ?? ''),
        quantityPolicyProvenance,
        ...(compatibility ? { compatibility } : {}),
        rows: graphRows,
      };
    }
    return {
      leaf: effectiveLeaf,
      contract: {
        id: String(snapshot.id),
        contractNumber: String(snapshot.contractNumber ?? ''),
        customerId: String(snapshot.customerId ?? ''),
        currency: snapshot.currency == null ? null : String(snapshot.currency),
        contractData: effectiveContractData,
        items: effectiveSnapshotItems,
        currentItems: effectiveCurrentItems,
        productGraph,
      },
    };
  }

  async nextVersionNumber(contractId: string) {
    const latest = await this.tx.contractApprovedPricingVersion.findFirst({
      where: { contractId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    return (latest?.versionNumber ?? 0) + 1;
  }

  async readPersistenceContext(contractId: string, financialRecordId: string) {
    return this.tx.contractApprovedPricingVersion.findUnique({
      where: { sourceFinancialRecordId_contractId: { sourceFinancialRecordId: financialRecordId, contractId } },
      select: { origin: true, legacySourceReference: true },
    });
  }

  async insertAndAdvance(version: ApprovedPricingVersionInsert, context: ApprovedPricingPersistenceContext = {
    origin: ApprovedPricingVersionOrigin.FINANCIAL_APPROVAL,
  }) {
    const sourceEvidence = optionalRecord(version.sourceEvidence);
    const graphEvidence = optionalRecord(sourceEvidence?.graph);
    const compatibilityEvidence = optionalRecord(graphEvidence?.compatibility);
    const recoveredContractItemIds = new Set(
      Array.isArray(compatibilityEvidence?.recoveredAccountingRows)
        ? compatibilityEvidence.recoveredAccountingRows.flatMap(raw => {
            const row = optionalRecord(raw);
            return row?.contractItemId ? [String(row.contractItemId)] : [];
          })
        : [],
    );
    const liveContractItemRebindings = new Map(
      Array.isArray(compatibilityEvidence?.liveContractItemRebindings)
        ? compatibilityEvidence.liveContractItemRebindings.flatMap(raw => {
            const row = optionalRecord(raw);
            return row?.sourceContractItemId && row?.linkedContractItemId
              ? [[String(row.sourceContractItemId), String(row.linkedContractItemId)] as const]
              : [];
          })
        : [],
    );
    const previousHead = await this.tx.contractApprovedPricingHead.findUnique({
      where: { contractId: version.contractId },
      select: { currentVersionId: true },
    });
    const created = await this.tx.contractApprovedPricingVersion.create({
      data: {
        id: version.id,
        contractId: version.contractId,
        versionNumber: version.versionNumber,
        sourceFinancialRecordId: version.sourceFinancialRecordId,
        origin: context.origin,
        approvedAt: version.approvedAt,
        approvedBy: version.approvedBy,
        schemaVersion: version.schemaVersion,
        currency: version.currency,
        grossAmount: version.grossAmount,
        discountAmount: version.discountAmount,
        netAmount: version.netAmount,
        sourceEvidence: version.sourceEvidence as Prisma.InputJsonValue,
        legacySourceReference: context.legacySourceReference == null ? undefined : context.legacySourceReference as Prisma.InputJsonValue,
        integrityHash: version.integrityHash,
        rows: {
          create: version.rows.map(row => ({
            id: row.id,
            contractItemId: row.contractItemId,
            linkedContractItemId: recoveredContractItemIds.has(row.contractItemId)
              ? null
              : liveContractItemRebindings.get(row.contractItemId) ?? row.contractItemId,
            productRowId: row.productRowId,
            ordinal: row.ordinal,
            contractedQuantity: row.contractedQuantity,
            unit: row.unit,
            canonicalAllInTotal: row.canonicalAllInTotal,
            discountEligible: row.discountEligible,
            componentEvidence: row.componentEvidence as Prisma.InputJsonValue,
            integrityHash: row.integrityHash,
          })),
        },
      },
      include: pricingVersionInclude,
    });
    await this.tx.contractApprovedPricingHead.upsert({
      where: { contractId: version.contractId },
      create: {
        contractId: version.contractId,
        currentVersionId: version.id,
        advancedAt: version.approvedAt,
        advancedBy: version.approvedBy,
      },
      update: {
        currentVersionId: version.id,
        advancedAt: version.approvedAt,
        advancedBy: version.approvedBy,
      },
    });
    if (this.auditContext) {
      const payload = stableAudit({ workspace: 'accounting', effectiveAuthority: this.auditContext.effectiveAuthority,
        reason: this.auditContext.reason, correlationId: this.auditContext.correlationId, idempotencyKey: this.auditContext.idempotencyKey,
        before: { currentVersionId: previousHead?.currentVersionId ?? null }, after: { currentVersionId: version.id },
        sourceFinancialRecordId: version.sourceFinancialRecordId, contractId: version.contractId,
        versionIntegrityHash: version.integrityHash, rowIntegrityHashes: version.rows.map(row => row.integrityHash) });
      const audit = { aggregateType: 'APPROVED_PRICING_VERSION' as const, aggregateId: version.id,
        eventType: 'APPROVED_PRICING_VERSION_CREATED' as const, payload, actorId: version.approvedBy,
        recordedAt: version.approvedAt, previousHash: null };
      await this.tx.dispatchLifecycleAudit.create({ data: { ...audit, payload: payload as Prisma.InputJsonValue,
        eventHash: approvedPricingLifecycleAuditHash(audit) } });
    }
    return mapVersion(created);
  }
}
