import type { RemainingStone, StonePartition } from '../types/contract.types';
import {
  calculatePackingPlan,
  parseCanonicalDecimal,
  parseStableIdentity
} from '@sabalanerp/contract-product-graph';
import { calculateRemainingAreasAfterPartitions } from './stoneCuttingService';
import { calculatePartitionPositions } from './partitionPositioningService';
import {
  isUsableRemainingStone,
  sanitizeRemainingStoneEntry
} from '../utils/remainingStoneGuards';
import { resolveSawKerfCm } from '../utils/sawKerf';

export interface RemainingStockInfo {
  sanitized: RemainingStone;
  quantity: number;
  pieceArea: number;
  totalSquareMeters: number;
}

export interface RemainingPartitionAllocation {
  stockInfo: RemainingStockInfo;
  rowErrors: Map<string, string>;
  summaryError: string;
  consumedSourcePieces: number;
  remainingAreas: RemainingStone[];
  remainingAreaSheetIndexes: Map<string, number>;
  physicalPiecesByRow: Map<string, StonePartition[]>;
  sourcePieceQuantitiesByRow: Map<string, number[]>;
  longitudinalCutMeters: number;
  crossCutMeters: number;
}

interface RemainingPartitionAllocationOptions {
  sawKerfEnabled?: boolean;
  sawKerfCm?: number | null;
}

type ExpandedPartition = StonePartition & {
  sourceRowId: string;
  requestedWidth: number;
  requestedLength: number;
};

const getQuantity = (quantity: number): number => Math.max(1, Math.floor(Number(quantity) || 1));
const normalizeGeometryNumber = (value: number): number => Number(value.toFixed(12));
const canonicalGeometry = (value: number) => parseCanonicalDecimal(String(normalizeGeometryNumber(value)));
const centimetersFromMeters = (value: string): number => normalizeGeometryNumber(Number(value) * 100);

const allocateMixedPreviewPartitions = (
  rows: StonePartition[],
  stockInfo: RemainingStockInfo,
  options: RemainingPartitionAllocationOptions
): RemainingPartitionAllocation => {
  const rowErrors = new Map<string, string>();
  const kerfCm = resolveSawKerfCm(options.sawKerfEnabled, options.sawKerfCm);
  const sheets: ExpandedPartition[][] = [];
  const physicalPiecesByRow = new Map<string, StonePartition[]>();
  const expandedRows = rows.filter(row => row.width > 0 && row.length > 0).flatMap(row => {
    const pieces: ExpandedPartition[] = [];
    for (let logicalIndex = 0; logicalIndex < getQuantity(row.quantity); logicalIndex += 1) {
      const segmentCount = Math.max(1, Math.ceil(
        normalizeGeometryNumber(row.length / stockInfo.sanitized.length) - 0.000000000001
      ));
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
        const rawLength = Math.min(stockInfo.sanitized.length,
          normalizeGeometryNumber(row.length - stockInfo.sanitized.length * segmentIndex));
        const width = options.sawKerfEnabled && row.width < stockInfo.sanitized.width
          ? normalizeGeometryNumber(row.width + kerfCm) : row.width;
        const length = options.sawKerfEnabled && rawLength < stockInfo.sanitized.length
          ? normalizeGeometryNumber(rawLength + kerfCm / 100) : rawLength;
        pieces.push({ ...row, id: `${row.id}__piece_${logicalIndex}_${segmentIndex}`,
          sourceRowId: row.id, requestedWidth: row.width, requestedLength: rawLength,
          logicalPieceOrdinal: logicalIndex + 1, width, length, quantity: 1,
          squareMeters: normalizeGeometryNumber(width * length / 100), position: undefined,
          validationError: undefined });
      }
    }
    return pieces;
  });
  for (const piece of expandedRows) {
    let placed = false;
    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
      const positioned = calculatePartitionPositions(
        [...sheets[sheetIndex], piece], stockInfo.sanitized.width, stockInfo.sanitized.length
      ) as ExpandedPartition[];
      if (!positioned.some(item => item.validationError || !item.position)) {
        sheets[sheetIndex] = positioned;
        placed = true;
        break;
      }
    }
    if (!placed && sheets.length < stockInfo.quantity) {
      const positioned = calculatePartitionPositions(
        [piece], stockInfo.sanitized.width, stockInfo.sanitized.length
      ) as ExpandedPartition[];
      if (!positioned.some(item => item.validationError || !item.position)) {
        sheets.push(positioned);
        placed = true;
      }
    }
    if (!placed) rowErrors.set(piece.sourceRowId, 'این تعداد و ابعاد در فضای باقی‌مانده جا نمی‌شود.');
  }
  sheets.flat().forEach(piece => {
    physicalPiecesByRow.set(piece.sourceRowId, [
      ...(physicalPiecesByRow.get(piece.sourceRowId) ?? []),
      { id: piece.id, logicalPieceOrdinal: piece.logicalPieceOrdinal,
        width: piece.requestedWidth,
        length: piece.requestedLength,
        quantity: 1,
        squareMeters: normalizeGeometryNumber(piece.requestedWidth * piece.requestedLength / 100),
        position: piece.position }
    ]);
  });
  const sourcePieceQuantitiesByRow = new Map<string, number[]>();
  rows.forEach(row => sourcePieceQuantitiesByRow.set(row.id, sheets
    .map(sheet => sheet.filter(piece => piece.sourceRowId === row.id).length)
    .filter(quantity => quantity > 0)));
  if (rowErrors.size) return { stockInfo, rowErrors,
    summaryError: `${rowErrors.size} پارتیشن دارای مشکل است. لطفاً ابعاد را بررسی و اصلاح کنید.`,
    consumedSourcePieces: sheets.length, remainingAreas: [], remainingAreaSheetIndexes: new Map(),
    physicalPiecesByRow, sourcePieceQuantitiesByRow, longitudinalCutMeters: 0, crossCutMeters: 0 };
  const remainingAreaSheetIndexes = new Map<string, number>();
  const remainingAreas = sheets.flatMap((sheet, sheetIndex) =>
    calculateRemainingAreasAfterPartitions(sheet, stockInfo.sanitized.width, stockInfo.sanitized.length)
      .map((area, areaIndex) => {
        const id = `remaining_partition_${Date.now()}_${sheetIndex}_${areaIndex}`;
        remainingAreaSheetIndexes.set(id, sheetIndex);
        return { ...area, id, quantity: 1 };
      }));
  return { stockInfo, rowErrors, summaryError: '', consumedSourcePieces: sheets.length,
    remainingAreas, remainingAreaSheetIndexes, physicalPiecesByRow,
    sourcePieceQuantitiesByRow, longitudinalCutMeters: 0, crossCutMeters: 0 };
};

export const normalizeRemainingStock = (remainingStone: RemainingStone): RemainingStockInfo => {
  const sanitized = sanitizeRemainingStoneEntry(remainingStone);
  const pieceArea = (sanitized.width * sanitized.length) / 100;
  const quantity = isUsableRemainingStone(sanitized)
    ? Math.max(1, Math.floor(Number(sanitized.quantity) || 1))
    : 0;

  return {
    sanitized,
    quantity,
    pieceArea,
    totalSquareMeters: quantity > 0 ? pieceArea * quantity : 0
  };
};

export const allocateRemainingStonePartitions = (
  rows: StonePartition[],
  remainingStone: RemainingStone,
  options: RemainingPartitionAllocationOptions = {}
): RemainingPartitionAllocation => {
  const stockInfo = normalizeRemainingStock(remainingStone);
  const rowErrors = new Map<string, string>();

  if (!isUsableRemainingStone(stockInfo.sanitized)) {
    rows.forEach((row) => {
      rowErrors.set(row.id, 'این سنگ باقی‌مانده قابل استفاده نیست یا موجودی آن به پایان رسیده است.');
    });

    return {
      stockInfo,
      rowErrors,
      summaryError: 'سنگ باقی‌مانده انتخاب‌شده قابل استفاده نیست.',
      consumedSourcePieces: 0,
      remainingAreas: [],
      remainingAreaSheetIndexes: new Map(),
      physicalPiecesByRow: new Map(),
      sourcePieceQuantitiesByRow: new Map(),
      longitudinalCutMeters: 0,
      crossCutMeters: 0
    };
  }

  // Modal previews may contain heterogeneous sibling rows. Keep their bounded greedy
  // placement here; each committed child is replayed individually by the canonical engine below.
  if (rows.length > 1) return allocateMixedPreviewPartitions(rows, stockInfo, options);

  const validRows = rows.filter((row) => row.width > 0 && row.length > 0);
  validRows.forEach((row) => {
    if (row.width > stockInfo.sanitized.width) {
      rowErrors.set(row.id, `عرض (${row.width}) از عرض باقی‌مانده (${stockInfo.sanitized.width}) بیشتر است.`);
    }
  });

  const totalRequestedSquareMeters = validRows.reduce(
    (sum, row) => sum + (row.width * row.length * getQuantity(row.quantity)) / 100,
    0
  );
  if (totalRequestedSquareMeters > stockInfo.totalSquareMeters + 0.0001) {
    validRows.forEach((row) => {
      if (!rowErrors.has(row.id)) {
        rowErrors.set(
          row.id,
          `مجموع متر مربع پارتیشن‌ها (${totalRequestedSquareMeters.toFixed(4)}) از ظرفیت باقی‌مانده (${stockInfo.totalSquareMeters.toFixed(4)}) بیشتر است.`
        );
      }
    });
  }

  if (rowErrors.size > 0) {
    return {
      stockInfo,
      rowErrors,
      summaryError: `${rowErrors.size} پارتیشن دارای مشکل است. لطفاً ابعاد را بررسی و اصلاح کنید.`,
      consumedSourcePieces: 0,
      remainingAreas: [],
      remainingAreaSheetIndexes: new Map(),
      physicalPiecesByRow: new Map(),
      sourcePieceQuantitiesByRow: new Map(),
      longitudinalCutMeters: 0,
      crossCutMeters: 0
    };
  }

  const kerfMeters = options.sawKerfEnabled
    ? resolveSawKerfCm(true, options.sawKerfCm) / 100
    : 0;
  const demandSourceRows = new Map<string, string>();
  const demandLogicalOrdinals = new Map<string, number>();
  const physicalDemands = validRows.flatMap((row) => {
    const demands: Array<{
      demandId: string;
      lengthMeters: ReturnType<typeof parseCanonicalDecimal>;
      widthMeters: ReturnType<typeof parseCanonicalDecimal>;
      quantity: number;
    }> = [];
    for (let logicalIndex = 0; logicalIndex < getQuantity(row.quantity); logicalIndex += 1) {
      const segmentCount = Math.max(1, Math.ceil(
        normalizeGeometryNumber(row.length / stockInfo.sanitized.length) - 0.000000000001
      ));
      for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
        const consumedBefore = normalizeGeometryNumber(stockInfo.sanitized.length * segmentIndex);
        const segmentLength = Math.min(
          stockInfo.sanitized.length,
          normalizeGeometryNumber(row.length - consumedBefore)
        );
        const demandId = `${row.id}:physical:${logicalIndex + 1}:${segmentIndex + 1}`;
        demandSourceRows.set(demandId, row.id);
        demandLogicalOrdinals.set(demandId, logicalIndex + 1);
        demands.push({
          demandId,
          lengthMeters: canonicalGeometry(segmentLength),
          widthMeters: canonicalGeometry(row.width / 100),
          quantity: 1
        });
      }
    }
    return demands;
  });
  const packing = calculatePackingPlan({
    policyVersion: 'packing-v1',
    kerfMeters: canonicalGeometry(kerfMeters),
    sources: [{
      sourceBatchId: parseStableIdentity('source-batch', `remaining-source:${stockInfo.sanitized.id}`),
      lengthMeters: canonicalGeometry(stockInfo.sanitized.length),
      widthMeters: canonicalGeometry(stockInfo.sanitized.width / 100),
      quantity: stockInfo.quantity
    }],
    demands: physicalDemands
  });

  if (!packing.ok) {
    validRows.forEach((row) => rowErrors.set(row.id, 'این تعداد و ابعاد در فضای باقی‌مانده جا نمی‌شود.'));
    return {
      stockInfo,
      rowErrors,
      summaryError: `${rowErrors.size} پارتیشن دارای مشکل است. لطفاً ابعاد را بررسی و اصلاح کنید.`,
      consumedSourcePieces: 0,
      remainingAreas: [],
      remainingAreaSheetIndexes: new Map(),
      physicalPiecesByRow: new Map(),
      sourcePieceQuantitiesByRow: new Map(),
      longitudinalCutMeters: 0,
      crossCutMeters: 0
    };
  }

  const plan = packing.plan;
  const physicalPiecesByRow = new Map<string, StonePartition[]>();
  validRows.forEach((row) => {
    physicalPiecesByRow.set(row.id, plan.placements
      .filter((placement) => demandSourceRows.get(placement.demandId) === row.id)
      .sort((left, right) => left.sourceOrdinal - right.sourceOrdinal ||
        left.demandId.localeCompare(right.demandId) || left.demandOrdinal - right.demandOrdinal)
      .map((placement, pieceIndex) => ({
        id: `${row.id}__piece_${pieceIndex}`,
        logicalPieceOrdinal: demandLogicalOrdinals.get(placement.demandId),
        width: centimetersFromMeters(placement.widthMeters),
        length: normalizeGeometryNumber(Number(placement.lengthMeters)),
        quantity: 1,
        squareMeters: normalizeGeometryNumber(Number(placement.widthMeters) * Number(placement.lengthMeters)),
        position: {
          startWidth: centimetersFromMeters(placement.xMeters),
          startLength: normalizeGeometryNumber(Number(placement.yMeters))
        }
      })));
  });

  const remainingAreaSheetIndexes = new Map<string, number>();
  const sourcePieceQuantitiesByRow = new Map<string, number[]>();
  validRows.forEach((row) => {
    const counts = new Map<number, number>();
    plan.placements.filter((placement) => demandSourceRows.get(placement.demandId) === row.id).forEach((placement) => {
      counts.set(placement.sourceOrdinal, (counts.get(placement.sourceOrdinal) ?? 0) + 1);
    });
    sourcePieceQuantitiesByRow.set(row.id, Array.from(counts.entries())
      .sort(([left], [right]) => left - right)
      .map(([, quantity]) => quantity));
  });
  const remainingAreas = plan.remainders.map((remainder, areaIndex) => {
    const id = `remaining_partition_${Date.now()}_${remainder.sourceOrdinal}_${areaIndex}`;
    remainingAreaSheetIndexes.set(id, remainder.sourceOrdinal - 1);
    const width = centimetersFromMeters(remainder.widthMeters);
    const length = normalizeGeometryNumber(Number(remainder.lengthMeters));
    return {
      id,
      width,
      length,
      squareMeters: (width * length) / 100,
      isAvailable: true,
      sourceCutId: stockInfo.sanitized.sourceCutId,
      quantity: 1,
      position: {
        startWidth: centimetersFromMeters(remainder.xMeters),
        startLength: normalizeGeometryNumber(Number(remainder.yMeters))
      }
    };
  });

  return {
    stockInfo,
    rowErrors,
    summaryError: '',
    consumedSourcePieces: plan.consumedSources.length,
    remainingAreas,
    remainingAreaSheetIndexes,
    physicalPiecesByRow,
    sourcePieceQuantitiesByRow,
    longitudinalCutMeters: normalizeGeometryNumber(Number(plan.longitudinalCutMeters)),
    crossCutMeters: normalizeGeometryNumber(Number(plan.crossCutMeters))
  };
};
