import type { Prisma, PrismaClient } from '@prisma/client';
import { buildLegacyPricingCandidate, type LegacyPricingSourceInput } from './source';
import type { LegacyPricingCandidate, LegacyPricingReview } from './index';

type LegacyPricingReadDatabase = Pick<PrismaClient, 'accountingFinancialRecord' | 'salesContract'>;

export type LegacyPricingReviewDecision = LegacyPricingReview & {
  contractId: string;
  sourceFinancialRecordId: string;
};

const jsonObject = (value: Prisma.JsonValue | null): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const legacyHash = (value: Prisma.JsonValue | null): string | null => {
  const source = jsonObject(value);
  return typeof source.sourceEvidenceHash === 'string' ? source.sourceEvidenceHash : null;
};

export const loadLegacyPricingCandidates = async (
  database: LegacyPricingReadDatabase,
  reviews: readonly LegacyPricingReviewDecision[] = [],
): Promise<LegacyPricingCandidate[]> => {
  const contracts = await database.salesContract.findMany({
    where: { productGraphState: { is: null } },
    include: {
      items: { orderBy: { id: 'asc' } },
      approvedPricingVersions: {
        where: { origin: 'LEGACY_SEAL' },
        select: { id: true, sourceFinancialRecordId: true, legacySourceReference: true },
      },
    },
    orderBy: { id: 'asc' },
  });
  const contractIds = contracts.map(contract => contract.id);
  const records = await database.accountingFinancialRecord.findMany({
    where: { kind: 'INVOICE_CANDIDATE', contractId: { in: contractIds } },
    include: { invoiceItems: { orderBy: { id: 'asc' } } },
    orderBy: [{ contractId: 'asc' }, { financiallyApprovedAt: 'desc' }, { id: 'asc' }],
  });
  const recordsByContract = new Map<string, typeof records>();
  for (const record of records) {
    if (!record.contractId) continue;
    const grouped = recordsByContract.get(record.contractId) ?? [];
    grouped.push(record);
    recordsByContract.set(record.contractId, grouped);
  }
  return contracts.map(contract => {
    const financialRecords: LegacyPricingSourceInput['financialRecords'] = (recordsByContract.get(contract.id) ?? []).map(record => ({
      id: record.id,
      kind: record.kind,
      status: record.status,
      approvedAt: record.financiallyApprovedAt?.toISOString() ?? null,
      approvedBy: record.financiallyApprovedBy,
      currency: record.currency,
      customerId: record.customerId,
      amount: record.amount.toFixed(12),
      sourceId: record.sourceId,
      sourceSnapshot: record.sourceSnapshot,
      metadata: record.metadata,
      invoiceItems: record.invoiceItems.map(item => ({
        id: item.id,
        contractItemId: item.contractItemId,
        productId: item.productId,
        quantity: item.quantity.toFixed(3),
        totalPrice: item.totalPrice.toFixed(12),
      })),
    }));
    const selectedRecordId = financialRecords.find(record =>
      record.kind === 'INVOICE_CANDIDATE'
      && ['ISSUED', 'POSTED'].includes(record.status)
      && record.approvedAt
      && record.approvedBy)?.id ?? financialRecords[0]?.id ?? '';
    const existingVersion = contract.approvedPricingVersions.find(version => version.sourceFinancialRecordId === selectedRecordId);
    const existingHash = existingVersion ? legacyHash(existingVersion.legacySourceReference) : null;
    const base = buildLegacyPricingCandidate({
      contract: {
        id: contract.id,
        currency: contract.currency,
        customerId: contract.customerId,
        items: contract.items.map(item => ({
          id: item.id,
          productId: item.productId,
          productRowId: item.productRowId,
          productType: item.productType,
          quantity: item.quantity.toFixed(3),
          totalPrice: item.totalPrice.toFixed(12),
        })),
      },
      financialRecords,
      existingSeal: existingVersion && existingHash ? { pricingVersionId: existingVersion.id, sourceEvidenceHash: existingHash } : null,
      review: null,
    });
    const review = reviews.find(item => item.contractId === base.contractId && item.sourceFinancialRecordId === base.sourceFinancialRecordId) ?? null;
    return review ? { ...base, review: {
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
      sourceEvidenceHash: review.sourceEvidenceHash,
      decision: review.decision,
      reason: review.reason,
    } } : base;
  });
};

export const parseLegacyPricingReviews = (value: unknown): LegacyPricingReviewDecision[] => {
  if (!Array.isArray(value)) throw new Error('Legacy pricing reviews must be a JSON array.');
  const decisions = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Legacy pricing review ${index} is invalid.`);
    const review = item as Record<string, unknown>;
    const required = (key: string) => {
      const entry = review[key];
      if (typeof entry !== 'string' || !entry.trim()) throw new Error(`Legacy pricing review ${index} is missing ${key}.`);
      return entry.trim();
    };
    const decision = required('decision');
    if (decision !== 'APPROVE_SEAL') throw new Error(`Legacy pricing review ${index} has an unsupported decision.`);
    const sourceEvidenceHash = required('sourceEvidenceHash');
    if (!/^[a-f0-9]{64}$/i.test(sourceEvidenceHash)) throw new Error(`Legacy pricing review ${index} has an invalid sourceEvidenceHash.`);
    const reviewedAt = required('reviewedAt');
    if (Number.isNaN(Date.parse(reviewedAt))) throw new Error(`Legacy pricing review ${index} has an invalid reviewedAt.`);
    return {
      contractId: required('contractId'),
      sourceFinancialRecordId: required('sourceFinancialRecordId'),
      reviewedBy: required('reviewedBy'),
      reviewedAt,
      sourceEvidenceHash,
      decision: 'APPROVE_SEAL' as const,
      reason: required('reason'),
    };
  });
  const identities = decisions.map(item => `${item.contractId}:${item.sourceFinancialRecordId}`);
  if (new Set(identities).size !== identities.length) throw new Error('Legacy pricing reviews contain duplicate source identities.');
  return decisions;
};
