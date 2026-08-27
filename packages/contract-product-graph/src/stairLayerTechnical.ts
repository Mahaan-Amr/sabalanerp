import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { calculatePackingPlan, type PackingPlan } from './packingPricing';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';
import type { PaidRemainderStock } from './remainderPolicy';
import type { StairLayerConfigurationInput, StairLayerSourceSelection, StairLayerParentGeometry,
  StairLayerPhysicalStripDemand, StairLayerCatalogUnit, StairLayerSideOperationsInput,
  StairLayerConfigurationResult, StairLayerConflict } from './stairLayerPolicy';
import { calculateProductOperationsTechnical, type ProductOperationsTechnicalInput, type ProductOperationsTechnicalResult } from './operationsTechnical';
import { calculateLayerSideOperations, type LayerSideResult } from './layerSideOperations';
import { projectTechnicalPacking, TECHNICAL_PACKING_VERSION, type TechnicalPackingPlan } from './technicalPacking';
import { technicalShape, technicalDecimal, technicalIdentity, technicalEnum, technicalRevision, technicalStock } from './technicalInput';
import { replayLayerSequence, type LayerReplayState } from './layerReplay';

export type StairLayerTechnicalSource = StairLayerSourceSelection extends infer Source
  ? Source extends object ? Omit<Source, 'materialRateToman'> : never : never;
export interface StairLayerGeometryInput extends Omit<StairLayerConfigurationInput,
  'calculationPolicyVersion' | 'packingPolicyVersion' | 'pricingPolicyVersion' |
  'roundingPolicyVersion' | 'layerRateToman' | 'longitudinalCutRateToman' |
  'crossCutRateToman' | 'calibrationCutRateToman' | 'source' | 'sideOperations'> {
  readonly source: StairLayerTechnicalSource;
}
export interface StairLayerTechnicalSideOperations extends Omit<StairLayerSideOperationsInput, 'operations'> {
  readonly operations: ProductOperationsTechnicalInput;
}
export interface StairLayerTechnicalInput extends StairLayerGeometryInput {
  readonly inputRevision: number;
  readonly sideOperations: readonly StairLayerTechnicalSideOperations[];
}
export interface StairLayerGeometryResult extends Pick<StairLayerConfigurationResult,
  'commercialLayerSets' | 'physicalStripCount' | 'physicalStrips' | 'generatedRemainders'> {
  readonly packingPlan: PackingPlan;
  readonly catalogQuantity: CanonicalDecimal;
  readonly materialSourceKind: StairLayerConfigurationResult['materialPricingReason'];
  readonly materialSourceSplit: Omit<StairLayerConfigurationResult['materialSourceSplit'],
    'paidMaterialAmountToman' | 'newMaterialAmountToman'>;
}
export interface StairLayerTechnicalResult extends Omit<StairLayerGeometryResult, 'packingPlan'> {
  readonly inputRevision: number;
  readonly layerConfigurationId: StairLayerTechnicalInput['layerConfigurationId'];
  readonly parentProductRowId: StairLayerTechnicalInput['parentProductRowId'];
  readonly packingPlan: TechnicalPackingPlan;
  readonly sideOperationResults: readonly LayerSideResult<ProductOperationsTechnicalResult>[];
}
export type StairLayerTechnicalCalculation =
  | { readonly ok: true; readonly result: StairLayerTechnicalResult; readonly inventory: readonly PaidRemainderStock[] }
  | { readonly ok: false; readonly inputRevision?: number; readonly conflicts: readonly StairLayerConflict[];
      readonly result?: StairLayerTechnicalResult };

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

const physicalStripDemands = (
  input: StairLayerGeometryInput,
  parent: StairLayerParentGeometry
): StairLayerPhysicalStripDemand[] => {
  const quantity = parent.quantity * input.layersPerParentPiece;
  return input.targetSides.map(side => ({
    side,
    quantity,
    lengthMeters:
      side === 'front' || side === 'back'
        ? parent.lengthMeters
        : parent.crossDimensionMeters,
    widthMeters: input.widthMeters
  }));
};

const catalogQuantity = (
  unit: StairLayerCatalogUnit,
  commercialLayerSets: number,
  strips: readonly StairLayerPhysicalStripDemand[]
): CanonicalDecimal => {
  if (unit === 'set') return canonical(commercialLayerSets);
  if (unit === 'physicalPiece') {
    return canonical(strips.reduce((sum, strip) => sum + strip.quantity, 0));
  }
  if (unit === 'meter') {
    return canonical(strips.reduce(
      (sum, strip) => sum.plus(d(strip.lengthMeters).times(strip.quantity)),
      d(0)
    ));
  }
  return canonical(strips.reduce(
    (sum, strip) => sum.plus(
      d(strip.lengthMeters).times(strip.widthMeters).times(strip.quantity)
    ),
    d(0)
  ));
};

const consumedCountByBatch = (plan: PackingPlan) => {
  const counts = new Map<string, number>();
  plan.consumedSources.forEach(source => {
    counts.set(source.sourceBatchId, (counts.get(source.sourceBatchId) ?? 0) + 1);
  });
  return counts;
};


export const calculateStairLayerGeometry = ({
  input, parent, availableInventory, packingPolicyVersion,
}: {
  readonly input: StairLayerGeometryInput; readonly parent: StairLayerParentGeometry;
  readonly availableInventory: readonly PaidRemainderStock[]; readonly packingPolicyVersion: string;
}): { readonly ok: true; readonly result: StairLayerGeometryResult; readonly inventory: readonly PaidRemainderStock[] } |
   { readonly ok: false; readonly conflicts: readonly StairLayerConflict[] } => {
  try {
    normalizedText(input.layerCatalogItemId, 'layerCatalogItemId');
    normalizedText(input.layerCatalogSnapshotVersion, 'layerCatalogSnapshotVersion');
    normalizedText(input.layerTitle, 'layerTitle');
    parseStableIdentity('layer-configuration', input.layerConfigurationId);
    parseStableIdentity('product-row', input.parentProductRowId);
    parseStableIdentity('source-batch', input.sourceBatchId);
    positiveInteger(input.layersPerParentPiece, 'layersPerParentPiece');
    positiveInteger(parent.quantity, 'parent.quantity');
    if (!Number.isSafeInteger(input.creationOrder) || input.creationOrder < 0) {
      throw new TypeError('creationOrder must be a non-negative integer.');
    }
    if (
      d(parent.lengthMeters).lte(0) ||
      d(parent.crossDimensionMeters).lte(0) ||
      d(input.widthMeters).lte(0) ||
      d(input.kerfMeters).lt(0)
    ) {
      throw new TypeError('Layer and parent geometry must be positive.');
    }
    if (input.targetSides.length === 0) {
      throw new TypeError('At least one target side is required.');
    }
    if (new Set(input.targetSides).size !== input.targetSides.length) {
      return {
        ok: false,
        conflicts: [{
          code: 'duplicate-layer-side',
          field: 'targetSides',
          message: 'A target side may appear only once inside one layer configuration.'
        }]
      };
    }

    const strips = physicalStripDemands(input, parent);
    const stockBySyntheticBatch = new Map<
      string,
      { stock: PaidRemainderStock; batchId: StableIdentity<'source-batch'> }
    >();
    const selectedIds = new Set<string>();
    const paidSourceIds =
      input.source.kind === 'paid-remainder' ||
      input.source.kind === 'parent-material'
        ? input.source.selectedRemainingStoneIds
        : [];
    const paidPackingSources = paidSourceIds.flatMap((remainingStoneId, index) => {
      parseStableIdentity('remaining-stone', remainingStoneId);
      if (selectedIds.has(remainingStoneId)) {
        throw new TypeError(
          `selectedRemainingStoneIds.${index} duplicates a selected source.`
        );
      }
      selectedIds.add(remainingStoneId);
      const matchingStocks = availableInventory.filter(
        item =>
          item.remainingStoneId === remainingStoneId ||
          item.remainingStoneId.startsWith(
            `${remainingStoneId}:layer-remainder:`
          )
      );
      if (matchingStocks.length === 0) {
        throw new RangeError(`Selected remaining stone ${remainingStoneId} is unavailable.`);
      }
      return matchingStocks.map(stock => {
        if ([...stockBySyntheticBatch.values()].some(
          item => item.stock.remainingStoneId === stock.remainingStoneId
        )) {
          throw new TypeError(
            `selectedRemainingStoneIds.${index} overlaps another selected source.`
          );
        }
        const batchId = parseStableIdentity(
          'source-batch',
          `${input.sourceBatchId}:paid:${stock.remainingStoneId}`
        );
        stockBySyntheticBatch.set(batchId, { stock, batchId });
        return {
          sourceBatchId: batchId,
          lengthMeters: stock.lengthMeters,
          widthMeters: stock.widthMeters,
          quantity: stock.quantity,
          allocationPriority: 0
        };
      });
    });
    const newSourceRows =
      input.source.kind === 'new-material' ||
      input.source.kind === 'parent-material'
        ? input.source.sourceRows
        : [];
    const newPackingSources = newSourceRows.map((source, index) => {
          parseStableIdentity('layer-source-row', source.sourceRowId);
          positiveInteger(source.quantity, `sourceRows.${index}.quantity`);
          if (d(source.lengthMeters).lte(0) || d(source.widthMeters).lte(0)) {
            throw new TypeError(`sourceRows.${index} dimensions must be positive.`);
          }
          return {
            sourceBatchId: parseStableIdentity(
              'source-batch',
              `${input.sourceBatchId}:new:${source.sourceRowId}`
            ),
            lengthMeters: source.lengthMeters,
            widthMeters: source.widthMeters,
            quantity: source.quantity,
            allocationPriority: input.source.kind === 'parent-material' ? 1 : 0
          };
        });
    const packingSources = [...paidPackingSources, ...newPackingSources];
    if (packingSources.length === 0) {
      return {
        ok: false,
        conflicts: [{
          code: 'explicit-layer-source-required',
          field: 'source',
          message: 'A layer source must be selected explicitly.'
        }]
      };
    }
    const packing = calculatePackingPlan({
      policyVersion: packingPolicyVersion,
      kerfMeters: input.kerfMeters,
      calibrationEnabled: input.calibrationEnabled,
      sources: packingSources,
      demands: strips.map(strip => ({
        demandId: `${input.layerConfigurationId}:${strip.side}`,
        lengthMeters: strip.lengthMeters,
        widthMeters: strip.widthMeters,
        quantity: strip.quantity
      }))
    });
    if (!packing.ok) {
      return {
        ok: false,
        conflicts: [{
          code: 'layer-source-insufficient',
          field: 'source',
          message: packing.conflict.message
        }]
      };
    }

    const layerQuantity = catalogQuantity(
      input.layerUnit,
      parent.quantity * input.layersPerParentPiece,
      strips
    );
    const consumedByBatch = consumedCountByBatch(packing.plan);
    const newMaterialQuantity =
      input.source.kind === 'new-material' ||
      input.source.kind === 'parent-material'
        ? canonical(newPackingSources.reduce((sum, source) => {
          const consumed = consumedByBatch.get(source.sourceBatchId) ?? 0;
          return sum.plus(
            d(source.lengthMeters).times(source.widthMeters).times(consumed)
          );
        }, d(0)))
        : canonical(0);
    const paidMaterialQuantity = canonical(
      [...stockBySyntheticBatch.values()].reduce((sum, { stock, batchId }) => {
        const consumed = consumedByBatch.get(batchId) ?? 0;
        return sum.plus(
          d(stock.lengthMeters).times(stock.widthMeters).times(consumed)
        );
      }, d(0))
    );
    let inventory = availableInventory.map(cloneStock);
    if (
      input.source.kind === 'paid-remainder' ||
      input.source.kind === 'parent-material'
    ) {
      const byId = new Map(inventory.map(stock => [stock.remainingStoneId, stock]));
      stockBySyntheticBatch.forEach(({ stock, batchId }) => {
        const consumed = consumedByBatch.get(batchId) ?? 0;
        if (consumed === 0) return;
        const current = byId.get(stock.remainingStoneId);
        if (!current || current.quantity < consumed) {
          throw new RangeError('Selected paid layer source is no longer sufficient.');
        }
        if (current.quantity === consumed) byId.delete(stock.remainingStoneId);
        else {
          byId.set(stock.remainingStoneId, {
            ...current,
            quantity: current.quantity - consumed
          });
        }
      });
      inventory = [...byId.values()];
    }

    const generatedRemainders = packing.plan.remainders.map((remainder, index) => {
      const paidSource = stockBySyntheticBatch.get(remainder.sourceBatchId)?.stock;
      const paidRootId = paidSource?.remainingStoneId.split(
        ':layer-remainder:'
      )[0];
      return {
        remainingStoneId: parseStableIdentity(
          'remaining-stone',
          paidRootId
            ? `${paidRootId}:layer-remainder:${input.layerConfigurationId}:${index + 1}`
            : `${input.layerConfigurationId}:remainder:${index + 1}`
        ),
        ownerProductRowId: input.parentProductRowId,
        catalogProductId:
          input.source.kind === 'new-material' ||
          input.source.kind === 'parent-material'
          ? input.source.catalogProductId
          : stockBySyntheticBatch.get(remainder.sourceBatchId)
              ?.stock.catalogProductId ?? '',
        sourceBatchId: input.sourceBatchId,
        lengthMeters: remainder.lengthMeters,
        widthMeters: remainder.widthMeters,
        quantity: 1,
        creationOrder: input.creationOrder * 1000 + index,
        materialPaid: true as const
      };
    });
    if (generatedRemainders.some(stock => !stock.catalogProductId)) {
      throw new TypeError('Generated layer remainder lost its catalog identity.');
    }
    inventory = [...inventory, ...generatedRemainders];

    const paidSourceCount = paidPackingSources.reduce(
      (sum, source) =>
        sum + (consumedByBatch.get(source.sourceBatchId) ?? 0),
      0
    );
    const newSourceCount = newPackingSources.reduce(
      (sum, source) =>
        sum + (consumedByBatch.get(source.sourceBatchId) ?? 0),
      0
    );
    return { ok: true, inventory, result: {
      commercialLayerSets: parent.quantity * input.layersPerParentPiece,
      physicalStripCount: strips.reduce((sum, strip) => sum + strip.quantity, 0),
      physicalStrips: strips, packingPlan: packing.plan, catalogQuantity: layerQuantity,
      materialSourceKind: paidSourceCount > 0 && newSourceCount > 0 ? 'mixed-material'
        : newSourceCount > 0 ? 'new-material' : 'paid-material',
      materialSourceSplit: { paidSourceCount, paidMaterialSquareMeters: paidMaterialQuantity,
        newSourceCount, newMaterialSquareMeters: newMaterialQuantity },
      generatedRemainders,
    } };
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


export const calculateStairLayerTechnical = (args: {
  readonly input: StairLayerTechnicalInput; readonly parent: StairLayerParentGeometry;
  readonly availableInventory: readonly PaidRemainderStock[];
}): StairLayerTechnicalCalculation => {
  const inputRevision = technicalRevision(args?.input);
  try {
    technicalShape(args, ['input', 'parent', 'availableInventory']);
    const { input, parent, availableInventory } = args;
    technicalShape(input, ['inputRevision', 'layerConfigurationId', 'parentProductRowId',
      'sourceBatchId', 'creationOrder', 'layerCatalogItemId', 'layerCatalogSnapshotVersion', 'layerTitle',
      'layerUnit', 'layersPerParentPiece', 'widthMeters', 'widthDisplayUnit', 'targetSides',
      'source', 'kerfMeters', 'calibrationEnabled', 'sideOperations', 'description']);
    if (inputRevision === undefined) throw new TypeError();
    technicalShape(parent, ['lengthMeters', 'crossDimensionMeters', 'quantity']);
    technicalDecimal(parent.lengthMeters); technicalDecimal(parent.crossDimensionMeters);
    for (const value of [input.layerConfigurationId, input.parentProductRowId, input.sourceBatchId,
      input.layerCatalogItemId, input.layerCatalogSnapshotVersion, input.layerTitle]) technicalIdentity(value);
    technicalEnum(input.layerUnit, ['set', 'physicalPiece', 'meter', 'squareMeter']);
    technicalEnum(input.widthDisplayUnit, ['m', 'cm']);
    technicalDecimal(input.widthMeters); technicalDecimal(input.kerfMeters);
    if (typeof input.calibrationEnabled !== 'boolean' ||
        (input.description !== undefined && typeof input.description !== 'string')) throw new TypeError();
    if (!Array.isArray(input.targetSides) || !Array.isArray(input.sideOperations) || !Array.isArray(availableInventory)) throw new TypeError();
    for (const side of input.targetSides) technicalEnum(side, ['front', 'back', 'left', 'right']);
    technicalEnum(input.source?.kind, ['paid-remainder', 'parent-material', 'new-material']);
    const paid = input.source.kind !== 'new-material';
    const fresh = input.source.kind !== 'paid-remainder';
    technicalShape(input.source, ['kind', ...(paid ? ['selectedRemainingStoneIds'] : []),
      ...(fresh ? ['catalogProductId', 'catalogSnapshotVersion', 'sourceRows'] : [])]);
    if (input.source.kind !== 'new-material') {
      if (!Array.isArray(input.source.selectedRemainingStoneIds)) throw new TypeError();
      input.source.selectedRemainingStoneIds.forEach(technicalIdentity);
    }
    if (input.source.kind !== 'paid-remainder') {
      technicalIdentity(input.source.catalogProductId); technicalIdentity(input.source.catalogSnapshotVersion);
      if (!Array.isArray(input.source.sourceRows)) throw new TypeError();
      for (const source of input.source.sourceRows) {
        technicalShape(source, ['sourceRowId', 'lengthMeters', 'widthMeters', 'quantity']);
        technicalIdentity(source.sourceRowId); technicalDecimal(source.lengthMeters); technicalDecimal(source.widthMeters);
      }
    }
    for (const side of input.sideOperations) {
      technicalShape(side, ['side', 'operationCollectionId', 'scopeIntent', 'operations']);
      technicalEnum(side.side, ['front', 'back', 'left', 'right']);
      if (side.operationCollectionId !== undefined) technicalIdentity(side.operationCollectionId);
      if (side.scopeIntent !== undefined) technicalEnum(side.scopeIntent, ['all-strips', 'side', 'side-subset']);
      if (!side.operations || side.operations.inputRevision !== inputRevision) throw new TypeError();
    }
    availableInventory.forEach(technicalStock);
  } catch {
    return { ok: false, ...(inputRevision === undefined ? {} : { inputRevision }),
      conflicts: [{ code: 'invalid-layer-input', field: 'layer', message: 'Invalid technical layer input.' }] };
  }
  const { input, parent, availableInventory } = args;
  const geometry = calculateStairLayerGeometry({ input, parent, availableInventory, packingPolicyVersion: TECHNICAL_PACKING_VERSION });
  if (!geometry.ok) return { ...geometry, inputRevision: input.inputRevision };
  const operations = calculateLayerSideOperations(input, geometry.result.physicalStrips, calculateProductOperationsTechnical);
  const result: StairLayerTechnicalResult = { ...geometry.result,
    inputRevision: input.inputRevision, layerConfigurationId: input.layerConfigurationId,
    parentProductRowId: input.parentProductRowId, packingPlan: projectTechnicalPacking(geometry.result.packingPlan),
    sideOperationResults: operations.results };
  if (!operations.ok) return { ok: false, inputRevision: input.inputRevision, result, conflicts: operations.conflicts };
  return { ok: true, result, inventory: geometry.inventory };
};
export type StairLayerTechnicalReplayResult = LayerReplayState<StairLayerTechnicalInput, StairLayerTechnicalResult>;
export const replayStairLayerTechnical = (args: {
  readonly inputRevision: number;
  readonly inputs: readonly StairLayerTechnicalInput[];
  readonly parents: ReadonlyMap<StableIdentity<'product-row'>, StairLayerParentGeometry>;
  readonly baseInventory: readonly PaidRemainderStock[];
}): { readonly ok: true; readonly result: StairLayerTechnicalReplayResult & { readonly inputRevision: number } } |
    { readonly ok: false; readonly inputRevision?: number; readonly conflicts: readonly StairLayerConflict[];
      readonly result?: StairLayerTechnicalReplayResult } => {
  const inputRevision = technicalRevision(args);
  try {
    technicalShape(args, ['inputRevision', 'inputs', 'parents', 'baseInventory']);
    if (inputRevision === undefined || !Array.isArray(args.inputs) || !Array.isArray(args.baseInventory) ||
        !(args.parents instanceof Map)) throw new TypeError();
    args.baseInventory.forEach(technicalStock);
    for (const input of args.inputs) {
      if (!input || input.inputRevision !== inputRevision) throw new TypeError();
      technicalIdentity(input.layerConfigurationId); technicalIdentity(input.parentProductRowId);
      if (!Number.isSafeInteger(input.creationOrder) || input.creationOrder < 0) throw new TypeError();
    }
  } catch {
    return { ok: false, ...(inputRevision === undefined ? {} : { inputRevision }),
      conflicts: [{ code: 'invalid-layer-input', field: 'layers', message: 'Invalid technical layer replay.' }] };
  }
  const replay = replayLayerSequence(args, calculateStairLayerTechnical);
  return replay.ok ? { ok: true, result: { ...replay.result, inputRevision: inputRevision! } }
    : { ...replay, inputRevision };
};
