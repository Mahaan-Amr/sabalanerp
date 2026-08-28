import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { calculatePackingPlan, type PackingPlan } from './packingPricing';
import type { LongitudinalProductInput, LongitudinalProductResult, LongitudinalConflict } from './longitudinalPolicy';
import { projectTechnicalPacking, TECHNICAL_PACKING_VERSION, type TechnicalPackingPlan } from './technicalPacking';

export type LongitudinalGeometryInput = Pick<LongitudinalProductInput,
  'sourceBatchId' | 'lengthMeters' | 'widthMeters' |
  'requestedAreaSquareMeters' | 'quantity' | 'lastManualField' | 'lastManualDimension' |
  'lengthDisplayUnit' | 'widthDisplayUnit' | 'sawKerfEnabled' | 'sawKerfMeters' |
  'calibrationEnabled' | 'calibrationSelection'> & { readonly motherWidthMeters?: CanonicalDecimal };
export interface LongitudinalTechnicalInput extends LongitudinalGeometryInput {
  readonly inputRevision: number;
}
export interface LongitudinalGeometryResult extends Pick<LongitudinalProductResult,
  'quantityMode' | 'lengthMeters' | 'widthMeters' | 'requestedAreaSquareMeters' |
  'quantity' | 'lengthDisplayUnit' | 'widthDisplayUnit' | 'sawKerfEnabled' |
  'sawKerfMeters' | 'calibrationEnabled' | 'calibrationSelection' |
  'sourcePiecesConsumed' | 'remainders' | 'summary'> {
  readonly packingPlan: PackingPlan;
  readonly consumedMaterialAreaSquareMeters: CanonicalDecimal;
  readonly longitudinalCutMeters: CanonicalDecimal;
}
export interface LongitudinalTechnicalResult extends Omit<LongitudinalGeometryResult, 'packingPlan'> {
  readonly inputRevision: number;
  readonly packingPlan: TechnicalPackingPlan;
}
export type LongitudinalTechnicalCalculation =
  | { readonly ok: true; readonly result: LongitudinalTechnicalResult }
  | { readonly ok: false; readonly inputRevision?: number;
      readonly conflicts: readonly (LongitudinalConflict | {
        readonly code: 'invalid-input'; readonly field: 'input'; readonly message: string;
      })[] };

const d = (value: CanonicalDecimal) => new Decimal(value);
const canonical = (value: Decimal): CanonicalDecimal => parseCanonicalDecimal(value.toFixed());
const emDash = '—';
const display = (value: CanonicalDecimal) => value;

export const parseLongitudinalDecimal = (
  value: CanonicalDecimal | undefined,
  field: LongitudinalConflict['field'],
  conflicts: LongitudinalConflict[],
  required = false
) => {
  if (value === undefined) {
    if (required) {
      conflicts.push({
        code: field === 'motherWidthMeters' ? 'mother-width-missing' : 'geometry-required',
        field,
        message: field === 'motherWidthMeters'
          ? 'Mother width is not registered in inventory.'
          : 'Enter length or square meters.'
      });
    }
    return undefined;
  }
  try {
    if (parseCanonicalDecimal(value) !== value) throw new TypeError();
    return d(value);
  } catch {
    conflicts.push({
      code: 'invalid-decimal',
      field,
      message: 'The value must be an exact normalized decimal.'
    });
    return undefined;
  }
};


/** Shared internal geometry, also used by the historical priced entry point. */
export const calculateLongitudinalGeometry = (
  input: LongitudinalGeometryInput,
  packingPolicyVersion: string
): { readonly ok: true; readonly result: LongitudinalGeometryResult } |
   { readonly ok: false; readonly conflicts: readonly LongitudinalConflict[] } => {
  const conflicts: LongitudinalConflict[] = [];
  const motherWidth = parseLongitudinalDecimal(
    input.motherWidthMeters,
    'motherWidthMeters',
    conflicts,
    true
  );
  const suppliedLength = parseLongitudinalDecimal(input.lengthMeters, 'dimensions', conflicts);
  const suppliedWidth = parseLongitudinalDecimal(input.widthMeters, 'widthMeters', conflicts);
  const suppliedArea = parseLongitudinalDecimal(
    input.requestedAreaSquareMeters,
    'dimensions',
    conflicts
  );
  const kerf = parseLongitudinalDecimal(input.sawKerfMeters, 'dimensions', conflicts);
  if (!motherWidth || motherWidth.lte(0)) {
    conflicts.push({
      code: 'mother-width-missing',
      field: 'motherWidthMeters',
      message: 'Mother width is not registered in inventory.'
    });
  }
  if (input.quantity !== undefined &&
      (!Number.isSafeInteger(input.quantity) || input.quantity < 0)) {
    conflicts.push({
      code: 'invalid-quantity',
      field: 'quantity',
      message: 'Quantity must be a non-negative integer or blank.'
    });
  }
  if (kerf?.lt(0)) {
    conflicts.push({
      code: 'invalid-decimal',
      field: 'dimensions',
      message: 'Saw kerf cannot be negative.'
    });
  }
  if (conflicts.some(conflict =>
    conflict.code === 'invalid-decimal' ||
    conflict.code === 'mother-width-missing' ||
    conflict.code === 'invalid-quantity'
  )) {
    return { ok: false, conflicts };
  }

  const width = suppliedWidth ?? motherWidth;
  if (!width || !motherWidth) return { ok: false, conflicts };
  if (width.lte(0)) {
    return {
      ok: false,
      conflicts: [{
        code: 'geometry-required',
        field: 'widthMeters',
        message: 'Width must be positive.'
      }]
    };
  }
  if (width.gt(motherWidth)) {
    return {
      ok: false,
      conflicts: [{
        code: 'maximum-mother-width-exceeded',
        field: 'widthMeters',
        message: `Maximum width is ${motherWidth.toFixed()}m.`
      }]
    };
  }
  const totalLinearMetersMode = input.quantity === undefined || input.quantity === 0;
  const multiplier = new Decimal(totalLinearMetersMode ? 1 : input.quantity);
  let length = suppliedLength;
  let area = suppliedArea;

  if (input.lastManualField === 'area' && area?.gt(0)) {
    length = area.div(width.times(multiplier));
  } else if (length?.gt(0)) {
    area = length.times(width).times(multiplier);
  } else if (area?.gt(0)) {
    length = area.div(width.times(multiplier));
  }

  if (!length?.gt(0) || !area?.gt(0)) {
    return {
      ok: false,
      conflicts: [{
        code: 'geometry-required',
        field: 'dimensions',
        message: 'Enter length or square meters.'
      }]
    };
  }
  if (!kerf) {
    return { ok: false, conflicts: [{ code: 'geometry-required', field: 'dimensions',
      message: 'Saw kerf must be supplied, including zero when disabled.' }] };
  }

  const packingKerf = input.sawKerfEnabled ? kerf : new Decimal(0);
  const piecesAcross = Decimal.floor(
    motherWidth.plus(packingKerf).div(width.plus(packingKerf))
  ).toNumber();
  const packingQuantity = totalLinearMetersMode
    ? Math.max(1, piecesAcross)
    : input.quantity;
  const packingLength = totalLinearMetersMode
    ? length.div(packingQuantity)
    : length;
  const requiredSourcePieces = totalLinearMetersMode
    ? 1
    : Math.ceil(input.quantity / Math.max(1, piecesAcross));
  const packing = calculatePackingPlan({
    policyVersion: packingPolicyVersion,
    kerfMeters: canonical(packingKerf),
    calibrationEnabled: false,
    sources: [{
      sourceBatchId: input.sourceBatchId,
      lengthMeters: canonical(packingLength),
      widthMeters: canonical(motherWidth),
      quantity: requiredSourcePieces
    }],
    demands: [{
      demandId: 'finished-longitudinal-piece',
      lengthMeters: canonical(packingLength),
      widthMeters: canonical(width),
      quantity: packingQuantity
    }]
  });
  if (!packing.ok) {
    return {
      ok: false,
      conflicts: [{
        code: 'packing-failed',
        field: 'summary',
        message: packing.conflict.message
      }]
    };
  }

  const billableLongitudinalCutMeters = totalLinearMetersMode
    ? canonical(length.times(packing.plan.cuts.length).div(packingQuantity))
    : packing.plan.longitudinalCutMeters;
  const hasLongitudinalCut = d(packing.plan.longitudinalCutMeters).gt(0);
  const hasWidthRemainder = packing.plan.remainders.some(remainder =>
    d(remainder.widthMeters).gt(0)
  );
  const automaticCalibration =
    width.lt(motherWidth) && hasLongitudinalCut && !hasWidthRemainder;
  const calibrationEnabled = !hasLongitudinalCut || width.eq(motherWidth)
    ? false
    : input.calibrationSelection === 'manual'
      ? input.calibrationEnabled
      : automaticCalibration;
  const calibrationMeters = calibrationEnabled
    ? canonical(packingLength.times(packing.plan.consumedSources.length))
    : canonical(new Decimal(0));


  const consumedMaterialArea = packing.plan.consumedSources.reduce(
    total => total.plus(packingLength.times(motherWidth)), new Decimal(0));
  return { ok: true, result: {
    quantityMode: totalLinearMetersMode ? 'total-linear-meters' as const : 'piece-count' as const,
    lengthMeters: canonical(length), widthMeters: canonical(width),
    requestedAreaSquareMeters: canonical(area),
    ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
    lengthDisplayUnit: input.lengthDisplayUnit, widthDisplayUnit: input.widthDisplayUnit,
    sawKerfEnabled: input.sawKerfEnabled, sawKerfMeters: input.sawKerfMeters,
    calibrationEnabled, calibrationSelection: input.calibrationSelection,
    sourcePiecesConsumed: packing.plan.consumedSources.length,
    packingPlan: { ...packing.plan, calibrationMeters },
    remainders: packing.plan.remainders,
    consumedMaterialAreaSquareMeters: canonical(consumedMaterialArea),
    longitudinalCutMeters: billableLongitudinalCutMeters,
    summary: [
      {
        key: 'layout' as const,
        label: 'چیدمان',
        value: totalLinearMetersMode
          ? `${display(canonical(length))}m × ${display(canonical(width.times(100)))}cm`
          : `${input.quantity} × ${display(canonical(length))}m × ${display(canonical(width.times(100)))}cm`
      },
      {
        key: 'stone' as const,
        label: 'سنگ',
        value: `درخواست ${display(canonical(area))}m² · مصرف ${display(canonical(
          packing.plan.consumedSources.reduce(
            total => total.plus(packingLength.times(motherWidth)),
            new Decimal(0)
          )
        ))}m²`
      },
      { key: 'longitudinal-tools' as const, label: 'ابزار طولی', value: emDash },
      { key: 'cross-tools' as const, label: 'ابزار عرضی', value: emDash },
      {
        key: 'cutting' as const,
        label: 'برش',
        value: hasLongitudinalCut
          ? `عادی ${billableLongitudinalCutMeters}m · کالیبر ${calibrationMeters}m`
          : emDash
      },
      {
        key: 'remainder' as const,
        label: 'باقی‌مانده',
        value: packing.plan.remainders.length > 0
          ? packing.plan.remainders
              .map(remainder => `${remainder.widthMeters}m × ${remainder.lengthMeters}m`)
              .join(' · ')
          : emDash
      }
    ]
  } };
};

export const calculateLongitudinalTechnical = (
  input: LongitudinalTechnicalInput
): LongitudinalTechnicalCalculation => {
  const inputRevision = Number.isSafeInteger(input?.inputRevision) && input.inputRevision >= 0
    ? input.inputRevision : undefined;
  // Validate this public, rate-free boundary before any value can reach a result.
  // Error messages deliberately omit unknown keys and values.
  const keys = ['inputRevision', 'sourceBatchId', 'motherWidthMeters', 'lengthMeters',
    'widthMeters', 'requestedAreaSquareMeters', 'quantity', 'lastManualField',
    'lastManualDimension', 'lengthDisplayUnit', 'widthDisplayUnit', 'sawKerfEnabled',
    'sawKerfMeters', 'calibrationEnabled', 'calibrationSelection'];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !keys.includes(key)) || inputRevision === undefined ||
      typeof input.sourceBatchId !== 'string' || !input.sourceBatchId.trim() ||
      input.sourceBatchId !== input.sourceBatchId.trim() ||
      !['length', 'width', 'area', 'quantity'].includes(input.lastManualField) ||
      !['length', 'width'].includes(input.lastManualDimension) ||
      !['m', 'cm'].includes(input.lengthDisplayUnit) ||
      !['m', 'cm'].includes(input.widthDisplayUnit) ||
      typeof input.sawKerfEnabled !== 'boolean' || typeof input.calibrationEnabled !== 'boolean' ||
      !['automatic', 'manual'].includes(input.calibrationSelection)) {
    return { ok: false, ...(inputRevision === undefined ? {} : { inputRevision }),
      conflicts: [{ code: 'invalid-input', field: 'input', message: 'Invalid technical input.' }] };
  }
  const geometry = calculateLongitudinalGeometry(input, TECHNICAL_PACKING_VERSION);
  if (!geometry.ok) return { ...geometry, inputRevision: input.inputRevision };
  return { ok: true, result: {
    ...geometry.result, inputRevision: input.inputRevision,
    packingPlan: projectTechnicalPacking(geometry.result.packingPlan),
  } };
};
