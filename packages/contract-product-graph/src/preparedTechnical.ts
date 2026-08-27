import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import type { StableIdentity } from './stableIdentity';
import { technicalShape, technicalDecimal, technicalIdentity, technicalEnum, technicalRevision } from './technicalInput';

export type PreparedKind = 'cubic' | 'readyPiece';
export type PreparedUnit = 'squareMeter' | 'ton' | 'count';
export interface PreparedTechnicalInput {
  readonly inputRevision: number;
  readonly productRowId: StableIdentity<'product-row'>;
  /** Keep historical identity; editing presentation may normalize volumetric to prepared. */
  readonly family: 'prepared' | 'volumetric';
  readonly kind: PreparedKind;
  readonly unit: PreparedUnit;
  readonly quantity?: CanonicalDecimal;
}
export interface PreparedTechnicalResult extends PreparedTechnicalInput {
  readonly quantity: CanonicalDecimal;
  readonly squareMeters: CanonicalDecimal;
}
export type PreparedTechnicalCalculation =
  | { readonly ok: true; readonly result: PreparedTechnicalResult }
  | { readonly ok: false; readonly inputRevision?: number; readonly conflicts: readonly {
      readonly code: 'invalid-prepared-input' | 'prepared-quantity-required'; readonly field: string; readonly message: string;
    }[] };

export const calculatePreparedTechnical = (input: PreparedTechnicalInput): PreparedTechnicalCalculation => {
  const inputRevision = technicalRevision(input);
  try {
    technicalShape(input, ['inputRevision', 'productRowId', 'family', 'kind', 'unit', 'quantity']);
    if (inputRevision === undefined) throw new TypeError();
    technicalIdentity(input.productRowId);
    technicalEnum(input.family, ['prepared', 'volumetric']);
    technicalEnum(input.kind, ['cubic', 'readyPiece']);
    technicalEnum(input.unit, input.kind === 'cubic' ? ['squareMeter', 'ton', 'count'] : ['squareMeter', 'count']);
    if (input.quantity !== undefined) technicalDecimal(input.quantity);
  } catch {
    return { ok: false, ...(inputRevision === undefined ? {} : { inputRevision }),
      conflicts: [{ code: 'invalid-prepared-input', field: 'prepared', message: 'Invalid technical prepared input.' }] };
  }
  if (input.quantity === undefined || new Decimal(input.quantity).lte(0)) {
    return { ok: false, inputRevision: input.inputRevision, conflicts: [{ code: 'prepared-quantity-required',
      field: 'quantity', message: 'Enter a positive prepared quantity.' }] };
  }
  return { ok: true, result: { ...input, quantity: input.quantity,
    squareMeters: input.unit === 'squareMeter' ? input.quantity : parseCanonicalDecimal('0') } };
};
