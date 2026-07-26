// Stair calculation service
// Handles all stair system V2 calculations

import type {
  StairStepperPart,
  StairPartDraftV2,
  ToolSelectionV2,
  Product,
  ContractProduct,
  RemainingStone,
  StoneCut,
  LayerEdgeDemand,
  LayerTypeOption
} from '../types/contract.types';
import {
  toMeters,
  convertMetersToUnit
} from '../utils/dimensionUtils';
import {
  getDraftStandardLengthMeters,
  getActualLengthMeters,
  getPricingLengthMeters,
  getPartDisplayLabel
} from '../utils/stairUtils';
import { formatDisplayNumber } from '../utils/formatUtils';
import {
  calculateDefaultFinishingQuantity,
  calculateFinishingCost as calculateUnitFinishingCost
} from '../utils/finishingUtils';
import {
  calculateStairLayerConfiguration,
  calculateStairPart,
  parseCanonicalDecimal,
  parseStableIdentity,
  type PaidRemainderStock,
  type StairLayerCalculation,
  type StairLayerCatalogUnit,
  type StairLayerConflict,
  type StairLayerConfigurationInput,
  type StairLayerParentGeometry,
  type StairPartCalculation,
  type StairPartPolicyInput
} from '@sabalanerp/contract-product-graph';

const toCanonicalDecimal = (value: number) =>
  parseCanonicalDecimal(String(value));

export const toCanonicalLayerInventory = ({
  stones,
  ownerProductRowId,
  catalogProductId
}: {
  stones: readonly RemainingStone[];
  ownerProductRowId: string;
  catalogProductId: string;
}): PaidRemainderStock[] => stones
  .filter(stone =>
    stone.isAvailable !== false &&
    Number(stone.length) > 0 &&
    Number(stone.width) > 0 &&
    Number(stone.quantity || 1) > 0
  )
  .map((stone, index) => ({
    remainingStoneId: parseStableIdentity('remaining-stone', stone.id),
    ownerProductRowId: parseStableIdentity('product-row', ownerProductRowId),
    catalogProductId,
    sourceBatchId: parseStableIdentity(
      'source-batch',
      stone.sourceCutId || `layer-source:${ownerProductRowId}:${stone.id}`
    ),
    lengthMeters: toCanonicalDecimal(Number(stone.length)),
    widthMeters: toCanonicalDecimal(Number(stone.width) / 100),
    quantity: Math.max(1, Math.trunc(Number(stone.quantity || 1))),
    creationOrder: index,
    materialPaid: true
  }));

const selectedLayerSides = (
  draft: StairPartDraftV2
): Array<'front' | 'back' | 'left' | 'right'> => (
  ['front', 'back', 'left', 'right'] as const
).filter(side => draft.layerEdges?.perimeter || draft.layerEdges?.[side]);

/**
 * Canonical layer preview/save calculation used by the live stair workflow.
 * New material receives a bounded candidate quantity; the optimizer still
 * consumes only its deterministic minimum and charges only consumed sources.
 */
export interface CanonicalLayerCalculationRequest {
  input: StairLayerConfigurationInput;
  parent: StairLayerParentGeometry;
  availableInventory: readonly PaidRemainderStock[];
}

export const createCanonicalLayerCalculationRequest = ({
  part,
  draft,
  parentProductRowId,
  creationOrder,
  availableInventory,
  parentRemainingStoneIds,
  layerUnit,
  getCuttingTypePricePerMeter
}: {
  part: StairStepperPart;
  draft: StairPartDraftV2;
  parentProductRowId: string;
  creationOrder: number;
  availableInventory: readonly PaidRemainderStock[];
  parentRemainingStoneIds: readonly string[];
  layerUnit: StairLayerCatalogUnit;
  getCuttingTypePricePerMeter: (code: string) => number | null;
}): CanonicalLayerCalculationRequest => {
  const layerConfigurationId = parseStableIdentity(
    'layer-configuration',
    draft.layerConfigurationDraftId ||
      `layer:${parentProductRowId}:${creationOrder}`
  );
  const stableParentRowId = parseStableIdentity(
    'product-row',
    parentProductRowId
  );
  const sides = selectedLayerSides(draft);
  const parentQuantity = Math.max(0, Math.trunc(Number(draft.quantity || 0)));
  const layersPerPiece = Math.max(
    0,
    Math.trunc(Number(draft.numberOfLayersPerStair || 0))
  );
  const usesParentMaterial = draft.layerSourceKind === 'parentMaterial';
  const sourceStone = usesParentMaterial
    ? draft.stoneProduct
    : draft.layerStoneProduct;
  const baseMaterialRate = Number(
    usesParentMaterial
      ? draft.pricePerSquareMeter
      : draft.layerPricePerSquareMeter
  ) || 0;
  const usesMandatory = usesParentMaterial
    ? draft.useMandatory
    : draft.layerUseMandatory;
  const mandatoryPercentage = usesParentMaterial
    ? draft.mandatoryPercentage
    : draft.layerMandatoryPercentage;
  const effectiveMaterialRate = usesMandatory
    ? baseMaterialRate * (1 + Number(mandatoryPercentage || 0) / 100)
    : baseMaterialRate;
  const sourceLengthMeters = usesParentMaterial
    ? getDraftStandardLengthMeters(draft)
    : Number(sourceStone?.motherLengthValue || 0);
  const sourceWidthMeters = Number(sourceStone?.widthValue || 0) / 100;
  const sourceBatchId = parseStableIdentity(
    'source-batch',
    `layer-source:${layerConfigurationId}`
  );
  const longitudinalRate =
    draft.cutRateSnapshots?.longitudinal ??
    getCuttingTypePricePerMeter('LONG');
  const crossRate =
    draft.cutRateSnapshots?.cross ??
    getCuttingTypePricePerMeter('CROSS');
  const calibrationRate =
    draft.cutRateSnapshots?.calibration ??
    draft.cutRateSnapshots?.longitudinal ??
    getCuttingTypePricePerMeter('LONG');
  const parentLengthMeters = getActualLengthMeters(draft);
  const parentCrossDimensionMeters = Number(draft.widthCm || 0) / 100;
  const stripWidthMeters = Number(draft.layerWidthCm || 0) / 100;
  const kerfMeters = draft.sawKerfEnabled
    ? Number(draft.sawKerfCm || 0.3) / 100
    : 0;
  const sideLength = (side: 'front' | 'back' | 'left' | 'right') =>
    side === 'front' || side === 'back'
      ? parentLengthMeters
      : parentCrossDimensionMeters;
  const stripQuantity = parentQuantity * layersPerPiece;
  const sourceQuantityUpperBound = Math.max(
    1,
    sides.reduce((sum, side) => {
      const columns = Math.max(
        0,
        Math.floor(
          (sourceWidthMeters + kerfMeters) /
          (stripWidthMeters + kerfMeters)
        )
      );
      const rows = Math.max(
        0,
        Math.floor(
          (sourceLengthMeters + kerfMeters) /
          (sideLength(side) + kerfMeters)
        )
      );
      const capacity = columns * rows;
      return sum + (
        capacity > 0
          ? Math.ceil(stripQuantity / capacity)
          : stripQuantity
      );
    }, 0)
  );
  const sideOperations = sides
    .filter(side => Boolean(draft.layerSideOperations?.[side]))
    .map(side => {
      const stored = draft.layerSideOperations?.[side]!;
      const isDetached =
        draft.layerDetachedOperationSides?.includes(side) || false;
      const hasSubset = stored.groups.some(group =>
        Number(group.scope) < stripQuantity
      );
      return {
        side,
        operationCollectionId: parseStableIdentity(
          'layer-operation-collection',
          isDetached
            ? `${layerConfigurationId}:operation:${side}`
            : `${layerConfigurationId}:operation:all`
        ),
        scopeIntent: isDetached
          ? (hasSubset ? 'side-subset' as const : 'side' as const)
          : 'all-strips' as const,
        operations: {
          ...stored,
          productRowId: stableParentRowId,
          lengthMeters: toCanonicalDecimal(sideLength(side)),
          widthMeters: toCanonicalDecimal(stripWidthMeters),
          quantity: stripQuantity
        }
      };
    });
  const selectedPaidIds = draft.layerSourceKind === 'contractRemainder'
    ? (draft.layerSelectedRemainingStoneIds || [])
    : parentRemainingStoneIds;
  const freshMaterialSource = {
    catalogProductId: usesParentMaterial
      ? draft.stoneId || sourceStone?.id || ''
      : draft.layerStoneProductId || sourceStone?.id || '',
    catalogSnapshotVersion: 'inventory-product-v1',
    materialRateToman: toCanonicalDecimal(effectiveMaterialRate),
    sourceRows: [{
      sourceRowId: parseStableIdentity(
        'layer-source-row',
        `layer-source-row:${layerConfigurationId}`
      ),
      lengthMeters: toCanonicalDecimal(sourceLengthMeters),
      widthMeters: toCanonicalDecimal(sourceWidthMeters),
      quantity: sourceQuantityUpperBound
    }]
  };

  return {
    parent: {
      lengthMeters: toCanonicalDecimal(parentLengthMeters),
      crossDimensionMeters: toCanonicalDecimal(parentCrossDimensionMeters),
      quantity: parentQuantity
    },
    availableInventory,
    input: {
      calculationPolicyVersion: 'stair-layer-calculation-v1',
      packingPolicyVersion: 'rectangle-pack-v1',
      pricingPolicyVersion: 'contract-pricing-v1',
      roundingPolicyVersion: 'nearest-toman-v1',
      layerConfigurationId,
      parentProductRowId: stableParentRowId,
      sourceBatchId,
      creationOrder,
      layerCatalogItemId: draft.layerTypeId || '',
      layerCatalogSnapshotVersion: 'inventory-layer-type-v1',
      layerTitle: draft.layerTypeName || 'لایه',
      layerUnit,
      layerRateToman: toCanonicalDecimal(Number(draft.layerTypePrice || 0)),
      layersPerParentPiece: layersPerPiece,
      widthMeters: toCanonicalDecimal(stripWidthMeters),
      widthDisplayUnit: 'cm',
      targetSides: sides,
      source: draft.layerSourceKind === 'newMaterial'
        ? {
            kind: 'new-material',
            ...freshMaterialSource
          }
        : draft.layerSourceKind === 'parentMaterial'
          ? {
              kind: 'parent-material',
              selectedRemainingStoneIds: selectedPaidIds.map(id =>
                parseStableIdentity('remaining-stone', id)
              ),
              ...freshMaterialSource
            }
          : {
              kind: 'paid-remainder',
              selectedRemainingStoneIds: selectedPaidIds.map(id =>
                parseStableIdentity('remaining-stone', id)
              )
            },
      kerfMeters: toCanonicalDecimal(kerfMeters),
      calibrationEnabled: Boolean(draft.calibrationCutEnabled),
      ...(longitudinalRate == null
        ? {}
        : { longitudinalCutRateToman: toCanonicalDecimal(longitudinalRate) }),
      ...(crossRate == null
        ? {}
        : { crossCutRateToman: toCanonicalDecimal(crossRate) }),
      ...(calibrationRate == null
        ? {}
        : { calibrationCutRateToman: toCanonicalDecimal(calibrationRate) }),
      sideOperations,
      ...(draft.layerDescription
        ? { description: draft.layerDescription }
        : {})
    }
  };
};

export const calculateCanonicalLayerDraft = (
  params: Parameters<typeof createCanonicalLayerCalculationRequest>[0]
): StairLayerCalculation => calculateStairLayerConfiguration(
  createCanonicalLayerCalculationRequest(params)
);

export const formatCanonicalLayerConflict = (
  conflict: StairLayerConflict | undefined
): string => {
  if (!conflict) return 'محاسبات لایه نیاز به اصلاح دارد';
  if (
    conflict.code === 'explicit-layer-source-required' ||
    conflict.code === 'layer-source-missing'
  ) {
    return 'منبع سنگ لایه را انتخاب کنید';
  }
  if (conflict.code === 'layer-source-insufficient') {
    return 'منبع انتخاب‌شده برای لایه کافی نیست';
  }
  if (conflict.code === 'layer-rate-required') {
    return conflict.field.includes('material')
      ? 'قیمت سنگ را وارد کنید'
      : 'نرخ قرارداد لایه را وارد کنید';
  }
  if (conflict.code === 'layer-cut-rate-missing') {
    return conflict.field.includes('cross')
      ? 'نرخ برش عرضی در موجودی ثبت نشده است'
      : 'نرخ برش طولی در موجودی ثبت نشده است';
  }
  if (conflict.code === 'layer-operation-invalid') {
    return 'عملیات لایه نیاز به اصلاح دارد';
  }
  return 'محاسبات لایه نیاز به اصلاح دارد';
};

export const createCanonicalStairDraftInput = (
  part: StairStepperPart,
  draft: StairPartDraftV2,
  getCuttingTypePricePerMeter: (code: string) => number | null
): StairPartPolicyInput => {
  const actualLengthMeters = getActualLengthMeters(draft);
  const motherLengthMeters = getDraftStandardLengthMeters(draft);
  const motherWidthMeters = Number(draft.stoneProduct?.widthValue || 0) / 100;
  const crossDimensionMeters = Number(draft.widthCm || 0) / 100;
  const longitudinalRate =
    draft.cutRateSnapshots?.longitudinal ??
    getCuttingTypePricePerMeter('LONG');
  const crossRate =
    draft.cutRateSnapshots?.cross ??
    getCuttingTypePricePerMeter('CROSS');
  const calibrationRate =
    draft.cutRateSnapshots?.calibration ??
    draft.cutRateSnapshots?.longitudinal ??
    getCuttingTypePricePerMeter('LONG');
  const rowSeed = `${draft.stoneProduct?.id || 'unselected'}:${part}`;

  return {
    calculationPolicyVersion: 'stair-calculation-v1',
    packingPolicyVersion: 'rectangle-pack-v1',
    pricingPolicyVersion: 'contract-pricing-v1',
    roundingPolicyVersion: 'nearest-toman-v1',
    stairSystemId: parseStableIdentity('stair-system', `draft:${rowSeed}`),
    part,
    sourceBatchId: parseStableIdentity('source-batch', `catalog:${rowSeed}`),
    ...(motherLengthMeters > 0
      ? { motherLengthMeters: toCanonicalDecimal(motherLengthMeters) }
      : {}),
    motherLengthDisplayUnit:
      draft.standardLengthUnit || draft.lengthUnit || 'm',
    ...(motherWidthMeters > 0
      ? { motherWidthMeters: toCanonicalDecimal(motherWidthMeters) }
      : {}),
    ...(actualLengthMeters > 0
      ? { lengthMeters: toCanonicalDecimal(actualLengthMeters) }
      : {}),
    ...(crossDimensionMeters > 0
      ? { crossDimensionMeters: toCanonicalDecimal(crossDimensionMeters) }
      : {}),
    lengthDisplayUnit: draft.lengthUnit || 'm',
    crossDimensionDisplayUnit: draft.widthUnit || 'cm',
    ...(Number.isSafeInteger(draft.quantity) && Number(draft.quantity) > 0
      ? { quantity: Number(draft.quantity) }
      : {}),
    ...(Number(draft.pricePerSquareMeter) > 0
      ? { baseRateToman: toCanonicalDecimal(Number(draft.pricePerSquareMeter)) }
      : {}),
    mandatoryEnabled: Boolean(draft.useMandatory),
    mandatoryPercentage: toCanonicalDecimal(Number(draft.mandatoryPercentage || 0)),
    rememberedMandatoryPercentage: toCanonicalDecimal(Number(draft.mandatoryPercentage || 25)),
    sawKerfEnabled: Boolean(draft.sawKerfEnabled),
    sawKerfMeters: toCanonicalDecimal(Number(draft.sawKerfCm || 0.3) / 100),
    calibrationEnabled: Boolean(draft.calibrationCutEnabled),
    calibrationSelection: draft.calibrationSelection || 'automatic',
    ...(longitudinalRate == null
      ? {}
      : { longitudinalCutRateToman: toCanonicalDecimal(longitudinalRate) }),
    ...(crossRate == null
      ? {}
      : { crossCutRateToman: toCanonicalDecimal(crossRate) }),
    ...(calibrationRate == null
      ? {}
      : { calibrationCutRateToman: toCanonicalDecimal(calibrationRate) })
  };
};

export const calculateCanonicalStairDraft = (
  part: StairStepperPart,
  draft: StairPartDraftV2,
  getCuttingTypePricePerMeter: (code: string) => number | null
): StairPartCalculation => calculateStairPart(
  createCanonicalStairDraftInput(part, draft, getCuttingTypePricePerMeter)
);

const getRemainingStoneUsageKeys = (stone: RemainingStone): string[] => {
  const keys = [stone.id, stone.sourceCutId].filter(Boolean);
  const layerSourceMatch = stone.id.match(/^used_layer_(.*)_\d+$/);
  if (layerSourceMatch?.[1]) {
    keys.push(layerSourceMatch[1]);
  }
  return keys;
};

/**
 * Calculate stair stone usage (pieces per stone, leftover width, etc.)
 */
export const calculateStairStoneUsage = (draft: StairPartDraftV2) => {
  const originalWidthCm = draft.stoneProduct?.widthValue || 0;
  const userWidthCm = draft.widthCm || 0;
  const quantity = draft.quantity || 0;

  let piecesPerStone = 1;
  let leftoverWidthCm = 0;
  let remainingStoneQuantity = 0;

  if (originalWidthCm > 0 && userWidthCm > 0) {
    piecesPerStone = Math.max(1, Math.floor(originalWidthCm / userWidthCm));
  }

  const baseStoneQuantity = piecesPerStone > 0 ? Math.ceil(quantity / piecesPerStone) : quantity;
  const remainingStoneGroups: Array<{ widthCm: number; quantity: number }> = [];
  const addRemainingStoneGroup = (widthCm: number, groupQuantity: number) => {
    if (widthCm <= 0 || groupQuantity <= 0) return;
    const existing = remainingStoneGroups.find(group => Math.abs(group.widthCm - widthCm) < 0.000001);
    if (existing) {
      existing.quantity += groupQuantity;
    } else {
      remainingStoneGroups.push({ widthCm, quantity: groupQuantity });
    }
  };

  if (originalWidthCm > 0 && userWidthCm > 0 && quantity > 0 && baseStoneQuantity > 0) {
    const fullSourceStoneCount = Math.floor(quantity / piecesPerStone);
    const remainingRequestedPieces = quantity % piecesPerStone;
    const leftoverFromFullSourceWidth = Math.max(0, originalWidthCm - piecesPerStone * userWidthCm);
    const leftoverFromPartialSourceWidth = remainingRequestedPieces > 0
      ? Math.max(0, originalWidthCm - remainingRequestedPieces * userWidthCm)
      : 0;

    addRemainingStoneGroup(leftoverFromFullSourceWidth, fullSourceStoneCount);
    addRemainingStoneGroup(leftoverFromPartialSourceWidth, remainingRequestedPieces > 0 ? 1 : 0);
  }

  if (remainingStoneGroups.length > 0) {
    leftoverWidthCm = remainingStoneGroups[0].widthCm;
    remainingStoneQuantity = remainingStoneGroups.reduce((sum, group) => sum + group.quantity, 0);
  }

  return {
    originalWidthCm,
    userWidthCm,
    quantity,
    piecesPerStone,
    leftoverWidthCm,
    remainingStoneQuantity,
    remainingStoneGroups,
    baseStoneQuantity
  };
};

/**
 * Calculate square meters for a draft
 */
export const computeSqmV2 = (draft: StairPartDraftV2): number => {
  const lengthM = getActualLengthMeters(draft);
  const widthM = (draft.widthCm || 0) / 100;
  const qty = draft.quantity || 0;
  const sqm = lengthM * widthM * qty;
  return Number.isFinite(sqm) ? sqm : 0;
};

/**
 * Calculate tool meters for a specific tool
 */
export const computeToolMetersForTool = (
  _part: StairStepperPart,
  draft: StairPartDraftV2,
  tool: ToolSelectionV2
): number => {
  const lengthM = getActualLengthMeters(draft);
  const widthM = (draft.widthCm || 0) / 100;
  const qty = draft.quantity || 0;
  const coveredQuantity = tool.coveredQuantity ?? qty;
  if (tool.manualValue !== null && tool.manualValue !== undefined) {
    return Math.max(0, tool.manualValue);
  }
  if (tool.calculationBase === 'squareMeters') {
    return lengthM * widthM * coveredQuantity;
  }
  let meters = 0;
  const t = tool;

  if (t.perimeter) {
    meters += 2 * (lengthM + widthM);
  } else {
    if (t.front) meters += lengthM;
    if (t.back) meters += lengthM;
    if (t.left) meters += widthM;
    if (t.right) meters += widthM;
  }
  
  return meters * coveredQuantity;
};

/**
 * Calculate total tool meters for all tools
 */
export const computeToolsMetersV2 = (part: StairStepperPart, draft: StairPartDraftV2): number => {
  if (!draft.tools || draft.tools.length === 0) return 0;
  return draft.tools.reduce((sum, tool) => sum + computeToolMetersForTool(part, draft, tool), 0);
};

/**
 * Calculate total layer length per stair (sum of all selected edge lengths)
 */
export const getTotalLayerLengthPerStairM = (_part: StairStepperPart, draft: StairPartDraftV2): number => {
  if (!draft.layerEdges || !draft.layerWidthCm) {
    return 0;
  }
  
  const stairLengthM = getActualLengthMeters(draft);
  const stairWidthM = (draft.widthCm || 0) / 100;
  const layerWidthCm = draft.layerWidthCm || 0;
  const layerWidthM = layerWidthCm / 100;
  const edges = draft.layerEdges;
  
  let totalLengthM = 0;
  
  if (edges.perimeter) {
    totalLengthM = 2 * (stairLengthM + stairWidthM);
  } else {
    const hasFrontOrBack = edges.front || edges.back;
    const hasLeftOrRight = edges.left || edges.right;
    const frontBackLengthM = hasLeftOrRight ? Math.max(0, stairLengthM - layerWidthM) : stairLengthM;
    const leftRightLengthM = hasFrontOrBack ? Math.max(0, stairWidthM - layerWidthM) : stairWidthM;

    if (edges.front) totalLengthM += frontBackLengthM;
    if (edges.back) totalLengthM += frontBackLengthM;
    if (edges.left) totalLengthM += leftRightLengthM;
    if (edges.right) totalLengthM += leftRightLengthM;
  }
  
  return totalLengthM;
};

/**
 * Calculate maximum layer length needed based on selected edges
 */
export const getMaxLayerLengthM = (_part: StairStepperPart, draft: StairPartDraftV2): number => {
  if (!draft.layerEdges || !draft.layerWidthCm) {
    return 0;
  }
  
  const stairLengthM = getActualLengthMeters(draft);
  const stairWidthM = (draft.widthCm || 0) / 100;
  const layerWidthCm = draft.layerWidthCm || 0;
  const layerWidthM = layerWidthCm / 100;
  const edges = draft.layerEdges;
  
  let maxLengthM = 0;
  
  if (edges.perimeter) {
    maxLengthM = Math.max(stairLengthM, stairWidthM);
  } else {
    if (edges.front || edges.back) {
      const hasLeftOrRight = edges.left || edges.right;
      const frontBackLengthM = hasLeftOrRight ? Math.max(0, stairLengthM - layerWidthM) : stairLengthM;
      maxLengthM = Math.max(maxLengthM, frontBackLengthM);
    }
    if (edges.left || edges.right) {
      const hasFrontOrBack = edges.front || edges.back;
      const leftRightLengthM = hasFrontOrBack ? Math.max(0, stairWidthM - layerWidthM) : stairWidthM;
      maxLengthM = Math.max(maxLengthM, leftRightLengthM);
    }
  }
  
  return maxLengthM;
};

/**
 * Calculate layer square meters based on selected edges
 */
export const computeLayerSqmV2 = (_part: StairStepperPart, draft: StairPartDraftV2): number => {
  if (!draft.layerEdges || !draft.layerWidthCm || !draft.numberOfLayersPerStair || !draft.quantity) {
    return 0;
  }
  
  const stairLengthM = getActualLengthMeters(draft);
  const stairWidthM = (draft.widthCm || 0) / 100;
  const layerWidthCm = draft.layerWidthCm || 0;
  const layerWidthM = layerWidthCm / 100;
  const edges = draft.layerEdges;
  
  let layerSqmPerStair = 0;
  
  if (edges.perimeter) {
    layerSqmPerStair = 2 * (stairLengthM + stairWidthM) * layerWidthM;
  } else {
    const hasFrontOrBack = edges.front || edges.back;
    const hasLeftOrRight = edges.left || edges.right;
    const frontBackLengthM = hasLeftOrRight ? Math.max(0, stairLengthM - layerWidthM) : stairLengthM;
    const leftRightLengthM = hasFrontOrBack ? Math.max(0, stairWidthM - layerWidthM) : stairWidthM;

    if (edges.front) layerSqmPerStair += frontBackLengthM * layerWidthM;
    if (edges.back) layerSqmPerStair += frontBackLengthM * layerWidthM;
    if (edges.left) layerSqmPerStair += leftRightLengthM * layerWidthM;
    if (edges.right) layerSqmPerStair += leftRightLengthM * layerWidthM;
  }
  
  return layerSqmPerStair * draft.numberOfLayersPerStair * draft.quantity;
};

/**
 * Get layer edge demands (what edges need layers and how many)
 */
export const getLayerEdgeDemands = (_part: StairStepperPart, draft: StairPartDraftV2): LayerEdgeDemand[] => {
  if (!draft.layerEdges || !draft.numberOfLayersPerStair || !draft.quantity || !draft.layerWidthCm) {
    return [];
  }

  const stairLengthM = getActualLengthMeters(draft);
  const stairWidthM = (draft.widthCm || 0) / 100;
  const layerWidthM = (draft.layerWidthCm || 0) / 100;
  if (stairLengthM <= 0 || stairWidthM <= 0 || layerWidthM <= 0) {
    return [];
  }

  const edges = draft.layerEdges;
  const baseLayersPerEdge = draft.quantity * draft.numberOfLayersPerStair;
  const demands: LayerEdgeDemand[] = [];

  if (edges.perimeter) {
    const perimeterLength = 2 * (stairLengthM + stairWidthM);
    if (perimeterLength > 0) {
      demands.push({
        edge: 'perimeter',
        layersNeeded: baseLayersPerEdge,
        lengthM: perimeterLength
      });
    }
    return demands;
  }

  const hasFrontOrBack = edges.front || edges.back;
  const hasLeftOrRight = edges.left || edges.right;
  const frontBackLength = hasLeftOrRight ? Math.max(0, stairLengthM - layerWidthM) : stairLengthM;
  const leftRightLength = hasFrontOrBack ? Math.max(0, stairWidthM - layerWidthM) : stairWidthM;

  if (edges.front && frontBackLength > 0) {
    demands.push({ edge: 'front', layersNeeded: baseLayersPerEdge, lengthM: frontBackLength });
  }
  if (edges.back && frontBackLength > 0) {
    demands.push({ edge: 'back', layersNeeded: baseLayersPerEdge, lengthM: frontBackLength });
  }
  if (edges.left && leftRightLength > 0) {
    demands.push({ edge: 'left', layersNeeded: baseLayersPerEdge, lengthM: leftRightLength });
  }
  if (edges.right && leftRightLength > 0) {
    demands.push({ edge: 'right', layersNeeded: baseLayersPerEdge, lengthM: leftRightLength });
  }

  return demands;
};

export interface LayerSourcePlan {
  sourceWidthCm: number;
  sourceLengthM: number;
  sourceStoneQuantity: number;
  sourceAreaSqm: number;
  columnsPerStone: number;
  physicalPieceQuantity: number;
  longitudinalCuttingMeters: number;
  crossCuttingMeters: number;
  remainingStones: RemainingStone[];
  allocations: Array<{
    edge: LayerEdgeDemand['edge'];
    lengthM: number;
    quantity: number;
    sourceStoneIndex: number;
  }>;
}

/**
 * Packs only the layer shortage that must come from newly charged source stone.
 * Already-paid parent/remainder allocations are handled before this function.
 */
export const calculateLayerSourcePlan = ({
  demands,
  sourceWidthCm,
  sourceLengthM,
  layerWidthCm,
  sawKerfEnabled = false,
  sawKerfCm = 0.3
}: {
  demands: Array<{ edge: LayerEdgeDemand['edge']; lengthM: number; quantity: number }>;
  sourceWidthCm: number;
  sourceLengthM: number;
  layerWidthCm: number;
  sawKerfEnabled?: boolean;
  sawKerfCm?: number;
}): LayerSourcePlan => {
  const safeKerfCm = sawKerfEnabled ? Math.max(0, sawKerfCm) : 0;
  const effectiveStripWidthCm = layerWidthCm + safeKerfCm;
  const columnsPerStone = sourceWidthCm > 0 && effectiveStripWidthCm > 0
    ? Math.floor(sourceWidthCm / effectiveStripWidthCm)
    : 0;
  const emptyPlan: LayerSourcePlan = {
    sourceWidthCm,
    sourceLengthM,
    sourceStoneQuantity: 0,
    sourceAreaSqm: 0,
    columnsPerStone,
    physicalPieceQuantity: 0,
    longitudinalCuttingMeters: 0,
    crossCuttingMeters: 0,
    remainingStones: [],
    allocations: []
  };

  if (columnsPerStone <= 0 || sourceLengthM <= 0 || layerWidthCm <= 0) {
    return emptyPlan;
  }

  type Column = { remainingLengthM: number; used: boolean };
  type SourceStone = { columns: Column[] };
  const stones: SourceStone[] = [];
  const placements: Array<{
    edge: LayerEdgeDemand['edge'];
    lengthM: number;
    sourceStoneIndex: number;
    columnIndex: number;
    crossCutRequired: boolean;
  }> = [];

  const addStone = (): number => {
    stones.push({
      columns: Array.from({ length: columnsPerStone }, () => ({
        remainingLengthM: sourceLengthM,
        used: false
      }))
    });
    return stones.length - 1;
  };

  demands
    .filter((demand) => demand.quantity > 0 && demand.lengthM > 0)
    .sort((left, right) => right.lengthM - left.lengthM || left.edge.localeCompare(right.edge))
    .forEach((demand) => {
      for (let pieceIndex = 0; pieceIndex < demand.quantity; pieceIndex++) {
        let targetStoneIndex = -1;
        let targetColumnIndex = -1;
        let crossCutRequired = false;

        for (let stoneIndex = 0; stoneIndex < stones.length && targetStoneIndex < 0; stoneIndex++) {
          const columnIndex = stones[stoneIndex].columns.findIndex(
            (column) => {
              const needsCrossCut = demand.lengthM + 1e-6 < column.remainingLengthM;
              const requiredLengthM = demand.lengthM + (needsCrossCut ? safeKerfCm / 100 : 0);
              return column.remainingLengthM + 1e-6 >= requiredLengthM;
            }
          );
          if (columnIndex >= 0) {
            targetStoneIndex = stoneIndex;
            targetColumnIndex = columnIndex;
          }
        }

        if (targetStoneIndex < 0) {
          if (demand.lengthM > sourceLengthM + 1e-6) {
            continue;
          }
          targetStoneIndex = addStone();
          targetColumnIndex = 0;
        }

        const column = stones[targetStoneIndex].columns[targetColumnIndex];
        crossCutRequired = demand.lengthM + 1e-6 < column.remainingLengthM;
        const consumedLengthM = demand.lengthM + (crossCutRequired ? safeKerfCm / 100 : 0);
        column.used = true;
        column.remainingLengthM = Math.max(0, column.remainingLengthM - consumedLengthM);
        placements.push({
          edge: demand.edge,
          lengthM: demand.lengthM,
          sourceStoneIndex: targetStoneIndex,
          columnIndex: targetColumnIndex,
          crossCutRequired
        });
      }
    });

  const allocations = placements.reduce<LayerSourcePlan['allocations']>((result, placement) => {
    const existing = result.find((entry) =>
      entry.edge === placement.edge &&
      entry.sourceStoneIndex === placement.sourceStoneIndex &&
      Math.abs(entry.lengthM - placement.lengthM) < 0.000001
    );
    if (existing) {
      existing.quantity += 1;
    } else {
      result.push({
        edge: placement.edge,
        lengthM: placement.lengthM,
        quantity: 1,
        sourceStoneIndex: placement.sourceStoneIndex
      });
    }
    return result;
  }, []);

  const remainingStones: RemainingStone[] = [];
  stones.forEach((stone, stoneIndex) => {
    const usedColumns = stone.columns.filter((column) => column.used);
    usedColumns.forEach((column, columnIndex) => {
      if (column.remainingLengthM > 1e-6) {
        remainingStones.push({
          id: `layer_new_length_${stoneIndex}_${columnIndex}`,
          width: layerWidthCm,
          length: column.remainingLengthM,
          squareMeters: (layerWidthCm / 100) * column.remainingLengthM,
          isAvailable: true,
          sourceCutId: `layer_new_source_${stoneIndex}`,
          quantity: 1
        });
      }
    });

    const residualWidthCm = Math.max(
      0,
      sourceWidthCm - usedColumns.length * effectiveStripWidthCm
    );
    if (residualWidthCm > 1e-6) {
      remainingStones.push({
        id: `layer_new_width_${stoneIndex}`,
        width: residualWidthCm,
        length: sourceLengthM,
        squareMeters: (residualWidthCm / 100) * sourceLengthM,
        isAvailable: true,
        sourceCutId: `layer_new_source_${stoneIndex}`,
        quantity: 1
      });
    }
  });

  const usedColumnCount = stones.reduce(
    (sum, stone) => sum + stone.columns.filter((column) => column.used).length,
    0
  );
  const crossCutCount = placements.filter((placement) => placement.crossCutRequired).length;

  return {
    sourceWidthCm,
    sourceLengthM,
    sourceStoneQuantity: stones.length,
    sourceAreaSqm: stones.length * (sourceWidthCm / 100) * sourceLengthM,
    columnsPerStone,
    physicalPieceQuantity: placements.length,
    longitudinalCuttingMeters: usedColumnCount * sourceLengthM,
    crossCuttingMeters: crossCutCount * (layerWidthCm / 100),
    remainingStones,
    allocations
  };
};

/**
 * Get layer stone product for draft (alternate stone or main stone)
 */
export const getLayerStoneProductForDraft = (draft: StairPartDraftV2, fallback: Product | null): Product | null => {
  if (draft.layerUseDifferentStone && draft.layerStoneProduct) {
    return draft.layerStoneProduct;
  }
  return fallback;
};

/**
 * Get base price per square meter for layers
 */
export const getLayerBasePricePerSquareMeter = (draft: StairPartDraftV2): number => {
  if (draft.layerUseDifferentStone) {
    return draft.layerPricePerSquareMeter || 0;
  }
  return draft.pricePerSquareMeter || 0;
};

/**
 * Get effective price per square meter for layers (includes mandatory if applicable)
 */
export const getLayerEffectivePricePerSquareMeter = (draft: StairPartDraftV2): number => {
  const base = getLayerBasePricePerSquareMeter(draft);
  if (draft.layerUseDifferentStone && draft.layerUseMandatory && draft.layerMandatoryPercentage && draft.layerMandatoryPercentage > 0) {
    return base * (1 + draft.layerMandatoryPercentage / 100);
  }
  return base;
};

/**
 * Normalize layer alternate stone settings
 */
export const normalizeLayerAltStoneSettings = (draft: StairPartDraftV2): StairPartDraftV2 => {
  if (!draft.layerUseDifferentStone) {
    return {
      ...draft,
      layerPricePerSquareMeter: null,
      layerUseMandatory: undefined,
      layerMandatoryPercentage: null
    };
  }
  const normalized = { ...draft };
  normalized.layerPricePerSquareMeter =
    normalized.layerPricePerSquareMeter && normalized.layerPricePerSquareMeter > 0
      ? normalized.layerPricePerSquareMeter
      : null;
  normalized.layerUseMandatory = normalized.layerUseMandatory ?? true;
  normalized.layerMandatoryPercentage = normalized.layerMandatoryPercentage ?? 20;
  return normalized;
};

/**
 * Compute finishing cost
 */
export const computeFinishingCost = (
  draft: StairPartDraftV2,
  pricingSquareMeters: number
): number => {
  if (!draft.finishingEnabled || !draft.finishingId) {
    return 0;
  }
  const calculationBase = draft.finishingCalculationBase === 'length' ? 'length' : 'squareMeters';
  const unitPrice = Number(draft.finishingUnitPrice || draft.finishingPricePerSquareMeter || 0);
  const defaultQuantity = calculateDefaultFinishingQuantity({
    calculationBase,
    productType: 'stair',
    length: draft.lengthValue,
    lengthUnit: draft.lengthUnit || 'm',
    quantity: draft.quantity,
    squareMeters: pricingSquareMeters
  });
  const rawQuantity = Number(draft.finishingQuantity || 0) || defaultQuantity;
  const quantity = calculationBase === 'squareMeters' && defaultQuantity > 0
    ? Math.min(rawQuantity, defaultQuantity)
    : rawQuantity;
  if (quantity <= 0 || unitPrice <= 0) return 0;
  return calculateUnitFinishingCost(quantity, unitPrice);
};

/**
 * Compute totals V2 - main calculation function for stair parts
 * getCuttingTypePricePerMeter: function to get cutting type price (from state or API)
 */
export const computeTotalsV2 = (
  part: StairStepperPart,
  draft: StairPartDraftV2,
  getCuttingTypePricePerMeter: (code: string) => number | null
): {
  canonicalCalculation: StairPartCalculation;
  sqm: number;
  toolsTotal: number;
  partTotal: number;
  pricingSquareMeters: number;
  baseStoneQuantity: number;
  piecesPerStone: number;
  leftoverWidthCm: number;
  remainingStoneQuantity: number;
  remainingStoneGroups: Array<{ widthCm: number; quantity: number }>;
  cuttingCost: number;
  cuttingCostPerMeter: number;
  cuttingCostLongitudinal: number;
  cuttingCostPerMeterLongitudinal: number;
  cuttingMetersLongitudinal: number;
  cuttingMetersLongitudinalProduction: number;
  cuttingMetersLongitudinalCalibration: number;
  cuttingCostCross: number;
  cuttingCostPerMeterCross: number;
  cuttingMetersCross: number;
  baseMaterialPrice: number;
  billableCuttingCost: number;
  billableCuttingCostLongitudinal: number;
  billableCuttingCostCross: number;
  shouldChargeCuttingCost: boolean;
} => {
  const canonicalCalculation = calculateCanonicalStairDraft(
    part,
    draft,
    getCuttingTypePricePerMeter
  );
  // Calculate display square meters using user-entered width (for display purposes)
  const sqm = computeSqmV2(draft);
  const toolsMeters = computeToolsMetersV2(part, draft);
  const pricePerSqm = draft.pricePerSquareMeter || 0;
  let toolsPrice = 0;
  if (draft.tools && draft.tools.length) {
    for (const t of draft.tools) {
      const meters = computeToolMetersForTool(part, draft, t);
      toolsPrice += meters * (t.pricePerMeter || 0);
    }
  }
  
  // Use original width for pricing (like long stone products)
  // Display sqm uses user-entered width, but pricing uses original width
  const {
    originalWidthCm,
    userWidthCm,
    baseStoneQuantity,
    piecesPerStone,
    leftoverWidthCm,
    remainingStoneQuantity,
    remainingStoneGroups
  } = calculateStairStoneUsage(draft);
  const actualLengthM = getActualLengthMeters(draft);
  const pricingLengthM = part === 'riser' ? actualLengthM : getPricingLengthMeters(draft);
  const stoneQuantityForPricing = baseStoneQuantity || 0;

  let pricingSquareMeters = sqm;
  if (originalWidthCm > 0 && userWidthCm > 0 && pricingLengthM > 0 && stoneQuantityForPricing > 0) {
    pricingSquareMeters = pricingLengthM * (originalWidthCm / 100) * stoneQuantityForPricing;
  }

  const baseMaterialPrice = pricingSquareMeters * pricePerSqm;
  const defaultMandatoryForPart = part === 'riser' || part === 'landing';
  const isMandatoryEnabled = draft.useMandatory ?? defaultMandatoryForPart;
  const mandatoryPercentageValue = draft.mandatoryPercentage ?? 20;
  const mandatoryAmount = isMandatoryEnabled && mandatoryPercentageValue > 0
    ? baseMaterialPrice * (mandatoryPercentageValue / 100)
    : 0;
  const materialPriceWithMandatory = baseMaterialPrice + mandatoryAmount;

  let cuttingCostPerMeter = 0;
  let cuttingCost = 0;
  let cuttingCostLongitudinal = 0;
  let cuttingCostPerMeterLongitudinal = 0;
  let cuttingMetersLongitudinal = 0;
  let cuttingMetersLongitudinalProduction = 0;
  let cuttingMetersLongitudinalCalibration = 0;
  let cuttingCostCross = 0;
  let cuttingCostPerMeterCross = 0;
  let cuttingMetersCross = 0;
  const needsWidthCut =
    originalWidthCm > 0 && userWidthCm > 0 && userWidthCm < originalWidthCm && actualLengthM > 0;
  const needsLengthCut =
    pricingLengthM > 0 && actualLengthM > 0 && pricingLengthM - actualLengthM > 0.0001 && userWidthCm > 0;

  if (needsWidthCut && stoneQuantityForPricing > 0) {
    cuttingMetersLongitudinalProduction = actualLengthM * (draft.quantity || 0);
    cuttingMetersLongitudinalCalibration = (draft.calibrationCutEnabled ?? true)
      ? actualLengthM * stoneQuantityForPricing
      : 0;
    cuttingMetersLongitudinal = cuttingMetersLongitudinalProduction + cuttingMetersLongitudinalCalibration;
    cuttingCostPerMeterLongitudinal =
      draft.cutRateSnapshots?.longitudinal ??
      getCuttingTypePricePerMeter('LONG') ??
      0;
    if (cuttingCostPerMeterLongitudinal > 0) {
      cuttingCostLongitudinal = cuttingCostPerMeterLongitudinal * cuttingMetersLongitudinal;
    }
  }

  if (needsLengthCut && stoneQuantityForPricing > 0) {
    const crossRateFromConfig =
      draft.cutRateSnapshots?.cross ??
      getCuttingTypePricePerMeter('CROSS') ??
      0;
    cuttingCostPerMeterCross = crossRateFromConfig;
    const sourceWidthInMeters = originalWidthCm / 100;
    cuttingMetersCross = sourceWidthInMeters * stoneQuantityForPricing;
    if (cuttingCostPerMeterCross > 0) {
      cuttingCostCross = cuttingCostPerMeterCross * cuttingMetersCross;
    }
  }

  cuttingCost = cuttingCostLongitudinal + cuttingCostCross;
  cuttingCostPerMeter = cuttingCostLongitudinal > 0
    ? cuttingCostPerMeterLongitudinal
    : (cuttingCostCross > 0 ? cuttingCostPerMeterCross : 0);

  const mandatoryCuttingPolicyActive = isMandatoryEnabled && mandatoryPercentageValue > 0;
  const billableCuttingCostLongitudinal = cuttingCostLongitudinal;
  const billableCuttingCostCross = mandatoryCuttingPolicyActive ? 0 : cuttingCostCross;
  const billableCuttingCost = billableCuttingCostLongitudinal + billableCuttingCostCross;
  const shouldChargeCuttingCost = billableCuttingCost > 0;

  const partTotal = materialPriceWithMandatory + toolsPrice + billableCuttingCost;
  const legacyResult = {
    canonicalCalculation,
    sqm,
    toolsTotal: toolsPrice,
    partTotal,
    pricingSquareMeters,
    baseStoneQuantity: stoneQuantityForPricing,
    piecesPerStone,
    leftoverWidthCm,
    remainingStoneQuantity,
    remainingStoneGroups,
    cuttingCost,
    cuttingCostPerMeter,
    cuttingCostLongitudinal,
    cuttingCostPerMeterLongitudinal,
    cuttingMetersLongitudinal,
    cuttingMetersLongitudinalProduction,
    cuttingMetersLongitudinalCalibration,
    cuttingCostCross,
    cuttingCostPerMeterCross,
    cuttingMetersCross,
    baseMaterialPrice,
    billableCuttingCost,
    billableCuttingCostLongitudinal,
    billableCuttingCostCross,
    shouldChargeCuttingCost
  };

  if (!canonicalCalculation.ok) {
    return legacyResult;
  }

  const canonicalResult = canonicalCalculation.result;
  const consumedSourceCount = canonicalResult.packingPlan.consumedSources.length;
  const canonicalRemainderGroups = canonicalResult.packingPlan.remainders.reduce<
    Array<{ widthCm: number; quantity: number }>
  >((groups, remainder) => {
    const widthCm = Number(remainder.widthMeters) * 100;
    const existing = groups.find(group => Math.abs(group.widthCm - widthCm) < 0.000001);
    if (existing) existing.quantity += 1;
    else groups.push({ widthCm, quantity: 1 });
    return groups;
  }, []);
  const longitudinalMeters = Number(canonicalResult.packingPlan.longitudinalCutMeters);
  const calibrationMeters = Number(canonicalResult.packingPlan.calibrationMeters);
  const crossMeters = Number(canonicalResult.packingPlan.crossCutMeters);
  const longitudinalCost = Number(canonicalResult.longitudinalCutAmountToman);
  const calibrationCost = Number(canonicalResult.calibrationCutAmountToman);
  const crossCost = Number(canonicalResult.crossCutAmountToman);

  return {
    ...legacyResult,
    sqm: Number(canonicalResult.requestedAreaSquareMeters),
    pricingSquareMeters: Number(canonicalResult.consumedMotherAreaSquareMeters),
    baseStoneQuantity: consumedSourceCount,
    piecesPerStone: consumedSourceCount > 0
      ? Math.ceil(canonicalResult.quantity / consumedSourceCount)
      : 0,
    leftoverWidthCm: canonicalRemainderGroups[0]?.widthCm || 0,
    remainingStoneQuantity: canonicalRemainderGroups.reduce(
      (sum, group) => sum + group.quantity,
      0
    ),
    remainingStoneGroups: canonicalRemainderGroups,
    cuttingCost: longitudinalCost + calibrationCost + crossCost,
    cuttingCostPerMeter: longitudinalMeters + calibrationMeters + crossMeters > 0
      ? (longitudinalCost + calibrationCost + crossCost) /
        (longitudinalMeters + calibrationMeters + crossMeters)
      : 0,
    cuttingCostLongitudinal: longitudinalCost + calibrationCost,
    cuttingMetersLongitudinal: longitudinalMeters + calibrationMeters,
    cuttingMetersLongitudinalProduction: longitudinalMeters,
    cuttingMetersLongitudinalCalibration: calibrationMeters,
    cuttingCostCross: crossCost,
    cuttingMetersCross: crossMeters,
    baseMaterialPrice: Number(canonicalResult.baseAmountToman),
    billableCuttingCost: longitudinalCost + calibrationCost + crossCost,
    billableCuttingCostLongitudinal: longitudinalCost + calibrationCost,
    billableCuttingCostCross: crossCost,
    shouldChargeCuttingCost: longitudinalCost + calibrationCost + crossCost > 0,
    partTotal: Number(canonicalResult.totalAmountToman) + toolsPrice
  };
};

/**
 * Calculate layer metrics: how many layers from remaining stones vs new stones,
 * cutting costs, and used remaining stones
 */
export const calculateLayerMetrics = (params: {
  totalLayers: number;
  layerWidthCm: number;
  layerLengthM: number;
  availableRemainingStones: RemainingStone[];
  cuttingCostPerMeter: number;
  edgeDemands?: LayerEdgeDemand[];
}): {
  layersFromRemainingStones: number;
  layersFromNewStones: number;
  totalLayerCuttingCost: number;
  usedRemainingStonesForLayers: RemainingStone[];
  layerCutDetails: StoneCut[];
  layerRemainingPieces?: RemainingStone[];
  squareMetersFromRemaining?: number;
  squareMetersFromNew?: number;
  totalLayerDemand?: number;
  unfulfilledDemands?: Array<{ edge: LayerEdgeDemand['edge']; lengthM: number; quantity: number }>;
} => {
  const {
    totalLayers,
    layerWidthCm,
    layerLengthM,
    availableRemainingStones,
    edgeDemands
  } = params;
  
  if (layerWidthCm <= 0) {
    return {
      layersFromRemainingStones: 0,
      layersFromNewStones: totalLayers,
      totalLayerCuttingCost: 0,
      usedRemainingStonesForLayers: [],
      layerCutDetails: [],
      layerRemainingPieces: [],
      squareMetersFromRemaining: 0,
      squareMetersFromNew: 0,
      totalLayerDemand: totalLayers
    };
  }

  const widthMeters = layerWidthCm / 100;
  const fallbackLength = layerLengthM > 0
    ? layerLengthM 
    : (availableRemainingStones[0]?.length || 0);

  const demands = (edgeDemands && edgeDemands.length)
    ? edgeDemands.filter(d => d.lengthM > 0 && d.layersNeeded > 0)
    : [{
        edge: 'front' as const,
        layersNeeded: Math.max(totalLayers, 0),
        lengthM: fallbackLength
      }];

  if (!demands.length) {
    return {
      layersFromRemainingStones: 0,
      layersFromNewStones: totalLayers,
      totalLayerCuttingCost: 0,
      usedRemainingStonesForLayers: [],
      layerCutDetails: [],
      layerRemainingPieces: [],
      squareMetersFromRemaining: 0,
      squareMetersFromNew: 0,
      totalLayerDemand: totalLayers
    };
  }

  const edgePriority: Record<LayerEdgeDemand['edge'], number> = {
    front: 0,
    back: 1,
    left: 2,
    right: 3,
    perimeter: 4
  };

  const sortedDemands = [...demands].sort(
    (a, b) => edgePriority[a.edge] - edgePriority[b.edge]
  );

  type LayerColumn = {
    id: string;
    source: RemainingStone;
    lengthRemaining: number;
    originalLength: number;
  };

  const columns: LayerColumn[] = [];
  const residualWidthPieces: RemainingStone[] = [];

  availableRemainingStones.forEach(stone => {
    const quantity = stone.quantity && stone.quantity > 0 ? stone.quantity : 1;
    const columnsPerStone = Math.floor(stone.width / layerWidthCm);
    const stoneLength = stone.length || 0;
    if (columnsPerStone <= 0 || stoneLength <= 0) {
      return;
    }

    for (let q = 0; q < quantity; q++) {
      for (let col = 0; col < columnsPerStone; col++) {
        columns.push({
          id: `${stone.id}_col_${q}_${col}`,
          source: stone,
          lengthRemaining: stoneLength,
          originalLength: stoneLength
        });
      }
    }

    const leftoverWidth = stone.width - (columnsPerStone * layerWidthCm);
    if (leftoverWidth > 0) {
      residualWidthPieces.push({
        id: `layer_width_leftover_${stone.id}`,
        width: leftoverWidth,
        length: stoneLength,
        squareMeters: (leftoverWidth / 100) * stoneLength,
        isAvailable: true,
        sourceCutId: stone.sourceCutId || stone.id,
        quantity: quantity
      });
    }
  });

  if (columns.length === 0) {
    return {
      layersFromRemainingStones: 0,
      layersFromNewStones: demands.reduce((sum, d) => sum + d.layersNeeded, 0),
      totalLayerCuttingCost: 0,
      usedRemainingStonesForLayers: [],
      layerCutDetails: [],
      layerRemainingPieces: residualWidthPieces,
      squareMetersFromRemaining: 0,
      squareMetersFromNew: demands.reduce((sum, d) => sum + d.layersNeeded * d.lengthM * widthMeters, 0),
      totalLayerDemand: demands.reduce((sum, d) => sum + d.layersNeeded, 0)
    };
  }

  let layersFromRemainingStones = 0;
  let totalLayerDemand = 0;
  let squareMetersFromRemaining = 0;
  let squareMetersFromNew = 0;
  const usageEntries: { source: RemainingStone; lengthM: number; quantity: number }[] = [];
  const unfulfilledDemands: Array<{ edge: LayerEdgeDemand['edge']; lengthM: number; quantity: number }> = [];

  const canUseRemainingForEdge = (_edge: LayerEdgeDemand['edge']) => true;

  sortedDemands.forEach(demand => {
    let needed = demand.layersNeeded;
    totalLayerDemand += demand.layersNeeded;

    if (canUseRemainingForEdge(demand.edge)) {
      for (const column of columns) {
        if (needed <= 0) break;
        if (column.lengthRemaining + 1e-6 < demand.lengthM) continue;

        const stripsPossible = Math.floor(column.lengthRemaining / demand.lengthM);
        if (stripsPossible <= 0) continue;

        const used = Math.min(needed, stripsPossible);
        column.lengthRemaining = Math.max(0, column.lengthRemaining - used * demand.lengthM);
        needed -= used;
        layersFromRemainingStones += used;
        squareMetersFromRemaining += used * demand.lengthM * widthMeters;

        usageEntries.push({
          source: column.source,
          lengthM: demand.lengthM,
          quantity: used
        });
      }
    }

    if (needed > 0) {
      squareMetersFromNew += needed * demand.lengthM * widthMeters;
      unfulfilledDemands.push({ edge: demand.edge, lengthM: demand.lengthM, quantity: needed });
    }
  });

  const layersFromNewStones = Math.max(0, totalLayerDemand - layersFromRemainingStones);

  const usedRemainingStonesForLayers: RemainingStone[] = usageEntries.map((entry, index) => ({
    id: `used_layer_${entry.source.id}_${index}`,
    width: layerWidthCm,
    length: entry.lengthM,
    squareMeters: (layerWidthCm * entry.lengthM * entry.quantity) / 100,
    isAvailable: false,
    sourceCutId: entry.source.sourceCutId || entry.source.id,
    quantity: entry.quantity
  }));

  const layerRemainingPieces: RemainingStone[] = [
    ...columns
      .filter(column => column.lengthRemaining > 1e-6)
      .map(column => ({
        id: `layer_remaining_${column.id}`,
        width: layerWidthCm,
        length: column.lengthRemaining,
        squareMeters: (layerWidthCm * column.lengthRemaining) / 100,
        isAvailable: true,
        sourceCutId: column.source.sourceCutId || column.source.id,
        quantity: 1
      })),
    ...residualWidthPieces
  ];
  
  return {
    layersFromRemainingStones,
    layersFromNewStones,
    totalLayerCuttingCost: 0,
    usedRemainingStonesForLayers,
    layerCutDetails: [],
    layerRemainingPieces,
    squareMetersFromRemaining,
    squareMetersFromNew,
    totalLayerDemand,
    unfulfilledDemands
  };
};

/**
 * Find an existing layer product with the same configuration
 */
export const findExistingLayerProduct = (
  sessionItems: ContractProduct[],
  draft: StairPartDraftV2,
  parentPartType: StairStepperPart,
  parentProductIndexInSession?: number
): ContractProduct | null => {
  if (!draft.layerEdges || !draft.layerWidthCm || !draft.numberOfLayersPerStair) {
    return null;
  }
  
  return sessionItems.find(item => {
    const itemIsLayer = ((item.meta as any)?.isLayer) || false;
    if (!itemIsLayer) return false;
    
    const itemLayerInfo = (item.meta as any)?.layerInfo;
    const itemLayerEdges = (item.meta as any)?.layerEdges;

    if (
      parentProductIndexInSession !== undefined &&
      itemLayerInfo?.parentProductIndexInSession !== parentProductIndexInSession
    ) return false;
    
    // Check if same parent part
    if (itemLayerInfo?.parentPartType !== parentPartType) return false;
    
    // Check if same edges configuration (exact match)
    const edgesMatch = 
      (itemLayerEdges?.front || false) === (draft.layerEdges?.front || false) &&
      (itemLayerEdges?.left || false) === (draft.layerEdges?.left || false) &&
      (itemLayerEdges?.right || false) === (draft.layerEdges?.right || false) &&
      (itemLayerEdges?.back || false) === (draft.layerEdges?.back || false) &&
      (itemLayerEdges?.perimeter || false) === (draft.layerEdges?.perimeter || false);
    
    if (!edgesMatch) return false;

    const itemLayerTypeId = ((item.meta as any)?.layerType)?.id || item.layerTypeId || null;
    const draftLayerTypeId = draft.layerTypeId || null;
    if ((itemLayerTypeId || null) !== (draftLayerTypeId || null)) return false;

    const itemAltStoneMeta = (item.meta as any)?.layerAltStone;
    const itemAltStoneId = item.layerUseDifferentStone ? (item.layerStoneProductId || itemAltStoneMeta?.id || item.productId) : null;
    const draftAltStoneId = draft.layerUseDifferentStone
      ? (draft.layerStoneProductId || draft.layerStoneProduct?.id || null)
      : null;
    if (!!item.layerUseDifferentStone !== !!draft.layerUseDifferentStone) return false;
    if (item.layerUseDifferentStone && itemAltStoneId !== draftAltStoneId) return false;
    
    const itemLayerBasePrice = item.layerUseDifferentStone
      ? (item.layerStoneBasePricePerSquareMeter || item.layerStonePricePerSquareMeter || 0)
      : (item.pricePerSquareMeter || 0);
    const draftLayerBasePrice = draft.layerUseDifferentStone
      ? (draft.layerPricePerSquareMeter || 0)
      : (draft.pricePerSquareMeter || 0);
    if (Math.abs(itemLayerBasePrice - draftLayerBasePrice) > 0.0001) return false;
    
    const itemMandatoryFlag = item.layerUseDifferentStone ? (item.layerUseMandatory ? true : false) : false;
    const draftMandatoryFlag = draft.layerUseDifferentStone ? (draft.layerUseMandatory ? true : false) : false;
    if (itemMandatoryFlag !== draftMandatoryFlag) return false;
    if (itemMandatoryFlag && draftMandatoryFlag) {
      const itemMandatoryPercent = item.layerMandatoryPercentage ?? 0;
      const draftMandatoryPercent = draft.layerMandatoryPercentage ?? 0;
      if (Math.abs(itemMandatoryPercent - draftMandatoryPercent) > 0.0001) return false;
    }
    
    // Check if same dimensions (with tolerance for floating point)
    const widthTolerance = 0.01; // 0.01cm tolerance
    if (Math.abs(item.width - (draft.layerWidthCm || 0)) > widthTolerance) return false;
    
    // Check length (convert to same unit for comparison)
    const itemLengthInDraftUnit = item.lengthUnit === draft.lengthUnit 
      ? item.length 
      : (item.lengthUnit === 'm' ? item.length * 100 : item.length / 100);
    const lengthTolerance = draft.lengthUnit === 'm' ? 0.001 : 0.1; // 0.001m or 0.1cm
    const draftLengthForComparison = convertMetersToUnit(getActualLengthMeters(draft), draft.lengthUnit || 'm');
    if (Math.abs(itemLengthInDraftUnit - draftLengthForComparison) > lengthTolerance) return false;
    
    // Check if same number of layers per stair
    if (itemLayerInfo?.numberOfLayersPerStair !== draft.numberOfLayersPerStair) return false;
    
    return true;
  }) || null;
};

/**
 * Collect all available remaining stones from all stair parts in session
 */
export const collectAvailableRemainingStones = (
  sessionItems: ContractProduct[],
  currentProductRemainingStones: RemainingStone[]
): RemainingStone[] => {
  const allAvailable: RemainingStone[] = [];
  
  // Collect from all non-layer stair parts in session
  sessionItems.forEach(item => {
    const itemIsLayer = ((item.meta as any)?.isLayer) || false;
    if (!itemIsLayer && item.remainingStones && item.remainingStones.length > 0) {
      // Get remaining stones that haven't been used yet
      const usedRemainingStones = item.usedRemainingStones || [];
      const usedRemainingStoneIds = new Set(usedRemainingStones.flatMap(getRemainingStoneUsageKeys));
      
      item.remainingStones.forEach(rs => {
        // Only include if not already used
        const isAlreadyUsed = getRemainingStoneUsageKeys(rs).some(key => usedRemainingStoneIds.has(key));
        if (!isAlreadyUsed) {
          allAvailable.push(rs);
        }
      });
    }
  });
  
  // Also include remaining stones from the current stair part
  currentProductRemainingStones.forEach(rs => {
    allAvailable.push(rs);
  });
  
  return allAvailable;
};

/**
 * Create a layer product from draft and calculations
 */
export const createLayerProduct = (params: {
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
}): ContractProduct => {
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
    description: `لایه ${getPartDisplayLabel(parentPartType)} - ${draft.numberOfLayersPerStair} لایه برای هر پله${layersFromRemainingStones > 0 ? ` (${layersFromRemainingStones} از باقیمانده، ${layersFromNewStones} از سنگ جدید)` : ''}${draft.layerTypeName ? ` | نوع لایه: ${draft.layerTypeName}` : ''}`,
    currency: 'تومان',
    isMandatory: false,
    mandatoryPercentage: 0,
    originalTotalPrice: layerMaterialPrice,
    isCut: layersFromRemainingStones > 0 || totalLayerCuttingCost > 0 || (layerCutDetails && layerCutDetails.length > 0),
    cutType: totalLayerCuttingCost > 0 ? 'longitudinal' : null,
    originalWidth: originalWidthCm,
    originalLength: lengthM,
    cuttingCost: totalLayerCuttingCost,
    cuttingCostPerMeter: layerCuttingCostPerMeter,
    cutDescription: layersFromRemainingStones > 0 
      ? `ترکیبی: ${layersFromRemainingStones} لایه از باقیمانده، ${layersFromNewStones} لایه از سنگ جدید`
      : '',
    remainingStones: layerRemainingPieces || [],
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
};

/**
 * Merge an existing layer product with new layer data
 */
export const mergeLayerProduct = (
  existing: ContractProduct,
  newData: {
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
  
  // Merge layer counts
  const updatedLayersFromRemaining = existingLayersFromRemaining + layersFromRemainingStones;
  const updatedLayersFromNew = existingLayersFromNew + layersFromNewStones;
  const updatedTotalLayers = updatedLayersFromRemaining + updatedLayersFromNew;
  
  // Recalculate totals with merged quantities
  const existingLayerSqm = existing.squareMeters || 0;
  const updatedTotalSqm = existingLayerSqm + newLayerSqm;
  
  // Merge stone area used
  const existingStoneAreaUsed = (existing.meta as any)?.stoneAreaUsedSqm || 0;
  const updatedStoneAreaUsedSqm = stoneAreaUsedSqm && stoneAreaUsedSqm > 0
    ? (existingStoneAreaUsed + stoneAreaUsedSqm)
    : existingStoneAreaUsed;
  
  // Merge remaining stone usage
  const existingUsedRemainingStones = existing.usedRemainingStones || [];
  const mergedUsedRemainingStones = [...existingUsedRemainingStones, ...usedRemainingStonesForLayers];
  
  // Merge cut details
  const existingCutDetails = existing.cutDetails || [];
  const mergedCutDetails = [...existingCutDetails, ...layerCutDetails];
  
  // Recalculate pricing
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
    description: `لایه ${getPartDisplayLabel(parentPartType)} - ${draft.numberOfLayersPerStair} لایه برای هر پله (${updatedLayersFromRemaining} از باقیمانده، ${updatedLayersFromNew} از سنگ جدید)${draft.layerTypeName ? ` | نوع لایه: ${draft.layerTypeName}` : ''}`,
    cutDescription: mergedUsedRemainingStones.length > 0 
      ? `ترکیبی: ${updatedLayersFromRemaining} لایه از باقیمانده، ${updatedLayersFromNew} لایه از سنگ جدید`
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
      ? (layerStoneBasePricePerSquareMeter ?? layerPricePerSquareMeter)
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
};

/**
 * Update remaining stone usage tracking in products
 * Returns a map of product index to updated product
 */
export const updateRemainingStoneUsage = (
  sessionItems: ContractProduct[],
  usedRemainingStones: RemainingStone[],
  mainStairPartIndex: number
): Map<number, ContractProduct> => {
  const updates = new Map<number, ContractProduct>();
  
  if (usedRemainingStones.length === 0) {
    return updates;
  }
  
  // Create a map of remaining stone IDs to their source product index
  const remainingStoneSourceMap = new Map<string, number>();
  sessionItems.forEach((item, idx) => {
    const itemIsLayer = ((item.meta as any)?.isLayer) || false;
    if (!itemIsLayer && item.remainingStones && item.remainingStones.length > 0) {
      item.remainingStones.forEach(rs => {
        remainingStoneSourceMap.set(rs.id, idx);
        if (rs.sourceCutId) {
          remainingStoneSourceMap.set(rs.sourceCutId, idx);
        }
      });
    }
  });
  
  // Group used remaining stones by their source product
  const usedBySource = new Map<number, RemainingStone[]>();
  usedRemainingStones.forEach(usedRs => {
    const sourceIdx = getRemainingStoneUsageKeys(usedRs)
      .map(key => remainingStoneSourceMap.get(key))
      .find((idx): idx is number => idx !== undefined);
    if (sourceIdx !== undefined) {
      if (!usedBySource.has(sourceIdx)) {
        usedBySource.set(sourceIdx, []);
      }
      usedBySource.get(sourceIdx)!.push(usedRs);
    }
  });
  
  // Also update the main stair part (the one we just added)
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
  
  // Update each source product with its used remaining stones
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
};
