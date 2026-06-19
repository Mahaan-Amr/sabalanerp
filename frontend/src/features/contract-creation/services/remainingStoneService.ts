import type { CuttingBreakdownEntry, RemainingStone, SlabStandardDimensionEntry, SmartLongitudinalCutPlan } from '../types/contract.types';
import { sumNumericValues } from '@/lib/numberFormat';

type UnitType = 'cm' | 'm';

const toCentimeters = (value: number, unit: UnitType): number => (unit === 'm' ? value * 100 : value);
const toMeters = (value: number, unit: UnitType): number => (unit === 'cm' ? value / 100 : value);

const almostEqual = (a: number, b: number, epsilon = 0.0001): boolean => Math.abs(a - b) <= epsilon;

interface LongitudinalRemainingInput {
  originalWidthCm: number;
  enteredWidth: number;
  enteredWidthUnit: UnitType;
  enteredLength: number;
  enteredLengthUnit: UnitType;
  quantity: number;
  seed?: number;
}

interface LongitudinalRemainingOutput {
  isCut: boolean;
  cutType: 'longitudinal' | null;
  remainingStones: RemainingStone[];
  enteredWidthCm: number;
  enteredLengthM: number;
}

interface SlabRemainingInput {
  requestedWidthCm: number;
  requestedLengthCm: number;
  standardDimensions: SlabStandardDimensionEntry[];
  seed?: number;
}

interface SlabRemainingOutput {
  isCut: boolean;
  cutType: 'longitudinal' | 'cross' | null;
  remainingStones: RemainingStone[];
}

export const calculateLongitudinalRemainingStones = ({
  originalWidthCm,
  enteredWidth,
  enteredWidthUnit,
  enteredLength,
  enteredLengthUnit,
  quantity,
  seed
}: LongitudinalRemainingInput): LongitudinalRemainingOutput => {
  const safeQuantity = Number(quantity) || 0;
  const enteredWidthCm = toCentimeters(Number(enteredWidth) || 0, enteredWidthUnit);
  const enteredLengthM = toMeters(Number(enteredLength) || 0, enteredLengthUnit);
  const remainingWidthCm = originalWidthCm - enteredWidthCm;
  const shouldCutByGeometry =
    originalWidthCm > 0 &&
    enteredWidthCm > 0 &&
    enteredLengthM > 0 &&
    safeQuantity > 0 &&
    remainingWidthCm > 0;

  if (!shouldCutByGeometry) {
    return {
      isCut: false,
      cutType: null,
      remainingStones: [],
      enteredWidthCm,
      enteredLengthM
    };
  }

  const baseSeed = seed ?? Date.now();
  const remainingStone: RemainingStone = {
    id: `remaining_${baseSeed}_0`,
    width: remainingWidthCm,
    length: enteredLengthM,
    squareMeters: (remainingWidthCm / 100) * enteredLengthM * safeQuantity,
    isAvailable: true,
    sourceCutId: `cut_${baseSeed}_0`,
    quantity: safeQuantity
  };

  return {
    isCut: true,
    cutType: 'longitudinal',
    remainingStones: [remainingStone],
    enteredWidthCm,
    enteredLengthM
  };
};

export const calculateSmartLongitudinalCutPlan = ({
  originalWidthCm,
  enteredWidth,
  enteredWidthUnit,
  enteredLength,
  enteredLengthUnit,
  quantity,
  longitudinalRatePerMeter = 0,
  optimizationEnabled = true,
  seed
}: LongitudinalRemainingInput & {
  longitudinalRatePerMeter?: number;
  crossRatePerMeter?: number;
  optimizationEnabled?: boolean;
}): SmartLongitudinalCutPlan => {
  const sourceWidthCm = Math.max(0, Number(originalWidthCm) || 0);
  const requestedWidthCm = toCentimeters(Number(enteredWidth) || 0, enteredWidthUnit);
  const requestedLengthM = toMeters(Number(enteredLength) || 0, enteredLengthUnit);
  const requestedQuantity = Math.max(0, Number(quantity) || 0);
  const totalRequestedLengthM = requestedLengthM * requestedQuantity;
  const warnings: string[] = [];
  const baseSeed = seed ?? Date.now();

  if (sourceWidthCm <= 0 || requestedWidthCm <= 0 || requestedLengthM <= 0 || requestedQuantity <= 0) {
    return {
      enabled: false,
      mode: 'none',
      sourceWidthCm,
      requestedWidthCm,
      requestedLengthM,
      requestedQuantity,
      totalRequestedLengthM,
      stripsPerSource: 0,
      sourceLengthConsumedM: 0,
      consumedAreaSqm: 0,
      requestedAreaSqm: 0,
      productionPieces: [],
      remainingStones: [],
      cuttingBreakdown: [],
      totalCuttingCost: 0,
      warnings: ['ابعاد یا تعداد برای محاسبه برش هوشمند کامل نیست.']
    };
  }

  if (requestedWidthCm > sourceWidthCm) {
    return {
      enabled: false,
      mode: 'none',
      sourceWidthCm,
      requestedWidthCm,
      requestedLengthM,
      requestedQuantity,
      totalRequestedLengthM,
      stripsPerSource: 0,
      sourceLengthConsumedM: 0,
      consumedAreaSqm: 0,
      requestedAreaSqm: 0,
      productionPieces: [],
      remainingStones: [],
      cuttingBreakdown: [],
      totalCuttingCost: 0,
      warnings: ['عرض درخواستی از عرض سنگ اصلی بیشتر است.']
    };
  }

  const possibleStrips = Math.max(1, Math.floor(sourceWidthCm / requestedWidthCm));
  const stripsPerSource = optimizationEnabled ? Math.min(possibleStrips, requestedQuantity) : 1;
  const sourceBandsNeeded = Math.ceil(requestedQuantity / stripsPerSource);
  const sourceLengthConsumedM = requestedLengthM * sourceBandsNeeded;
  const consumedAreaSqm = (sourceWidthCm / 100) * sourceLengthConsumedM;
  const requestedAreaSqm = (requestedWidthCm / 100) * totalRequestedLengthM;
  const mode: SmartLongitudinalCutPlan['mode'] = optimizationEnabled && stripsPerSource > 1 ? 'optimized' : 'single-strip';

  if (!longitudinalRatePerMeter) {
    warnings.push('نرخ برش طولی پیدا نشد؛ هزینه برش طولی صفر محاسبه شد.');
  }
  const productionPieces = [{
    widthCm: requestedWidthCm,
    lengthM: requestedLengthM,
    quantity: requestedQuantity
  }];

  const remainingByDimension = new Map<string, RemainingStone>();
  let remainingQuantityToPlan = requestedQuantity;
  let longitudinalMeters = 0;
  for (let bandIndex = 0; bandIndex < sourceBandsNeeded; bandIndex += 1) {
    const piecesInBand = Math.min(stripsPerSource, remainingQuantityToPlan);
    remainingQuantityToPlan -= piecesInBand;
    const remainingWidthCm = sourceWidthCm - requestedWidthCm * piecesInBand;
    const cutCount = remainingWidthCm > 0 ? piecesInBand : Math.max(piecesInBand - 1, 0);
    longitudinalMeters += cutCount * requestedLengthM;

    if (remainingWidthCm > 0) {
      const key = `${remainingWidthCm}:${requestedLengthM}`;
      const existing = remainingByDimension.get(key);
      if (existing) {
        existing.quantity = (existing.quantity || 1) + 1;
        existing.squareMeters += (remainingWidthCm / 100) * requestedLengthM;
      } else {
        remainingByDimension.set(key, {
          id: `remaining_smart_${baseSeed}_${bandIndex}`,
          width: remainingWidthCm,
          length: requestedLengthM,
          squareMeters: (remainingWidthCm / 100) * requestedLengthM,
          isAvailable: true,
          sourceCutId: `cut_smart_${baseSeed}_${bandIndex}`,
          quantity: 1
        });
      }
    }
  }
  const remainingStones: RemainingStone[] = Array.from(remainingByDimension.values());

  const cuttingBreakdown: CuttingBreakdownEntry[] = [];
  const longitudinalCost = longitudinalMeters * longitudinalRatePerMeter;
  if (longitudinalMeters > 0) {
    cuttingBreakdown.push({
      type: 'longitudinal',
      meters: longitudinalMeters,
      rate: longitudinalRatePerMeter,
      cost: longitudinalCost
    });
  }

  return {
    enabled: requestedWidthCm < sourceWidthCm,
    mode,
    sourceWidthCm,
    requestedWidthCm,
    requestedLengthM,
    requestedQuantity,
    totalRequestedLengthM,
    stripsPerSource,
    sourceLengthConsumedM,
    consumedAreaSqm,
    requestedAreaSqm,
    productionPieces,
    remainingStones,
    cuttingBreakdown,
    totalCuttingCost: sumNumericValues(cuttingBreakdown, (cut) => cut.cost),
    warnings
  };
};

export const calculateSlabRemainingStones = ({
  requestedWidthCm,
  requestedLengthCm,
  standardDimensions,
  seed
}: SlabRemainingInput): SlabRemainingOutput => {
  const baseSeed = seed ?? Date.now();
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}_${baseSeed}_${idCounter++}`;

  const remainingPieces: RemainingStone[] = [];
  let hasLongitudinal = false;
  let hasCross = false;

  for (const entry of standardDimensions) {
    const standardWidthCm = Number(entry.standardWidthCm) || 0;
    const standardLengthCm = Number(entry.standardLengthCm) || 0;
    const quantity = Number(entry.quantity) || 0;

    if (standardWidthCm <= 0 || standardLengthCm <= 0 || quantity <= 0) continue;

    const needsLongitudinalCut = requestedWidthCm > 0 && requestedWidthCm < standardWidthCm;
    const needsCrossCut = requestedLengthCm > 0 && requestedLengthCm < standardLengthCm;

    if (!needsLongitudinalCut && !needsCrossCut) continue;

    hasLongitudinal = hasLongitudinal || needsLongitudinalCut;
    hasCross = hasCross || needsCrossCut;

    const remainingWidthCm = standardWidthCm - requestedWidthCm;
    const remainingLengthCm = standardLengthCm - requestedLengthCm;

    if (needsLongitudinalCut && remainingWidthCm > 0 && requestedLengthCm > 0) {
      const pieceLengthM = requestedLengthCm / 100;
      remainingPieces.push({
        id: nextId('remaining_slab_width'),
        width: remainingWidthCm,
        length: pieceLengthM,
        squareMeters: (remainingWidthCm / 100) * pieceLengthM * quantity,
        isAvailable: true,
        sourceCutId: nextId('cut_slab_width'),
        quantity
      });
    }

    if (needsCrossCut && remainingLengthCm > 0 && requestedWidthCm > 0) {
      const pieceLengthM = remainingLengthCm / 100;
      remainingPieces.push({
        id: nextId('remaining_slab_length'),
        width: requestedWidthCm,
        length: pieceLengthM,
        squareMeters: (requestedWidthCm / 100) * pieceLengthM * quantity,
        isAvailable: true,
        sourceCutId: nextId('cut_slab_length'),
        quantity
      });
    }

    if (needsLongitudinalCut && needsCrossCut && remainingWidthCm > 0 && remainingLengthCm > 0) {
      const cornerLengthM = remainingLengthCm / 100;
      remainingPieces.push({
        id: nextId('remaining_slab_corner'),
        width: remainingWidthCm,
        length: cornerLengthM,
        squareMeters: (remainingWidthCm / 100) * cornerLengthM * quantity,
        isAvailable: true,
        sourceCutId: nextId('cut_slab_corner'),
        quantity
      });
    }
  }

  const isCut = hasLongitudinal || hasCross;
  const cutType: 'longitudinal' | 'cross' | null = hasCross ? 'cross' : hasLongitudinal ? 'longitudinal' : null;

  return {
    isCut,
    cutType,
    remainingStones: remainingPieces
  };
};

export const hasLongitudinalGeometryChanged = (params: {
  previousProduct: {
    originalWidth: number;
    width: number;
    widthUnit: UnitType;
    length: number;
    lengthUnit: UnitType;
    quantity: number;
  } | null;
  nextOriginalWidthCm: number;
  nextWidthValue: number;
  nextWidthUnit: UnitType;
  nextLengthValue: number;
  nextLengthUnit: UnitType;
  nextQuantity: number;
}): boolean => {
  const {
    previousProduct,
    nextOriginalWidthCm,
    nextWidthValue,
    nextWidthUnit,
    nextLengthValue,
    nextLengthUnit,
    nextQuantity
  } = params;

  if (!previousProduct) return true;

  const previousWidthCm = toCentimeters(previousProduct.width, previousProduct.widthUnit);
  const nextWidthCm = toCentimeters(nextWidthValue, nextWidthUnit);
  const previousLengthM = toMeters(previousProduct.length, previousProduct.lengthUnit);
  const nextLengthM = toMeters(nextLengthValue, nextLengthUnit);

  if (!almostEqual(previousProduct.originalWidth, nextOriginalWidthCm)) return true;
  if (!almostEqual(previousWidthCm, nextWidthCm)) return true;
  if (!almostEqual(previousLengthM, nextLengthM)) return true;
  if (!almostEqual(previousProduct.quantity, nextQuantity)) return true;

  return false;
};

export const hasSlabGeometryChanged = (params: {
  previousProduct: {
    width: number;
    widthUnit: UnitType;
    length: number;
    lengthUnit: UnitType;
    quantity: number;
    slabStandardDimensions?: SlabStandardDimensionEntry[];
  } | null;
  nextWidthValueCm: number;
  nextLengthValueCm: number;
  nextQuantity: number;
  nextStandardDimensions: SlabStandardDimensionEntry[];
}): boolean => {
  const {
    previousProduct,
    nextWidthValueCm,
    nextLengthValueCm,
    nextQuantity,
    nextStandardDimensions
  } = params;

  if (!previousProduct) return true;

  const previousWidthCm = toCentimeters(previousProduct.width, previousProduct.widthUnit);
  const previousLengthCm = toCentimeters(previousProduct.length, previousProduct.lengthUnit);

  if (!almostEqual(previousWidthCm, nextWidthValueCm)) return true;
  if (!almostEqual(previousLengthCm, nextLengthValueCm)) return true;
  if (!almostEqual(previousProduct.quantity, nextQuantity)) return true;

  const previousStd = JSON.stringify(previousProduct.slabStandardDimensions || []);
  const nextStd = JSON.stringify(nextStandardDimensions || []);
  return previousStd !== nextStd;
};
