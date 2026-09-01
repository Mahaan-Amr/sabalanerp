import { calculateStairLayerGeometry } from './stairLayerTechnical';
import { replayLayerSequence } from './layerReplay';
import { calculateLayerSideOperations } from './layerSideOperations';
import Decimal from 'decimal.js';
import { hashCanonicalValue } from './canonicalHash';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import {
  calculatePricing,
  type PackingPlan,
  type PricedLine
} from './packingPricing';
import {
  calculateProductOperations,
  parseProductOperationsInput,
  type ProductOperationsInput,
  type ProductOperationsResult
} from './operationsPolicy';
import type { PaidRemainderStock } from './remainderPolicy';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';

export type StairLayerSide = 'front' | 'back' | 'left' | 'right';
export type StairLayerCatalogUnit =
  | 'set'
  | 'physicalPiece'
  | 'meter'
  | 'squareMeter';

export interface StairLayerNewSourceRow {
  readonly sourceRowId: StableIdentity<'layer-source-row'>;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly quantity: number;
}

export type StairLayerSourceSelection =
  | {
      readonly kind: 'paid-remainder';
      readonly selectedRemainingStoneIds: readonly StableIdentity<'remaining-stone'>[];
    }
  | {
      readonly kind: 'parent-material';
      readonly selectedRemainingStoneIds: readonly StableIdentity<'remaining-stone'>[];
      readonly catalogProductId: string;
      readonly catalogSnapshotVersion: string;
      readonly materialRateToman: CanonicalDecimal;
      readonly sourceRows: readonly StairLayerNewSourceRow[];
    }
  | {
      readonly kind: 'new-material';
      readonly catalogProductId: string;
      readonly catalogSnapshotVersion: string;
      readonly materialRateToman: CanonicalDecimal;
      readonly sourceRows: readonly StairLayerNewSourceRow[];
    };

export interface StairLayerSideOperationsInput {
  readonly side: StairLayerSide;
  /**
   * One seller-facing operation selection may fan out into multiple physical
   * side scopes. The shared identity keeps that intent auditable without
   * merging the side-specific geometry.
   */
  readonly operationCollectionId?: StableIdentity<'layer-operation-collection'>;
  readonly scopeIntent?: 'all-strips' | 'side' | 'side-subset';
  readonly operations: ProductOperationsInput;
}

export interface StairLayerConfigurationInput {
  readonly calculationPolicyVersion: string;
  readonly packingPolicyVersion: string;
  readonly pricingPolicyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly layerConfigurationId: StableIdentity<'layer-configuration'>;
  readonly parentProductRowId: StableIdentity<'product-row'>;
  readonly sourceBatchId: StableIdentity<'source-batch'>;
  readonly creationOrder: number;
  readonly layerCatalogItemId: string;
  readonly layerCatalogSnapshotVersion: string;
  readonly layerTitle: string;
  readonly layerUnit: StairLayerCatalogUnit;
  readonly layerRateToman: CanonicalDecimal;
  readonly layersPerParentPiece: number;
  readonly widthMeters: CanonicalDecimal;
  readonly widthDisplayUnit: 'cm' | 'm';
  readonly targetSides: readonly StairLayerSide[];
  readonly source: StairLayerSourceSelection;
  readonly kerfMeters: CanonicalDecimal;
  readonly calibrationEnabled: boolean;
  readonly longitudinalCutRateToman?: CanonicalDecimal;
  readonly crossCutRateToman?: CanonicalDecimal;
  readonly calibrationCutRateToman?: CanonicalDecimal;
  readonly sideOperations: readonly StairLayerSideOperationsInput[];
  readonly description?: string;
}

export interface StairLayerParentGeometry {
  readonly lengthMeters: CanonicalDecimal;
  readonly crossDimensionMeters: CanonicalDecimal;
  readonly quantity: number;
}

export interface StairLayerPhysicalStripDemand {
  readonly side: StairLayerSide;
  readonly quantity: number;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
}

export interface StairLayerConfigurationResult {
  readonly calculationPolicyVersion: string;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly commercialLayerSets: number;
  readonly physicalStripCount: number;
  readonly physicalStrips: readonly StairLayerPhysicalStripDemand[];
  readonly packingPlan: PackingPlan;
  readonly materialPricingReason: 'paid-material' | 'new-material' | 'mixed-material';
  readonly materialSourceSplit: {
    readonly paidSourceCount: number;
    readonly paidMaterialSquareMeters: CanonicalDecimal;
    readonly paidMaterialAmountToman: CanonicalDecimal;
    readonly newSourceCount: number;
    readonly newMaterialSquareMeters: CanonicalDecimal;
    readonly newMaterialAmountToman: CanonicalDecimal;
  };
  readonly layerPricingQuantity: CanonicalDecimal;
  readonly layerPricingLine: PricedLine;
  readonly materialPricingLine?: PricedLine;
  readonly cuttingPricingLines: readonly PricedLine[];
  readonly sideOperationResults: readonly {
    readonly side: StairLayerSide;
    readonly operationCollectionId: StableIdentity<'layer-operation-collection'>;
    readonly scopeIntent: 'all-strips' | 'side' | 'side-subset';
    readonly result: ProductOperationsResult;
  }[];
  readonly generatedRemainders: readonly PaidRemainderStock[];
  readonly layerAmountToman: CanonicalDecimal;
  readonly materialAmountToman: CanonicalDecimal;
  readonly cuttingAmountToman: CanonicalDecimal;
  readonly operationsAmountToman: CanonicalDecimal;
  readonly totalAmountToman: CanonicalDecimal;
}

export type StairLayerConflictCode =
  | 'duplicate-layer-side'
  | 'duplicate-layer-source'
  | 'explicit-layer-source-required'
  | 'invalid-layer-input'
  | 'layer-cut-rate-missing'
  | 'layer-operation-invalid'
  | 'layer-parent-mismatch'
  | 'layer-rate-required'
  | 'layer-source-insufficient'
  | 'layer-source-missing';

export interface StairLayerConflict {
  readonly code: StairLayerConflictCode;
  readonly field: string;
  readonly message: string;
  readonly entityId?: string;
}

export type StairLayerCalculation =
  | {
      readonly ok: true;
      readonly result: StairLayerConfigurationResult;
      readonly inventory: readonly PaidRemainderStock[];
    }
  | {
      readonly ok: false;
      readonly conflicts: readonly StairLayerConflict[];
    };

const d = (value: CanonicalDecimal | string | number) => new Decimal(value);
const canonical = (value: Decimal | string | number): CanonicalDecimal =>
  parseCanonicalDecimal(new Decimal(value).toFixed());
const positiveInteger = (value: number, field: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive integer.`);
  }
};
const normalizedText = (value: string, field: string) => {
  if (!value || value !== value.trim()) {
    throw new TypeError(`${field} must be a normalized non-empty string.`);
  }
};
const cloneStock = (stock: PaidRemainderStock): PaidRemainderStock => ({ ...stock });

export const parseStairLayerConfigurationInput = (
  value: unknown
): StairLayerConfigurationInput => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Stair layer configuration input must be an object.');
  }
  const record = value as Record<string, unknown>;
  const object = (item: unknown, field: string) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`${field} must be an object.`);
    }
    return item as Record<string, unknown>;
  };
  const array = (item: unknown, field: string) => {
    if (!Array.isArray(item)) throw new TypeError(`${field} must be an array.`);
    return item;
  };
  const text = (item: unknown, field: string) => {
    if (typeof item !== 'string' || !item || item !== item.trim()) {
      throw new TypeError(`${field} must be normalized text.`);
    }
    return item;
  };
  const decimal = (item: unknown, field: string) => {
    const value = text(item, field);
    if (parseCanonicalDecimal(value) !== value) {
      throw new TypeError(`${field} must be a canonical decimal.`);
    }
    return parseCanonicalDecimal(value);
  };
  const integer = (item: unknown, field: string, allowZero = false) => {
    if (
      !Number.isSafeInteger(item) ||
      Number(item) < (allowZero ? 0 : 1)
    ) {
      throw new TypeError(`${field} must be ${allowZero ? 'a non-negative' : 'a positive'} integer.`);
    }
    return Number(item);
  };
  const side = (item: unknown, field: string): StairLayerSide => {
    if (!['front', 'back', 'left', 'right'].includes(String(item))) {
      throw new TypeError(`${field} is not a supported layer side.`);
    }
    return item as StairLayerSide;
  };
  const unit = record.layerUnit;
  if (!['set', 'physicalPiece', 'meter', 'squareMeter'].includes(String(unit))) {
    throw new TypeError('layerUnit is unsupported.');
  }
  const widthDisplayUnit = record.widthDisplayUnit;
  if (widthDisplayUnit !== 'cm' && widthDisplayUnit !== 'm') {
    throw new TypeError('widthDisplayUnit is unsupported.');
  }
  const source = object(record.source, 'source');
  const sourceKind = source.kind;
  let parsedSource: StairLayerSourceSelection;
  if (sourceKind === 'paid-remainder') {
    parsedSource = {
      kind: sourceKind,
      selectedRemainingStoneIds: array(
        source.selectedRemainingStoneIds,
        'source.selectedRemainingStoneIds'
      ).map((item, index) => parseStableIdentity(
        'remaining-stone',
        text(item, `source.selectedRemainingStoneIds.${index}`)
      ))
    };
  } else if (sourceKind === 'new-material') {
    parsedSource = {
      kind: sourceKind,
      catalogProductId: text(source.catalogProductId, 'source.catalogProductId'),
      catalogSnapshotVersion: text(
        source.catalogSnapshotVersion,
        'source.catalogSnapshotVersion'
      ),
      materialRateToman: decimal(
        source.materialRateToman,
        'source.materialRateToman'
      ),
      sourceRows: array(source.sourceRows, 'source.sourceRows').map((item, index) => {
        const row = object(item, `source.sourceRows.${index}`);
        return {
          sourceRowId: parseStableIdentity(
            'layer-source-row',
            text(row.sourceRowId, `source.sourceRows.${index}.sourceRowId`)
          ),
          lengthMeters: decimal(
            row.lengthMeters,
            `source.sourceRows.${index}.lengthMeters`
          ),
          widthMeters: decimal(
            row.widthMeters,
            `source.sourceRows.${index}.widthMeters`
          ),
          quantity: integer(
            row.quantity,
            `source.sourceRows.${index}.quantity`
          )
        };
      })
    };
  } else if (sourceKind === 'parent-material') {
    parsedSource = {
      kind: sourceKind,
      selectedRemainingStoneIds: array(
        source.selectedRemainingStoneIds,
        'source.selectedRemainingStoneIds'
      ).map((item, index) => parseStableIdentity(
        'remaining-stone',
        text(item, `source.selectedRemainingStoneIds.${index}`)
      )),
      catalogProductId: text(source.catalogProductId, 'source.catalogProductId'),
      catalogSnapshotVersion: text(
        source.catalogSnapshotVersion,
        'source.catalogSnapshotVersion'
      ),
      materialRateToman: decimal(
        source.materialRateToman,
        'source.materialRateToman'
      ),
      sourceRows: array(source.sourceRows, 'source.sourceRows').map((item, index) => {
        const row = object(item, `source.sourceRows.${index}`);
        return {
          sourceRowId: parseStableIdentity(
            'layer-source-row',
            text(row.sourceRowId, `source.sourceRows.${index}.sourceRowId`)
          ),
          lengthMeters: decimal(
            row.lengthMeters,
            `source.sourceRows.${index}.lengthMeters`
          ),
          widthMeters: decimal(
            row.widthMeters,
            `source.sourceRows.${index}.widthMeters`
          ),
          quantity: integer(
            row.quantity,
            `source.sourceRows.${index}.quantity`
          )
        };
      })
    };
  } else {
    throw new TypeError('source.kind is unsupported.');
  }
  if (typeof record.calibrationEnabled !== 'boolean') {
    throw new TypeError('calibrationEnabled must be boolean.');
  }
  const optionalDecimal = (field: string) =>
    record[field] === undefined
      ? undefined
      : decimal(record[field], field);
  const description = record.description === undefined
    ? undefined
    : text(record.description, 'description');
  return {
    calculationPolicyVersion: text(
      record.calculationPolicyVersion,
      'calculationPolicyVersion'
    ),
    packingPolicyVersion: text(
      record.packingPolicyVersion,
      'packingPolicyVersion'
    ),
    pricingPolicyVersion: text(
      record.pricingPolicyVersion,
      'pricingPolicyVersion'
    ),
    roundingPolicyVersion: text(
      record.roundingPolicyVersion,
      'roundingPolicyVersion'
    ),
    layerConfigurationId: parseStableIdentity(
      'layer-configuration',
      text(record.layerConfigurationId, 'layerConfigurationId')
    ),
    parentProductRowId: parseStableIdentity(
      'product-row',
      text(record.parentProductRowId, 'parentProductRowId')
    ),
    sourceBatchId: parseStableIdentity(
      'source-batch',
      text(record.sourceBatchId, 'sourceBatchId')
    ),
    creationOrder: integer(record.creationOrder, 'creationOrder', true),
    layerCatalogItemId: text(record.layerCatalogItemId, 'layerCatalogItemId'),
    layerCatalogSnapshotVersion: text(
      record.layerCatalogSnapshotVersion,
      'layerCatalogSnapshotVersion'
    ),
    layerTitle: text(record.layerTitle, 'layerTitle'),
    layerUnit: unit as StairLayerCatalogUnit,
    layerRateToman: decimal(record.layerRateToman, 'layerRateToman'),
    layersPerParentPiece: integer(
      record.layersPerParentPiece,
      'layersPerParentPiece'
    ),
    widthMeters: decimal(record.widthMeters, 'widthMeters'),
    widthDisplayUnit,
    targetSides: array(record.targetSides, 'targetSides')
      .map((item, index) => side(item, `targetSides.${index}`)),
    source: parsedSource,
    kerfMeters: decimal(record.kerfMeters, 'kerfMeters'),
    calibrationEnabled: record.calibrationEnabled,
    ...(optionalDecimal('longitudinalCutRateToman') === undefined
      ? {}
      : { longitudinalCutRateToman: optionalDecimal('longitudinalCutRateToman') }),
    ...(optionalDecimal('crossCutRateToman') === undefined
      ? {}
      : { crossCutRateToman: optionalDecimal('crossCutRateToman') }),
    ...(optionalDecimal('calibrationCutRateToman') === undefined
      ? {}
      : { calibrationCutRateToman: optionalDecimal('calibrationCutRateToman') }),
    sideOperations: array(record.sideOperations, 'sideOperations')
      .map((item, index) => {
        const entry = object(item, `sideOperations.${index}`);
        const parsedSide = side(entry.side, `sideOperations.${index}.side`);
        const scopeIntent = entry.scopeIntent === undefined
          ? 'side'
          : entry.scopeIntent;
        if (!['all-strips', 'side', 'side-subset'].includes(String(scopeIntent))) {
          throw new TypeError(
            `sideOperations.${index}.scopeIntent is unsupported.`
          );
        }
        return {
          side: parsedSide,
          ...(entry.operationCollectionId === undefined
            ? {}
            : {
                operationCollectionId: parseStableIdentity(
                  'layer-operation-collection',
                  text(
                    entry.operationCollectionId,
                    `sideOperations.${index}.operationCollectionId`
                  )
                )
              }),
          scopeIntent: scopeIntent as 'all-strips' | 'side' | 'side-subset',
          operations: parseProductOperationsInput(entry.operations)
        };
      }),
    ...(description === undefined ? {} : { description })
  };
};

const sumAmounts = (values: readonly CanonicalDecimal[]) =>
  canonical(values.reduce((sum, value) => sum.plus(value), d(0)));

export const calculateStairLayerConfiguration = ({
  input,
  parent,
  availableInventory
}: {
  readonly input: StairLayerConfigurationInput;
  readonly parent: StairLayerParentGeometry;
  readonly availableInventory: readonly PaidRemainderStock[];
}): StairLayerCalculation => {
  try {
    normalizedText(input.calculationPolicyVersion, 'calculationPolicyVersion');
    normalizedText(input.packingPolicyVersion, 'packingPolicyVersion');
    normalizedText(input.pricingPolicyVersion, 'pricingPolicyVersion');
    normalizedText(input.roundingPolicyVersion, 'roundingPolicyVersion');
    if (d(input.layerRateToman).lte(0)) {
      return {
        ok: false,
        conflicts: [{
          code: 'layer-rate-required',
          field: 'layerRateToman',
          message: 'Layer rate must be greater than zero.'
        }]
      };
    }
    if (
      (input.source.kind === 'new-material' ||
        input.source.kind === 'parent-material') &&
      d(input.source.materialRateToman).lte(0)
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'layer-rate-required',
          field: 'source.materialRateToman',
          message: 'New layer material rate must be greater than zero.'
        }]
      };
    }

    const technical = calculateStairLayerGeometry({ input, parent, availableInventory,
      packingPolicyVersion: input.packingPolicyVersion });
    if (!technical.ok) return technical;
    const facts = technical.result;
    const strips = facts.physicalStrips;
    const packing = { plan: facts.packingPlan };
    const missingRates: StairLayerConflict[] = [];
    if (
      d(packing.plan.longitudinalCutMeters).gt(0) &&
      input.longitudinalCutRateToman === undefined
    ) {
      missingRates.push({
        code: 'layer-cut-rate-missing',
        field: 'longitudinalCutRateToman',
        message: 'Longitudinal layer cutting rate is missing.'
      });
    }
    if (
      d(packing.plan.crossCutMeters).gt(0) &&
      input.crossCutRateToman === undefined
    ) {
      missingRates.push({
        code: 'layer-cut-rate-missing',
        field: 'crossCutRateToman',
        message: 'Cross layer cutting rate is missing.'
      });
    }
    if (
      d(packing.plan.calibrationMeters).gt(0) &&
      input.calibrationCutRateToman === undefined
    ) {
      missingRates.push({
        code: 'layer-cut-rate-missing',
        field: 'calibrationCutRateToman',
        message: 'Layer calibration rate is missing.'
      });
    }
    if (missingRates.length > 0) return { ok: false, conflicts: missingRates };

    const sideOperations = calculateLayerSideOperations(input, strips, calculateProductOperations);
    if (!sideOperations.ok) return { ok: false, conflicts: sideOperations.conflicts };
    const sideOperationResults = sideOperations.results;
    const layerQuantity = facts.catalogQuantity;
    const newMaterialQuantity = facts.materialSourceSplit.newMaterialSquareMeters;
    const paidMaterialQuantity = facts.materialSourceSplit.paidMaterialSquareMeters;
    const pricing = calculatePricing({
      policyVersion: input.pricingPolicyVersion,
      roundingPolicyVersion: input.roundingPolicyVersion,
      lines: [
        {
          lineId: `${input.layerConfigurationId}:layer-type`,
          quantity: layerQuantity,
          rateToman: input.layerRateToman
        },
        ...(input.source.kind === 'new-material' ||
        input.source.kind === 'parent-material'
          ? [{
              lineId: `${input.layerConfigurationId}:material`,
              quantity: newMaterialQuantity,
              rateToman: input.source.materialRateToman
            }]
          : []),
        ...(input.longitudinalCutRateToman === undefined
          ? []
          : [{
              lineId: `${input.layerConfigurationId}:cut:longitudinal`,
              quantity: packing.plan.longitudinalCutMeters,
              rateToman: input.longitudinalCutRateToman
            }]),
        ...(input.crossCutRateToman === undefined
          ? []
          : [{
              lineId: `${input.layerConfigurationId}:cut:cross`,
              quantity: packing.plan.crossCutMeters,
              rateToman: input.crossCutRateToman
            }]),
        ...(input.calibrationCutRateToman === undefined
          ? []
          : [{
              lineId: `${input.layerConfigurationId}:cut:calibration`,
              quantity: packing.plan.calibrationMeters,
              rateToman: input.calibrationCutRateToman
            }])
      ]
    });
    const layerPricingLine = pricing.lines.find(line =>
      line.lineId.endsWith(':layer-type')
    )!;
    const materialPricingLine = pricing.lines.find(line =>
      line.lineId.endsWith(':material')
    );
    const cuttingPricingLines = pricing.lines.filter(line =>
      line.lineId.includes(':cut:')
    );

    const inventory = technical.inventory;
    const generatedRemainders = facts.generatedRemainders;

    const layerAmountToman = layerPricingLine.amountToman;
    const materialAmountToman = materialPricingLine?.amountToman ?? canonical(0);
    const paidSourceCount = facts.materialSourceSplit.paidSourceCount;
    const newSourceCount = facts.materialSourceSplit.newSourceCount;
    const cuttingAmountToman = sumAmounts(
      cuttingPricingLines.map(line => line.amountToman)
    );
    const operationsAmountToman = sumAmounts(
      sideOperationResults.map(item => item.result.totalAmountToman)
    );
    const totalAmountToman = sumAmounts([
      layerAmountToman,
      materialAmountToman,
      cuttingAmountToman,
      operationsAmountToman
    ]);
    const resultBase = {
      calculationPolicyVersion: input.calculationPolicyVersion,
      inputHash: hashCanonicalValue({ input, parent, availableInventory }),
      commercialLayerSets: parent.quantity * input.layersPerParentPiece,
      physicalStripCount: strips.reduce((sum, strip) => sum + strip.quantity, 0),
      physicalStrips: strips,
      packingPlan: packing.plan,
      materialPricingReason:
        paidSourceCount > 0 && newSourceCount > 0
          ? 'mixed-material' as const
          : newSourceCount > 0
            ? 'new-material' as const
            : 'paid-material' as const,
      materialSourceSplit: {
        paidSourceCount,
        paidMaterialSquareMeters: paidMaterialQuantity,
        paidMaterialAmountToman: canonical(0),
        newSourceCount,
        newMaterialSquareMeters: newMaterialQuantity,
        newMaterialAmountToman: materialAmountToman
      },
      layerPricingQuantity: layerQuantity,
      layerPricingLine,
      ...(materialPricingLine ? { materialPricingLine } : {}),
      cuttingPricingLines,
      sideOperationResults,
      generatedRemainders,
      layerAmountToman,
      materialAmountToman,
      cuttingAmountToman,
      operationsAmountToman,
      totalAmountToman
    };
    const result: StairLayerConfigurationResult = {
      ...resultBase,
      resultHash: hashCanonicalValue(resultBase)
    };
    return { ok: true, result, inventory };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Layer input is invalid.';
    const missing = error instanceof RangeError;
    const duplicate = message.includes('duplicates a selected source');
    return {
      ok: false,
      conflicts: [{
        code: duplicate
          ? 'duplicate-layer-source'
          : missing
            ? 'layer-source-missing'
            : 'invalid-layer-input',
        field: missing || duplicate ? 'source' : 'layer',
        message
      }]
    };
  }
};

export interface StairLayerReplayResult {
  readonly configurations: readonly {
    readonly input: StairLayerConfigurationInput;
    readonly result: StairLayerConfigurationResult;
  }[];
  readonly inventory: readonly PaidRemainderStock[];
}

export const replayStairLayerConfigurations = ({
  inputs,
  parents,
  baseInventory
}: {
  readonly inputs: readonly StairLayerConfigurationInput[];
  readonly parents: ReadonlyMap<
    StableIdentity<'product-row'>,
    StairLayerParentGeometry
  >;
  readonly baseInventory: readonly PaidRemainderStock[];
}):
  | { readonly ok: true; readonly result: StairLayerReplayResult }
  | { readonly ok: false; readonly conflicts: readonly StairLayerConflict[] } => {
  const replay = replayLayerSequence({ inputs, parents, baseInventory }, calculateStairLayerConfiguration);
  return replay.ok ? replay : { ok: false, conflicts: replay.conflicts };
};

export const duplicateStairLayerConfigurationDraft = ({
  source,
  layerConfigurationId,
  sourceBatchId,
  sideOperations
}: {
  readonly source: StairLayerConfigurationInput;
  readonly layerConfigurationId: StableIdentity<'layer-configuration'>;
  readonly sourceBatchId: StableIdentity<'source-batch'>;
  readonly sideOperations: readonly StairLayerSideOperationsInput[];
}) => {
  const {
    source: _source,
    layerConfigurationId: _oldLayerConfigurationId,
    sourceBatchId: _oldSourceBatchId,
    sideOperations: _oldSideOperations,
    ...settings
  } = source;
  return {
    ...settings,
    layerConfigurationId,
    sourceBatchId,
    sideOperations
  };
};
