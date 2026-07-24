import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { hashCanonicalValue } from './canonicalHash';
import {
  calculatePackingPlan,
  calculatePricing,
  type PackingPlan,
  type PricedLine
} from './packingPricing';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';
import type {
  FinishingSelectionDraft,
  ProductOperationsInput,
  ToolSelectionDraft
} from './operationsPolicy';

export type StairPartKind = 'tread' | 'riser' | 'landing';
export type StairQuantityMode = 'steps' | 'staircases';
export type StairDisplayUnit = 'cm' | 'm';

export interface StaircaseQuantityIntent {
  readonly mode: StairQuantityMode;
  readonly totalSteps?: number;
  readonly numberOfStaircases?: number;
  readonly stepsPerStaircase?: number;
}

export interface CanonicalStairSystem {
  readonly stairSystemId: StableIdentity<'stair-system'>;
  readonly catalogProductId: string;
  readonly catalogSnapshotVersion: string;
  readonly quantityMode: StairQuantityMode;
  readonly totalSteps: number;
  readonly numberOfStaircases?: number;
  readonly stepsPerStaircase?: number;
}

export type ResolvedStaircaseQuantity = Omit<
  CanonicalStairSystem,
  'stairSystemId' | 'catalogProductId' | 'catalogSnapshotVersion'
>;

export interface StairPartPolicyInput {
  readonly calculationPolicyVersion: string;
  readonly packingPolicyVersion: string;
  readonly pricingPolicyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly stairSystemId: StableIdentity<'stair-system'>;
  readonly part: StairPartKind;
  readonly sourceBatchId: StableIdentity<'source-batch'>;
  readonly motherLengthMeters?: CanonicalDecimal;
  readonly motherWidthMeters?: CanonicalDecimal;
  readonly lengthMeters?: CanonicalDecimal;
  readonly crossDimensionMeters?: CanonicalDecimal;
  readonly lengthDisplayUnit: StairDisplayUnit;
  readonly crossDimensionDisplayUnit: StairDisplayUnit;
  readonly quantity?: number;
  readonly baseRateToman?: CanonicalDecimal;
  readonly mandatoryEnabled: boolean;
  readonly mandatoryPercentage: CanonicalDecimal;
  readonly rememberedMandatoryPercentage: CanonicalDecimal;
  readonly sawKerfEnabled: boolean;
  readonly sawKerfMeters: CanonicalDecimal;
  readonly calibrationEnabled: boolean;
  readonly calibrationSelection: 'automatic' | 'manual';
  readonly longitudinalCutRateToman?: CanonicalDecimal;
  readonly crossCutRateToman?: CanonicalDecimal;
  readonly calibrationCutRateToman?: CanonicalDecimal;
}

export interface CanonicalStairPartFacts {
  readonly stairSystemId: StableIdentity<'stair-system'>;
  readonly part: StairPartKind;
  readonly lengthDisplayUnit: StairDisplayUnit;
  readonly crossDimensionDisplayUnit: StairDisplayUnit;
}

export interface StairPartPolicyResult {
  readonly calculationPolicyVersion: string;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly stairPart: CanonicalStairPartFacts;
  readonly lengthMeters: CanonicalDecimal;
  readonly crossDimensionMeters: CanonicalDecimal;
  readonly quantity: number;
  readonly requestedAreaSquareMeters: CanonicalDecimal;
  readonly motherLengthMeters: CanonicalDecimal;
  readonly motherWidthMeters: CanonicalDecimal;
  readonly mandatoryEnabled: boolean;
  readonly mandatoryPercentage: CanonicalDecimal;
  readonly rememberedMandatoryPercentage: CanonicalDecimal;
  readonly sawKerfEnabled: boolean;
  readonly sawKerfMeters: CanonicalDecimal;
  readonly calibrationEnabled: boolean;
  readonly calibrationSelection: 'automatic' | 'manual';
  readonly packingPlan: PackingPlan;
  readonly pricingLines: readonly PricedLine[];
  readonly baseAmountToman: CanonicalDecimal;
  readonly mandatoryAmountToman: CanonicalDecimal;
  readonly longitudinalCutAmountToman: CanonicalDecimal;
  readonly crossCutAmountToman: CanonicalDecimal;
  readonly calibrationCutAmountToman: CanonicalDecimal;
  readonly totalAmountToman: CanonicalDecimal;
}

export type StairPartConflictCode =
  | 'stair-mother-dimensions-required'
  | 'stair-geometry-required'
  | 'stair-maximum-mother-length-exceeded'
  | 'stair-maximum-mother-width-exceeded'
  | 'stair-quantity-required'
  | 'stair-price-required'
  | 'stair-cut-rate-missing'
  | 'invalid-stair-input';

export interface StairPartConflict {
  readonly code: StairPartConflictCode;
  readonly field: string;
  readonly message: string;
}

export type StairPartCalculation =
  | { readonly ok: true; readonly result: StairPartPolicyResult }
  | { readonly ok: false; readonly conflicts: readonly StairPartConflict[] };

const decimal = (value: CanonicalDecimal) => new Decimal(value);
const canonical = (value: Decimal | string | number): CanonicalDecimal =>
  parseCanonicalDecimal(new Decimal(value).toFixed());
const normalizedVersion = (value: string, field: string) => {
  if (!value || value !== value.trim()) throw new TypeError(`${field} is required.`);
};
const positiveInteger = (value: number | undefined, field: string) => {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
  return Number(value);
};

export const resolveStaircaseQuantity = (
  intent: StaircaseQuantityIntent
): ResolvedStaircaseQuantity => {
  if (intent.mode === 'steps') {
    const totalSteps = positiveInteger(intent.totalSteps, 'totalSteps');
    return {
      quantityMode: 'steps',
      totalSteps
    };
  }
  const numberOfStaircases = positiveInteger(
    intent.numberOfStaircases,
    'numberOfStaircases'
  );
  const stepsPerStaircase = positiveInteger(
    intent.stepsPerStaircase,
    'stepsPerStaircase'
  );
  return {
    quantityMode: 'staircases',
    totalSteps: numberOfStaircases * stepsPerStaircase,
    numberOfStaircases,
    stepsPerStaircase
  };
};

export const createNewStairPartPolicyInput = (
  part: StairPartKind,
  identity: {
    readonly stairSystemId: StableIdentity<'stair-system'>;
    readonly sourceBatchId: StableIdentity<'source-batch'>;
  },
  versions: {
    readonly calculation: string;
    readonly packing: string;
    readonly pricing: string;
    readonly rounding: string;
  }
): StairPartPolicyInput => ({
  calculationPolicyVersion: versions.calculation,
  packingPolicyVersion: versions.packing,
  pricingPolicyVersion: versions.pricing,
  roundingPolicyVersion: versions.rounding,
  stairSystemId: identity.stairSystemId,
  part,
  sourceBatchId: identity.sourceBatchId,
  ...(part === 'tread'
    ? { crossDimensionMeters: canonical('0.3') }
    : part === 'riser'
      ? { crossDimensionMeters: canonical('0.17') }
      : {}),
  lengthDisplayUnit: 'm',
  crossDimensionDisplayUnit: 'cm',
  mandatoryEnabled: false,
  mandatoryPercentage: canonical('25'),
  rememberedMandatoryPercentage: canonical('25'),
  sawKerfEnabled: false,
  sawKerfMeters: canonical('0.003'),
  calibrationEnabled: false,
  calibrationSelection: 'automatic'
});

export const copyStairPartPolicyFromTread = ({
  tread,
  target
}: {
  readonly tread: StairPartPolicyInput;
  readonly target: StairPartPolicyInput;
}): StairPartPolicyInput => ({
  ...tread,
  stairSystemId: target.stairSystemId,
  part: target.part,
  sourceBatchId: target.sourceBatchId
});

export const copyStairPartOperations = ({
  source,
  targetProductRowId,
  lengthMeters,
  crossDimensionMeters,
  quantity,
  operationGroupIdentity,
  toolSelectionIdentity,
  finishingSelectionIdentity
}: {
  readonly source: ProductOperationsInput;
  readonly targetProductRowId: StableIdentity<'product-row'>;
  readonly lengthMeters: CanonicalDecimal;
  readonly crossDimensionMeters: CanonicalDecimal;
  readonly quantity: number;
  readonly operationGroupIdentity: (
    sourceId: StableIdentity<'operation-group'>,
    index: number
  ) => StableIdentity<'operation-group'>;
  readonly toolSelectionIdentity: (
    sourceId: StableIdentity<'tool-selection'>,
    index: number
  ) => StableIdentity<'tool-selection'>;
  readonly finishingSelectionIdentity: (
    sourceId: StableIdentity<'finishing-selection'>,
    index: number
  ) => StableIdentity<'finishing-selection'>;
}): ProductOperationsInput => {
  const groupIdentity = new Map(
    source.groups.map((group, index) => [
      group.operationGroupId,
      operationGroupIdentity(group.operationGroupId, index)
    ])
  );
  const targetGroup = (sourceId: StableIdentity<'operation-group'>) => {
    const identity = groupIdentity.get(sourceId);
    if (!identity) throw new TypeError(`Missing copied operation group ${sourceId}.`);
    return identity;
  };
  const tools: ToolSelectionDraft[] = source.tools.map((tool, index) => ({
    ...tool,
    toolSelectionId: toolSelectionIdentity(tool.toolSelectionId, index),
    operationGroupId: targetGroup(tool.operationGroupId),
    ...(tool.edges ? { edges: [...tool.edges] } : {}),
    ...(tool.quantityOverride
      ? { quantityOverride: { ...tool.quantityOverride } }
      : {})
  }));
  const finishings: FinishingSelectionDraft[] = source.finishings.map(
    (finishing, index) => ({
      ...finishing,
      finishingSelectionId: finishingSelectionIdentity(
        finishing.finishingSelectionId,
        index
      ),
      operationGroupId: targetGroup(finishing.operationGroupId),
      incompatibleCatalogItemIds: [...finishing.incompatibleCatalogItemIds],
      ...(finishing.quantityOverride
        ? { quantityOverride: { ...finishing.quantityOverride } }
        : {})
    })
  );
  return {
    ...source,
    productRowId: targetProductRowId,
    lengthMeters,
    widthMeters: crossDimensionMeters,
    quantity,
    groups: source.groups.map(group => ({
      ...group,
      operationGroupId: targetGroup(group.operationGroupId)
    })),
    tools,
    finishings
  };
};

export const parseStairPartPolicyInput = (
  value: unknown
): StairPartPolicyInput => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Stair part policy input must be an object.');
  }
  const record = value as Record<string, unknown>;
  const string = (key: string) => {
    if (typeof record[key] !== 'string') throw new TypeError(`${key} must be a string.`);
    return record[key] as string;
  };
  const optionalDecimal = (key: string) =>
    record[key] === undefined || record[key] === null
      ? undefined
      : parseCanonicalDecimal(string(key));
  if (!['tread', 'riser', 'landing'].includes(String(record.part))) {
    throw new TypeError('part must be tread, riser, or landing.');
  }
  if (!['cm', 'm'].includes(String(record.lengthDisplayUnit))) {
    throw new TypeError('lengthDisplayUnit must be cm or m.');
  }
  if (!['cm', 'm'].includes(String(record.crossDimensionDisplayUnit))) {
    throw new TypeError('crossDimensionDisplayUnit must be cm or m.');
  }
  if (!['automatic', 'manual'].includes(String(record.calibrationSelection))) {
    throw new TypeError('calibrationSelection must be automatic or manual.');
  }
  if (
    typeof record.mandatoryEnabled !== 'boolean' ||
    typeof record.sawKerfEnabled !== 'boolean' ||
    typeof record.calibrationEnabled !== 'boolean'
  ) {
    throw new TypeError('Stair switches must be boolean.');
  }
  const quantity = record.quantity;
  const parsed: StairPartPolicyInput = {
    calculationPolicyVersion: string('calculationPolicyVersion'),
    packingPolicyVersion: string('packingPolicyVersion'),
    pricingPolicyVersion: string('pricingPolicyVersion'),
    roundingPolicyVersion: string('roundingPolicyVersion'),
    stairSystemId: parseStableIdentity('stair-system', string('stairSystemId')),
    part: record.part as StairPartKind,
    sourceBatchId: parseStableIdentity('source-batch', string('sourceBatchId')),
    ...(optionalDecimal('motherLengthMeters') === undefined
      ? {}
      : { motherLengthMeters: optionalDecimal('motherLengthMeters') }),
    ...(optionalDecimal('motherWidthMeters') === undefined
      ? {}
      : { motherWidthMeters: optionalDecimal('motherWidthMeters') }),
    ...(optionalDecimal('lengthMeters') === undefined
      ? {}
      : { lengthMeters: optionalDecimal('lengthMeters') }),
    ...(optionalDecimal('crossDimensionMeters') === undefined
      ? {}
      : { crossDimensionMeters: optionalDecimal('crossDimensionMeters') }),
    lengthDisplayUnit: record.lengthDisplayUnit as StairDisplayUnit,
    crossDimensionDisplayUnit: record.crossDimensionDisplayUnit as StairDisplayUnit,
    ...(quantity === undefined || quantity === null
      ? {}
      : { quantity: positiveInteger(quantity as number, 'quantity') }),
    ...(optionalDecimal('baseRateToman') === undefined
      ? {}
      : { baseRateToman: optionalDecimal('baseRateToman') }),
    mandatoryEnabled: record.mandatoryEnabled,
    mandatoryPercentage: parseCanonicalDecimal(string('mandatoryPercentage')),
    rememberedMandatoryPercentage: parseCanonicalDecimal(
      string('rememberedMandatoryPercentage')
    ),
    sawKerfEnabled: record.sawKerfEnabled,
    sawKerfMeters: parseCanonicalDecimal(string('sawKerfMeters')),
    calibrationEnabled: record.calibrationEnabled,
    calibrationSelection: record.calibrationSelection as 'automatic' | 'manual',
    ...(optionalDecimal('longitudinalCutRateToman') === undefined
      ? {}
      : { longitudinalCutRateToman: optionalDecimal('longitudinalCutRateToman') }),
    ...(optionalDecimal('crossCutRateToman') === undefined
      ? {}
      : { crossCutRateToman: optionalDecimal('crossCutRateToman') }),
    ...(optionalDecimal('calibrationCutRateToman') === undefined
      ? {}
      : { calibrationCutRateToman: optionalDecimal('calibrationCutRateToman') })
  };
  return parsed;
};

export const calculateStairPart = (
  input: StairPartPolicyInput
): StairPartCalculation => {
  try {
    normalizedVersion(input.calculationPolicyVersion, 'calculationPolicyVersion');
    normalizedVersion(input.packingPolicyVersion, 'packingPolicyVersion');
    normalizedVersion(input.pricingPolicyVersion, 'pricingPolicyVersion');
    normalizedVersion(input.roundingPolicyVersion, 'roundingPolicyVersion');
    parseStableIdentity('stair-system', input.stairSystemId);
    parseStableIdentity('source-batch', input.sourceBatchId);

    if (!input.motherLengthMeters || !input.motherWidthMeters) {
      return {
        ok: false,
        conflicts: [{
          code: 'stair-mother-dimensions-required',
          field: 'motherDimensions',
          message: 'Mother length and width must be registered in inventory.'
        }]
      };
    }
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
    const motherLength = decimal(input.motherLengthMeters);
    const motherWidth = decimal(input.motherWidthMeters);
    const length = decimal(input.lengthMeters);
    const crossDimension = decimal(input.crossDimensionMeters);
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
    if (!input.baseRateToman || decimal(input.baseRateToman).lte(0)) {
      return {
        ok: false,
        conflicts: [{
          code: 'stair-price-required',
          field: 'baseRateToman',
          message: 'Enter the price.'
        }]
      };
    }
    const kerf = decimal(input.sawKerfMeters);
    if (kerf.lt(0)) throw new TypeError('sawKerfMeters cannot be negative.');
    const packed = calculatePackingPlan({
      policyVersion: input.packingPolicyVersion,
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
    const requiredRates = [
      {
        field: 'longitudinalCutRateToman',
        quantity: packed.plan.longitudinalCutMeters,
        rate: input.longitudinalCutRateToman
      },
      {
        field: 'crossCutRateToman',
        quantity: packed.plan.crossCutMeters,
        rate: input.crossCutRateToman
      },
      {
        field: 'calibrationCutRateToman',
        quantity: calibrationMeters,
        rate: input.calibrationCutRateToman
      }
    ];
    const missingRates = requiredRates.filter(
      item => decimal(item.quantity).gt(0) && item.rate === undefined
    );
    if (missingRates.length > 0) {
      return {
        ok: false,
        conflicts: missingRates.map(item => ({
          code: 'stair-cut-rate-missing' as const,
          field: item.field,
          message: 'The required cutting rate is not registered in inventory.'
        }))
      };
    }
    const area = length.times(crossDimension).times(quantity);
    const lines = [
      {
        lineId: 'base-material',
        quantity: canonical(area),
        rateToman: input.baseRateToman
      },
      ...(input.mandatoryEnabled
        ? [{
            lineId: 'mandatory',
            quantity: canonical(area.times(input.baseRateToman)),
            rateToman: canonical(decimal(input.mandatoryPercentage).div(100))
          }]
        : []),
      ...requiredRates.flatMap(item =>
        decimal(item.quantity).gt(0) && item.rate !== undefined
          ? [{
              lineId: item.field,
              quantity: item.quantity,
              rateToman: item.rate
            }]
          : []
      )
    ];
    const pricing = calculatePricing({
      policyVersion: input.pricingPolicyVersion,
      roundingPolicyVersion: input.roundingPolicyVersion,
      lines
    });
    const amount = (lineId: string) =>
      pricing.lines.find(line => line.lineId === lineId)?.amountToman ?? canonical(0);
    const plan: PackingPlan = {
      ...packed.plan,
      calibrationMeters
    };
    const resultBase = {
      calculationPolicyVersion: input.calculationPolicyVersion,
      inputHash: hashCanonicalValue(input),
      stairPart: {
        stairSystemId: input.stairSystemId,
        part: input.part,
        lengthDisplayUnit: input.lengthDisplayUnit,
        crossDimensionDisplayUnit: input.crossDimensionDisplayUnit
      },
      lengthMeters: canonical(length),
      crossDimensionMeters: canonical(crossDimension),
      quantity,
      requestedAreaSquareMeters: canonical(area),
      motherLengthMeters: canonical(motherLength),
      motherWidthMeters: canonical(motherWidth),
      mandatoryEnabled: input.mandatoryEnabled,
      mandatoryPercentage: input.mandatoryPercentage,
      rememberedMandatoryPercentage: input.rememberedMandatoryPercentage,
      sawKerfEnabled: input.sawKerfEnabled,
      sawKerfMeters: input.sawKerfMeters,
      calibrationEnabled,
      calibrationSelection: input.calibrationSelection,
      packingPlan: plan,
      pricingLines: pricing.lines,
      baseAmountToman: amount('base-material'),
      mandatoryAmountToman: amount('mandatory'),
      longitudinalCutAmountToman: amount('longitudinalCutRateToman'),
      crossCutAmountToman: amount('crossCutRateToman'),
      calibrationCutAmountToman: amount('calibrationCutRateToman'),
      totalAmountToman: pricing.totalAmountToman
    };
    return {
      ok: true,
      result: {
        ...resultBase,
        resultHash: hashCanonicalValue(resultBase)
      }
    };
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

export interface LegacyNosingSnapshot {
  readonly legacyValue: string;
  readonly title: string;
  readonly rateToman: CanonicalDecimal;
}

export interface NosingMigrationMapping {
  readonly legacyValue: string;
  readonly toolCatalogItemId: string;
  readonly toolSnapshotVersion: string;
}

export type MigratedLegacyNosing =
  | {
      readonly kind: 'catalog-tool';
      readonly toolCatalogItemId: string;
      readonly toolSnapshotVersion: string;
      readonly edge: 'front';
    }
  | {
      readonly kind: 'historical-tool-snapshot';
      readonly legacyValue: string;
      readonly title: string;
      readonly rateToman: CanonicalDecimal;
      readonly edge: 'front';
      readonly outsideCurrentCatalog: true;
    };

export const migrateLegacyNosing = (
  snapshot: LegacyNosingSnapshot,
  mappings: readonly NosingMigrationMapping[]
): MigratedLegacyNosing => {
  const mapping = mappings.find(item => item.legacyValue === snapshot.legacyValue);
  return mapping
    ? {
        kind: 'catalog-tool',
        toolCatalogItemId: mapping.toolCatalogItemId,
        toolSnapshotVersion: mapping.toolSnapshotVersion,
        edge: 'front'
      }
    : {
        kind: 'historical-tool-snapshot',
        legacyValue: snapshot.legacyValue,
        title: snapshot.title,
        rateToman: snapshot.rateToman,
        edge: 'front',
        outsideCurrentCatalog: true
      };
};
