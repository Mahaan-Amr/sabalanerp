import Decimal from 'decimal.js';
import { parseCanonicalDecimal } from './canonicalDecimal';

export interface LegacyProductSemanticRepairEvidence {
  readonly productRowId: string;
  readonly repairKinds: readonly (
    | 'longitudinal-customer-geometry'
    | 'unsplit-whole-row-operation-scope'
  )[];
  readonly repairedFields: readonly string[];
  readonly legacyTotalAmountToman: string;
  readonly canonicalTotalAmountToman: string;
}

export interface LegacyProductSemanticRepairCandidate {
  readonly productIndex: number;
  readonly productRowId: string;
  readonly product: Readonly<Record<string, unknown>>;
  readonly repairKinds: LegacyProductSemanticRepairEvidence['repairKinds'];
  readonly repairedFields: readonly string[];
}

const recordFrom = (
  value: unknown
): Readonly<Record<string, unknown>> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;

const decimalFrom = (value: unknown): Decimal | undefined => {
  try {
    const decimal = new Decimal(String(value));
    return decimal.isFinite() ? decimal : undefined;
  } catch {
    return undefined;
  }
};

const canonical = (value: Decimal) =>
  parseCanonicalDecimal(value.toFixed());

const displayedLengthMeters = (
  product: Readonly<Record<string, unknown>>
): Decimal | undefined => {
  const length = decimalFrom(product.length);
  if (!length?.gt(0)) return undefined;
  return product.lengthUnit === 'cm' ? length.div(100) : length;
};

export const deriveLegacyProductSemanticRepairCandidates = (
  products: readonly Readonly<Record<string, unknown>>[]
): readonly LegacyProductSemanticRepairCandidate[] =>
  products.flatMap((product, productIndex) => {
    if (
      product.productType !== 'longitudinal' ||
      Number(product.quantity ?? 0) !== 0 ||
      product.smartCutDerivedQuantity !== true
    ) {
      return [];
    }
    const longitudinal = recordFrom(product.longitudinalPolicyInput);
    const operations = recordFrom(product.operationPolicyInput);
    const optimizer = recordFrom(product.smartCutPlan);
    if (
      !longitudinal ||
      !operations ||
      !optimizer ||
      optimizer.derivedQuantity !== true ||
      longitudinal.quantity !== undefined ||
      operations.quantity !== undefined ||
      longitudinal.lastManualField === 'area'
    ) {
      return [];
    }

    const visibleLength = displayedLengthMeters(product);
    const optimizerLength = decimalFrom(optimizer.totalRequestedLengthM);
    const operationLength = decimalFrom(operations.lengthMeters);
    const staleLongitudinalLength = decimalFrom(longitudinal.lengthMeters);
    const width = decimalFrom(longitudinal.widthMeters);
    const visibleArea = decimalFrom(product.squareMeters);
    const optimizerArea = decimalFrom(optimizer.requestedAreaSqm);
    if (
      !visibleLength?.gt(0) ||
      !optimizerLength?.eq(visibleLength) ||
      !operationLength?.eq(visibleLength) ||
      !staleLongitudinalLength?.gt(0) ||
      staleLongitudinalLength.eq(visibleLength) ||
      !width?.gt(0) ||
      !visibleArea?.eq(visibleLength.times(width)) ||
      !optimizerArea?.eq(visibleArea)
    ) {
      return [];
    }

    const groups = Array.isArray(operations.groups)
      ? operations.groups.map(recordFrom)
      : [];
    const followsStaleWholeRow =
      groups.length === 1 &&
      groups[0] !== undefined &&
      decimalFrom(groups[0].scope)?.eq(staleLongitudinalLength) === true;
    const nextOperations = followsStaleWholeRow
      ? {
          ...operations,
          groups: [{
            ...groups[0],
            scope: canonical(visibleLength)
          }]
        }
      : operations;
    const productRowId = String(
      product.rowId ?? product.productRowId ?? `legacy-product-${productIndex}`
    );
    const repairedFields = [
      'longitudinalPolicyInput.lengthMeters',
      'longitudinalPolicyInput.requestedAreaSquareMeters',
      ...(followsStaleWholeRow
        ? ['operationPolicyInput.groups.0.scope']
        : [])
    ];
    const repairKinds: LegacyProductSemanticRepairEvidence['repairKinds'] = [
      'longitudinal-customer-geometry',
      ...(followsStaleWholeRow
        ? ['unsplit-whole-row-operation-scope' as const]
        : [])
    ];

    return [{
      productIndex,
      productRowId,
      product: {
        ...product,
        longitudinalPolicyInput: {
          ...longitudinal,
          lengthMeters: canonical(visibleLength),
          requestedAreaSquareMeters: canonical(visibleArea)
        },
        operationPolicyInput: nextOperations
      },
      repairKinds,
      repairedFields
    }];
  });
