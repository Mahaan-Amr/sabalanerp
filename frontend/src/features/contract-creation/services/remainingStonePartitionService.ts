import type { RemainingStone, StonePartition } from '../types/contract.types';
import { calculateRemainingAreasAfterPartitions } from './stoneCuttingService';
import { calculatePartitionPositions } from './partitionPositioningService';
import {
  isUsableRemainingStone,
  sanitizeRemainingStoneEntry
} from '../utils/remainingStoneGuards';

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
}

const getQuantity = (quantity: number): number => Math.max(1, Math.floor(Number(quantity) || 1));

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

const expandPartitionRows = (rows: StonePartition[]): ExpandedPartition[] =>
  rows.flatMap((row) => {
    const quantity = getQuantity(row.quantity);
    const perPieceSquareMeters = (row.width * row.length) / 100;

    return Array.from({ length: quantity }, (_, index) => ({
      ...row,
      id: `${row.id}__piece_${index}`,
      sourceRowId: row.id,
      quantity: 1,
      squareMeters: perPieceSquareMeters,
      validationError: undefined,
      position: undefined
    }));
  });

const sheetFits = (sheet: ExpandedPartition[], piece: ExpandedPartition, width: number, length: number): ExpandedPartition[] | null => {
  const positioned = calculatePartitionPositions([...sheet, piece], width, length) as ExpandedPartition[];
  const hasErrors = positioned.some((partition) => partition.validationError || !partition.position);
  return hasErrors ? null : positioned;
};

export const allocateRemainingStonePartitions = (
  rows: StonePartition[],
  remainingStone: RemainingStone
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
      remainingAreas: []
    };
  }

  const validRows = rows.filter((row) => row.width > 0 && row.length > 0);

  validRows.forEach((row) => {
    if (row.width > stockInfo.sanitized.width) {
      rowErrors.set(row.id, `عرض (${row.width}) از عرض باقی‌مانده (${stockInfo.sanitized.width}) بیشتر است.`);
    } else if (row.length > stockInfo.sanitized.length) {
      rowErrors.set(row.id, `طول (${row.length}) از طول باقی‌مانده (${stockInfo.sanitized.length}) بیشتر است.`);
    }
  });

  const totalRequestedSquareMeters = validRows.reduce((sum, row) => sum + row.squareMeters, 0);
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
      remainingAreas: []
    };
  }

  const sheets: ExpandedPartition[][] = [];
  const expandedRows = expandPartitionRows(validRows);

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
      remainingAreas: []
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
    remainingAreas
  };
};
