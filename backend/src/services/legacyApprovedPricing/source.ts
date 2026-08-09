import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  LegacyPricingApprovalLeaf,
  LegacyPricingCandidate,
  LegacyPricingReview,
} from './index';

export type LegacyPricingSourceInput = {
  contract: {
    id: string;
    currency: string | null;
    customerId: string | null;
    items: readonly {
      id: string;
      productId: string | null;
      productRowId: string | null;
      quantity: string | null;
      totalPrice: string | null;
    }[];
  };
  financialRecords: readonly {
    id: string;
    kind: string;
    status: string;
    approvedAt: string | null;
    approvedBy: string | null;
    currency: string | null;
    customerId: string | null;
    amount: string | null;
    sourceSnapshot: unknown;
    invoiceItems: readonly {
      contractItemId: string | null;
      productId: string | null;
      quantity: string | null;
      totalPrice: string | null;
    }[];
  }[];
  existingSeal: { pricingVersionId: string; sourceEvidenceHash: string } | null;
  review: LegacyPricingReview | null;
};

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(object) : [];
const text = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};
const decimal = (value: unknown, scale: number): string | null => {
  const raw = text(value);
  if (!raw) return null;
  try {
    const parsed = new Prisma.Decimal(raw);
    return parsed.isFinite() && parsed.decimalPlaces() <= scale ? parsed.toFixed(scale) : null;
  } catch {
    return null;
  }
};

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
  return String(value);
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

const approvedLeaf = (record: LegacyPricingSourceInput['financialRecords'][number]): LegacyPricingApprovalLeaf => ({
  id: record.id,
  kind: record.kind,
  status: record.status,
  approvedAt: record.approvedAt,
  approvedBy: record.approvedBy,
});
const isValidLeaf = (record: LegacyPricingSourceInput['financialRecords'][number]) =>
  record.kind === 'INVOICE_CANDIDATE'
  && ['ISSUED', 'POSTED'].includes(record.status)
  && Boolean(record.approvedAt && record.approvedBy);

const productQuantity = (product: Record<string, unknown>): string | null => {
  const type = text(product.productType)?.toLowerCase();
  if (type === 'prepared') return decimal(product.preparedQuantity ?? product.quantity, 3);
  if (type === 'slab') return decimal(product.squareMeters, 3);
  if (type === 'longitudinal') {
    const length = decimal(product.length, 12);
    const count = decimal(product.quantity, 3);
    const unit = text(product.lengthUnit);
    if (!length || !count || !unit) return null;
    const quantity = new Prisma.Decimal(length).mul(count);
    if (!['cm', 'm'].includes(unit)) return null;
    return (unit === 'cm' ? quantity.div(100) : quantity).toFixed(3);
  }
  return decimal(product.quantity, 3);
};

const productUnit = (product: Record<string, unknown>): string | null => {
  const type = text(product.productType)?.toLowerCase();
  if (type === 'prepared') return text(product.preparedUnit ?? product.unit);
  if (type === 'slab') return 'squareMeter';
  if (type === 'longitudinal') return ['m', 'cm'].includes(text(product.lengthUnit) ?? '') ? 'meter' : null;
  if (type) return 'count';
  return text(product.unit);
};

export const buildLegacyPricingCandidate = (source: LegacyPricingSourceInput): LegacyPricingCandidate => {
  const records = [...source.financialRecords].sort((left, right) =>
    `${right.approvedAt ?? ''}:${right.id}`.localeCompare(`${left.approvedAt ?? ''}:${left.id}`));
  const valid = records.filter(isValidLeaf);
  const selected = valid[0] ?? records[0] ?? null;
  const snapshot = object(selected?.sourceSnapshot);
  const contractData = object(snapshot.contractData);
  const snapshotItems = array(snapshot.items);
  const products = array(contractData.products);
  const invoiceItems = selected?.invoiceItems ?? [];
  const project = object(contractData.project);
  const discount = object(contractData.discount);

  const rows = source.contract.items.map(item => {
    const approvalItem = snapshotItems.find(candidate => text(candidate.id) === item.id) ?? null;
    const invoiceItem = invoiceItems.find(candidate => candidate.contractItemId === item.id) ?? null;
    const product = item.productRowId
      ? products.find(candidate => text(candidate.rowId ?? candidate.productRowId) === item.productRowId) ?? null
      : null;
    const componentSource = product ? object(product.componentEvidence) : {};
    const componentEvidence = Object.keys(componentSource).length
      ? Object.fromEntries(Object.entries(componentSource).map(([key, value]) => [key, decimal(value, 12)]))
      : null;
    return {
      contractItemId: item.id,
      relationalProductRowId: item.productRowId,
      snapshotProductRowId: product ? text(product.rowId ?? product.productRowId) : null,
      relationalProductId: item.productId,
      snapshotProductId: product ? text(product.productId) : null,
      quantity: product ? productQuantity(product) : null,
      quantityEvidence: {
        contractItem: decimal(item.quantity, 3),
        approvalItem: decimal(approvalItem?.quantity, 3),
        invoiceItem: decimal(invoiceItem?.quantity, 3),
      },
      unit: product ? productUnit(product) : null,
      canonicalAllInTotal: product ? decimal(product.totalPrice, 12) : null,
      amountEvidence: {
        contractItem: decimal(item.totalPrice, 12),
        approvalItem: decimal(approvalItem?.totalPrice, 12),
        invoiceItem: decimal(invoiceItem?.totalPrice, 12),
      },
      discountEligible: product && typeof product.discountEligible === 'boolean' ? product.discountEligible : null,
      componentEvidence,
      snapshotHash: product && approvalItem && invoiceItem ? digest({ product, approvalItem, invoiceItem }) : null,
    };
  });
  const rowTotals = rows.map(row => decimal(row.canonicalAllInTotal, 12));
  const grossAmount = rowTotals.length && rowTotals.every((value): value is string => value != null)
    ? rowTotals.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(12)
    : null;
  const discountAmount = decimal(discount.amount, 12);
  const evidence = {
    contract: source.contract,
    financialRecord: selected,
    snapshot,
    rows: rows.map(row => ({ contractItemId: row.contractItemId, snapshotHash: row.snapshotHash })),
  };
  return {
    contractId: source.contract.id,
    sourceFinancialRecordId: selected?.id ?? '',
    validApprovalLeaves: records.map(approvedLeaf),
    currency: source.contract.currency,
    customerId: source.contract.customerId,
    projectId: text(contractData.projectId),
    destination: text(project.address),
    envelopeEvidence: {
      financialCurrency: selected?.currency ?? null,
      financialCustomerId: selected?.customerId ?? null,
      snapshotCurrency: text(snapshot.currency),
      snapshotCustomerId: text(snapshot.customerId ?? contractData.customerId),
      snapshotProjectId: text(contractData.projectId),
    },
    discount: Object.keys(discount).length ? {
      enabled: typeof discount.enabled === 'boolean' ? discount.enabled : false,
      baseAmount: decimal(discount.baseSubtotal, 12),
      amount: discountAmount,
    } : null,
    rows,
    grossAmount,
    discountAmount,
    netAmount: decimal(selected?.amount ?? null, 12),
    sourceIdentityHash: digest({ contractId: source.contract.id, financialRecordId: selected?.id ?? null, itemIds: source.contract.items.map(item => item.id) }),
    sourceEvidenceHash: digest(evidence),
    existingSeal: source.existingSeal,
    review: source.review,
    rowCounts: {
      contractItems: source.contract.items.length,
      approvalItems: snapshotItems.length,
      productSnapshots: products.length,
      invoiceItems: invoiceItems.length,
    },
  };
};
