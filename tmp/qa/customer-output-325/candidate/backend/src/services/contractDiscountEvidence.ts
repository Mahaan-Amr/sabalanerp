import { Prisma } from '@prisma/client';
import { ApprovedPricingEvidenceError } from './approvedPricing/evidenceError';

// Discount reconstruction is an evidence interpreter, so its deliberate validation failures are typed.

export const LEGACY_NO_DISCOUNT_EVIDENCE_ORIGIN = {
  EXPLICIT_NULL: 'LEGACY_WIZARD_NULL',
  ABSENT_RECONCILED: 'LEGACY_WIZARD_ABSENT_RECONCILED',
} as const;

export const LEGACY_DISCOUNT_ELIGIBILITY_EVIDENCE_ORIGIN =
  'LEGACY_WIZARD_MISSING_IS_LAYER_AS_FALSE' as const;

const isNonZeroOrMalformedDecimal = (value: unknown) => {
  if (value === null || value === undefined || value === '') return false;
  try {
    return !new Prisma.Decimal(String(value)).eq(0);
  } catch {
    return true;
  }
};

const isExplicitZeroDecimal = (value: unknown) => {
  if (value === null || value === undefined || value === '') return false;
  try {
    return new Prisma.Decimal(String(value)).eq(0);
  } catch {
    return false;
  }
};

const positiveDiscountKeys = new Set([
  'discountAmount',
  'discountPercent',
  'appliedDiscountAmount',
  'appliedDiscountPercent',
  'contractDiscountAmount',
  'contractDiscountPercent',
]);

export const hasConflictingDiscountOrNonProductAdjustmentEvidence = (
  data: Readonly<Record<string, unknown>>,
) => {
  if ([...positiveDiscountKeys].some(key => isNonZeroOrMalformedDecimal(data[key]))) return true;
  const nestedDiscount = data.discount;
  if (nestedDiscount && typeof nestedDiscount === 'object' && !Array.isArray(nestedDiscount)) {
    const evidence = nestedDiscount as Record<string, unknown>;
    if (evidence.enabled === true || isNonZeroOrMalformedDecimal(evidence.amount) ||
      isNonZeroOrMalformedDecimal(evidence.percent)) {
      return true;
    }
  }
  const serviceRows = data.serviceRows;
  if (serviceRows === null || serviceRows === undefined) return false;
  if (!Array.isArray(serviceRows)) return true;
  return serviceRows.some(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return true;
    const service = row as Record<string, unknown>;
    const witnessedAmounts = ['totalPrice', 'amount']
      .filter(key => Object.prototype.hasOwnProperty.call(service, key))
      .map(key => service[key]);
    return witnessedAmounts.length === 0 || witnessedAmounts.some(value => !isExplicitZeroDecimal(value));
  });
};

export const isExplicitZeroDiscountInput = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const discount = value as Record<string, unknown>;
  const isZeroOrMissing = (candidate: unknown) => {
    if (candidate === null || candidate === undefined || candidate === '') return true;
    try {
      return new Prisma.Decimal(String(candidate)).eq(0);
    } catch {
      return false;
    }
  };
  return discount.enabled === false && isZeroOrMissing(discount.percent) && isZeroOrMissing(discount.amount);
};

export const contractDiscountEligibleBase = (
  snapshotByRow: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  rows: readonly { readonly productRowId: string; readonly baseAmountToman?: string | null }[],
) => contractDiscountEligibilityEvidence(snapshotByRow, rows).eligibleBase;

export const contractDiscountEligibilityEvidence = (
  snapshotByRow: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  rows: readonly { readonly productRowId: string; readonly baseAmountToman?: string | null }[],
  options: Readonly<{ allowLegacyMissingNonLayer?: boolean }> = {},
) => {
  const normalizedNonLayerProductRowIds: string[] = [];
  const eligibleBase = rows.reduce((sum, row) => {
    const snapshot = snapshotByRow.get(row.productRowId);
    if (!snapshot) throw new ApprovedPricingEvidenceError(`Canonical row ${row.productRowId} has no product snapshot`);
    const baseAmount = row.baseAmountToman == null ? null : new Prisma.Decimal(row.baseAmountToman);
    return isContractRowDiscountEligible(
      snapshot,
      baseAmount,
      row.productRowId,
      options.allowLegacyMissingNonLayer === true
        ? () => normalizedNonLayerProductRowIds.push(row.productRowId)
        : undefined,
    )
      ? sum.plus(baseAmount!)
      : sum;
  }, new Prisma.Decimal(0));
  return { eligibleBase, normalizedNonLayerProductRowIds };
};

export const isContractRowDiscountEligible = (
  snapshot: Readonly<Record<string, unknown>>,
  baseAmount: Prisma.Decimal | null,
  productRowId: string,
  normalizeMissingNonLayer?: () => void,
) => {
  const meta = snapshot.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new ApprovedPricingEvidenceError(`Product ${productRowId} discount metadata is missing or null`);
  }
  const isLayer = (meta as Record<string, unknown>).isLayer;
  if (isLayer === undefined && normalizeMissingNonLayer) {
    normalizeMissingNonLayer();
    if (baseAmount === null) throw new ApprovedPricingEvidenceError(`Product ${productRowId} base amount is missing or null`);
    return baseAmount.gt(0);
  }
  if (typeof isLayer !== 'boolean') {
    throw new ApprovedPricingEvidenceError(`Product ${productRowId} discount eligibility evidence is missing`);
  }
  if (isLayer) return false;
  if (baseAmount === null) throw new ApprovedPricingEvidenceError(`Product ${productRowId} base amount is missing or null`);
  return baseAmount.gt(0);
};
