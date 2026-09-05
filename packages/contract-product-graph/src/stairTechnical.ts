import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { calculatePackingPlan, type PackingPlan } from './packingPricing';
import { parseStableIdentity } from './stableIdentity';
import type { StairPartPolicyInput, StairPartPolicyResult, StairPartConflict } from './stairPolicy';
import { projectTechnicalPacking, TECHNICAL_PACKING_VERSION, type TechnicalPackingPlan } from './technicalPacking';
import { technicalShape, technicalDecimal, technicalIdentity, technicalEnum, technicalRevision } from './technicalInput';

export type StairPartGeometryInput = Pick<StairPartPolicyInput,
  'stairSystemId' | 'part' | 'sourceBatchId' | 'motherLengthMeters' | 'motherLengthDisplayUnit' |
  'motherWidthMeters' | 'lengthMeters' | 'crossDimensionMeters' | 'lengthDisplayUnit' |
  'crossDimensionDisplayUnit' | 'quantity' | 'sawKerfEnabled' | 'sawKerfMeters' |
  'calibrationEnabled' | 'calibrationSelection'>;
export interface StairPartTechnicalInput extends StairPartGeometryInput { readonly inputRevision: number }
export type StairPartGeometryResult = Omit<StairPartPolicyResult,
  'calculationPolicyVersion' | 'inputHash' | 'resultHash' | 'mandatoryEnabled' |
  'mandatoryPercentage' | 'rememberedMandatoryPercentage' | 'pricingLines' |
  'baseAmountToman' | 'mandatoryAmountToman' | 'longitudinalCutAmountToman' |
  'crossCutAmountToman' | 'calibrationCutAmountToman' | 'totalAmountToman'>;
export interface StairPartTechnicalResult extends Omit<StairPartGeometryResult, 'packingPlan'> {
  readonly inputRevision: number; readonly packingPlan: TechnicalPackingPlan;
}
export type StairPartTechnicalCalculation =
  | { readonly ok: true; readonly result: StairPartTechnicalResult }
  | { readonly ok: false; readonly inputRevision?: number; readonly conflicts: readonly StairPartConflict[] };

const decimal = (value: CanonicalDecimal) => new Decimal(value);
const canonical = (value: Decimal | string | number): CanonicalDecimal =>
  parseCanonicalDecimal(new Decimal(value).toFixed());

const positiveInteger = (value: number | undefined, field: string) => {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return Number(value);
};


/** Canonical geometry, shared by technical previews and priced staircase parts. */
export const calculateStairPartGeometry = (
  input: StairPartGeometryInput, packingPolicyVersion: string
): { readonly ok: true; readonly result: StairPartGeometryResult } |
   { readonly ok: false; readonly conflicts: readonly StairPartConflict[] } => {
  try {
    parseStableIdentity('stair-system', input.stairSystemId);
    parseStableIdentity('source-batch', input.sourceBatchId);

    if (!input.lengthMeters || !input.crossDimensionMeters) {
      return {
        ok: false,
        conflicts: [{
          code: 'stair-geometry-required',
          field: 'dimensions',
          message: 'Complete both stair-part dimensions.'
        }]
      };
    }
    if (!input.motherWidthMeters) {
      return {
        ok: false,
        conflicts: [{
          code: 'stair-mother-dimensions-required',
          field: 'motherWidthMeters',
          message: 'Mother width must be registered in inventory.'
        }]
      };
    }
    const length = decimal(input.lengthMeters);
    const crossDimension = decimal(input.crossDimensionMeters);
    const motherLengthMode = input.motherLengthMeters === undefined
      ? 'derived-from-finished' as const
      : 'explicit' as const;
    const motherLength = input.motherLengthMeters === undefined
      ? length
      : decimal(input.motherLengthMeters);
    const motherLengthDisplayUnit =
      input.motherLengthDisplayUnit ?? input.lengthDisplayUnit;
    const motherWidth = decimal(input.motherWidthMeters);
    if (
      motherLength.lte(0) ||
      motherWidth.lte(0) ||
      length.lte(0) ||
      crossDimension.lte(0)
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'stair-geometry-required',
          field: 'dimensions',
          message: 'Stair-part and mother dimensions must be positive.'
        }]
      };
    }
    if (length.gt(motherLength)) {
      return {
        ok: false,
        conflicts: [{
          code: 'stair-maximum-mother-length-exceeded',
          field: 'lengthMeters',
          message: `Maximum length is ${motherLength.toFixed()}m.`
        }]
      };
    }
    if (crossDimension.gt(motherWidth)) {
      return {
        ok: false,
        conflicts: [{
          code: 'stair-maximum-mother-width-exceeded',
          field: 'crossDimensionMeters',
          message: `Maximum width is ${motherWidth.toFixed()}m.`
        }]
      };
    }
    let quantity: number;
    try {
      quantity = positiveInteger(input.quantity, 'quantity');
    } catch {
      return {
        ok: false,
        conflicts: [{
          code: 'stair-quantity-required',
          field: 'quantity',
          message: 'Enter a positive stair-part quantity.'
        }]
      };
    }
    const kerf = decimal(input.sawKerfMeters);
    if (kerf.lt(0)) throw new TypeError('sawKerfMeters cannot be negative.');
    const packed = calculatePackingPlan({
      policyVersion: packingPolicyVersion,
      kerfMeters: canonical(input.sawKerfEnabled ? kerf : new Decimal(0)),
      calibrationEnabled: false,
      sources: [{
        sourceBatchId: input.sourceBatchId,
        lengthMeters: canonical(motherLength),
        widthMeters: canonical(motherWidth),
        quantity
      }],
      demands: [{
        demandId: `${input.stairSystemId}:${input.part}`,
        lengthMeters: canonical(length),
        widthMeters: canonical(crossDimension),
        quantity
      }]
    });
    if (!packed.ok) {
      return {
        ok: false,
        conflicts: [{
          code: 'invalid-stair-input',
          field: 'packing',
          message: packed.conflict.message
        }]
      };
    }
    const hasLongitudinalCut = decimal(packed.plan.longitudinalCutMeters).gt(0);
    const hasWidthRemainder = packed.plan.remainders.some(remainder =>
      decimal(remainder.widthMeters).gt(0) &&
      decimal(remainder.widthMeters).lt(motherWidth)
    );
    const automaticCalibration =
      crossDimension.lt(motherWidth) && hasLongitudinalCut && !hasWidthRemainder;
    const calibrationEnabled =
      crossDimension.eq(motherWidth) || !hasLongitudinalCut
        ? false
        : input.calibrationSelection === 'manual'
          ? input.calibrationEnabled
          : automaticCalibration;
    const calibrationMeters = calibrationEnabled
      ? packed.plan.longitudinalCutMeters
      : canonical(0);
    const area = length.times(crossDimension).times(quantity);
    const consumedMotherArea = motherLength
      .times(motherWidth)
      .times(packed.plan.consumedSources.length);
    const paidRemainderArea = packed.plan.remainders.reduce(
      (sum, remainder) =>
        sum.plus(decimal(remainder.lengthMeters).times(remainder.widthMeters)),
      new Decimal(0)
    );
    return { ok: true, result: {
      stairPart: {
        stairSystemId: input.stairSystemId,
        part: input.part,
        motherLengthMode,
        motherLengthDisplayUnit,
        lengthDisplayUnit: input.lengthDisplayUnit,
        crossDimensionDisplayUnit: input.crossDimensionDisplayUnit
      },
      lengthMeters: canonical(length),
      crossDimensionMeters: canonical(crossDimension),
      quantity,
      requestedAreaSquareMeters: canonical(area),
      consumedMotherAreaSquareMeters: canonical(consumedMotherArea),
      paidRemainderAreaSquareMeters: canonical(paidRemainderArea),
      motherLengthMeters: canonical(motherLength),
      motherLengthMode,
      motherLengthDisplayUnit,
      motherWidthMeters: canonical(motherWidth),
      sawKerfEnabled: input.sawKerfEnabled, sawKerfMeters: input.sawKerfMeters,
      calibrationEnabled, calibrationSelection: input.calibrationSelection,
      packingPlan: { ...packed.plan, calibrationMeters },
    } };
  } catch (error) {
    return {
      ok: false,
      conflicts: [{
        code: 'invalid-stair-input',
        field: 'stairPart',
        message: error instanceof Error ? error.message : 'Stair input is invalid.'
      }]
    };
  }
};


export const calculateStairPartTechnical = (input: StairPartTechnicalInput): StairPartTechnicalCalculation => {
  const inputRevision = technicalRevision(input);
  try {
    technicalShape(input, ['inputRevision', 'stairSystemId', 'part', 'sourceBatchId',
      'motherLengthMeters', 'motherLengthDisplayUnit', 'motherWidthMeters', 'lengthMeters',
      'crossDimensionMeters', 'lengthDisplayUnit', 'crossDimensionDisplayUnit', 'quantity',
      'sawKerfEnabled', 'sawKerfMeters', 'calibrationEnabled', 'calibrationSelection']);
    if (inputRevision === undefined) throw new TypeError();
    technicalIdentity(input.stairSystemId); technicalIdentity(input.sourceBatchId);
    technicalEnum(input.part, ['tread', 'riser', 'landing']);
    for (const value of [input.motherLengthMeters, input.motherWidthMeters, input.lengthMeters, input.crossDimensionMeters]) {
      if (value !== undefined) technicalDecimal(value);
    }
    technicalDecimal(input.sawKerfMeters);
    for (const unit of [input.lengthDisplayUnit, input.crossDimensionDisplayUnit]) technicalEnum(unit, ['m', 'cm']);
    if (input.motherLengthDisplayUnit !== undefined) technicalEnum(input.motherLengthDisplayUnit, ['m', 'cm']);
    technicalEnum(input.calibrationSelection, ['automatic', 'manual']);
    if (typeof input.calibrationEnabled !== 'boolean' || typeof input.sawKerfEnabled !== 'boolean') throw new TypeError();
  } catch {
    return { ok: false, ...(inputRevision === undefined ? {} : { inputRevision }),
      conflicts: [{ code: 'invalid-stair-input', field: 'stairPart', message: 'Invalid technical stair input.' }] };
  }
  const geometry = calculateStairPartGeometry(input, TECHNICAL_PACKING_VERSION);
  if (!geometry.ok) return { ...geometry, inputRevision: input.inputRevision };
  return { ok: true, result: { ...geometry.result, inputRevision: input.inputRevision,
    packingPlan: projectTechnicalPacking(geometry.result.packingPlan) } };
};
