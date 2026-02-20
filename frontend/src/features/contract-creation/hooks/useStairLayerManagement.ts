import { useCallback } from 'react';
import type {
  ContractProduct,
  StairPartDraftV2,
  StairStepperPart,
  Product,
  StoneCut,
  RemainingStone,
  ToolSelectionV2
} from '../types/contract.types';
import {
  getActualLengthMeters,
  convertMetersToUnit,
  getPricingLengthMeters
} from '../utils/stairCalculations';

interface UseStairLayerManagementProps {
  getDraftByPart: (part: StairStepperPart) => StairPartDraftV2 | null;
}

interface UseStairLayerManagementReturn {
  syncLayerSessionItems: (items: ContractProduct[]) => ContractProduct[];
  getLayerStoneProductForDraft: (draft: StairPartDraftV2, fallback: Product | null) => Product | null;
  getLayerBasePricePerSquareMeter: (draft: StairPartDraftV2) => number;
  getLayerEffectivePricePerSquareMeter: (draft: StairPartDraftV2) => number;
  normalizeLayerAltStoneSettings: (draft: StairPartDraftV2) => StairPartDraftV2;
  getTotalLayerLengthPerStairM: (part: StairStepperPart, draft: StairPartDraftV2) => number;
  getMaxLayerLengthM: (part: StairStepperPart, draft: StairPartDraftV2) => number;
  computeLayerSqmV2: (part: StairStepperPart, draft: StairPartDraftV2) => number;
  createLayerProduct: (params: CreateLayerProductParams) => ContractProduct;
  mergeLayerProduct: (existing: ContractProduct, newData: MergeLayerProductParams) => ContractProduct;
  updateRemainingStoneUsage: (
    sessionItems: ContractProduct[],
    usedRemainingStones: RemainingStone[],
    mainStairPartIndex: number
  ) => Map<number, ContractProduct>;
}

interface CreateLayerProductParams {
  draft: StairPartDraftV2;
  stoneProduct: Product;
  stairSystemId: string;
  parentPartType: StairStepperPart;
  totalLayers: number;
  totalLayerSqm: number;
  layerMaterialPrice: number;
  layerTotalPrice: number;
  layerTypeCost: number;
  layersFromRemainingStones: number;
  layersFromNewStones: number;
  totalLayerCuttingCost: number;
  layerCutDetails: StoneCut[];
  layerRemainingPieces?: RemainingStone[];
  usedRemainingStonesForLayers: RemainingStone[];
  originalWidthCm: number;
  lengthM: number;
  layerCuttingCostPerMeter: number;
  parentProductIndexInSession: number;
  layerPricePerSquareMeter: number;
  layerStoneLabel?: string | null;
  layerUseDifferentStone?: boolean;
  layerStoneProductId?: string | null;
  layerStoneBasePricePerSquareMeter?: number | null;
  layerUseMandatory?: boolean;
  layerMandatoryPercentage?: number | null;
  stoneAreaUsedSqm?: number;
}

interface MergeLayerProductParams {
  draft: StairPartDraftV2;
  parentPartType: StairStepperPart;
  newLayersNeeded: number;
  newLayerSqm: number;
  layerMaterialPrice: number;
  layerTypeCost: number;
  totalLayerCuttingCost: number;
  layerCutDetails: StoneCut[];
  usedRemainingStonesForLayers: RemainingStone[];
  layersFromRemainingStones: number;
  layersFromNewStones: number;
  layerPricePerSquareMeter: number;
  layerStoneLabel?: string | null;
  layerUseDifferentStone?: boolean;
  layerStoneProductId?: string | null;
  layerStoneBasePricePerSquareMeter?: number | null;
  layerUseMandatory?: boolean;
  layerMandatoryPercentage?: number | null;
  stoneAreaUsedSqm?: number;
}

/**
 * Hook for managing stair layer products - creation, synchronization, and pricing
 */
export const useStairLayerManagement = ({
  getDraftByPart
}: UseStairLayerManagementProps): UseStairLayerManagementReturn => {

  // Helper function to get part display label
  const getPartDisplayLabel = (part: StairStepperPart): string => {
    const labels: Record<StairStepperPart, string> = {
      tread: 'پله',
      riser: 'کف پله',
      landing: 'سکو'
    };
    return labels[part] || part;
  };

  /**
   * Synchronize layer session items with parent stair part changes
   * Updates quantity, square meters, pricing when parent draft changes
   */
  const syncLayerSessionItems = useCallback((items: ContractProduct[]): ContractProduct[] => {
    if (!items.some(item => (item.meta as any)?.isLayer)) {
      return items;
    }

    let changed = false;
    const updated = items.map(item => {
      const isLayer = ((item.meta as any)?.isLayer) || false;
      if (!isLayer) {
        return item;
      }

      const layerInfo = (item.meta as any)?.layerInfo;
      const layerEdges = (item.meta as any)?.layerEdges;
      const parentPartType: StairStepperPart | undefined = layerInfo?.parentPartType;
      if (!layerInfo || !layerEdges || !parentPartType) {
        return item;
      }

      const parentDraft = getDraftByPart(parentPartType);
      if (!parentDraft || !parentDraft.quantity) {
        return item;
      }

      const numberOfLayersPerStair = layerInfo.numberOfLayersPerStair || 0;
      if (numberOfLayersPerStair <= 0) {
        return item;
      }

      const tempDraft: StairPartDraftV2 = {
        ...parentDraft,
        layerEdges,
        layerWidthCm: item.width,
        numberOfLayersPerStair,
        quantity: parentDraft.quantity
      };

      const newLayerSqm = computeLayerSqmV2(parentPartType, tempDraft);
      const totalLayers = (parentDraft.quantity || 0) * numberOfLayersPerStair;
      const layerTypeUnitPrice = item.layerTypePrice || 0;

      // Calculate layer type cost based on total length per stair × number of stairs × layer type price per meter
      const totalLayerLengthPerStairM = getTotalLayerLengthPerStairM(parentPartType, tempDraft);
      const totalLayerLengthM = totalLayerLengthPerStairM * (parentDraft.quantity || 0);
      const layerTypeCost = totalLayerLengthM * layerTypeUnitPrice;

      // Calculate stone area used for pricing (not layer square meters)
      const stoneWidthCm = item.originalWidth || 0;
      const stoneWidthM = stoneWidthCm / 100;
      const stoneLengthM = getActualLengthMeters(parentDraft);
      const layerWidthCm = item.width || 0;

      // Calculate stone area used
      let stoneAreaUsedSqm = 0;
      if (stoneWidthCm > 0 && layerWidthCm > 0 && stoneLengthM > 0) {
        const layersPerStoneWidth = Math.floor(stoneWidthCm / layerWidthCm);
        if (layersPerStoneWidth > 0) {
          const stonesNeeded = Math.ceil(totalLayers / layersPerStoneWidth);
          stoneAreaUsedSqm = stonesNeeded * stoneLengthM * stoneWidthM;
        }
      }

      // Use stone area used for pricing, fallback to layer square meters if calculation fails
      const pricingAreaSqm = stoneAreaUsedSqm > 0 ? stoneAreaUsedSqm : newLayerSqm;
      const materialCost = pricingAreaSqm * (item.pricePerSquareMeter || 0);
      const newTotalPrice = materialCost + layerTypeCost + (item.cuttingCost || 0);
      const newLengthMeters = getActualLengthMeters(parentDraft);
      const newLengthUnit = parentDraft.lengthUnit || 'm';
      const newLengthValue = convertMetersToUnit(newLengthMeters, newLengthUnit);

      const currentSqm = item.squareMeters || 0;
      const currentTotal = typeof item.totalPrice === 'number' ? item.totalPrice : parseFloat(String(item.totalPrice || 0));

      if (Math.abs(newLayerSqm - currentSqm) < 0.0001 &&
          Math.abs(newTotalPrice - (currentTotal || 0)) < 0.5 &&
          Math.abs((item.length || 0) - newLengthValue) < 0.0001) {
        return item;
      }

      changed = true;
      return {
        ...item,
        squareMeters: newLayerSqm,
        totalPrice: newTotalPrice,
        originalTotalPrice: materialCost,
        quantity: totalLayers,
        length: newLengthValue,
        lengthUnit: newLengthUnit,
        meta: {
          ...item.meta,
          layerInfo: {
            ...layerInfo,
            lastSyncedAt: Date.now()
          },
          stoneAreaUsedSqm: stoneAreaUsedSqm > 0 ? stoneAreaUsedSqm : undefined
        } as any
      };
    });

    return changed ? updated : items;
  }, [getDraftByPart]);

  /**
   * Get the stone product to use for layer (different stone or same as parent)
   */
  const getLayerStoneProductForDraft = useCallback((draft: StairPartDraftV2, fallback: Product | null): Product | null => {
    if (draft.layerUseDifferentStone && draft.layerStoneProduct) {
      return draft.layerStoneProduct;
    }
    return fallback;
  }, []);

  /**
   * Get base price per square meter for layer (before mandatory percentage)
   */
  const getLayerBasePricePerSquareMeter = useCallback((draft: StairPartDraftV2): number => {
    if (draft.layerUseDifferentStone) {
      return draft.layerPricePerSquareMeter || 0;
    }
    return draft.pricePerSquareMeter || 0;
  }, []);

  /**
   * Get effective price per square meter for layer (after mandatory percentage)
   */
  const getLayerEffectivePricePerSquareMeter = useCallback((draft: StairPartDraftV2): number => {
    const base = getLayerBasePricePerSquareMeter(draft);
    if (draft.layerUseDifferentStone && draft.layerUseMandatory && draft.layerMandatoryPercentage && draft.layerMandatoryPercentage > 0) {
      return base * (1 + draft.layerMandatoryPercentage / 100);
    }
    return base;
  }, [getLayerBasePricePerSquareMeter]);

  /**
   * Normalize layer alternative stone settings
   * Sets default values when using different stone for layers
   */
  const normalizeLayerAltStoneSettings = useCallback((draft: StairPartDraftV2): StairPartDraftV2 => {
    if (!draft.layerUseDifferentStone) {
      return {
        ...draft,
        layerPricePerSquareMeter: draft.layerPricePerSquareMeter ?? draft.pricePerSquareMeter ?? null,
        layerUseMandatory: undefined,
        layerMandatoryPercentage: null
      };
    }
    const normalized = { ...draft };
    if (!normalized.layerPricePerSquareMeter || normalized.layerPricePerSquareMeter <= 0) {
      normalized.layerPricePerSquareMeter = draft.layerPricePerSquareMeter || draft.pricePerSquareMeter || 0;
    }
    normalized.layerUseMandatory = normalized.layerUseMandatory ?? true;
    normalized.layerMandatoryPercentage = normalized.layerMandatoryPercentage ?? 20;
    return normalized;
  }, []);

  /**
   * Calculate total layer length per stair (sum of all selected edge lengths)
   * Used for layer type cost calculation: total length per stair × number of stairs × price per meter
   */
  const getTotalLayerLengthPerStairM = useCallback((part: StairStepperPart, draft: StairPartDraftV2): number => {
    if (!draft.layerEdges || !draft.layerWidthCm) {
      return 0;
    }

    const stairLengthM = getActualLengthMeters(draft);
    const stairWidthM = (draft.widthCm || 0) / 100;
    const layerWidthCm = draft.layerWidthCm || 0;
    const layerWidthM = layerWidthCm / 100;
    const edges = draft.layerEdges;

    let totalLengthM = 0;

    if (part === 'landing') {
      if (edges.perimeter) {
        totalLengthM = 2 * (stairLengthM + stairWidthM);
      } else {
        const hasFrontOrBack = edges.front || edges.back;
        const hasLeftOrRight = edges.left || edges.right;

        const frontBackLengthM = hasLeftOrRight ? Math.max(0, stairWidthM - layerWidthM) : stairWidthM;
        if (edges.front) totalLengthM += frontBackLengthM;
        if (edges.back) totalLengthM += frontBackLengthM;

        const leftRightLengthM = hasFrontOrBack ? Math.max(0, stairLengthM - layerWidthM) : stairLengthM;
        if (edges.left) totalLengthM += leftRightLengthM;
        if (edges.right) totalLengthM += leftRightLengthM;
      }
    } else {
      if (edges.front) {
        totalLengthM += stairLengthM;
      }

      const sideLengthM = edges.front ? Math.max(0, stairWidthM - layerWidthM) : stairWidthM;
      if (edges.left) totalLengthM += sideLengthM;
      if (edges.right) totalLengthM += sideLengthM;
    }

    return totalLengthM;
  }, []);

  /**
   * Calculate maximum layer length needed based on selected edges
   * Used for stone usage calculation to ensure we have enough stone
   */
  const getMaxLayerLengthM = useCallback((part: StairStepperPart, draft: StairPartDraftV2): number => {
    if (!draft.layerEdges || !draft.layerWidthCm) {
      return 0;
    }

    const stairLengthM = getActualLengthMeters(draft);
    const stairWidthM = (draft.widthCm || 0) / 100;
    const layerWidthCm = draft.layerWidthCm || 0;
    const layerWidthM = layerWidthCm / 100;
    const edges = draft.layerEdges;

    let maxLengthM = 0;

    if (part === 'landing') {
      if (edges.perimeter) {
        maxLengthM = Math.max(stairLengthM, stairWidthM);
      } else {
        if (edges.front || edges.back) {
          const hasLeftOrRight = edges.left || edges.right;
          const frontBackLengthM = hasLeftOrRight ? Math.max(0, stairWidthM - layerWidthM) : stairWidthM;
          maxLengthM = Math.max(maxLengthM, frontBackLengthM);
        }
        if (edges.left || edges.right) {
          const hasFrontOrBack = edges.front || edges.back;
          const leftRightLengthM = hasFrontOrBack ? Math.max(0, stairLengthM - layerWidthM) : stairLengthM;
          maxLengthM = Math.max(maxLengthM, leftRightLengthM);
        }
      }
    } else {
      if (edges.front) {
        maxLengthM = Math.max(maxLengthM, stairLengthM);
      }

      if (edges.left || edges.right) {
        const sideLengthM = edges.front ? Math.max(0, stairWidthM - layerWidthM) : stairWidthM;
        maxLengthM = Math.max(maxLengthM, sideLengthM);
      }
    }

    return maxLengthM;
  }, []);

  /**
   * Calculate layer square meters based on selected edges
   * Accounts for overlap when multiple edges are selected
   */
  const computeLayerSqmV2 = useCallback((part: StairStepperPart, draft: StairPartDraftV2): number => {
    if (!draft.layerEdges || !draft.layerWidthCm || !draft.numberOfLayersPerStair || !draft.quantity) {
      return 0;
    }

    const stairLengthM = getActualLengthMeters(draft);
    const stairWidthM = (draft.widthCm || 0) / 100;
    const layerWidthCm = draft.layerWidthCm || 0;
    const layerWidthM = layerWidthCm / 100;
    const edges = draft.layerEdges;

    let layerSqmPerStair = 0;

    if (part === 'landing') {
      if (edges.perimeter) {
        layerSqmPerStair = 2 * (stairLengthM + stairWidthM) * layerWidthM;
      } else {
        const hasFrontOrBack = edges.front || edges.back;
        const hasLeftOrRight = edges.left || edges.right;

        const frontBackLengthM = hasLeftOrRight ? Math.max(0, stairWidthM - layerWidthM) : stairWidthM;
        if (edges.front) layerSqmPerStair += frontBackLengthM * layerWidthM;
        if (edges.back) layerSqmPerStair += frontBackLengthM * layerWidthM;

        const leftRightLengthM = hasFrontOrBack ? Math.max(0, stairLengthM - layerWidthM) : stairLengthM;
        if (edges.left) layerSqmPerStair += leftRightLengthM * layerWidthM;
        if (edges.right) layerSqmPerStair += leftRightLengthM * layerWidthM;
      }
    } else {
      if (edges.front) {
        layerSqmPerStair += stairWidthM * layerWidthM;
      }

      const sideLengthM = edges.front ? Math.max(0, stairLengthM - layerWidthM) : stairLengthM;
      if (edges.left) layerSqmPerStair += sideLengthM * layerWidthM;
      if (edges.right) layerSqmPerStair += sideLengthM * layerWidthM;
    }

    const totalLayers = (draft.quantity || 0) * (draft.numberOfLayersPerStair || 0);
    const sqm = layerSqmPerStair * totalLayers;
    return Number.isFinite(sqm) ? sqm : 0;
  }, []);

  /**
   * Create a new layer product from draft and calculation results
   */
  const createLayerProduct = useCallback((params: CreateLayerProductParams): ContractProduct => {
    const {
      draft,
      stoneProduct,
      stairSystemId,
      parentPartType,
      totalLayers,
      totalLayerSqm,
      layerMaterialPrice,
      layerTotalPrice,
      layerTypeCost,
      layersFromRemainingStones,
      layersFromNewStones,
      totalLayerCuttingCost,
      layerCutDetails,
      layerRemainingPieces,
      usedRemainingStonesForLayers,
      originalWidthCm,
      lengthM,
      layerCuttingCostPerMeter,
      parentProductIndexInSession,
      layerPricePerSquareMeter,
      layerStoneLabel,
      layerUseDifferentStone,
      layerStoneProductId,
      layerStoneBasePricePerSquareMeter,
      layerUseMandatory,
      layerMandatoryPercentage,
      stoneAreaUsedSqm
    } = params;

    const layerStoneName = layerUseDifferentStone
      ? (layerStoneLabel || stoneProduct.namePersian || stoneProduct.name || '')
      : (draft.stoneLabel || stoneProduct.namePersian || stoneProduct.name || '');

    return {
      productId: layerUseDifferentStone ? (layerStoneProductId || stoneProduct.id) : (draft.stoneId || stoneProduct.id),
      product: stoneProduct,
      productType: 'stair',
      stairSystemId,
      stairPartType: parentPartType,
      stoneCode: stoneProduct.code,
      stoneName: `${layerStoneName} - لایه (${draft.numberOfLayersPerStair} لایه برای هر پله)`,
      diameterOrWidth: draft.thicknessCm ?? stoneProduct.thicknessValue ?? 0,
      length: convertMetersToUnit(getActualLengthMeters(draft), draft.lengthUnit || 'm'),
      lengthUnit: draft.lengthUnit || 'm',
      width: draft.layerWidthCm!,
      widthUnit: 'cm',
      quantity: totalLayers,
      squareMeters: totalLayerSqm,
      pricePerSquareMeter: layerPricePerSquareMeter,
      totalPrice: typeof layerTotalPrice === 'number' ? Number(layerTotalPrice.toFixed(2)) : Number(parseFloat(String(layerTotalPrice || 0)).toFixed(2)),
      description: `لایه برای ${getPartDisplayLabel(parentPartType)} - ${draft.numberOfLayersPerStair} لایه برای هر پله${layersFromRemainingStones > 0 ? ` (${layersFromRemainingStones} از باقی‌مانده، ${layersFromNewStones} از سنگ جدید)` : ''}${draft.layerTypeName ? ` | نوع لایه: ${draft.layerTypeName}` : ''}`,
      currency: 'تومان',
      isMandatory: false,
      mandatoryPercentage: 0,
      originalTotalPrice: layerMaterialPrice,
      isCut:
        layersFromRemainingStones > 0 ||
        totalLayerCuttingCost > 0 ||
        (layerCutDetails && layerCutDetails.length > 0),
      cutType: totalLayerCuttingCost > 0 ? 'longitudinal' : null,
      originalWidth: originalWidthCm,
      originalLength: lengthM,
      cuttingCost: totalLayerCuttingCost,
      cuttingCostPerMeter: layerCuttingCostPerMeter,
      cutDescription: layersFromRemainingStones > 0
        ? `استفاده از باقی‌مانده: ${layersFromRemainingStones} لایه، سنگ جدید: ${layersFromNewStones} لایه`
        : '',
      remainingStones: (() => {
        if (layerRemainingPieces && layerRemainingPieces.length) {
          return layerRemainingPieces;
        }
        const layerRemainingStones: RemainingStone[] = [];

        layerCutDetails.forEach((cutDetail, index) => {
          const cutDetailAny = cutDetail as any;
          const originalRemainingWidthCm = cutDetail.originalWidth;
          const originalRemainingLengthCm = cutDetail.length;
          const layerWidthCm = cutDetailAny._layerWidthCm || draft.layerWidthCm || 0;
          const layerLengthCm = cutDetailAny._layerLengthCm || (lengthM * 100);

          const needsWidthCut = layerWidthCm > 0 && layerWidthCm < originalRemainingWidthCm;
          const needsLengthCut = layerLengthCm > 0 && layerLengthCm < originalRemainingLengthCm;

          const correspondingUsedStone = usedRemainingStonesForLayers.find((urs, idx) => {
            const layerLengthM = layerLengthCm / 100;
            return idx === index || (Math.abs(urs.length - layerLengthM) < 0.001 && Math.abs(urs.width - layerWidthCm) < 0.01);
          });

          const quantity = correspondingUsedStone?.quantity || 1;

          const actualUsedWidthCm = cutDetailAny._actualUsedWidthCm || layerWidthCm;
          const actualUsedLengthCm = cutDetailAny._actualUsedLengthCm || layerLengthCm;
          const actualRemainingWidthCm = cutDetailAny._actualRemainingWidthCm || Math.max(0, originalRemainingWidthCm - layerWidthCm);
          const actualRemainingLengthCm = cutDetailAny._actualRemainingLengthCm || Math.max(0, originalRemainingLengthCm - layerLengthCm);

          if (needsWidthCut || needsLengthCut) {
            if (needsWidthCut && actualRemainingWidthCm > 0 && originalRemainingLengthCm > 0) {
              const remainingWidthPieceLengthM = originalRemainingLengthCm / 100;
              const remainingWidthSqm = (actualRemainingWidthCm * remainingWidthPieceLengthM * quantity) / 100;

              layerRemainingStones.push({
                id: `layer_remaining_width_${cutDetail.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                width: actualRemainingWidthCm,
                length: remainingWidthPieceLengthM,
                squareMeters: remainingWidthSqm,
                isAvailable: actualRemainingWidthCm > 0 && remainingWidthPieceLengthM > 0,
                sourceCutId: cutDetail.id,
                quantity: quantity,
                position: {
                  startWidth: actualUsedWidthCm,
                  startLength: 0
                }
              });
            }

            if (needsLengthCut && actualRemainingLengthCm > 0 && actualUsedWidthCm > 0) {
              const remainingLengthPieceWidthCm = actualUsedWidthCm;
              const remainingLengthPieceLengthM = actualRemainingLengthCm / 100;
              const remainingLengthSqm = (remainingLengthPieceWidthCm * remainingLengthPieceLengthM * quantity) / 100;

              layerRemainingStones.push({
                id: `layer_remaining_length_${cutDetail.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                width: remainingLengthPieceWidthCm,
                length: remainingLengthPieceLengthM,
                squareMeters: remainingLengthSqm,
                isAvailable: remainingLengthPieceWidthCm > 0 && remainingLengthPieceLengthM > 0,
                sourceCutId: cutDetail.id,
                quantity: quantity,
                position: {
                  startWidth: 0,
                  startLength: actualUsedLengthCm / 100
                }
              });
            }
          }
        });

        return layerRemainingStones;
      })(),
      cutDetails: layerCutDetails,
      usedRemainingStones: usedRemainingStonesForLayers,
      totalUsedRemainingWidth: usedRemainingStonesForLayers.reduce((sum, rs) => sum + (rs.width || 0), 0),
      totalUsedRemainingLength: usedRemainingStonesForLayers.reduce((sum, rs) => sum + (rs.length || 0), 0),
      appliedSubServices: [],
      totalSubServiceCost: 0,
      usedLengthForSubServices: 0,
      usedSquareMetersForSubServices: 0,
      standardLengthValue: draft.standardLengthValue ?? null,
      standardLengthUnit: draft.standardLengthUnit || draft.lengthUnit || 'm',
      layerTypeId: draft.layerTypeId ?? null,
      layerTypeName: draft.layerTypeName ?? null,
      layerTypePrice: draft.layerTypePrice ?? null,
      layerUseDifferentStone: !!layerUseDifferentStone,
      layerStoneProductId: layerUseDifferentStone ? (layerStoneProductId || stoneProduct.id) : null,
      layerStoneName: layerUseDifferentStone ? layerStoneName : null,
      layerStonePricePerSquareMeter: layerUseDifferentStone ? layerPricePerSquareMeter : null,
      layerStoneBasePricePerSquareMeter: layerUseDifferentStone ? (layerStoneBasePricePerSquareMeter ?? layerPricePerSquareMeter) : null,
      layerUseMandatory: layerUseDifferentStone ? (layerUseMandatory ?? true) : undefined,
      layerMandatoryPercentage: layerUseDifferentStone ? (layerMandatoryPercentage ?? null) : undefined,
      actualLengthMeters: getActualLengthMeters(draft) || null,
      parentProductIndex: undefined,
      meta: {
        stairStepperV2: true,
        isLayer: true,
        layerEdges: draft.layerEdges,
        layerInfo: {
          numberOfLayersPerStair: draft.numberOfLayersPerStair,
          parentPartType,
          parentQuantity: draft.quantity,
          layersFromRemainingStones,
          layersFromNewStones,
          parentProductIndexInSession
        },
        standardLength: draft.standardLengthValue ? {
          value: draft.standardLengthValue,
          unit: draft.standardLengthUnit || draft.lengthUnit || 'm',
          meters: getPricingLengthMeters(draft)
        } : undefined,
        layerType: draft.layerTypeId ? {
          id: draft.layerTypeId,
          name: draft.layerTypeName,
          pricePerLayer: draft.layerTypePrice || 0,
          totalCost: layerTypeCost
        } : undefined,
        layerAltStone: layerUseDifferentStone ? {
          id: layerStoneProductId || stoneProduct.id,
          name: layerStoneName,
          pricePerSquareMeter: layerPricePerSquareMeter,
          basePricePerSquareMeter: layerStoneBasePricePerSquareMeter ?? layerPricePerSquareMeter,
          mandatoryPercentage: layerUseMandatory ? (layerMandatoryPercentage ?? 0) : 0
        } : undefined,
        stoneAreaUsedSqm: stoneAreaUsedSqm && stoneAreaUsedSqm > 0 ? stoneAreaUsedSqm : undefined
      } as any
    };
  }, [getPartDisplayLabel]);

  /**
   * Merge an existing layer product with new layer data
   * Used when adding more layers to an existing layer product
   */
  const mergeLayerProduct = useCallback((
    existing: ContractProduct,
    newData: MergeLayerProductParams
  ): ContractProduct => {
    const {
      draft,
      parentPartType,
      newLayersNeeded,
      newLayerSqm,
      layerMaterialPrice,
      layerTypeCost,
      totalLayerCuttingCost,
      layerCutDetails,
      usedRemainingStonesForLayers,
      layersFromRemainingStones,
      layersFromNewStones,
      layerPricePerSquareMeter,
      layerStoneLabel,
      layerUseDifferentStone,
      layerStoneProductId,
      layerStoneBasePricePerSquareMeter,
      layerUseMandatory,
      layerMandatoryPercentage,
      stoneAreaUsedSqm
    } = newData;

    const existingLayerInfo = (existing.meta as any)?.layerInfo;
    const existingLayersFromRemaining = existingLayerInfo?.layersFromRemainingStones || 0;
    const existingLayersFromNew = existingLayerInfo?.layersFromNewStones || 0;

    const updatedLayersFromRemaining = existingLayersFromRemaining + layersFromRemainingStones;
    const updatedLayersFromNew = existingLayersFromNew + layersFromNewStones;
    const updatedTotalLayers = updatedLayersFromRemaining + updatedLayersFromNew;

    const existingLayerSqm = existing.squareMeters || 0;
    const updatedTotalSqm = existingLayerSqm + newLayerSqm;

    const existingStoneAreaUsed = (existing.meta as any)?.stoneAreaUsedSqm || 0;
    const updatedStoneAreaUsedSqm = stoneAreaUsedSqm && stoneAreaUsedSqm > 0
      ? (existingStoneAreaUsed + stoneAreaUsedSqm)
      : existingStoneAreaUsed;

    const existingUsedRemainingStones = existing.usedRemainingStones || [];
    const mergedUsedRemainingStones = [...existingUsedRemainingStones, ...usedRemainingStonesForLayers];

    const existingCutDetails = existing.cutDetails || [];
    const mergedCutDetails = [...existingCutDetails, ...layerCutDetails];

    const existingLayerMaterialPrice = existing.originalTotalPrice || 0;
    const updatedLayerMaterialPrice = layerMaterialPrice + existingLayerMaterialPrice;
    const updatedLayerTotalPrice = Number((updatedLayerMaterialPrice + (existing.cuttingCost || 0) + totalLayerCuttingCost).toFixed(2));

    const existingLayerTypeMeta = (existing.meta as any)?.layerType || {};
    return {
      ...existing,
      quantity: updatedTotalLayers,
      squareMeters: updatedTotalSqm,
      totalPrice: updatedLayerTotalPrice,
      originalTotalPrice: updatedLayerMaterialPrice,
      cuttingCost: (existing.cuttingCost || 0) + totalLayerCuttingCost,
      cutDetails: mergedCutDetails,
      usedRemainingStones: mergedUsedRemainingStones,
      totalUsedRemainingWidth: mergedUsedRemainingStones.reduce((sum, rs) => sum + (rs.width || 0), 0),
      totalUsedRemainingLength: mergedUsedRemainingStones.reduce((sum, rs) => sum + (rs.length || 0), 0),
      description: `لایه برای ${getPartDisplayLabel(parentPartType)} - ${draft.numberOfLayersPerStair} لایه برای هر پله (${updatedLayersFromRemaining} از باقی‌مانده، ${updatedLayersFromNew} از سنگ جدید)${draft.layerTypeName ? ` | نوع لایه: ${draft.layerTypeName}` : ''}`,
      cutDescription: mergedUsedRemainingStones.length > 0
        ? `استفاده از باقی‌مانده: ${updatedLayersFromRemaining} لایه، سنگ جدید: ${updatedLayersFromNew} لایه`
        : '',
      layerTypeId: draft.layerTypeId ?? existing.layerTypeId ?? null,
      layerTypeName: draft.layerTypeName ?? existing.layerTypeName ?? null,
      layerTypePrice: draft.layerTypePrice ?? existing.layerTypePrice ?? null,
      pricePerSquareMeter: layerUseDifferentStone ? layerPricePerSquareMeter : existing.pricePerSquareMeter,
      layerUseDifferentStone: layerUseDifferentStone ?? existing.layerUseDifferentStone ?? false,
      layerStoneProductId: layerUseDifferentStone ? (layerStoneProductId || existing.layerStoneProductId || existing.productId) : existing.layerStoneProductId || null,
      layerStoneName: layerUseDifferentStone ? (layerStoneLabel || existing.layerStoneName || existing.stoneName) : existing.layerStoneName || null,
      layerStonePricePerSquareMeter: layerUseDifferentStone ? layerPricePerSquareMeter : existing.layerStonePricePerSquareMeter || null,
      layerStoneBasePricePerSquareMeter: layerUseDifferentStone
        ? (layerStoneBasePricePerSquareMeter ?? existing.layerStoneBasePricePerSquareMeter ?? layerPricePerSquareMeter)
        : existing.layerStoneBasePricePerSquareMeter || null,
      layerUseMandatory: layerUseDifferentStone
        ? (layerUseMandatory ?? existing.layerUseMandatory ?? true)
        : existing.layerUseMandatory,
      layerMandatoryPercentage: layerUseDifferentStone
        ? (layerMandatoryPercentage ?? existing.layerMandatoryPercentage ?? null)
        : existing.layerMandatoryPercentage,
      meta: {
        ...existing.meta,
        layerEdges: draft.layerEdges,
        layerInfo: {
          ...existingLayerInfo,
          layersFromRemainingStones: updatedLayersFromRemaining,
          layersFromNewStones: updatedLayersFromNew,
          parentQuantity: (existingLayerInfo?.parentQuantity || 0) + draft.quantity
        },
        standardLength: draft.standardLengthValue
          ? {
              value: draft.standardLengthValue,
              unit: draft.standardLengthUnit || draft.lengthUnit || 'm',
              meters: getPricingLengthMeters(draft)
            }
          : (existing.meta as any)?.standardLength,
        layerType: draft.layerTypeId
          ? {
              id: draft.layerTypeId,
              name: draft.layerTypeName,
              pricePerLayer: draft.layerTypePrice || existingLayerTypeMeta.pricePerLayer || 0,
              totalCost: (existingLayerTypeMeta.totalCost || 0) + layerTypeCost
            }
          : ((existing.meta as any)?.layerType),
        layerAltStone: (layerUseDifferentStone ?? existing.layerUseDifferentStone)
          ? {
              id: layerUseDifferentStone ? (layerStoneProductId || existing.layerStoneProductId || existing.productId) : (existing.layerStoneProductId || existing.productId),
              name: layerUseDifferentStone ? (layerStoneLabel || existing.layerStoneName || existing.stoneName) : (existing.layerStoneName || existing.stoneName),
              pricePerSquareMeter: layerUseDifferentStone ? layerPricePerSquareMeter : (existing.layerStonePricePerSquareMeter || layerPricePerSquareMeter || existing.pricePerSquareMeter),
              basePricePerSquareMeter: layerUseDifferentStone
                ? (layerStoneBasePricePerSquareMeter ?? layerPricePerSquareMeter)
                : (existing.layerStoneBasePricePerSquareMeter || layerStoneBasePricePerSquareMeter || existing.pricePerSquareMeter),
              mandatoryPercentage: layerUseDifferentStone
                ? (layerUseMandatory ? (layerMandatoryPercentage ?? 0) : 0)
                : (existing.layerUseMandatory ? (existing.layerMandatoryPercentage ?? 0) : 0)
            }
          : undefined,
        stoneAreaUsedSqm: updatedStoneAreaUsedSqm > 0 ? updatedStoneAreaUsedSqm : undefined
      } as any
    };
  }, [getPartDisplayLabel]);

  /**
   * Update remaining stone usage tracking in products
   * Returns a map of product index to updated product
   */
  const updateRemainingStoneUsage = useCallback((
    sessionItems: ContractProduct[],
    usedRemainingStones: RemainingStone[],
    mainStairPartIndex: number
  ): Map<number, ContractProduct> => {
    const updates = new Map<number, ContractProduct>();

    if (usedRemainingStones.length === 0) {
      return updates;
    }

    const remainingStoneSourceMap = new Map<string, number>();
    sessionItems.forEach((item, idx) => {
      const itemIsLayer = ((item.meta as any)?.isLayer) || false;
      if (!itemIsLayer && item.remainingStones && item.remainingStones.length > 0) {
        item.remainingStones.forEach(rs => {
          remainingStoneSourceMap.set(rs.id, idx);
        });
      }
    });

    const usedBySource = new Map<number, RemainingStone[]>();
    usedRemainingStones.forEach(usedRs => {
      const sourceIdx = remainingStoneSourceMap.get(usedRs.id);
      if (sourceIdx !== undefined) {
        if (!usedBySource.has(sourceIdx)) {
          usedBySource.set(sourceIdx, []);
        }
        usedBySource.get(sourceIdx)!.push(usedRs);
      }
    });

    if (mainStairPartIndex >= 0 && mainStairPartIndex < sessionItems.length) {
      const mainProduct = sessionItems[mainStairPartIndex];
      if (mainProduct && mainProduct.productType === 'stair' && !((mainProduct.meta as any)?.isLayer)) {
        const existingUsed = mainProduct.usedRemainingStones || [];
        const mergedUsed = [...existingUsed, ...usedRemainingStones];
        updates.set(mainStairPartIndex, {
          ...mainProduct,
          usedRemainingStones: mergedUsed,
          totalUsedRemainingWidth: mergedUsed.reduce((sum, rs) => sum + (rs.width || 0), 0),
          totalUsedRemainingLength: mergedUsed.reduce((sum, rs) => sum + (rs.length || 0), 0)
        });
      }
    }

    usedBySource.forEach((usedStones, sourceIdx) => {
      if (sourceIdx >= 0 && sourceIdx < sessionItems.length) {
        const sourceProduct = sessionItems[sourceIdx];
        if (sourceProduct && sourceProduct.productType === 'stair' && !((sourceProduct.meta as any)?.isLayer)) {
          const existingUsed = sourceProduct.usedRemainingStones || [];
          const mergedUsed = [...existingUsed, ...usedStones];
          updates.set(sourceIdx, {
            ...sourceProduct,
            usedRemainingStones: mergedUsed,
            totalUsedRemainingWidth: mergedUsed.reduce((sum, rs) => sum + (rs.width || 0), 0),
            totalUsedRemainingLength: mergedUsed.reduce((sum, rs) => sum + (rs.length || 0), 0)
          });
        }
      }
    });

    return updates;
  }, []);

  return {
    syncLayerSessionItems,
    getLayerStoneProductForDraft,
    getLayerBasePricePerSquareMeter,
    getLayerEffectivePricePerSquareMeter,
    normalizeLayerAltStoneSettings,
    getTotalLayerLengthPerStairM,
    getMaxLayerLengthM,
    computeLayerSqmV2,
    createLayerProduct,
    mergeLayerProduct,
    updateRemainingStoneUsage
  };
};
