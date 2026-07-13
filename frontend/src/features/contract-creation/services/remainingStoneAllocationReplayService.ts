import type { ContractProduct, RemainingStone, StonePartition } from '../types/contract.types';
import { recalculateUsedRemainingDimensions } from '../utils/dimensionUtils';
import { ensureContractProductRowIds } from '../utils/contractProductIdentity';
import { mergeRemainingStoneCollection, normalizeRemainingStoneCollection } from '../utils/remainingStoneGuards';
import { allocateRemainingStonePartitions } from './remainingStonePartitionService';
import { recalculateRemainingChildAddOns } from './remainingStoneChildAddOnService';
import { calculateSlabRemainingStones, calculateSmartLongitudinalCutPlan } from './remainingStoneService';

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

const getChildOperationTotal = (child: ContractProduct, cuttingCost: number): number =>
  cuttingCost + Number(child.totalSubServiceCost || 0) + Number(child.finishingCost || 0);

export const replayRemainingStoneAllocations = ({
  products,
  sourceRowId,
  sourceInventory
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
    .filter(({ product }) => product.parentProductRowId === sourceRowId)
    .sort((left, right) => {
      const orderDifference = getAllocationOrder(left.product, left.index) - getAllocationOrder(right.product, right.index);
      return orderDifference || left.index - right.index;
    });
  const updatedChildren = new Map<number, ContractProduct>();

  childEntries.forEach(({ product: child, index: childIndex }, replayIndex) => {
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
    let lastReason = 'ابعاد یا تعداد این محصول در باقی‌مانده جدید جا نمی‌شود.';

    for (let stockIndex = 0; stockIndex < availableInventory.length; stockIndex += 1) {
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
    const cuttingMetersPerPiece = (widthCut ? row.length : 0) + (lengthCut ? row.width / 100 : 0);
    const cuttingCost = cuttingMetersPerPiece * row.quantity * Number(recalculatedChild.cuttingCostPerMeter || 0);
    const allocationOrder = getAllocationOrder(recalculatedChild, replayIndex);
    const generatedRemainingStoneIds = successfulAllocation.remainingAreas.map((area) => area.id);

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

    availableInventory = replaceAllocatedStock(availableInventory, successfulStockIndex, successfulAllocation);
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
