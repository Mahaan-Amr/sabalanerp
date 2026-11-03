import type { ContractProduct, RemainingStone, StonePartition } from '../types/contract.types';
import { recalculateUsedRemainingDimensions } from '../utils/dimensionUtils';
import { ensureContractProductRowIds } from '../utils/contractProductIdentity';
import {
  getRemainingStoneInventoryGroupKey,
  groupRemainingStoneInventory,
  mergeRemainingStoneCollection,
  normalizeRemainingStoneCollection
} from '../utils/remainingStoneGuards';
import { allocateRemainingStonePartitions } from './remainingStonePartitionService';
import { recalculateRemainingChildAddOns } from './remainingStoneChildAddOnService';
import { calculateSlabRemainingStones, calculateSmartLongitudinalCutPlan } from './remainingStoneService';
import { calculateRemainingChildCuttingBreakdown } from './remainingStoneCuttingService';

export interface RemainingStoneReplayConflict {
  childRowId: string;
  childLabel: string;
  allocationId: string;
  reason: string;
}

export interface RemainingStoneReplayResult {
  ok: boolean;
  products: ContractProduct[];
  conflicts: RemainingStoneReplayConflict[];
}

interface ReplayOptions {
  products: ContractProduct[];
  sourceRowId: string;
  sourceInventory?: RemainingStone[];
  inventoryExpectations?: Array<{
    groupKey: string;
    expectedQuantity: number;
    beforeChildRowId: string;
  }>;
}

const getAllocationId = (product: ContractProduct): string =>
  product.meta?.remainingSource?.allocationId ||
  product.meta?.remainingSource?.partitionId ||
  `allocation-${product.rowId}`;

const getAllocationOrder = (product: ContractProduct, fallbackIndex: number): number => {
  const value = product.remainingStoneAllocationOrder ?? product.meta?.remainingSource?.allocationOrder;
  return Number.isFinite(Number(value)) ? Number(value) : fallbackIndex;
};

export const resolveRemainingStoneSourceInventory = (
  source: ContractProduct,
  explicit?: RemainingStone[]
): RemainingStone[] => {
  if (explicit || source.remainingStoneSourceInventory || source.smartCutPlan?.remainingStones) {
    return normalizeRemainingStoneCollection(
      explicit || source.remainingStoneSourceInventory || source.smartCutPlan?.remainingStones || []
    );
  }

  if (source.productType === 'longitudinal') {
    return normalizeRemainingStoneCollection(calculateSmartLongitudinalCutPlan({
      originalWidthCm: Number(source.originalWidth || source.diameterOrWidth || 0),
      enteredWidth: Number(source.width || 0),
      enteredWidthUnit: source.widthUnit || 'cm',
      enteredLength: Number(source.length || 0),
      enteredLengthUnit: source.lengthUnit || 'm',
      quantity: Number(source.quantity || 0),
      requestedAreaSqm: Number(source.squareMeters || 0),
      allowPhysicalSplitting: !!source.smartCutAllowPhysicalSplitting || !!source.smartCutDerivedDimension,
      longitudinalRatePerMeter: Number(source.cuttingCostPerMeter || 0),
      sawKerfEnabled: !!source.sawKerfEnabled,
      sawKerfCm: source.sawKerfCm,
      calibrationCutEnabled: source.calibrationCutEnabled,
      seed: 1
    }).remainingStones);
  }

  if (source.productType === 'slab' && (source.slabStandardDimensions || []).length > 0) {
    const requestedWidthCm = source.widthUnit === 'm' ? Number(source.width || 0) * 100 : Number(source.width || 0);
    const requestedLengthCm = source.lengthUnit === 'm' ? Number(source.length || 0) * 100 : Number(source.length || 0);
    return normalizeRemainingStoneCollection(calculateSlabRemainingStones({
      requestedWidthCm,
      requestedLengthCm,
      standardDimensions: source.slabStandardDimensions || [],
      sawKerfEnabled: !!source.sawKerfEnabled,
      sawKerfCm: source.sawKerfCm,
      seed: 1
    }).remainingStones);
  }

  return normalizeRemainingStoneCollection(source.remainingStones || []);
};

const allocationRow = (child: ContractProduct): StonePartition => ({
  id: getAllocationId(child),
  width: Number(child.width || child.diameterOrWidth || 0),
  length: child.lengthUnit === 'cm' ? Number(child.length || 0) / 100 : Number(child.length || 0),
  quantity: Math.max(1, Math.floor(Number(child.quantity) || 1)),
  squareMeters: Number(child.squareMeters || 0)
});

const replaceAllocatedStock = (
  inventory: RemainingStone[],
  stockIndex: number,
  allocation: ReturnType<typeof allocateRemainingStonePartitions>
): RemainingStone[] => {
  const stock = allocation.stockInfo;
  const unconsumedQuantity = Math.max(0, stock.quantity - allocation.consumedSourcePieces);
  const retained = unconsumedQuantity > 0
    ? [{
        ...stock.sanitized,
        quantity: unconsumedQuantity,
        squareMeters: stock.pieceArea * unconsumedQuantity
      }]
    : [];
  const generated = allocation.remainingAreas.map((area) => ({
    ...area,
    sourceCutId: stock.sanitized.sourceCutId
  }));

  return normalizeRemainingStoneCollection([
    ...inventory.slice(0, stockIndex),
    ...retained,
    ...generated,
    ...inventory.slice(stockIndex + 1)
  ]);
};

interface PhysicalStockUnit {
  stone: RemainingStone;
  physicalId: string;
}

const expandPhysicalStockUnits = (
  stones: RemainingStone[]
): PhysicalStockUnit[] => stones.flatMap((stone) => {
  const quantity = Math.max(1, Math.trunc(Number(stone.quantity || 1)));
  const offset = Math.max(0, Math.trunc(Number(stone.physicalUnitOffset || 0)));
  return Array.from({ length: quantity }, (_, index) => ({
    stone,
    physicalId:
      quantity === 1 && offset === 0
        ? stone.id
        : `${stone.id}:unit:${offset + index + 1}`
  }));
});

const replaceAllocatedStockGroup = (
  inventory: RemainingStone[],
  groupKey: string,
  allocation: ReturnType<typeof allocateRemainingStonePartitions>
): {
  inventory: RemainingStone[];
  consumedSourceStoneIds: string[];
  generatedRemainingStoneIds: string[];
} => {
  const groupStones = inventory.filter(
    stone => getRemainingStoneInventoryGroupKey(stone) === groupKey
  );
  const physicalUnits = expandPhysicalStockUnits(groupStones);
  const consumedUnits = physicalUnits.slice(0, allocation.consumedSourcePieces);
  const consumedByStoneId = new Map<string, number>();
  consumedUnits.forEach(({ stone }) => {
    consumedByStoneId.set(stone.id, (consumedByStoneId.get(stone.id) || 0) + 1);
  });

  const retainedInventory = inventory.flatMap((stone) => {
    if (getRemainingStoneInventoryGroupKey(stone) !== groupKey) return [stone];
    const consumed = consumedByStoneId.get(stone.id) || 0;
    const quantity = Math.max(1, Math.trunc(Number(stone.quantity || 1)));
    const retainedQuantity = quantity - consumed;
    if (retainedQuantity <= 0) return [];
    return [{
      ...stone,
      quantity: retainedQuantity,
      physicalUnitOffset:
        Math.max(0, Math.trunc(Number(stone.physicalUnitOffset || 0))) +
        consumed,
      squareMeters: (stone.width * stone.length * retainedQuantity) / 100
    }];
  });

  const remainderSequenceBySource = new Map<string, number>();
  const generated = allocation.remainingAreas.map((area) => {
    const sheetIndex = allocation.remainingAreaSheetIndexes.get(area.id) ?? 0;
    const sourceUnit = consumedUnits[sheetIndex];
    const sourceId = sourceUnit?.physicalId || consumedUnits[0]?.physicalId || area.id;
    const sequence = (remainderSequenceBySource.get(sourceId) || 0) + 1;
    remainderSequenceBySource.set(sourceId, sequence);
    return {
      ...area,
      id: `${sourceId}:secondary:${sequence}`,
      sourceCutId: sourceUnit?.stone.sourceCutId || area.sourceCutId
    };
  });

  return {
    inventory: normalizeRemainingStoneCollection([
      ...retainedInventory,
      ...generated
    ]),
    consumedSourceStoneIds: consumedUnits.map(unit => unit.physicalId),
    generatedRemainingStoneIds: generated.map(stone => stone.id)
  };
};

const getChildOperationTotal = (child: ContractProduct, cuttingCost: number): number =>
  cuttingCost + Number(child.totalSubServiceCost || 0) + Number(child.finishingCost || 0);

export const replayRemainingStoneAllocations = ({
  products,
  sourceRowId,
  sourceInventory,
  inventoryExpectations = []
}: ReplayOptions): RemainingStoneReplayResult => {
  const normalizedProducts = ensureContractProductRowIds(products);
  const sourceIndex = normalizedProducts.findIndex((product) => product.rowId === sourceRowId);
  if (sourceIndex < 0) {
    return {
      ok: false,
      products,
      conflicts: [{
        childRowId: '',
        childLabel: 'محصول منبع',
        allocationId: '',
        reason: 'محصول منبع برای بازپخش تخصیص‌ها پیدا نشد.'
      }]
    };
  }

  const source = normalizedProducts[sourceIndex];
  const canonicalInventory = resolveRemainingStoneSourceInventory(source, sourceInventory);
  let availableInventory = canonicalInventory;
  const usedRemainingStones: RemainingStone[] = [];
  const conflicts: RemainingStoneReplayConflict[] = [];
  const childEntries = normalizedProducts
    .map((product, index) => ({ product, index }))
    .filter(({ product }) =>
      product.parentProductRowId === sourceRowId &&
      !Boolean((product.meta as { isLayer?: boolean } | undefined)?.isLayer)
    )
    .sort((left, right) => {
      const orderDifference = getAllocationOrder(left.product, left.index) - getAllocationOrder(right.product, right.index);
      return orderDifference || left.index - right.index;
    });
  const updatedChildren = new Map<number, ContractProduct>();

  childEntries.forEach(({ product: child, index: childIndex }, replayIndex) => {
    if (conflicts.length > 0) return;
    const expectation = inventoryExpectations.find(
      candidate => candidate.beforeChildRowId === child.rowId
    );
    if (expectation) {
      const actualQuantity =
        groupRemainingStoneInventory(availableInventory)
          .find(group => group.key === expectation.groupKey)?.quantity || 0;
      if (actualQuantity !== expectation.expectedQuantity) {
        conflicts.push({
          childRowId: child.rowId || '',
          childLabel: 'گروه باقی‌مانده',
          allocationId: expectation.groupKey,
          reason:
            `موجودی این گروه از ${expectation.expectedQuantity} به ${actualQuantity} قطعه تغییر کرده است؛ تعداد را دوباره تأیید کنید.`
        });
        return;
      }
    }
    const addOnResult = recalculateRemainingChildAddOns(child);
    if (!addOnResult.ok) {
      conflicts.push({
        childRowId: child.rowId || '',
        childLabel: child.stoneName || child.product?.namePersian || `محصول ${childIndex + 1}`,
        allocationId: getAllocationId(child),
        reason: addOnResult.reason || 'افزونه محصول با هندسه جدید سازگار نیست.'
      });
      return;
    }
    const recalculatedChild = addOnResult.product;
    const row = allocationRow(recalculatedChild);
    let successfulAllocation: ReturnType<typeof allocateRemainingStonePartitions> | null = null;
    let successfulStockIndex = -1;
    let successfulGroupKey: string | null = null;
    let lastReason = 'ابعاد یا تعداد این محصول در باقی‌مانده جدید جا نمی‌شود.';

    const requestedGroupKey = recalculatedChild.meta?.remainingSource?.sourceGroupKey;
    if (requestedGroupKey) {
      const group = groupRemainingStoneInventory(availableInventory)
        .find(candidate => candidate.key === requestedGroupKey);
      if (group) {
        const aggregateStock: RemainingStone = {
          ...group.stones[0],
          quantity: group.quantity,
          squareMeters: group.totalSquareMeters
        };
        const attempt = allocateRemainingStonePartitions([row], aggregateStock, {
          sawKerfEnabled: !!recalculatedChild.sawKerfEnabled,
          sawKerfCm: recalculatedChild.sawKerfCm
        });
        if (attempt.rowErrors.size === 0) {
          successfulAllocation = attempt;
          successfulGroupKey = requestedGroupKey;
        } else {
          lastReason = attempt.rowErrors.get(row.id) || attempt.summaryError || lastReason;
        }
      }
    }

    for (
      let stockIndex = 0;
      !requestedGroupKey &&
      !successfulAllocation &&
      stockIndex < availableInventory.length;
      stockIndex += 1
    ) {
      const attempt = allocateRemainingStonePartitions([row], availableInventory[stockIndex], {
        sawKerfEnabled: !!recalculatedChild.sawKerfEnabled,
        sawKerfCm: recalculatedChild.sawKerfCm
      });
      if (attempt.rowErrors.size === 0) {
        successfulAllocation = attempt;
        successfulStockIndex = stockIndex;
        break;
      }
      lastReason = attempt.rowErrors.get(row.id) || attempt.summaryError || lastReason;
    }

    if (!successfulAllocation) {
      conflicts.push({
        childRowId: child.rowId || '',
        childLabel: child.stoneName || child.product?.namePersian || `محصول ${childIndex + 1}`,
        allocationId: row.id,
        reason: availableInventory.length > 0 ? lastReason : 'هیچ سنگ باقی‌مانده‌ای پس از محاسبه هندسه منبع موجود نیست.'
      });
      return;
    }

    const stock = successfulAllocation.stockInfo.sanitized;
    const physicalPieces = successfulAllocation.physicalPiecesByRow.get(row.id) || [];
    const widthCut = row.width < stock.width;
    const lengthCut = row.length < stock.length;
    const cuttingBreakdown = calculateRemainingChildCuttingBreakdown({
      row,
      stock,
      rate: Number(recalculatedChild.cuttingCostPerMeter || 0)
    });
    const cuttingCost = cuttingBreakdown.reduce((total, entry) => total + entry.cost, 0);
    const allocationOrder = getAllocationOrder(recalculatedChild, replayIndex);
    let generatedRemainingStoneIds =
      successfulAllocation.remainingAreas.map((area) => area.id);
    let consumedSourceStoneIds = [stock.id];
    if (successfulGroupKey) {
      const replacement = replaceAllocatedStockGroup(
        availableInventory,
        successfulGroupKey,
        successfulAllocation
      );
      availableInventory = replacement.inventory;
      consumedSourceStoneIds = replacement.consumedSourceStoneIds;
      generatedRemainingStoneIds = replacement.generatedRemainingStoneIds;
    } else {
      availableInventory = replaceAllocatedStock(
        availableInventory,
        successfulStockIndex,
        successfulAllocation
      );
    }

    usedRemainingStones.push({
      id: `used-${row.id}`,
      width: row.width,
      length: row.length,
      squareMeters: (row.width * row.length * row.quantity) / 100,
      isAvailable: false,
      sourceCutId: stock.sourceCutId,
      quantity: row.quantity,
      physicalPieces,
      cutType: lengthCut ? 'cross' : (widthCut ? 'longitudinal' : null),
      cuttingCostPerMeter: Number(recalculatedChild.cuttingCostPerMeter || 0),
      cuttingCost
    });

    updatedChildren.set(childIndex, {
      ...recalculatedChild,
      parentProductIndex: sourceIndex,
      parentProductRowId: sourceRowId,
      remainingStoneAllocationOrder: allocationOrder,
      pricePerSquareMeter: 0,
      unitPrice: 0,
      originalTotalPrice: 0,
      isMandatory: false,
      mandatoryPercentage: 0,
      isCut: widthCut || lengthCut,
      cutType: lengthCut ? 'cross' : (widthCut ? 'longitudinal' : null),
      originalWidth: stock.width,
      originalLength: stock.length,
      cuttingCost,
      physicalCuttingCost: cuttingCost,
      cuttingBreakdown,
      totalPrice: getChildOperationTotal(recalculatedChild, cuttingCost),
      remainingStones: [],
      usedRemainingStones: [],
      totalUsedRemainingWidth: 0,
      totalUsedRemainingLength: 0,
      meta: {
        remainingSource: {
          sourceProductRowId: sourceRowId,
          sourceProductIndex: sourceIndex,
          sourceRemainingStoneId: stock.id,
          sourceRemainingStone: stock,
          allocationId: row.id,
          partitionId: row.id,
          allocationOrder,
          allocatedQuantity: row.quantity,
          generatedRemainingStoneIds,
          sourceGroupKey: successfulGroupKey || undefined,
          consumedSourceStoneIds,
          physicalPieces
        },
        pricing: {
          materialCost: 0,
          cuttingCost,
          toolsCost: Number(recalculatedChild.totalSubServiceCost || 0),
          finishingCost: Number(recalculatedChild.finishingCost || 0),
          totalPrice: getChildOperationTotal(recalculatedChild, cuttingCost)
        },
        sawKerf: recalculatedChild.sawKerfEnabled
          ? { enabled: true, cm: recalculatedChild.sawKerfCm }
          : undefined,
        tools: recalculatedChild.meta?.tools,
        finishing: recalculatedChild.meta?.finishing
      }
    });

  });

  if (conflicts.length > 0) {
    return { ok: false, products, conflicts };
  }

  const recalculated = recalculateUsedRemainingDimensions(usedRemainingStones);
  const nextProducts = normalizedProducts.map((product, index) => {
    if (index === sourceIndex) {
      return {
        ...product,
        remainingStoneSourceInventory: canonicalInventory,
        remainingStones: mergeRemainingStoneCollection(availableInventory),
        usedRemainingStones,
        totalUsedRemainingWidth: recalculated.totalUsedWidth,
        totalUsedRemainingLength: recalculated.totalUsedLength
      };
    }
    return updatedChildren.get(index) || product;
  });

  return { ok: true, products: nextProducts, conflicts: [] };
};

export const formatRemainingStoneReplayConflicts = (conflicts: RemainingStoneReplayConflict[]): string =>
  conflicts
    .map((conflict, index) => `${index + 1}. ${conflict.childLabel}: ${conflict.reason}`)
    .join('\n');
