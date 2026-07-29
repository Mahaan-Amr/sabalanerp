import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { hashCanonicalValue } from './canonicalHash';
import {
  calculatePackingPlan,
  calculatePricing,
  type PackedRemainder,
  type PackingPlan,
  type PricedLine
} from './packingPricing';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';

export type LongitudinalManualField = 'length' | 'width' | 'area' | 'quantity';
export type LongitudinalDisplayUnit = 'cm' | 'm';

export interface LongitudinalProductInput {
  readonly calculationPolicyVersion: string;
  readonly packingPolicyVersion: string;
  readonly pricingPolicyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly sourceBatchId: StableIdentity<'source-batch'>;
  readonly motherWidthMeters: CanonicalDecimal;
  readonly lengthMeters?: CanonicalDecimal;
  readonly widthMeters?: CanonicalDecimal;
  readonly requestedAreaSquareMeters?: CanonicalDecimal;
  readonly quantity?: number;
  readonly lastManualField: LongitudinalManualField;
  readonly lastManualDimension: 'length' | 'width';
  readonly lengthDisplayUnit: LongitudinalDisplayUnit;
  readonly widthDisplayUnit: LongitudinalDisplayUnit;
  readonly baseMaterialPricing?: 'manual-positive' | 'paid-source-zero';
  readonly baseRateToman?: CanonicalDecimal;
  readonly mandatoryEnabled: boolean;
  readonly mandatoryPercentage: CanonicalDecimal;
  readonly rememberedMandatoryPercentage: CanonicalDecimal;
  readonly sawKerfEnabled: boolean;
  readonly sawKerfMeters: CanonicalDecimal;
  readonly calibrationEnabled: boolean;
  readonly calibrationSelection: 'automatic' | 'manual';
  readonly longitudinalCutRateToman?: CanonicalDecimal;
  readonly calibrationCutRateToman?: CanonicalDecimal;
}

export type LongitudinalConflictCode =
  | 'base-rate-required'
  | 'calibration-cut-rate-missing'
  | 'geometry-required'
  | 'invalid-decimal'
  | 'invalid-mandatory-percentage'
  | 'invalid-quantity'
  | 'longitudinal-cut-rate-missing'
  | 'maximum-mother-width-exceeded'
  | 'mother-width-missing'
  | 'packing-failed';

export interface LongitudinalConflict {
  readonly code: LongitudinalConflictCode;
  readonly field:
    | 'baseRateToman'
    | 'calibration'
    | 'dimensions'
    | 'mandatoryPercentage'
    | 'motherWidthMeters'
    | 'quantity'
    | 'summary'
    | 'widthMeters';
  readonly message: string;
}

export interface LongitudinalSummaryRow {
  readonly key:
    | 'layout'
    | 'stone'
    | 'longitudinal-tools'
    | 'cross-tools'
    | 'cutting'
    | 'remainder';
  readonly label: string;
  readonly value: string;
}

export interface LongitudinalProductResult {
  readonly calculationPolicyVersion: string;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly quantityMode: 'piece-count' | 'total-linear-meters';
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly requestedAreaSquareMeters: CanonicalDecimal;
  readonly quantity?: number;
  readonly lengthDisplayUnit: LongitudinalDisplayUnit;
  readonly widthDisplayUnit: LongitudinalDisplayUnit;
  readonly baseMaterialPricing: 'manual-positive' | 'paid-source-zero';
  readonly mandatoryEnabled: boolean;
  readonly mandatoryPercentage: CanonicalDecimal;
  readonly rememberedMandatoryPercentage: CanonicalDecimal;
  readonly sawKerfEnabled: boolean;
  readonly sawKerfMeters: CanonicalDecimal;
  readonly calibrationEnabled: boolean;
  readonly calibrationSelection: 'automatic' | 'manual';
  readonly sourcePiecesConsumed: number;
  readonly packingPlan: PackingPlan;
  readonly remainders: readonly PackedRemainder[];
  readonly baseAmountToman: CanonicalDecimal;
  readonly mandatoryAmountToman: CanonicalDecimal;
  readonly longitudinalCutAmountToman: CanonicalDecimal;
  readonly calibrationCutAmountToman: CanonicalDecimal;
  readonly totalAmountToman: CanonicalDecimal;
  readonly pricingLines: readonly PricedLine[];
  readonly summary: readonly LongitudinalSummaryRow[];
}

export type LongitudinalProductCalculation =
  | { readonly ok: true; readonly result: LongitudinalProductResult }
  | { readonly ok: false; readonly conflicts: readonly LongitudinalConflict[] };

export interface NewLongitudinalProductInput {
  readonly calculationPolicyVersion: string;
  readonly packingPolicyVersion: string;
  readonly pricingPolicyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly sourceBatchId: StableIdentity<'source-batch'>;
  readonly motherWidthMeters: CanonicalDecimal;
  readonly defaultMandatoryPercentage: CanonicalDecimal;
  readonly sawKerfMeters: CanonicalDecimal;
  readonly longitudinalCutRateToman?: CanonicalDecimal;
  readonly calibrationCutRateToman?: CanonicalDecimal;
}

export const createNewLongitudinalProductInput = (
  input: NewLongitudinalProductInput
): LongitudinalProductInput => ({
  calculationPolicyVersion: input.calculationPolicyVersion,
  packingPolicyVersion: input.packingPolicyVersion,
  pricingPolicyVersion: input.pricingPolicyVersion,
  roundingPolicyVersion: input.roundingPolicyVersion,
  sourceBatchId: input.sourceBatchId,
  motherWidthMeters: input.motherWidthMeters,
  widthMeters: input.motherWidthMeters,
  lastManualField: 'width',
  lastManualDimension: 'width',
  lengthDisplayUnit: 'm',
  widthDisplayUnit: 'cm',
  mandatoryEnabled: false,
  mandatoryPercentage: input.defaultMandatoryPercentage,
  rememberedMandatoryPercentage: input.defaultMandatoryPercentage,
  sawKerfEnabled: false,
  sawKerfMeters: input.sawKerfMeters,
  calibrationEnabled: false,
  calibrationSelection: 'automatic',
  ...(input.longitudinalCutRateToman === undefined
    ? {}
    : { longitudinalCutRateToman: input.longitudinalCutRateToman }),
  ...(input.calibrationCutRateToman === undefined
    ? {}
    : { calibrationCutRateToman: input.calibrationCutRateToman })
});

const d = (value: CanonicalDecimal) => new Decimal(value);
const canonical = (value: Decimal): CanonicalDecimal =>
  parseCanonicalDecimal(value.toFixed());
const positive = (value: CanonicalDecimal | undefined) =>
  value !== undefined && d(value).gt(0);

const parseInputDecimal = (
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

const emDash = '—';
const display = (value: CanonicalDecimal) => value;
const withoutUndefined = <Value>(value: Value): Value =>
  JSON.parse(JSON.stringify(value)) as Value;

export const parseLongitudinalProductInput = (
  value: unknown
): LongitudinalProductInput => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Longitudinal product input must be an object.');
  }
  const record = value as Record<string, unknown>;
  const requiredString = (key: string) => {
    const item = record[key];
    if (typeof item !== 'string' || !item.trim()) {
      throw new TypeError(`Longitudinal ${key} must be a non-empty string.`);
    }
    return item;
  };
  const decimal = (key: string, optional = false) => {
    const item = record[key];
    if (item === undefined && optional) return undefined;
    if (typeof item !== 'string') {
      throw new TypeError(`Longitudinal ${key} must be a canonical decimal string.`);
    }
    if (parseCanonicalDecimal(item) !== item) {
      throw new TypeError(`Longitudinal ${key} must be normalized.`);
    }
    return parseCanonicalDecimal(item);
  };
  const boolean = (key: string) => {
    if (typeof record[key] !== 'boolean') {
      throw new TypeError(`Longitudinal ${key} must be boolean.`);
    }
    return record[key] as boolean;
  };
  const enumeration = <Value extends string>(
    key: string,
    values: readonly Value[]
  ): Value => {
    if (!values.includes(record[key] as Value)) {
      throw new TypeError(`Longitudinal ${key} has an unsupported value.`);
    }
    return record[key] as Value;
  };
  const quantity = record.quantity;
  if (quantity !== undefined && (!Number.isSafeInteger(quantity) || Number(quantity) <= 0)) {
    throw new TypeError('Longitudinal quantity must be a positive integer or omitted.');
  }
  return {
    calculationPolicyVersion: requiredString('calculationPolicyVersion'),
    packingPolicyVersion: requiredString('packingPolicyVersion'),
    pricingPolicyVersion: requiredString('pricingPolicyVersion'),
    roundingPolicyVersion: requiredString('roundingPolicyVersion'),
    sourceBatchId: parseStableIdentity('source-batch', requiredString('sourceBatchId')),
    motherWidthMeters: decimal('motherWidthMeters')!,
    ...(decimal('lengthMeters', true) === undefined
      ? {}
      : { lengthMeters: decimal('lengthMeters') }),
    ...(decimal('widthMeters', true) === undefined
      ? {}
      : { widthMeters: decimal('widthMeters') }),
    ...(decimal('requestedAreaSquareMeters', true) === undefined
      ? {}
      : { requestedAreaSquareMeters: decimal('requestedAreaSquareMeters') }),
    ...(quantity === undefined ? {} : { quantity: Number(quantity) }),
    lastManualField: enumeration(
      'lastManualField',
      ['length', 'width', 'area', 'quantity'] as const
    ),
    lastManualDimension: enumeration(
      'lastManualDimension',
      ['length', 'width'] as const
    ),
    lengthDisplayUnit: enumeration('lengthDisplayUnit', ['cm', 'm'] as const),
    widthDisplayUnit: enumeration('widthDisplayUnit', ['cm', 'm'] as const),
    baseMaterialPricing: record.baseMaterialPricing === undefined
      ? 'manual-positive'
      : enumeration(
          'baseMaterialPricing',
          ['manual-positive', 'paid-source-zero'] as const
        ),
    ...(decimal('baseRateToman', true) === undefined
      ? {}
      : { baseRateToman: decimal('baseRateToman') }),
    mandatoryEnabled: boolean('mandatoryEnabled'),
    mandatoryPercentage: decimal('mandatoryPercentage')!,
    rememberedMandatoryPercentage: decimal('rememberedMandatoryPercentage')!,
    sawKerfEnabled: boolean('sawKerfEnabled'),
    sawKerfMeters: decimal('sawKerfMeters')!,
    calibrationEnabled: boolean('calibrationEnabled'),
    calibrationSelection: enumeration(
      'calibrationSelection',
      ['automatic', 'manual'] as const
    ),
    ...(decimal('longitudinalCutRateToman', true) === undefined
      ? {}
      : { longitudinalCutRateToman: decimal('longitudinalCutRateToman') }),
    ...(decimal('calibrationCutRateToman', true) === undefined
      ? {}
      : { calibrationCutRateToman: decimal('calibrationCutRateToman') })
  };
};

export const calculateLongitudinalProduct = (
  input: LongitudinalProductInput
): LongitudinalProductCalculation => {
  const conflicts: LongitudinalConflict[] = [];
  const motherWidth = parseInputDecimal(
    input.motherWidthMeters,
    'motherWidthMeters',
    conflicts,
    true
  );
  const suppliedLength = parseInputDecimal(input.lengthMeters, 'dimensions', conflicts);
  const suppliedWidth = parseInputDecimal(input.widthMeters, 'widthMeters', conflicts);
  const suppliedArea = parseInputDecimal(
    input.requestedAreaSquareMeters,
    'dimensions',
    conflicts
  );
  const baseRate = parseInputDecimal(input.baseRateToman, 'baseRateToman', conflicts);
  const mandatoryPercentage = parseInputDecimal(
    input.mandatoryPercentage,
    'mandatoryPercentage',
    conflicts
  );
  parseInputDecimal(
    input.rememberedMandatoryPercentage,
    'mandatoryPercentage',
    conflicts
  );
  const kerf = parseInputDecimal(input.sawKerfMeters, 'dimensions', conflicts);
  const longitudinalCutRate = parseInputDecimal(
    input.longitudinalCutRateToman,
    'summary',
    conflicts
  );
  const calibrationCutRate = parseInputDecimal(
    input.calibrationCutRateToman,
    'calibration',
    conflicts
  );

  if (!motherWidth || motherWidth.lte(0)) {
    conflicts.push({
      code: 'mother-width-missing',
      field: 'motherWidthMeters',
      message: 'Mother width is not registered in inventory.'
    });
  }
  if (input.quantity !== undefined &&
      (!Number.isSafeInteger(input.quantity) || input.quantity <= 0)) {
    conflicts.push({
      code: 'invalid-quantity',
      field: 'quantity',
      message: 'Quantity must be a positive integer or blank.'
    });
  }
  const paidSourceMaterial = input.baseMaterialPricing === 'paid-source-zero';
  if (
    (!paidSourceMaterial && (!baseRate || baseRate.lte(0))) ||
    (paidSourceMaterial && (!baseRate || !baseRate.eq(0))) ||
    (paidSourceMaterial && input.mandatoryEnabled)
  ) {
    conflicts.push({
      code: 'base-rate-required',
      field: 'baseRateToman',
      message: paidSourceMaterial
        ? 'Paid source material must have zero base rate and no mandatory increase.'
        : 'Enter the price.'
    });
  }
  if (!mandatoryPercentage || mandatoryPercentage.lte(0)) {
    conflicts.push({
      code: 'invalid-mandatory-percentage',
      field: 'mandatoryPercentage',
      message: 'Mandatory percentage must be positive.'
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
  const multiplier = new Decimal(input.quantity ?? 1);
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
  if (!mandatoryPercentage || !kerf) {
    return { ok: false, conflicts };
  }

  const packingKerf = input.sawKerfEnabled ? kerf : new Decimal(0);
  const piecesAcross = Decimal.floor(
    motherWidth.plus(packingKerf).div(width.plus(packingKerf))
  ).toNumber();
  const requiredSourcePieces = input.quantity === undefined
    ? 1
    : Math.ceil(input.quantity / Math.max(1, piecesAcross));
  const packing = calculatePackingPlan({
    policyVersion: input.packingPolicyVersion,
    kerfMeters: canonical(packingKerf),
    calibrationEnabled: false,
    sources: [{
      sourceBatchId: input.sourceBatchId,
      lengthMeters: canonical(length),
      widthMeters: canonical(motherWidth),
      quantity: requiredSourcePieces
    }],
    demands: [{
      demandId: 'finished-longitudinal-piece',
      lengthMeters: canonical(length),
      widthMeters: canonical(width),
      quantity: input.quantity ?? 1
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
    ? canonical(length.times(packing.plan.consumedSources.length))
    : canonical(new Decimal(0));

  const operationConflicts = [...conflicts];
  if (hasLongitudinalCut && longitudinalCutRate === undefined) {
    operationConflicts.push({
      code: 'longitudinal-cut-rate-missing',
      field: 'summary',
      message: 'Longitudinal cutting rate is not registered in inventory.'
    });
  }
  if (d(calibrationMeters).gt(0) && calibrationCutRate === undefined) {
    operationConflicts.push({
      code: 'calibration-cut-rate-missing',
      field: 'calibration',
      message: 'Calibration cutting rate is not registered in inventory.'
    });
  }
  if (operationConflicts.length > 0) {
    return { ok: false, conflicts: operationConflicts };
  }

  const consumedMaterialArea = packing.plan.consumedSources.reduce(
    total => total.plus(length.times(motherWidth)),
    new Decimal(0)
  );
  const pricingLines = [
    {
      lineId: 'base-material',
      quantity: canonical(consumedMaterialArea),
      rateToman: canonical(baseRate!)
    },
    ...(input.mandatoryEnabled
      ? [{
          lineId: 'mandatory',
          quantity: canonical(consumedMaterialArea.times(baseRate!)),
          rateToman: canonical(mandatoryPercentage.div(100))
        }]
      : []),
    ...(hasLongitudinalCut
      ? [{
          lineId: 'longitudinal-cut',
          quantity: packing.plan.longitudinalCutMeters,
          rateToman: canonical(longitudinalCutRate!)
        }]
      : []),
    ...(d(calibrationMeters).gt(0)
      ? [{
          lineId: 'calibration-cut',
          quantity: calibrationMeters,
          rateToman: canonical(calibrationCutRate!)
        }]
      : [])
  ];
  const pricing = calculatePricing({
    policyVersion: input.pricingPolicyVersion,
    roundingPolicyVersion: input.roundingPolicyVersion,
    lines: pricingLines
  });
  const amountFor = (lineId: string) =>
    pricing.lines.find(line => line.lineId === lineId)?.amountToman ??
    canonical(new Decimal(0));
  const resultWithoutHash = {
    calculationPolicyVersion: input.calculationPolicyVersion,
    inputHash: hashCanonicalValue(withoutUndefined(input)),
    quantityMode: input.quantity === undefined
      ? 'total-linear-meters' as const
      : 'piece-count' as const,
    lengthMeters: canonical(length),
    widthMeters: canonical(width),
    requestedAreaSquareMeters: canonical(area),
    ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
    lengthDisplayUnit: input.lengthDisplayUnit,
    widthDisplayUnit: input.widthDisplayUnit,
    baseMaterialPricing: input.baseMaterialPricing ?? 'manual-positive',
    mandatoryEnabled: input.mandatoryEnabled,
    mandatoryPercentage: input.mandatoryPercentage,
    rememberedMandatoryPercentage: input.rememberedMandatoryPercentage,
    sawKerfEnabled: input.sawKerfEnabled,
    sawKerfMeters: input.sawKerfMeters,
    calibrationEnabled,
    calibrationSelection: input.calibrationSelection,
    sourcePiecesConsumed: packing.plan.consumedSources.length,
    packingPlan: {
      ...packing.plan,
      calibrationMeters
    },
    remainders: packing.plan.remainders,
    baseAmountToman: amountFor('base-material'),
    mandatoryAmountToman: amountFor('mandatory'),
    longitudinalCutAmountToman: amountFor('longitudinal-cut'),
    calibrationCutAmountToman: amountFor('calibration-cut'),
    totalAmountToman: pricing.totalAmountToman,
    pricingLines: pricing.lines,
    summary: [
      {
        key: 'layout' as const,
        label: 'چیدمان',
        value: input.quantity === undefined
          ? `${display(canonical(length))}m × ${display(canonical(width.times(100)))}cm`
          : `${input.quantity} × ${display(canonical(length))}m × ${display(canonical(width.times(100)))}cm`
      },
      {
        key: 'stone' as const,
        label: 'سنگ',
        value: `درخواست ${display(canonical(area))}m² · مصرف ${display(canonical(
          packing.plan.consumedSources.reduce(
            total => total.plus(length.times(motherWidth)),
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
          ? `عادی ${packing.plan.longitudinalCutMeters}m · کالیبر ${calibrationMeters}m`
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
  };
  return {
    ok: true,
    result: {
      ...resultWithoutHash,
      resultHash: hashCanonicalValue(resultWithoutHash)
    }
  };
};

export const transitionLongitudinalQuantity = ({
  previousQuantity,
  nextQuantity,
  mandatoryEnabled,
  mandatoryPercentage,
  rememberedMandatoryPercentage
}: {
  previousQuantity?: number;
  nextQuantity?: number;
  mandatoryEnabled: boolean;
  mandatoryPercentage?: CanonicalDecimal;
  rememberedMandatoryPercentage: CanonicalDecimal;
}) => {
  if (nextQuantity === undefined) {
    return {
      quantity: undefined,
      mandatoryEnabled: false,
      mandatoryPercentage: mandatoryPercentage ?? rememberedMandatoryPercentage,
      rememberedMandatoryPercentage
    };
  }
  if (previousQuantity === undefined) {
    return {
      quantity: nextQuantity,
      mandatoryEnabled: true,
      mandatoryPercentage: rememberedMandatoryPercentage,
      rememberedMandatoryPercentage
    };
  }
  return {
    quantity: nextQuantity,
    mandatoryEnabled,
    mandatoryPercentage: mandatoryPercentage ?? rememberedMandatoryPercentage,
    rememberedMandatoryPercentage
  };
};
