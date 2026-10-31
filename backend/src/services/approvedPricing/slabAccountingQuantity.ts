import { Prisma } from '@prisma/client';
import { resolveCommercialQuantityPolicy } from '../commercialQuantityPolicy';
import { ApprovedPricingEvidenceError } from './evidenceError';
import { exactQuantityText } from '../exactQuantity';

/** Seal exact matching slab witnesses without repricing or rounding. */
export const slabAccountingQuantity = (input: {
  productRowId: string;
  rawArea: unknown;
  canonicalArea: unknown;
  graphSchemaVersion: number;
  roundingPolicy: string;
}) => {
  const label = `Product ${input.productRowId} slab area`;
  const decimal = (value: unknown) => {
    try {
      const result = new Prisma.Decimal(String(value));
      if (!result.isFinite() || !result.gt(0)) throw new Error('Invalid area');
      return result;
    } catch {
      throw new ApprovedPricingEvidenceError(`${label} must be a positive finite decimal`);
    }
  };
  const raw = decimal(input.rawArea);
  // Keep the existing strict path (and historical hashes) for scale-three areas.
  if (raw.decimalPlaces() <= 3) return null;
  const canonical = decimal(input.canonicalArea);
  if (!raw.eq(canonical)) {
    throw new ApprovedPricingEvidenceError(`${label} canonical quantity conflicts with contract snapshot`);
  }
  const policy = resolveCommercialQuantityPolicy({
    graphSchemaVersion: input.graphSchemaVersion,
    roundingPolicy: input.roundingPolicy,
    productFamily: 'slab',
  });
  let sealedQuantity: string;
  try { sealedQuantity = exactQuantityText(raw); }
  catch { throw new ApprovedPricingEvidenceError(`${label} exceeds exact storage capacity`); }
  return {
    evidenceOrigin: 'SLAB_EXACT_ACCOUNTING_AREA_V1' as const,
    productRowId: input.productRowId,
    rawSnapshotAreaSquareMeters: raw.toFixed(),
    rawCanonicalAreaSquareMeters: canonical.toFixed(),
    sealedQuantity,
    differenceSquareMeters: '0',
    unit: 'squareMeter' as const,
    precisionPolicy: 'exact-slab-quantity-v1' as const,
    sourcePolicy: policy.historicalPolicySelector,
  };
};
