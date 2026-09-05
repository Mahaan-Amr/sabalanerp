import { calculateLongitudinalGeometry, parseLongitudinalDecimal } from './longitudinalTechnical';
import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { hashCanonicalValue } from './canonicalHash';
import {
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
  readonly billableLongitudinalCutMeters: CanonicalDecimal;
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
  if (quantity !== undefined && (!Number.isSafeInteger(quantity) || Number(quantity) < 0)) {
    throw new TypeError('Longitudinal quantity must be a non-negative integer or omitted.');
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
  const baseRate = parseLongitudinalDecimal(input.baseRateToman, 'baseRateToman', conflicts);
  const mandatoryPercentage = parseLongitudinalDecimal(input.mandatoryPercentage, 'mandatoryPercentage', conflicts);
  parseLongitudinalDecimal(input.rememberedMandatoryPercentage, 'mandatoryPercentage', conflicts);
  const longitudinalCutRate = parseLongitudinalDecimal(input.longitudinalCutRateToman, 'summary', conflicts);
  const calibrationCutRate = parseLongitudinalDecimal(input.calibrationCutRateToman, 'calibration', conflicts);
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

  const geometry = calculateLongitudinalGeometry(input, input.packingPolicyVersion);
  if (!geometry.ok) return { ok: false, conflicts: [...conflicts, ...geometry.conflicts] };
  const facts = geometry.result;
  const hasLongitudinalCut = d(facts.packingPlan.longitudinalCutMeters).gt(0);
  const calibrationMeters = facts.packingPlan.calibrationMeters;
  const billableLongitudinalCutMeters = facts.longitudinalCutMeters;
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


  if (!mandatoryPercentage) return { ok: false, conflicts };
  const consumedMaterialArea = d(facts.consumedMaterialAreaSquareMeters);
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
          quantity: billableLongitudinalCutMeters,
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

  const resultWithoutHash: Omit<LongitudinalProductResult, 'resultHash'> = {
    calculationPolicyVersion: input.calculationPolicyVersion,
    inputHash: hashCanonicalValue(withoutUndefined(input)),
    quantityMode: facts.quantityMode,
    lengthMeters: facts.lengthMeters, widthMeters: facts.widthMeters,
    requestedAreaSquareMeters: facts.requestedAreaSquareMeters,
    ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
    lengthDisplayUnit: facts.lengthDisplayUnit, widthDisplayUnit: facts.widthDisplayUnit,
    baseMaterialPricing: input.baseMaterialPricing ?? 'manual-positive',
    mandatoryEnabled: input.mandatoryEnabled,
    mandatoryPercentage: input.mandatoryPercentage,
    rememberedMandatoryPercentage: input.rememberedMandatoryPercentage,
    sawKerfEnabled: facts.sawKerfEnabled, sawKerfMeters: facts.sawKerfMeters,
    calibrationEnabled: facts.calibrationEnabled, calibrationSelection: facts.calibrationSelection,
    sourcePiecesConsumed: facts.sourcePiecesConsumed,
    packingPlan: facts.packingPlan, remainders: facts.remainders,
    baseAmountToman: amountFor('base-material'),
    mandatoryAmountToman: amountFor('mandatory'),
    billableLongitudinalCutMeters,
    longitudinalCutAmountToman: amountFor('longitudinal-cut'),
    calibrationCutAmountToman: amountFor('calibration-cut'),
    totalAmountToman: pricing.totalAmountToman, pricingLines: pricing.lines,
    summary: facts.summary,
  };
  return { ok: true, result: { ...resultWithoutHash, resultHash: hashCanonicalValue(resultWithoutHash) } };
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
  if (nextQuantity === undefined || nextQuantity === 0) {
    return {
      quantity: nextQuantity,
      mandatoryEnabled: false,
      mandatoryPercentage: mandatoryPercentage ?? rememberedMandatoryPercentage,
      rememberedMandatoryPercentage
    };
  }
  if (previousQuantity === undefined || previousQuantity === 0) {
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

export const longitudinalOperationsQuantity = ({
  quantityMode,
  quantity
}: Pick<LongitudinalProductResult, 'quantityMode' | 'quantity'>): number | undefined =>
  quantityMode === 'total-linear-meters' ? undefined : quantity;

export type LongitudinalQuantityEntry =
  | { accepted: true; quantity: number | undefined }
  | { accepted: false };

export const parseLongitudinalQuantityEntry = (
  value: string
): LongitudinalQuantityEntry => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { accepted: true, quantity: undefined };
  }

  try {
    const normalized = parseCanonicalDecimal(trimmed);
    if (normalized === '0') {
      return { accepted: true, quantity: 0 };
    }
    if (!/^[1-9]\d*$/.test(normalized)) {
      return { accepted: false };
    }
    const quantity = Number(normalized);
    return Number.isSafeInteger(quantity)
      ? { accepted: true, quantity }
      : { accepted: false };
  } catch {
    return { accepted: false };
  }
};
