import { ApprovedPricingEvidenceError } from './approvedPricing/evidenceError';

export const COMMERCIAL_QUANTITY_POLICY_VERSION = 'commercial-quantity-v1' as const;

export type CommercialQuantityRole = 'PIECE_COUNT' | 'MEASURED_QUANTITY' | 'BILLABLE_QUANTITY';
export type CommercialMeasurementUnit = 'count' | 'meter' | 'squareMeter' | 'ton';
export type CommercialProductFamily = 'longitudinal' | 'stair' | 'slab' | 'prepared' | 'volumetric';

export type CommercialQuantityPolicy = Readonly<{
  version: typeof COMMERCIAL_QUANTITY_POLICY_VERSION;
  productFamily: CommercialProductFamily;
  pieceCount: { role: 'PIECE_COUNT'; unit: 'count'; scale: 0 };
  measuredQuantity: { role: 'MEASURED_QUANTITY'; unit: CommercialMeasurementUnit; scale: number };
  billableQuantity: {
    role: 'BILLABLE_QUANTITY';
    basis: 'PIECE_COUNT' | 'MEASURED_QUANTITY';
    unit: CommercialMeasurementUnit;
    scale: number;
  };
  historicalPolicySelector: { graphSchemaVersion: 1; roundingPolicy: 'rounding-v1' | 'rounding-v2' };
}>;

const countPolicy = {
  pieceCount: { role: 'PIECE_COUNT', unit: 'count', scale: 0 },
  measuredQuantity: { role: 'MEASURED_QUANTITY', unit: 'count', scale: 0 },
  billableQuantity: { role: 'BILLABLE_QUANTITY', basis: 'PIECE_COUNT', unit: 'count', scale: 0 },
} as const;

const FAMILY_POLICY: Partial<Record<CommercialProductFamily, Omit<CommercialQuantityPolicy,
  'version' | 'productFamily' | 'historicalPolicySelector'>>> = {
  longitudinal: {
    pieceCount: { role: 'PIECE_COUNT', unit: 'count', scale: 0 },
    measuredQuantity: { role: 'MEASURED_QUANTITY', unit: 'meter', scale: 3 },
    billableQuantity: { role: 'BILLABLE_QUANTITY', basis: 'MEASURED_QUANTITY', unit: 'meter', scale: 3 },
  },
  stair: countPolicy,
  slab: {
    pieceCount: { role: 'PIECE_COUNT', unit: 'count', scale: 0 },
    measuredQuantity: { role: 'MEASURED_QUANTITY', unit: 'squareMeter', scale: 3 },
    billableQuantity: { role: 'BILLABLE_QUANTITY', basis: 'MEASURED_QUANTITY', unit: 'squareMeter', scale: 3 },
  },
  volumetric: countPolicy,
};

export const resolveCommercialQuantityPolicy = (input: {
  graphSchemaVersion: number;
  roundingPolicy: string;
  productFamily: string;
  commercialUnit?: string;
}): CommercialQuantityPolicy => {
  if (input.graphSchemaVersion !== 1 || !['rounding-v1', 'rounding-v2'].includes(input.roundingPolicy)) {
    throw new ApprovedPricingEvidenceError(
      `Unsupported commercial quantity policy selector ${input.graphSchemaVersion}:${input.roundingPolicy}`,
    );
  }
  const productFamily = input.productFamily.toLowerCase() as CommercialProductFamily;
  const preparedUnit = input.commercialUnit as CommercialMeasurementUnit | undefined;
  const family = productFamily === 'prepared'
    ? preparedUnit === 'count'
      ? countPolicy
      : preparedUnit === 'squareMeter' || preparedUnit === 'ton'
        ? {
            pieceCount: { role: 'PIECE_COUNT' as const, unit: 'count' as const, scale: 0 as const },
            measuredQuantity: { role: 'MEASURED_QUANTITY' as const, unit: preparedUnit, scale: 3 },
            billableQuantity: { role: 'BILLABLE_QUANTITY' as const, basis: 'MEASURED_QUANTITY' as const, unit: preparedUnit, scale: 3 },
          }
        : undefined
    : FAMILY_POLICY[productFamily];
  if (!family) throw new ApprovedPricingEvidenceError(`Commercial quantity policy is missing for ${input.productFamily}`);
  return {
    version: COMMERCIAL_QUANTITY_POLICY_VERSION,
    productFamily,
    ...family,
    historicalPolicySelector: {
      graphSchemaVersion: 1,
      roundingPolicy: input.roundingPolicy as 'rounding-v1' | 'rounding-v2',
    },
  };
};
