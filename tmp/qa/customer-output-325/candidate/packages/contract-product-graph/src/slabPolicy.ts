import Decimal from 'decimal.js';
import { hashCanonicalValue } from './canonicalHash';
import { normalizeLegacyJson } from './canonicalJson';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import {
  calculatePackingPlan,
  calculatePricing,
  type PackingPlan,
  type PricedLine
} from './packingPricing';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';

export type SlabDisplayUnit = 'cm' | 'm';
export type SlabManualField = 'length' | 'width' | 'area';
export type SlabCuttingPricingMethod = 'lineBased' | 'squareMeter';
export type SlabEdge = 'top' | 'bottom' | 'left' | 'right';

export interface SlabSourceRowInput {
  readonly sourceRowId: StableIdentity<'slab-source-row'>;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly lengthDisplayUnit: SlabDisplayUnit;
  readonly widthDisplayUnit: SlabDisplayUnit;
  readonly quantity: number;
}

export interface SlabPolicyInput {
  readonly calculationPolicyVersion: string;
  readonly packingPolicyVersion: string;
  readonly pricingPolicyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly sourceBatchId: StableIdentity<'source-batch'>;
  readonly lengthMeters?: CanonicalDecimal;
  readonly widthMeters?: CanonicalDecimal;
  readonly areaSquareMeters?: CanonicalDecimal;
  readonly quantity?: number;
  readonly lastManualField?: SlabManualField;
  readonly lastManualDimension?: 'length' | 'width';
  readonly lengthDisplayUnit: SlabDisplayUnit;
  readonly widthDisplayUnit: SlabDisplayUnit;
  readonly sourceRows: readonly SlabSourceRowInput[];
  readonly baseMaterialRateToman?: CanonicalDecimal;
  readonly kerfMeters: CanonicalDecimal;
  readonly cuttingPricingMethod: SlabCuttingPricingMethod;
  readonly longitudinalCutRateToman?: CanonicalDecimal;
  readonly crossCutRateToman?: CanonicalDecimal;
  readonly squareMeterCutRateToman?: CanonicalDecimal;
  readonly verticalCutSides: readonly SlabEdge[];
  readonly verticalCutRateToman?: CanonicalDecimal;
}

export interface CanonicalSlabFacts {
  readonly lengthDisplayUnit: SlabDisplayUnit;
  readonly widthDisplayUnit: SlabDisplayUnit;
  readonly cuttingPricingMethod: SlabCuttingPricingMethod;
  readonly sourceRows: readonly SlabSourceRowInput[];
}

export interface SlabPolicyResult {
  readonly calculationPolicyVersion: string;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly quantity: number;
  readonly finishedAreaSquareMeters: CanonicalDecimal;
  readonly lengthDisplayUnit: SlabDisplayUnit;
  readonly widthDisplayUnit: SlabDisplayUnit;
  readonly sourceRows: readonly SlabSourceRowInput[];
  readonly packingPlan: PackingPlan;
  readonly cuttingPricingMethod: SlabCuttingPricingMethod;
  readonly materialAreaSquareMeters: CanonicalDecimal;
  readonly materialPricingLine: PricedLine;
  readonly cuttingPricingLines: readonly PricedLine[];
  readonly verticalCutPricingLine?: PricedLine;
  readonly materialAmountToman: CanonicalDecimal;
  readonly cuttingAmountToman: CanonicalDecimal;
  readonly verticalCutAmountToman: CanonicalDecimal;
  readonly totalAmountToman: CanonicalDecimal;
}

export type SlabConflictCode =
  | 'duplicate-slab-source'
  | 'invalid-slab-input'
  | 'slab-cut-rate-missing'
  | 'slab-geometry-incomplete'
  | 'slab-price-required'
  | 'slab-source-insufficient'
  | 'slab-source-required';

export interface SlabConflict {
  readonly code: SlabConflictCode;
  readonly field: string;
  readonly message: string;
  readonly entityId?: string;
}

export type SlabCalculation =
  | { readonly ok: true; readonly result: SlabPolicyResult }
  | { readonly ok: false; readonly conflicts: readonly SlabConflict[] };

const d = (value: CanonicalDecimal | string | number) => new Decimal(value);
const canonical = (value: Decimal | string | number): CanonicalDecimal =>
  parseCanonicalDecimal(new Decimal(value).toFixed());
const positive = (value?: CanonicalDecimal) =>
  value !== undefined && d(value).gt(0);

export const parseSlabPolicyInput = (value: unknown): SlabPolicyInput => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Slab policy input must be an object.');
  }
  const record = value as Record<string, unknown>;
  const text = (item: unknown, field: string) => {
    if (typeof item !== 'string' || !item || item !== item.trim()) {
      throw new TypeError(`${field} must be normalized text.`);
    }
    return item;
  };
  const decimal = (item: unknown, field: string) => {
    const parsed = parseCanonicalDecimal(text(item, field));
    if (parsed !== item) throw new TypeError(`${field} must be canonical.`);
    return parsed;
  };
  const optionalDecimal = (field: string) =>
    record[field] === undefined ? undefined : decimal(record[field], field);
  const unit = (item: unknown, field: string): SlabDisplayUnit => {
    if (item !== 'cm' && item !== 'm') throw new TypeError(`${field} is invalid.`);
    return item;
  };
  const quantity = record.quantity;
  if (
    quantity !== undefined &&
    (!Number.isSafeInteger(quantity) || Number(quantity) <= 0)
  ) {
    throw new TypeError('quantity must be a positive integer.');
  }
  if (!Array.isArray(record.sourceRows)) {
    throw new TypeError('sourceRows must be an array.');
  }
  const cuttingPricingMethod = record.cuttingPricingMethod;
  if (cuttingPricingMethod !== 'lineBased' && cuttingPricingMethod !== 'squareMeter') {
    throw new TypeError('cuttingPricingMethod is invalid.');
  }
  const lastManualField = record.lastManualField;
  if (
    lastManualField !== undefined &&
    !['length', 'width', 'area'].includes(String(lastManualField))
  ) {
    throw new TypeError('lastManualField is invalid.');
  }
  const lastManualDimension = record.lastManualDimension;
  if (
    lastManualDimension !== undefined &&
    lastManualDimension !== 'length' &&
    lastManualDimension !== 'width'
  ) {
    throw new TypeError('lastManualDimension is invalid.');
  }
  if (!Array.isArray(record.verticalCutSides)) {
    throw new TypeError('verticalCutSides must be an array.');
  }
  const edges = record.verticalCutSides.map((edge, index) => {
    if (!['top', 'bottom', 'left', 'right'].includes(String(edge))) {
      throw new TypeError(`verticalCutSides.${index} is invalid.`);
    }
    return edge as SlabEdge;
  });
  if (typeof record.kerfMeters !== 'string') {
    throw new TypeError('kerfMeters is required.');
  }
  return {
    calculationPolicyVersion: text(
      record.calculationPolicyVersion,
      'calculationPolicyVersion'
    ),
    packingPolicyVersion: text(record.packingPolicyVersion, 'packingPolicyVersion'),
    pricingPolicyVersion: text(record.pricingPolicyVersion, 'pricingPolicyVersion'),
    roundingPolicyVersion: text(
      record.roundingPolicyVersion,
      'roundingPolicyVersion'
    ),
    sourceBatchId: parseStableIdentity(
      'source-batch',
      text(record.sourceBatchId, 'sourceBatchId')
    ),
    ...(optionalDecimal('lengthMeters') === undefined
      ? {}
      : { lengthMeters: optionalDecimal('lengthMeters') }),
    ...(optionalDecimal('widthMeters') === undefined
      ? {}
      : { widthMeters: optionalDecimal('widthMeters') }),
    ...(optionalDecimal('areaSquareMeters') === undefined
      ? {}
      : { areaSquareMeters: optionalDecimal('areaSquareMeters') }),
    ...(quantity === undefined ? {} : { quantity: Number(quantity) }),
    ...(lastManualField === undefined
      ? {}
      : { lastManualField: lastManualField as SlabManualField }),
    ...(lastManualDimension === undefined ? {} : { lastManualDimension }),
    lengthDisplayUnit: unit(record.lengthDisplayUnit, 'lengthDisplayUnit'),
    widthDisplayUnit: unit(record.widthDisplayUnit, 'widthDisplayUnit'),
    sourceRows: record.sourceRows.map((item, index) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw new TypeError(`sourceRows.${index} must be an object.`);
      }
      const source = item as Record<string, unknown>;
      if (!Number.isSafeInteger(source.quantity) || Number(source.quantity) <= 0) {
        throw new TypeError(`sourceRows.${index}.quantity must be positive.`);
      }
      return {
        sourceRowId: parseStableIdentity(
          'slab-source-row',
          text(source.sourceRowId, `sourceRows.${index}.sourceRowId`)
        ),
        lengthMeters: decimal(
          source.lengthMeters,
          `sourceRows.${index}.lengthMeters`
        ),
        widthMeters: decimal(
          source.widthMeters,
          `sourceRows.${index}.widthMeters`
        ),
        lengthDisplayUnit: unit(
          source.lengthDisplayUnit,
          `sourceRows.${index}.lengthDisplayUnit`
        ),
        widthDisplayUnit: unit(
          source.widthDisplayUnit,
          `sourceRows.${index}.widthDisplayUnit`
        ),
        quantity: Number(source.quantity)
      };
    }),
    ...(optionalDecimal('baseMaterialRateToman') === undefined
      ? {}
      : { baseMaterialRateToman: optionalDecimal('baseMaterialRateToman') }),
    kerfMeters: decimal(record.kerfMeters, 'kerfMeters'),
    cuttingPricingMethod,
    ...(optionalDecimal('longitudinalCutRateToman') === undefined
      ? {}
      : { longitudinalCutRateToman: optionalDecimal('longitudinalCutRateToman') }),
    ...(optionalDecimal('crossCutRateToman') === undefined
      ? {}
      : { crossCutRateToman: optionalDecimal('crossCutRateToman') }),
    ...(optionalDecimal('squareMeterCutRateToman') === undefined
      ? {}
      : { squareMeterCutRateToman: optionalDecimal('squareMeterCutRateToman') }),
    verticalCutSides: edges,
    ...(optionalDecimal('verticalCutRateToman') === undefined
      ? {}
      : { verticalCutRateToman: optionalDecimal('verticalCutRateToman') })
  };
};

const resolveGeometry = (
  input: SlabPolicyInput
):
  | {
      readonly lengthMeters: CanonicalDecimal;
      readonly widthMeters: CanonicalDecimal;
      readonly areaSquareMeters: CanonicalDecimal;
      readonly quantity: number;
    }
  | null => {
  if (!Number.isSafeInteger(input.quantity) || Number(input.quantity) <= 0) {
    return null;
  }
  const quantity = Number(input.quantity);
  const length = positive(input.lengthMeters) ? d(input.lengthMeters!) : undefined;
  const width = positive(input.widthMeters) ? d(input.widthMeters!) : undefined;
  const totalArea = positive(input.areaSquareMeters)
    ? d(input.areaSquareMeters!)
    : undefined;
  if (length && width) {
    const area = length.times(width).times(quantity);
    if (input.lastManualField === 'area' && totalArea) {
      if (input.lastManualDimension === 'length') {
        return {
          lengthMeters: canonical(length),
          widthMeters: canonical(totalArea.div(length.times(quantity))),
          areaSquareMeters: canonical(totalArea),
          quantity
        };
      }
      return {
        lengthMeters: canonical(totalArea.div(width.times(quantity))),
        widthMeters: canonical(width),
        areaSquareMeters: canonical(totalArea),
        quantity
      };
    }
    return {
      lengthMeters: canonical(length),
      widthMeters: canonical(width),
      areaSquareMeters: canonical(area),
      quantity
    };
  }
  if (length && totalArea) {
    return {
      lengthMeters: canonical(length),
      widthMeters: canonical(totalArea.div(length.times(quantity))),
      areaSquareMeters: canonical(totalArea),
      quantity
    };
  }
  if (width && totalArea) {
    return {
      lengthMeters: canonical(totalArea.div(width.times(quantity))),
      widthMeters: canonical(width),
      areaSquareMeters: canonical(totalArea),
      quantity
    };
  }
  return null;
};

export const calculateSlab = (input: SlabPolicyInput): SlabCalculation => {
  try {
    parseStableIdentity('source-batch', input.sourceBatchId);
    const geometry = resolveGeometry(input);
    if (!geometry) {
      return {
        ok: false,
        conflicts: [{
          code: 'slab-geometry-incomplete',
          field: 'geometry',
          message: 'Slab dimensions and quantity are incomplete.'
        }]
      };
    }
    if (!positive(input.baseMaterialRateToman)) {
      return {
        ok: false,
        conflicts: [{
          code: 'slab-price-required',
          field: 'baseMaterialRateToman',
          message: 'Slab material price must be greater than zero.'
        }]
      };
    }
    if (d(input.kerfMeters).lt(0)) {
      throw new TypeError('Slab kerf cannot be negative.');
    }
    if (input.sourceRows.length === 0) {
      return {
        ok: false,
        conflicts: [{
          code: 'slab-source-required',
          field: 'sourceRows',
          message: 'At least one manual slab source is required.'
        }]
      };
    }
    const sourceIds = new Set<string>();
    const sourceByBatch = new Map<string, SlabSourceRowInput>();
    for (const [index, source] of input.sourceRows.entries()) {
      parseStableIdentity('slab-source-row', source.sourceRowId);
      if (sourceIds.has(source.sourceRowId)) {
        return {
          ok: false,
          conflicts: [{
            code: 'duplicate-slab-source',
            field: 'sourceRows',
            entityId: source.sourceRowId,
            message: 'Each manual slab source row must have a stable unique identity.'
          }]
        };
      }
      sourceIds.add(source.sourceRowId);
      if (
        d(source.lengthMeters).lte(0) ||
        d(source.widthMeters).lte(0) ||
        !Number.isSafeInteger(source.quantity) ||
        source.quantity <= 0
      ) {
        return {
          ok: false,
          conflicts: [{
            code: 'invalid-slab-input',
            field: 'sourceRows',
            entityId: source.sourceRowId,
            message: `Manual slab source ${index + 1} requires positive dimensions and quantity.`
          }]
        };
      }
    }
    const packingSources = input.sourceRows.map(source => {
      const sourceBatchId = parseStableIdentity(
        'source-batch',
        `${input.sourceBatchId}:${source.sourceRowId}`
      );
      sourceByBatch.set(sourceBatchId, source);
      return {
        sourceBatchId,
        lengthMeters: source.lengthMeters,
        widthMeters: source.widthMeters,
        quantity: source.quantity
      };
    });
    const packing = calculatePackingPlan({
      policyVersion: input.packingPolicyVersion,
      kerfMeters: input.kerfMeters,
      sources: packingSources,
      demands: [{
        demandId: `${input.sourceBatchId}:finished-slab`,
        lengthMeters: geometry.lengthMeters,
        widthMeters: geometry.widthMeters,
        quantity: geometry.quantity
      }]
    });
    if (!packing.ok) {
      return {
        ok: false,
        conflicts: [{
          code: 'slab-source-insufficient',
          field: 'sourceRows',
          message: packing.conflict.message
        }]
      };
    }
    const missingRates: SlabConflict[] = [];
    if (input.cuttingPricingMethod === 'lineBased') {
      if (
        d(packing.plan.longitudinalCutMeters).gt(0) &&
        input.longitudinalCutRateToman === undefined
      ) {
        missingRates.push({
          code: 'slab-cut-rate-missing',
          field: 'longitudinalCutRateToman',
          message: 'Longitudinal slab cutting rate is missing.'
        });
      }
      if (
        d(packing.plan.crossCutMeters).gt(0) &&
        input.crossCutRateToman === undefined
      ) {
        missingRates.push({
          code: 'slab-cut-rate-missing',
          field: 'crossCutRateToman',
          message: 'Cross slab cutting rate is missing.'
        });
      }
    } else if (!positive(input.squareMeterCutRateToman)) {
      missingRates.push({
        code: 'slab-cut-rate-missing',
        field: 'squareMeterCutRateToman',
        message: 'Square-meter slab cutting rate must be greater than zero.'
      });
    }
    if (
      input.verticalCutSides.length > 0 &&
      input.verticalCutRateToman === undefined
    ) {
      missingRates.push({
        code: 'slab-cut-rate-missing',
        field: 'verticalCutRateToman',
        message: 'Vertical slab cutting rate is missing.'
      });
    }
    if (missingRates.length > 0) return { ok: false, conflicts: missingRates };

    const consumedCount = new Map<string, number>();
    packing.plan.consumedSources.forEach(source => {
      consumedCount.set(
        source.sourceBatchId,
        (consumedCount.get(source.sourceBatchId) ?? 0) + 1
      );
    });
    const materialArea = canonical([...consumedCount].reduce(
      (sum, [sourceBatchId, count]) => {
        const source = sourceByBatch.get(sourceBatchId)!;
        return sum.plus(
          d(source.lengthMeters).times(source.widthMeters).times(count)
        );
      },
      d(0)
    ));
    const verticalMeters = canonical([...consumedCount].reduce(
      (sum, [sourceBatchId, count]) => {
        const source = sourceByBatch.get(sourceBatchId)!;
        return sum.plus(input.verticalCutSides.reduce((edgeSum, edge) =>
          edgeSum.plus(
            edge === 'top' || edge === 'bottom'
              ? d(source.widthMeters).times(count)
              : d(source.lengthMeters).times(count)
          ), d(0)));
      },
      d(0)
    ));
    const pricing = calculatePricing({
      policyVersion: input.pricingPolicyVersion,
      roundingPolicyVersion: input.roundingPolicyVersion,
      lines: [
        {
          lineId: 'slab-material',
          quantity: materialArea,
          rateToman: input.baseMaterialRateToman!
        },
        ...(input.cuttingPricingMethod === 'lineBased'
          ? [
              ...(input.longitudinalCutRateToman === undefined ? [] : [{
                lineId: 'slab-cut-longitudinal',
                quantity: packing.plan.longitudinalCutMeters,
                rateToman: input.longitudinalCutRateToman
              }]),
              ...(input.crossCutRateToman === undefined ? [] : [{
                lineId: 'slab-cut-cross',
                quantity: packing.plan.crossCutMeters,
                rateToman: input.crossCutRateToman
              }])
            ]
          : [{
              lineId: 'slab-cut-square-meter',
              quantity: geometry.areaSquareMeters,
              rateToman: input.squareMeterCutRateToman!
            }]),
        ...(input.verticalCutSides.length === 0 ? [] : [{
          lineId: 'slab-cut-vertical',
          quantity: verticalMeters,
          rateToman: input.verticalCutRateToman!
        }])
      ]
    });
    const materialPricingLine = pricing.lines.find(
      line => line.lineId === 'slab-material'
    )!;
    const verticalCutPricingLine = pricing.lines.find(
      line => line.lineId === 'slab-cut-vertical'
    );
    const cuttingPricingLines = pricing.lines.filter(
      line => line.lineId.startsWith('slab-cut-') &&
        line.lineId !== 'slab-cut-vertical'
    );
    const cuttingAmountToman = canonical(cuttingPricingLines.reduce(
      (sum, line) => sum.plus(line.amountToman),
      d(0)
    ));
    const resultBase = {
      calculationPolicyVersion: input.calculationPolicyVersion,
      inputHash: hashCanonicalValue(normalizeLegacyJson(input)),
      ...geometry,
      finishedAreaSquareMeters: geometry.areaSquareMeters,
      lengthDisplayUnit: input.lengthDisplayUnit,
      widthDisplayUnit: input.widthDisplayUnit,
      sourceRows: input.sourceRows.map(source => ({ ...source })),
      packingPlan: packing.plan,
      cuttingPricingMethod: input.cuttingPricingMethod,
      materialAreaSquareMeters: materialArea,
      materialPricingLine,
      cuttingPricingLines,
      ...(verticalCutPricingLine ? { verticalCutPricingLine } : {}),
      materialAmountToman: materialPricingLine.amountToman,
      cuttingAmountToman,
      verticalCutAmountToman:
        verticalCutPricingLine?.amountToman ?? canonical(0),
      totalAmountToman: pricing.totalAmountToman
    };
    const { areaSquareMeters: _areaSquareMeters, ...normalized } = resultBase;
    const result: SlabPolicyResult = {
      ...normalized,
      resultHash: hashCanonicalValue(normalized)
    };
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Slab input is invalid.';
    return {
      ok: false,
      conflicts: [{
        code: error instanceof RangeError
          ? 'duplicate-slab-source'
          : 'invalid-slab-input',
        field: 'slab',
        message
      }]
    };
  }
};
