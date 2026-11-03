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
      id: string;
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
const canonicalCurrency = (currency: unknown): string | null => {
  const unit = moneyCurrency(currency);
  return unit === 'TOMAN' ? 'تومان' : unit === 'RIAL' ? 'ریال' : null;
};
const toContractMoney = (value: unknown, valueCurrency: unknown, contractCurrency: unknown): string | null => {
  const amount = decimal(value, 12);
  const from = moneyCurrency(valueCurrency);
  const to = moneyCurrency(contractCurrency);
  if (!amount || !from || !to) return null;
  if (from === to) return amount;
  if (from === 'RIAL' && to === 'TOMAN') return new Prisma.Decimal(amount).div(10).toFixed(12);
  return null;
};
const owns = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key);

const legacyComponentEvidence = (product: Record<string, unknown>, currency: unknown, contractCurrency: unknown) => {
  const material = owns(product, 'originalTotalPrice') ? toContractMoney(product.originalTotalPrice, currency, contractCurrency) : null;
  const cutting = owns(product, 'cuttingCost') ? toContractMoney(product.cuttingCost, currency, contractCurrency) : null;
  const toolingSnapshot = owns(product, 'totalSubServiceCost') ? toContractMoney(product.totalSubServiceCost, currency, contractCurrency) : null;
  const tools = Array.isArray(product.appliedSubServices) ? product.appliedSubServices.map(object) : [];
  const toolAmounts = tools.map(tool => toContractMoney(tool.cost, currency, contractCurrency));
  const toolingFromRows = toolAmounts.every((value): value is string => value != null)
    ? toolAmounts.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(12)
    : null;
  let conflict = Boolean(toolingSnapshot && toolingFromRows && toolingSnapshot !== toolingFromRows);

  const finishings = Array.isArray(product.finishings) ? product.finishings.map(object) : [];
  const finishingAmounts = finishings.map(finishing => toContractMoney(finishing.cost, currency, contractCurrency));
  const finishingFromRows = finishingAmounts.length && finishingAmounts.every((value): value is string => value != null)
    ? finishingAmounts.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(12)
    : null;
  const hasFinishing = Boolean(text(product.finishingId) || finishings.length || object(product.meta).finishing);
  const finishingSnapshot = owns(product, 'finishingCost')
    ? toContractMoney(product.finishingCost ?? (hasFinishing ? null : 0), currency, contractCurrency)
    : hasFinishing ? null : new Prisma.Decimal(0).toFixed(12);
  if (finishingSnapshot && finishingFromRows && finishingSnapshot !== finishingFromRows) conflict = true;

  const mandatoryEnabled = typeof product.isMandatory === 'boolean' ? product.isMandatory : null;
  const percentage = decimal(product.mandatoryPercentage, 12);
  const mandatory = mandatoryEnabled === true
    ? material && percentage ? new Prisma.Decimal(material).mul(percentage).div(100).toFixed(12) : null
    : mandatoryEnabled === false ? new Prisma.Decimal(0).toFixed(12) : null;
  const isLayer = object(product.meta).isLayer;
  const discountEligible = material == null || typeof isLayer !== 'boolean'
    ? null
    : isLayer === false && new Prisma.Decimal(material).gt(0);
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

const contractedQuantityWitness = (product: Record<string, unknown>, rawWitness: unknown): string | null => {
  const raw = decimal(rawWitness, 3);
  const type = text(product.productType)?.toLowerCase();
  const expectedRaw = decimal(type === 'prepared' ? product.preparedQuantity ?? product.quantity : product.quantity, 3);
  const contracted = productQuantity(product);
  if (!raw || !expectedRaw || !contracted) return null;
  return new Prisma.Decimal(raw).eq(expectedRaw) ? contracted : raw;
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
  const relationalRowCounts = new Map<string, number>();
  for (const item of source.contract.items) if (item.productRowId) relationalRowCounts.set(item.productRowId, (relationalRowCounts.get(item.productRowId) ?? 0) + 1);
  const snapshotRowCounts = new Map<string, number>();
  for (const product of products) {
    const rowId = text(product.rowId ?? product.productRowId);
    if (rowId) snapshotRowCounts.set(rowId, (snapshotRowCounts.get(rowId) ?? 0) + 1);
  }

  const rows = source.contract.items.map(item => {
    const approvalItem = snapshotItems.find(candidate => text(candidate.id) === item.id) ?? null;
    const invoiceItem = invoiceItems.find(candidate => candidate.contractItemId === item.id) ?? null;
    const duplicatedIdentity = Boolean(item.productRowId
      && ((relationalRowCounts.get(item.productRowId) ?? 0) > 1 || (snapshotRowCounts.get(item.productRowId) ?? 0) > 1));
    const product = item.productRowId && !duplicatedIdentity
      ? products.find(candidate => text(candidate.rowId ?? candidate.productRowId) === item.productRowId) ?? null
      : null;
    const productCurrency = product ? text(product.currency) : null;
    const components = product ? legacyComponentEvidence(product, productCurrency, source.contract.currency) : null;
    return {
      contractItemId: item.id,
      relationalProductRowId: item.productRowId,
      snapshotProductRowId: product ? text(product.rowId ?? product.productRowId) : null,
      relationalProductId: item.productId,
      snapshotProductId: product ? text(product.productId) : null,
      currencyEvidence: {
        contract: canonicalCurrency(source.contract.currency),
        approvalSnapshot: canonicalCurrency(snapshotCurrency) === canonicalCurrency(source.contract.currency) ? canonicalCurrency(source.contract.currency) : null,
        productSnapshot: canonicalCurrency(productCurrency) === canonicalCurrency(source.contract.currency) ? canonicalCurrency(source.contract.currency) : null,
        financialRecord: toContractMoney(0, selected?.currency, source.contract.currency) == null ? null : canonicalCurrency(source.contract.currency),
      },
      quantity: product ? productQuantity(product) : null,
      quantityEvidence: {
        contractItem: product ? contractedQuantityWitness(product, item.quantity) : decimal(item.quantity, 3),
        approvalItem: product ? contractedQuantityWitness(product, approvalItem?.quantity) : decimal(approvalItem?.quantity, 3),
        invoiceItem: product ? contractedQuantityWitness(product, invoiceItem?.quantity) : decimal(invoiceItem?.quantity, 3),
      },
      unit: product ? productUnit(product) : null,
      canonicalAllInTotal: product ? toContractMoney(product.totalPrice, productCurrency, source.contract.currency) : null,
      amountEvidence: {
        contractItem: toContractMoney(item.totalPrice, source.contract.currency, source.contract.currency),
        approvalItem: toContractMoney(approvalItem?.totalPrice, snapshotCurrency, source.contract.currency),
        invoiceItem: toContractMoney(invoiceItem?.totalPrice, selected?.currency, source.contract.currency),
      },
      discountEligible: components?.discountEligible ?? null,
      componentEvidence: components?.evidence ?? null,
      componentEvidenceConflict: components?.conflict ?? false,
      identityEvidenceConflict: duplicatedIdentity,
      snapshotHash: product && approvalItem && invoiceItem ? canonicalApprovedPricingHash({ product, approvalItem, invoiceItem }) : null,
    };
  });
  const rowTotals = rows.map(row => decimal(row.canonicalAllInTotal, 12));
  const grossAmount = rowTotals.length && rowTotals.every((value): value is string => value != null)
    ? rowTotals.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).toFixed(12)
    : null;
  const discountAmount = toContractMoney(discount.amount, snapshotCurrency, source.contract.currency);
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
    currency: canonicalCurrency(source.contract.currency),
    customerId: source.contract.customerId,
    projectId: text(contractData.projectId),
    destination: text(project.address),
    envelopeEvidence: {
      financialCurrency: toContractMoney(0, selected?.currency, source.contract.currency) == null ? null : canonicalCurrency(source.contract.currency),
      financialCustomerId: selected?.customerId ?? null,
      snapshotCurrency: canonicalCurrency(snapshotCurrency) === canonicalCurrency(source.contract.currency) ? canonicalCurrency(source.contract.currency) : null,
      snapshotCustomerId: text(snapshot.customerId ?? contractData.customerId),
      snapshotProjectId: text(contractData.projectId),
    },
    discount: Object.keys(discount).length ? {
      enabled: typeof discount.enabled === 'boolean' ? discount.enabled : false,
      baseAmount: toContractMoney(discount.baseSubtotal, snapshotCurrency, source.contract.currency),
      amount: discountAmount,
    } : null,
    rows,
    grossAmount,
    discountAmount,
    netAmount: toContractMoney(selected?.amount ?? null, selected?.currency, source.contract.currency),
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
