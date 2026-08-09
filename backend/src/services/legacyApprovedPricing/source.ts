import { Prisma } from '@prisma/client';
import { canonicalApprovedPricingHash } from '../approvedPricing';
import { isCompleteValidApprovalLeaf } from './approvalLeaf';
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
      productType: string | null;
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
    sourceId: string | null;
    sourceSnapshot: unknown;
    metadata: unknown;
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

type MoneyCurrency = 'TOMAN' | 'RIAL';
const moneyCurrency = (currency: unknown): MoneyCurrency | null => {
  const normalized = text(currency)?.toLowerCase();
  if (normalized === 'تومان' || normalized === 'toman') return 'TOMAN';
  if (normalized === 'ریال' || normalized === 'rial' || normalized === 'irr') return 'RIAL';
  return null;
};
const rialCurrency = (currency: unknown): string | null => moneyCurrency(currency) ? 'ریال' : null;
const toRial = (value: unknown, currency: unknown): string | null => {
  const amount = decimal(value, 12);
  const unit = moneyCurrency(currency);
  if (!amount || !unit) return null;
  return new Prisma.Decimal(amount).mul(unit === 'TOMAN' ? 10 : 1).toFixed(12);
};
const owns = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key);

const legacyComponentEvidence = (product: Record<string, unknown>, currency: unknown) => {
  const material = owns(product, 'originalTotalPrice') ? toRial(product.originalTotalPrice, currency) : null;
  const cutting = owns(product, 'cuttingCost') ? toRial(product.cuttingCost, currency) : null;
  const toolingSnapshot = owns(product, 'totalSubServiceCost') ? toRial(product.totalSubServiceCost, currency) : null;
  const tools = Array.isArray(product.appliedSubServices) ? product.appliedSubServices.map(object) : [];
  const toolAmounts = tools.map(tool => toRial(tool.cost, currency));
  const toolingFromRows = toolAmounts.every((value): value is string => value != null)
    ? toolAmounts.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(12)
    : null;
  let conflict = Boolean(toolingSnapshot && toolingFromRows && toolingSnapshot !== toolingFromRows);

  const finishings = Array.isArray(product.finishings) ? product.finishings.map(object) : [];
  const finishingAmounts = finishings.map(finishing => toRial(finishing.cost, currency));
  const finishingFromRows = finishingAmounts.length && finishingAmounts.every((value): value is string => value != null)
    ? finishingAmounts.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(12)
    : null;
  const hasFinishing = Boolean(text(product.finishingId) || finishings.length || object(product.meta).finishing);
  const finishingSnapshot = owns(product, 'finishingCost')
    ? toRial(product.finishingCost ?? (hasFinishing ? null : 0), currency)
    : hasFinishing ? null : new Prisma.Decimal(0).toFixed(12);
  if (finishingSnapshot && finishingFromRows && finishingSnapshot !== finishingFromRows) conflict = true;

  const mandatoryEnabled = product.isMandatory === true;
  const percentage = decimal(product.mandatoryPercentage, 12);
  const mandatory = mandatoryEnabled
    ? material && percentage ? new Prisma.Decimal(material).mul(percentage).div(100).toFixed(12) : null
    : new Prisma.Decimal(0).toFixed(12);
  const discountEligible = material == null ? null : new Prisma.Decimal(material).gt(0) && object(product.meta).isLayer !== true;
  return {
    discountEligible,
    conflict,
    evidence: {
      material,
      mandatory,
      cutting,
      tooling: toolingSnapshot,
      finishing: finishingSnapshot,
      discountBasis: discountEligible == null ? null : discountEligible ? material : new Prisma.Decimal(0).toFixed(12),
    },
  };
};

const approvedLeaf = (record: LegacyPricingSourceInput['financialRecords'][number]): LegacyPricingApprovalLeaf => ({
  id: record.id,
  kind: record.kind,
  status: record.status,
  approvedAt: record.approvedAt,
  approvedBy: record.approvedBy,
});
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
  const valid = records.filter(isCompleteValidApprovalLeaf);
  const selected = valid[0] ?? records[0] ?? null;
  const snapshot = object(selected?.sourceSnapshot);
  const contractData = object(snapshot.contractData);
  const snapshotItems = array(snapshot.items);
  const products = array(contractData.products);
  const invoiceItems = selected?.invoiceItems ?? [];
  const project = object(contractData.project);
  const discount = object(contractData.discount);
  const snapshotCurrency = text(snapshot.currency);

  const rows = source.contract.items.map(item => {
    const approvalItem = snapshotItems.find(candidate => text(candidate.id) === item.id) ?? null;
    const invoiceItem = invoiceItems.find(candidate => candidate.contractItemId === item.id) ?? null;
    const product = item.productRowId
      ? products.find(candidate => text(candidate.rowId ?? candidate.productRowId) === item.productRowId) ?? null
      : null;
    const productCurrency = product ? text(product.currency) : null;
    const components = product ? legacyComponentEvidence(product, productCurrency) : null;
    return {
      contractItemId: item.id,
      relationalProductRowId: item.productRowId,
      snapshotProductRowId: product ? text(product.rowId ?? product.productRowId) : null,
      relationalProductId: item.productId,
      snapshotProductId: product ? text(product.productId) : null,
      currencyEvidence: {
        contract: rialCurrency(source.contract.currency),
        approvalSnapshot: rialCurrency(snapshotCurrency),
        productSnapshot: rialCurrency(productCurrency),
        financialRecord: rialCurrency(selected?.currency),
      },
      quantity: product ? productQuantity(product) : null,
      quantityEvidence: {
        contractItem: decimal(item.quantity, 3),
        approvalItem: decimal(approvalItem?.quantity, 3),
        invoiceItem: decimal(invoiceItem?.quantity, 3),
      },
      unit: product ? productUnit(product) : null,
      canonicalAllInTotal: product ? toRial(product.totalPrice, productCurrency) : null,
      amountEvidence: {
        contractItem: toRial(item.totalPrice, source.contract.currency),
        approvalItem: toRial(approvalItem?.totalPrice, snapshotCurrency),
        invoiceItem: toRial(invoiceItem?.totalPrice, selected?.currency),
      },
      discountEligible: components?.discountEligible ?? null,
      componentEvidence: components?.evidence ?? null,
      componentEvidenceConflict: components?.conflict ?? false,
      snapshotHash: product && approvalItem && invoiceItem ? canonicalApprovedPricingHash({ product, approvalItem, invoiceItem }) : null,
    };
  });
  const rowTotals = rows.map(row => decimal(row.canonicalAllInTotal, 12));
  const grossAmount = rowTotals.length && rowTotals.every((value): value is string => value != null)
    ? rowTotals.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(12)
    : null;
  const discountAmount = toRial(discount.amount, snapshotCurrency);
  const evidence = {
    contract: source.contract,
    financialRecord: selected,
    snapshot,
    rows: rows.map(row => ({ contractItemId: row.contractItemId, snapshotHash: row.snapshotHash })),
  };
  return {
    contractId: source.contract.id,
    sourceFinancialRecordId: selected?.id ?? '',
    approvalLeaves: records.map(approvedLeaf),
    currency: rialCurrency(source.contract.currency),
    customerId: source.contract.customerId,
    projectId: text(contractData.projectId),
    destination: text(project.address),
    envelopeEvidence: {
      financialCurrency: rialCurrency(selected?.currency),
      financialCustomerId: selected?.customerId ?? null,
      snapshotCurrency: rialCurrency(snapshotCurrency),
      snapshotCustomerId: text(snapshot.customerId ?? contractData.customerId),
      snapshotProjectId: text(contractData.projectId),
    },
    discount: Object.keys(discount).length ? {
      enabled: typeof discount.enabled === 'boolean' ? discount.enabled : false,
      baseAmount: toRial(discount.baseSubtotal, snapshotCurrency),
      amount: discountAmount,
    } : null,
    rows,
    grossAmount,
    discountAmount,
    netAmount: toRial(selected?.amount ?? null, selected?.currency),
    sourceIdentityHash: canonicalApprovedPricingHash({ contractId: source.contract.id, financialRecordId: selected?.id ?? null, itemIds: source.contract.items.map(item => item.id) }),
    sourceEvidenceHash: canonicalApprovedPricingHash(evidence),
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
