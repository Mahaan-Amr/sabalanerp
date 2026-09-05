import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { calculatePackingPlan, type PackingPlan } from './packingPricing';
import { parseStableIdentity } from './stableIdentity';
import type { SlabPolicyInput, SlabPolicyResult, SlabSourceRowInput, SlabConflict } from './slabPolicy';
import { projectTechnicalPacking, TECHNICAL_PACKING_VERSION, type TechnicalPackingPlan } from './technicalPacking';
import { technicalShape, technicalDecimal, technicalIdentity, technicalEnum, technicalRevision } from './technicalInput';

export type SlabGeometryInput = Pick<SlabPolicyInput,
  'sourceBatchId' | 'lengthMeters' | 'widthMeters' | 'areaSquareMeters' | 'quantity' |
  'lastManualField' | 'lastManualDimension' | 'lengthDisplayUnit' | 'widthDisplayUnit' |
  'sourceRows' | 'kerfMeters' | 'verticalCutSides'>;
export interface SlabTechnicalInput extends SlabGeometryInput {
  readonly inputRevision: number;
}
export interface SlabGeometryResult extends Pick<SlabPolicyResult,
  'lengthMeters' | 'widthMeters' | 'quantity' | 'finishedAreaSquareMeters' |
  'lengthDisplayUnit' | 'widthDisplayUnit' | 'sourceRows' | 'materialAreaSquareMeters'> {
  readonly packingPlan: PackingPlan;
  readonly verticalCutMeters: CanonicalDecimal;
}
export interface SlabTechnicalResult extends Omit<SlabGeometryResult, 'packingPlan'> {
  readonly inputRevision: number;
  readonly packingPlan: TechnicalPackingPlan;
}
export type SlabTechnicalCalculation =
  | { readonly ok: true; readonly result: SlabTechnicalResult }
  | { readonly ok: false; readonly inputRevision?: number; readonly conflicts: readonly SlabConflict[] };

const d = (value: CanonicalDecimal | string | number) => new Decimal(value);
const canonical = (value: Decimal | string | number): CanonicalDecimal =>
  parseCanonicalDecimal(new Decimal(value).toFixed());
const positive = (value?: CanonicalDecimal) =>
  value !== undefined && d(value).gt(0);

const resolveGeometry = (
  input: SlabGeometryInput
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


/** Canonical geometry shared with the priced slab entry point. */
export const calculateSlabGeometry = (
  input: SlabGeometryInput, packingPolicyVersion: string
): { readonly ok: true; readonly result: SlabGeometryResult } |
   { readonly ok: false; readonly conflicts: readonly SlabConflict[] } => {
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
      policyVersion: packingPolicyVersion,
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
    return { ok: true, result: {
      lengthMeters: geometry.lengthMeters, widthMeters: geometry.widthMeters,
      quantity: geometry.quantity, finishedAreaSquareMeters: geometry.areaSquareMeters,
      lengthDisplayUnit: input.lengthDisplayUnit, widthDisplayUnit: input.widthDisplayUnit,
      sourceRows: input.sourceRows.map(source => ({ ...source })),
      packingPlan: packing.plan, materialAreaSquareMeters: materialArea,
      verticalCutMeters: verticalMeters,
    } };
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

export const calculateSlabTechnical = (input: SlabTechnicalInput): SlabTechnicalCalculation => {
  const inputRevision = technicalRevision(input);
  try {
    technicalShape(input, ['inputRevision', 'sourceBatchId', 'lengthMeters', 'widthMeters',
      'areaSquareMeters', 'quantity', 'lastManualField', 'lastManualDimension',
      'lengthDisplayUnit', 'widthDisplayUnit', 'sourceRows', 'kerfMeters', 'verticalCutSides']);
    if (inputRevision === undefined) throw new TypeError();
    technicalIdentity(input.sourceBatchId);
    for (const value of [input.lengthMeters, input.widthMeters, input.areaSquareMeters]) {
      if (value !== undefined) technicalDecimal(value);
    }
    technicalDecimal(input.kerfMeters);
    technicalEnum(input.lengthDisplayUnit, ['m', 'cm']);
    technicalEnum(input.widthDisplayUnit, ['m', 'cm']);
    if (input.lastManualField !== undefined) technicalEnum(input.lastManualField, ['length', 'width', 'area']);
    if (input.lastManualDimension !== undefined) technicalEnum(input.lastManualDimension, ['length', 'width']);
    if (!Array.isArray(input.sourceRows) || !Array.isArray(input.verticalCutSides)) throw new TypeError();
    for (const source of input.sourceRows) {
      technicalShape(source, ['sourceRowId', 'lengthMeters', 'widthMeters', 'lengthDisplayUnit', 'widthDisplayUnit', 'quantity']);
      technicalIdentity(source.sourceRowId);
      technicalDecimal(source.lengthMeters); technicalDecimal(source.widthMeters);
      technicalEnum(source.lengthDisplayUnit, ['m', 'cm']); technicalEnum(source.widthDisplayUnit, ['m', 'cm']);
    }
    for (const side of input.verticalCutSides) technicalEnum(side, ['top', 'bottom', 'left', 'right']);
  } catch {
    return { ok: false, ...(inputRevision === undefined ? {} : { inputRevision }),
      conflicts: [{ code: 'invalid-slab-input', field: 'slab', message: 'Invalid technical slab input.' }] };
  }
  const calculation = calculateSlabGeometry(input, TECHNICAL_PACKING_VERSION);
  if (!calculation.ok) return { ...calculation, inputRevision: input.inputRevision };
  return { ok: true, result: { ...calculation.result, inputRevision: input.inputRevision,
    packingPlan: projectTechnicalPacking(calculation.result.packingPlan) } };
};
