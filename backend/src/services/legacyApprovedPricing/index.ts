import { Prisma } from '@prisma/client';
import type { PricingReadinessReasonCode, PricingReadinessStatus } from '../dispatchDocuments/contracts';
import { hashCanonicalEvidence } from './canonicalEvidence';
import { isCompleteValidApprovalLeaf } from './approvalLeaf';

export const LEGACY_PRICING_STATUSES = [
  'READY',
  'LEGACY_REVIEW_REQUIRED',
  'REPAIR_REQUIRED',
  'EVIDENCE_CONFLICT',
  'STALE',
] as const;
export type LegacyPricingStatus = (typeof LEGACY_PRICING_STATUSES)[number];

export const LEGACY_PRICING_REASON_CODES = [
  'MISSING_STABLE_ROW_ID',
  'ROW_SNAPSHOT_NOT_FOUND',
  'APPROVAL_NOT_VALID_LEAF',
  'MISSING_APPROVED_GRAPH_VERSION',
  'APPROVAL_SNAPSHOT_ROW_MISSING',
  'MISSING_TOTAL',
  'MISSING_QUANTITY',
  'MISSING_UNIT',
  'MISSING_CURRENCY',
  'MISSING_DISCOUNT_EVIDENCE',
  'MISSING_ATTACHED_COST_EVIDENCE',
  'MISSING_OR_INVALID_PROJECT',
  'MULTIPLE_VALID_APPROVALS',
  'IDENTITY_CONFLICT',
  'FINANCIAL_MISMATCH',
  'HASH_MISMATCH',
] as const;
export type LegacyPricingReasonCode = (typeof LEGACY_PRICING_REASON_CODES)[number];

export type LegacyPricingApprovalLeaf = {
  id: string;
  kind: string;
  status: string;
  approvedAt: string | null;
  approvedBy: string | null;
};

export type LegacyPricingRow = {
  contractItemId: string;
  relationalProductRowId: string | null;
  snapshotProductRowId: string | null;
  relationalProductId: string | null;
  snapshotProductId: string | null;
  currencyEvidence: { contract: string | null; approvalSnapshot: string | null; productSnapshot: string | null; financialRecord: string | null };
  quantity: string | null;
  quantityEvidence: { contractItem: string | null; approvalItem: string | null; invoiceItem: string | null };
  unit: string | null;
  canonicalAllInTotal: string | null;
  amountEvidence: { contractItem: string | null; approvalItem: string | null; invoiceItem: string | null };
  discountEligible: boolean | null;
  componentEvidence: Readonly<Record<string, string | null>> | null;
  componentEvidenceConflict: boolean;
  snapshotHash: string | null;
};

export type LegacyPricingReview = {
  reviewedBy: string;
  reviewedAt: string;
  sourceEvidenceHash: string;
  decision: 'APPROVE_SEAL';
  reason: string;
};

export type LegacyPricingCandidate = {
  contractId: string;
  sourceFinancialRecordId: string;
  approvalLeaves: readonly LegacyPricingApprovalLeaf[];
  currency: string | null;
  customerId: string | null;
  projectId: string | null;
  destination: string | null;
  envelopeEvidence: {
    financialCurrency: string | null;
    financialCustomerId: string | null;
    snapshotCurrency: string | null;
    snapshotCustomerId: string | null;
    snapshotProjectId: string | null;
  };
  discount: { enabled: boolean; baseAmount: string | null; amount: string | null } | null;
  rows: readonly LegacyPricingRow[];
  grossAmount: string | null;
  discountAmount: string | null;
  netAmount: string | null;
  sourceIdentityHash: string;
  sourceEvidenceHash: string;
  existingSeal: { pricingVersionId: string; sourceEvidenceHash: string } | null;
  review: LegacyPricingReview | null;
  rowCounts: { contractItems: number; approvalItems: number; productSnapshots: number; invoiceItems: number };
};

export type LegacyPricingReason = {
  code: LegacyPricingReasonCode;
  detail: Readonly<Record<string, string>>;
};

export type LegacyPricingClassification = {
  contractId: string;
  sourceFinancialRecordId: string;
  status: LegacyPricingStatus;
  reasons: LegacyPricingReason[];
  sourceCount: number;
  sourceIdentityHash: string;
  sourceEvidenceHash: string;
  quantityTotal: string | null;
  amountTotal: string | null;
};

const PERSISTED_REASON_BY_LEGACY_REASON: Record<LegacyPricingReasonCode, PricingReadinessReasonCode> = {
  MISSING_STABLE_ROW_ID: 'MISSING_STABLE_ROW_IDENTITY',
  ROW_SNAPSHOT_NOT_FOUND: 'SOURCE_EVIDENCE_INCOMPLETE',
  APPROVAL_NOT_VALID_LEAF: 'MISSING_FINANCIAL_APPROVAL',
  MISSING_APPROVED_GRAPH_VERSION: 'SOURCE_EVIDENCE_INCOMPLETE',
  APPROVAL_SNAPSHOT_ROW_MISSING: 'SOURCE_EVIDENCE_INCOMPLETE',
  MISSING_TOTAL: 'MISSING_CANONICAL_ROW_TOTAL',
  MISSING_QUANTITY: 'MISSING_CONTRACTED_QUANTITY',
  MISSING_UNIT: 'SOURCE_EVIDENCE_INCOMPLETE',
  MISSING_CURRENCY: 'MISSING_CURRENCY',
  MISSING_DISCOUNT_EVIDENCE: 'MISSING_DISCOUNT_EVIDENCE',
  MISSING_ATTACHED_COST_EVIDENCE: 'SOURCE_EVIDENCE_INCOMPLETE',
  MISSING_OR_INVALID_PROJECT: 'SOURCE_EVIDENCE_INCOMPLETE',
  MULTIPLE_VALID_APPROVALS: 'MISSING_FINANCIAL_APPROVAL',
  IDENTITY_CONFLICT: 'ROW_IDENTITY_CONFLICT',
  FINANCIAL_MISMATCH: 'SOURCE_EVIDENCE_INCOMPLETE',
  HASH_MISMATCH: 'SOURCE_HASH_MISMATCH',
};

export const toPersistedPricingReadiness = (classification: LegacyPricingClassification): {
  status: PricingReadinessStatus;
  reasons: Array<{ code: PricingReadinessReasonCode; detail: Readonly<Record<string, unknown>> }>;
} => ({
  status: classification.status === 'READY'
    ? 'READY'
    : ['EVIDENCE_CONFLICT', 'STALE'].includes(classification.status) ? 'QUARANTINED' : 'BLOCKED',
  reasons: classification.reasons.map(item => ({
    code: PERSISTED_REASON_BY_LEGACY_REASON[item.code],
    detail: { legacyCode: item.code, ...item.detail },
  })),
});

const hashIsValid = (value: string | null | undefined) => Boolean(value && /^[a-f0-9]{64}$/i.test(value));

const exact = (value: string | null, scale: number): Prisma.Decimal | null => {
  if (value == null || !value.trim()) return null;
  try {
    const decimal = new Prisma.Decimal(value);
    return decimal.isFinite() && decimal.decimalPlaces() <= scale ? decimal : null;
  } catch {
    return null;
  }
};

const reason = (code: LegacyPricingReasonCode, detail: Record<string, string> = {}): LegacyPricingReason => ({ code, detail });
const addReason = (reasons: LegacyPricingReason[], next: LegacyPricingReason) => {
  if (!reasons.some(item => item.code === next.code && JSON.stringify(item.detail) === JSON.stringify(next.detail))) reasons.push(next);
};

export const classifyLegacyPricingCandidate = (candidate: LegacyPricingCandidate): LegacyPricingClassification => {
  const repair: LegacyPricingReason[] = [];
  const conflicts: LegacyPricingReason[] = [];
  const validLeaves = candidate.approvalLeaves.filter(isCompleteValidApprovalLeaf);
  if (validLeaves.length === 0) addReason(repair, reason('APPROVAL_NOT_VALID_LEAF'));
  if (validLeaves.length > 1) addReason(conflicts, reason('MULTIPLE_VALID_APPROVALS', { count: String(validLeaves.length) }));
  if (validLeaves.length === 1 && validLeaves[0].id !== candidate.sourceFinancialRecordId) {
    addReason(conflicts, reason('IDENTITY_CONFLICT', { source: 'financial-record' }));
  }

  if (!candidate.currency?.trim()) addReason(repair, reason('MISSING_CURRENCY'));
  const currencies = [candidate.currency, candidate.envelopeEvidence.financialCurrency, candidate.envelopeEvidence.snapshotCurrency];
  if (currencies.some(value => !value?.trim())) addReason(repair, reason('MISSING_CURRENCY'));
  else if (new Set(currencies).size !== 1) addReason(conflicts, reason('FINANCIAL_MISMATCH', { source: 'currency' }));
  if (!candidate.customerId?.trim() || !candidate.projectId?.trim() || !candidate.destination?.trim()) {
    addReason(repair, reason('MISSING_OR_INVALID_PROJECT'));
  }
  if (!candidate.envelopeEvidence.financialCustomerId?.trim()
    || !candidate.envelopeEvidence.snapshotCustomerId?.trim()
    || !candidate.envelopeEvidence.snapshotProjectId?.trim()) {
    addReason(repair, reason('MISSING_OR_INVALID_PROJECT'));
  } else if (candidate.customerId !== candidate.envelopeEvidence.financialCustomerId
    || candidate.customerId !== candidate.envelopeEvidence.snapshotCustomerId
    || candidate.projectId !== candidate.envelopeEvidence.snapshotProjectId) {
    addReason(conflicts, reason('IDENTITY_CONFLICT', { source: 'customer-project-envelope' }));
  }
  const discountBase = exact(candidate.discount?.baseAmount ?? null, 12);
  const discount = exact(candidate.discount?.amount ?? null, 12);
  if (!candidate.discount || discountBase == null || discount == null) addReason(repair, reason('MISSING_DISCOUNT_EVIDENCE'));
  if (candidate.discount && discount && candidate.discount.enabled !== discount.gt(0)) {
    addReason(conflicts, reason('FINANCIAL_MISMATCH', { source: 'discount-enabled' }));
  }

  if (candidate.rows.length === 0) addReason(repair, reason('ROW_SNAPSHOT_NOT_FOUND'));
  if (new Set(Object.values(candidate.rowCounts)).size !== 1) {
    addReason(repair, reason('APPROVAL_SNAPSHOT_ROW_MISSING', Object.fromEntries(Object.entries(candidate.rowCounts).map(([key, value]) => [key, String(value)]))));
  }
  let quantityTotal = new Prisma.Decimal(0);
  let rowAmountTotal = new Prisma.Decimal(0);
  let quantityComplete = candidate.rows.length > 0;
  let amountComplete = candidate.rows.length > 0;
  for (const [index, row] of candidate.rows.entries()) {
    const detail = { row: row.contractItemId || String(index) };
    if (!row.relationalProductRowId?.trim()) addReason(repair, reason('MISSING_STABLE_ROW_ID', detail));
    if (!row.snapshotProductRowId?.trim()) addReason(repair, reason('APPROVAL_SNAPSHOT_ROW_MISSING', detail));
    if (row.relationalProductRowId && row.snapshotProductRowId && row.relationalProductRowId !== row.snapshotProductRowId) {
      addReason(conflicts, reason('IDENTITY_CONFLICT', detail));
    }
    if (!row.relationalProductId?.trim() || !row.snapshotProductId?.trim()) addReason(repair, reason('ROW_SNAPSHOT_NOT_FOUND', detail));
    if (row.relationalProductId && row.snapshotProductId && row.relationalProductId !== row.snapshotProductId) {
      addReason(conflicts, reason('IDENTITY_CONFLICT', { ...detail, source: 'catalog-product' }));
    }
    const rowCurrencies = Object.values(row.currencyEvidence);
    if (rowCurrencies.some(value => !value)) addReason(repair, reason('MISSING_CURRENCY', detail));
    else if (new Set(rowCurrencies).size !== 1) addReason(conflicts, reason('FINANCIAL_MISMATCH', { ...detail, source: 'currency' }));
    const quantity = exact(row.quantity, 3);
    const quantityEvidence = Object.values(row.quantityEvidence).map(value => exact(value, 3));
    if (quantityEvidence.some(value => value == null)) addReason(repair, reason('MISSING_QUANTITY', detail));
    else if (new Set(quantityEvidence.map(value => value!.toFixed(3))).size !== 1) addReason(conflicts, reason('FINANCIAL_MISMATCH', { ...detail, source: 'quantity' }));
    if (quantity == null || !quantity.gt(0)) {
      quantityComplete = false;
      addReason(repair, reason('MISSING_QUANTITY', detail));
    } else quantityTotal = quantityTotal.plus(quantity);
    if (!row.unit?.trim()) addReason(repair, reason('MISSING_UNIT', detail));
    const total = exact(row.canonicalAllInTotal, 12);
    const amountEvidence = Object.values(row.amountEvidence).map(value => exact(value, 12));
    if (amountEvidence.some(value => value == null)) addReason(repair, reason('MISSING_TOTAL', detail));
    else if (new Set(amountEvidence.map(value => value!.toFixed(12))).size !== 1) addReason(conflicts, reason('FINANCIAL_MISMATCH', { ...detail, source: 'row-total' }));
    if (total == null) {
      amountComplete = false;
      addReason(repair, reason('MISSING_TOTAL', detail));
    } else rowAmountTotal = rowAmountTotal.plus(total);
    const components = row.componentEvidence && Object.entries(row.componentEvidence);
    if (row.componentEvidenceConflict) addReason(conflicts, reason('FINANCIAL_MISMATCH', { ...detail, source: 'attached-component-snapshots' }));
    if (!components?.length || components.some(([, value]) => exact(value, 12) == null)) {
      addReason(repair, reason('MISSING_ATTACHED_COST_EVIDENCE', detail));
    } else if (total && !components.filter(([key]) => key !== 'discountBasis').reduce((sum, [, value]) => sum.plus(value!), new Prisma.Decimal(0)).eq(total)) {
      addReason(conflicts, reason('FINANCIAL_MISMATCH', { ...detail, source: 'components' }));
    }
    const discountBasis = exact(row.componentEvidence?.discountBasis ?? null, 12);
    if (discountBasis == null || row.discountEligible == null) {
      addReason(repair, reason('MISSING_DISCOUNT_EVIDENCE', detail));
    } else if (discountBasis.lt(0) || (!row.discountEligible && !discountBasis.eq(0))) {
      addReason(conflicts, reason('FINANCIAL_MISMATCH', { ...detail, source: 'discount-basis' }));
    }
    if (!row.snapshotHash) addReason(repair, reason('ROW_SNAPSHOT_NOT_FOUND', detail));
    else if (!hashIsValid(row.snapshotHash)) addReason(conflicts, reason('HASH_MISMATCH', detail));
  }

  const gross = exact(candidate.grossAmount, 12);
  const declaredDiscount = exact(candidate.discountAmount, 12);
  const net = exact(candidate.netAmount, 12);
  if (gross == null || declaredDiscount == null || net == null) {
    amountComplete = false;
    addReason(repair, reason('MISSING_TOTAL', { source: 'envelope' }));
  } else if ((amountComplete && !gross.eq(rowAmountTotal)) || !gross.minus(declaredDiscount).eq(net) || (discount && !discount.eq(declaredDiscount))) {
    addReason(conflicts, reason('FINANCIAL_MISMATCH', { source: 'envelope' }));
  }
  if (!hashIsValid(candidate.sourceIdentityHash) || !hashIsValid(candidate.sourceEvidenceHash)) {
    addReason(conflicts, reason('HASH_MISMATCH', { source: 'source-evidence' }));
  }

  let status: LegacyPricingStatus;
  let reasons: LegacyPricingReason[];
  if (candidate.existingSeal && candidate.existingSeal.sourceEvidenceHash !== candidate.sourceEvidenceHash) {
    status = 'STALE'; reasons = [reason('HASH_MISMATCH', { source: 'existing-seal' })];
  } else if (conflicts.length) {
    status = 'EVIDENCE_CONFLICT'; reasons = conflicts;
  } else if (repair.length) {
    status = 'REPAIR_REQUIRED'; reasons = repair;
  } else if (candidate.existingSeal) {
    status = 'READY'; reasons = [];
  } else if (!candidate.review) {
    status = 'LEGACY_REVIEW_REQUIRED'; reasons = [reason('MISSING_APPROVED_GRAPH_VERSION')];
  } else if (candidate.review.sourceEvidenceHash !== candidate.sourceEvidenceHash) {
    status = 'EVIDENCE_CONFLICT'; reasons = [reason('HASH_MISMATCH', { source: 'review' })];
  } else {
    status = 'READY'; reasons = [];
  }
  reasons.sort((left, right) => `${left.code}:${JSON.stringify(left.detail)}`.localeCompare(`${right.code}:${JSON.stringify(right.detail)}`));
  return {
    contractId: candidate.contractId,
    sourceFinancialRecordId: candidate.sourceFinancialRecordId,
    status,
    reasons,
    sourceCount: candidate.rows.length,
    sourceIdentityHash: candidate.sourceIdentityHash,
    sourceEvidenceHash: candidate.sourceEvidenceHash,
    quantityTotal: quantityComplete ? quantityTotal.toFixed(3) : null,
    amountTotal: amountComplete && net ? net.toFixed(12) : null,
  };
};

export type LegacyPricingManifestEntry = LegacyPricingClassification & { quarantined: boolean };
export type LegacyPricingManifest = {
  schemaVersion: 1;
  sourceContractCount: string;
  sourceApprovalRecordCount: string;
  sourceRowCount: string;
  sourceIdentityHash: string;
  sourceEvidenceHash: string;
  quantityTotal: string | null;
  amountTotal: string | null;
  knownQuantitySubtotal: string;
  knownAmountSubtotal: string;
  quantityMissingEntryCount: number;
  amountMissingEntryCount: number;
  counts: Record<LegacyPricingStatus, number>;
  entries: LegacyPricingManifestEntry[];
  manifestHash: string;
};

export const buildLegacyPricingManifest = (candidates: readonly LegacyPricingCandidate[]): LegacyPricingManifest => {
  const entries = candidates.map(classifyLegacyPricingCandidate)
    .sort((left, right) => `${left.contractId}:${left.sourceFinancialRecordId}`.localeCompare(`${right.contractId}:${right.sourceFinancialRecordId}`))
    .map(item => ({ ...item, quarantined: ['REPAIR_REQUIRED', 'EVIDENCE_CONFLICT', 'STALE'].includes(item.status) }));
  const counts = Object.fromEntries(LEGACY_PRICING_STATUSES.map(status => [status, entries.filter(item => item.status === status).length])) as Record<LegacyPricingStatus, number>;
  const quantityComplete = entries.every(item => item.quantityTotal != null);
  const amountComplete = entries.every(item => item.amountTotal != null);
  const knownQuantitySubtotal = entries.reduce((sum, item) => item.quantityTotal == null ? sum : sum.plus(item.quantityTotal), new Prisma.Decimal(0)).toFixed(3);
  const knownAmountSubtotal = entries.reduce((sum, item) => item.amountTotal == null ? sum : sum.plus(item.amountTotal), new Prisma.Decimal(0)).toFixed(12);
  const quantityTotal = quantityComplete ? knownQuantitySubtotal : null;
  const amountTotal = amountComplete ? knownAmountSubtotal : null;
  const body = {
    schemaVersion: 1 as const,
    sourceContractCount: String(entries.length),
    sourceApprovalRecordCount: String(candidates.reduce((count, item) => count + item.approvalLeaves.length, 0)),
    sourceRowCount: String(entries.reduce((count, item) => count + item.sourceCount, 0)),
    sourceIdentityHash: hashCanonicalEvidence(entries.map(item => ({ contractId: item.contractId, sourceFinancialRecordId: item.sourceFinancialRecordId, sourceIdentityHash: item.sourceIdentityHash }))),
    sourceEvidenceHash: hashCanonicalEvidence(entries.map(item => ({ contractId: item.contractId, sourceEvidenceHash: item.sourceEvidenceHash }))),
    quantityTotal,
    amountTotal,
    knownQuantitySubtotal,
    knownAmountSubtotal,
    quantityMissingEntryCount: entries.filter(item => item.quantityTotal == null).length,
    amountMissingEntryCount: entries.filter(item => item.amountTotal == null).length,
    counts,
    entries,
  };
  return { ...body, manifestHash: hashCanonicalEvidence(body) };
};

export type LegacyPricingSealCommand = {
  idempotencyKey: string;
  origin: 'LEGACY_SEAL';
  candidate: LegacyPricingCandidate;
  review: LegacyPricingReview;
  sourceReference: {
    contractId: string;
    sourceFinancialRecordId: string;
    sourceIdentityHash: string;
    sourceEvidenceHash: string;
  };
};

export interface LegacyPricingSealWriter {
  seal(command: LegacyPricingSealCommand): Promise<{ outcome: 'SEALED' | 'REPLAYED'; pricingVersionId: string }>;
}

export type LegacyPricingSealOptions = {
  afterEach?: (completed: number) => void | Promise<void>;
  recapture?: () => Promise<readonly LegacyPricingCandidate[]>;
};

export type LegacyPricingSourceDifference =
  | 'SOURCE_CONTRACT_COUNT'
  | 'SOURCE_APPROVAL_RECORD_COUNT'
  | 'SOURCE_ROW_COUNT'
  | 'SOURCE_IDENTITY_HASH'
  | 'SOURCE_EVIDENCE_HASH'
  | 'QUANTITY_TOTAL'
  | 'AMOUNT_TOTAL'
  | 'KNOWN_QUANTITY_SUBTOTAL'
  | 'KNOWN_AMOUNT_SUBTOTAL';

export const compareLegacyPricingSourceManifests = (
  before: LegacyPricingManifest,
  after: LegacyPricingManifest,
): { matched: boolean; differences: LegacyPricingSourceDifference[] } => {
  const differences: LegacyPricingSourceDifference[] = [];
  if (before.sourceContractCount !== after.sourceContractCount) differences.push('SOURCE_CONTRACT_COUNT');
  if (before.sourceApprovalRecordCount !== after.sourceApprovalRecordCount) differences.push('SOURCE_APPROVAL_RECORD_COUNT');
  if (before.sourceRowCount !== after.sourceRowCount) differences.push('SOURCE_ROW_COUNT');
  if (before.sourceIdentityHash !== after.sourceIdentityHash) differences.push('SOURCE_IDENTITY_HASH');
  if (before.sourceEvidenceHash !== after.sourceEvidenceHash) differences.push('SOURCE_EVIDENCE_HASH');
  if (before.quantityTotal !== after.quantityTotal) differences.push('QUANTITY_TOTAL');
  if (before.amountTotal !== after.amountTotal) differences.push('AMOUNT_TOTAL');
  if (before.knownQuantitySubtotal !== after.knownQuantitySubtotal) differences.push('KNOWN_QUANTITY_SUBTOTAL');
  if (before.knownAmountSubtotal !== after.knownAmountSubtotal) differences.push('KNOWN_AMOUNT_SUBTOTAL');
  return { matched: differences.length === 0, differences };
};

export const runLegacyPricingSeal = async (
  candidates: readonly LegacyPricingCandidate[],
  writer: LegacyPricingSealWriter,
  options: LegacyPricingSealOptions = {},
) => {
  const beforeManifest = buildLegacyPricingManifest(candidates);
  const byIdentity = new Map(candidates.map(item => [`${item.contractId}:${item.sourceFinancialRecordId}`, item]));
  const results: Array<{ contractId: string; sourceFinancialRecordId: string; outcome: 'SEALED' | 'REPLAYED'; pricingVersionId: string }> = [];
  for (const entry of beforeManifest.entries.filter(item => item.status === 'READY')) {
    const candidate = byIdentity.get(`${entry.contractId}:${entry.sourceFinancialRecordId}`)!;
    if (candidate.existingSeal) {
      results.push({ contractId: entry.contractId, sourceFinancialRecordId: entry.sourceFinancialRecordId, outcome: 'REPLAYED', pricingVersionId: candidate.existingSeal.pricingVersionId });
    } else {
      if (!candidate.review) throw new Error('READY legacy pricing evidence requires an immutable review decision.');
      const result = await writer.seal({
        idempotencyKey: hashCanonicalEvidence({ scope: 'legacy-pricing-seal', contractId: candidate.contractId, sourceFinancialRecordId: candidate.sourceFinancialRecordId, sourceEvidenceHash: candidate.sourceEvidenceHash }),
        origin: 'LEGACY_SEAL',
        candidate,
        review: candidate.review,
        sourceReference: {
          contractId: candidate.contractId,
          sourceFinancialRecordId: candidate.sourceFinancialRecordId,
          sourceIdentityHash: candidate.sourceIdentityHash,
          sourceEvidenceHash: candidate.sourceEvidenceHash,
        },
      });
      results.push({ contractId: entry.contractId, sourceFinancialRecordId: entry.sourceFinancialRecordId, ...result });
    }
    await options.afterEach?.(results.length);
  }
  const afterManifest = options.recapture ? buildLegacyPricingManifest(await options.recapture()) : beforeManifest;
  const sourceComparison = compareLegacyPricingSourceManifests(beforeManifest, afterManifest);
  return {
    status: sourceComparison.matched ? 'COMPLETED' as const : 'FAILED' as const,
    reason: sourceComparison.matched ? null : 'SOURCE_EVIDENCE_CHANGED_DURING_SEALING' as const,
    beforeManifest,
    afterManifest,
    sourceComparison,
    results,
    outcomeCounts: {
      SEALED: results.filter(item => item.outcome === 'SEALED').length,
      REPLAYED: results.filter(item => item.outcome === 'REPLAYED').length,
    },
  };
};

export * from './source';
export * from './prismaSource';
export * from './canonicalEvidence';
export * from './approvalLeaf';
export * from './approvedPricingWriter';
