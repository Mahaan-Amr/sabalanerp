import type { RemainingStone, StonePartition } from '../types/contract.types';
import { calculateRemainingAreasAfterPartitions } from './stoneCuttingService';
import { calculatePartitionPositions } from './partitionPositioningService';
import {
  isUsableRemainingStone,
  sanitizeRemainingStoneEntry
} from '../utils/remainingStoneGuards';
import { resolveSawKerfCm } from '../utils/sawKerf';

type ExpandedPartition = StonePartition & {
  sourceRowId: string;
};

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
  physicalPiecesByRow: Map<string, StonePartition[]>;
}

interface RemainingPartitionAllocationOptions {
  sawKerfEnabled?: boolean;
  sawKerfCm?: number | null;
}

const getQuantity = (quantity: number): number => Math.max(1, Math.floor(Number(quantity) || 1));

const getConsumedPartition = (
  row: StonePartition,
  stockWidth: number,
  stockLength: number,
  options: RemainingPartitionAllocationOptions
): StonePartition => {
  const kerfCm = resolveSawKerfCm(options.sawKerfEnabled, options.sawKerfCm);
  const widthCut = options.sawKerfEnabled && row.width > 0 && row.width < stockWidth;
  const lengthCut = options.sawKerfEnabled && row.length > 0 && row.length < stockLength;
  const consumedWidth = widthCut ? row.width + kerfCm : row.width;
  const consumedLength = lengthCut ? row.length + kerfCm / 100 : row.length;

  return {
    ...row,
    width: consumedWidth,
    length: consumedLength,
    squareMeters: (consumedWidth * consumedLength * getQuantity(row.quantity)) / 100
  };
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

const sheetFits = (sheet: ExpandedPartition[], piece: ExpandedPartition, width: number, length: number): ExpandedPartition[] | null => {
  const positioned = calculatePartitionPositions([...sheet, piece], width, length) as ExpandedPartition[];
  const hasErrors = positioned.some((partition) => partition.validationError || !partition.position);
  return hasErrors ? null : positioned;
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
      physicalPiecesByRow: new Map()
    };
  }

  const validRows = rows.filter((row) => row.width > 0 && row.length > 0);
  const consumedRows = validRows.map((row) =>
    getConsumedPartition(row, stockInfo.sanitized.width, stockInfo.sanitized.length, options)
  );

  consumedRows.forEach((row) => {
    if (row.width > stockInfo.sanitized.width) {
      rowErrors.set(row.id, `عرض (${row.width}) از عرض باقی‌مانده (${stockInfo.sanitized.width}) بیشتر است.`);
    }
  });

  const totalRequestedSquareMeters = consumedRows.reduce((sum, row) => sum + row.squareMeters, 0);
  if (totalRequestedSquareMeters > stockInfo.totalSquareMeters + 0.0001) {
    validRows.forEach((row) => {
      if (!rowErrors.has(row.id)) {
        rowErrors.set(
          row.id,
          `مجموع متر مربع پارتیشن‌ها (${totalRequestedSquareMeters.toFixed(3)}) از ظرفیت باقی‌مانده (${stockInfo.totalSquareMeters.toFixed(3)}) بیشتر است.`
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
      physicalPiecesByRow: new Map()
    };
  }

  const sheets: ExpandedPartition[][] = [];
  const physicalPiecesByRow = new Map<string, StonePartition[]>();
  const expandedRows = consumedRows.flatMap((row) => {
    const quantity = getQuantity(row.quantity);
    const pieces: ExpandedPartition[] = [];

    for (let quantityIndex = 0; quantityIndex < quantity; quantityIndex += 1) {
      let remainingLength = row.length;
      let segmentIndex = 0;

      while (remainingLength > 0.000001) {
        const segmentLength = Math.min(stockInfo.sanitized.length, remainingLength);
        pieces.push({
          ...row,
          id: `${row.id}__piece_${quantityIndex}_${segmentIndex}`,
          sourceRowId: row.id,
          quantity: 1,
          length: segmentLength,
          squareMeters: (row.width * segmentLength) / 100,
          validationError: undefined,
          position: undefined
        });
        remainingLength = Math.max(0, remainingLength - segmentLength);
        segmentIndex += 1;
      }
    }

    physicalPiecesByRow.set(
      row.id,
      pieces.map((piece) => ({
        id: piece.id,
        width: piece.width,
        length: piece.length,
        quantity: 1,
        squareMeters: piece.squareMeters,
        position: piece.position
      }))
    );

    return pieces;
  });

  for (const piece of expandedRows) {
    let placed = false;

    for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
      const positionedSheet = sheetFits(sheets[sheetIndex], piece, stockInfo.sanitized.width, stockInfo.sanitized.length);
      if (positionedSheet) {
        sheets[sheetIndex] = positionedSheet;
        placed = true;
        break;
      }
    }

    if (!placed && sheets.length < stockInfo.quantity) {
      const positionedSheet = sheetFits([], piece, stockInfo.sanitized.width, stockInfo.sanitized.length);
      if (positionedSheet) {
        sheets.push(positionedSheet);
        placed = true;
      }
    }

    if (!placed) {
      rowErrors.set(piece.sourceRowId, 'این تعداد و ابعاد در فضای باقی‌مانده جا نمی‌شود.');
    }
  }

  if (rowErrors.size > 0) {
    return {
      stockInfo,
      rowErrors,
      summaryError: `${rowErrors.size} پارتیشن دارای مشکل است. لطفاً ابعاد را بررسی و اصلاح کنید.`,
      consumedSourcePieces: sheets.length,
      remainingAreas: [],
      physicalPiecesByRow
    };
  }

  const remainingAreas = sheets.flatMap((sheet, sheetIndex) =>
    calculateRemainingAreasAfterPartitions(sheet, stockInfo.sanitized.width, stockInfo.sanitized.length)
      .map((area, areaIndex) => ({
        ...area,
        id: `remaining_partition_${Date.now()}_${sheetIndex}_${areaIndex}`,
        quantity: 1
      }))
  );

  return {
    stockInfo,
    rowErrors,
    summaryError: '',
    consumedSourcePieces: sheets.length,
    remainingAreas,
    physicalPiecesByRow
  };
};
