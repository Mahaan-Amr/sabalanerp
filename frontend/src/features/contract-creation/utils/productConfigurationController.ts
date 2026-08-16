import type {
  AppliedProductFinishing,
  AppliedSubService,
  ContractProduct,
  ContractUsageType,
  Product,
  RemainingStone,
  StairPartDraftV2,
  StairStepperPart,
  SmartLongitudinalCutPlan
} from '../types/contract.types';
import {
  calculateLongitudinalProduct,
  parseCanonicalDecimal,
  parseStableIdentity,
  type LongitudinalProductCalculation,
  type LongitudinalProductInput,
  type OperationEdge,
  type ProductOperationsInput
} from '@sabalanerp/contract-product-graph';
import { recalculateUsedRemainingDimensions } from './dimensionUtils';
import {
  mergeRemainingStoneCollection,
  normalizeRemainingStoneCollection,
  sanitizeRemainingStoneEntry
} from './remainingStoneGuards';

export interface ContractQuantityInputPolicy {
  minimum: number;
  quantity: number;
  calculationQuantity: number;
  optimizerRequested: boolean;
}

export interface FreshContractProductDefaults {
  quantity: number;
  calibrationCutEnabled?: boolean;
}

export const getFreshContractProductDefaults = (
  productType: ContractUsageType | null | undefined
): FreshContractProductDefaults => {
  if (productType === 'longitudinal') {
    return { quantity: 0, calibrationCutEnabled: false };
  }
  if (productType === 'stair') {
    return { quantity: 1, calibrationCutEnabled: false };
  }
  return { quantity: 1 };
};

export const resolveExistingCalibrationCutEnabled = (value: boolean | null | undefined): boolean =>
  value ?? true;

export type LongitudinalDraftForSaveResolution =
  | {
      ok: true;
      draft: Partial<ContractProduct>;
      calculation: Extract<LongitudinalProductCalculation, { ok: true }>;
    }
  | {
      ok: false;
      message: string;
    };

/**
 * Materializes the canonical longitudinal editor input at the commit boundary.
 *
 * The calculation worker updates legacy flat fields asynchronously for preview
 * compatibility. Save must not depend on that timing: the policy input is the
 * canonical owner of every editable longitudinal fact.
 */
export const resolveLongitudinalDraftForSave = (
  draft: Partial<ContractProduct>
): LongitudinalDraftForSaveResolution => {
  const input = draft.longitudinalPolicyInput;
  if (!input) {
    return {
      ok: false,
      message: 'اطلاعات ویرایش محصول طولی کامل نیست.'
    };
  }

  const calculation = calculateLongitudinalProduct(input);
  if (!calculation.ok) {
    return {
      ok: false,
      message: calculation.conflicts.map(conflict => conflict.message).join(' | ')
    };
  }

  const result = calculation.result;
  const length = Number(result.lengthMeters) *
    (input.lengthDisplayUnit === 'cm' ? 100 : 1);
  const width = Number(result.widthMeters) *
    (input.widthDisplayUnit === 'cm' ? 100 : 1);

  return {
    ok: true,
    calculation,
    draft: {
      ...draft,
      length,
      width,
      quantity: result.quantity ?? 0,
      squareMeters: Number(result.requestedAreaSquareMeters),
      pricePerSquareMeter: input.baseRateToman === undefined
        ? undefined
        : Number(input.baseRateToman),
      lengthUnit: input.lengthDisplayUnit,
      widthUnit: input.widthDisplayUnit,
      isMandatory: input.mandatoryEnabled,
      mandatoryPercentage: Number(input.mandatoryPercentage),
      sawKerfEnabled: input.sawKerfEnabled,
      sawKerfCm: input.sawKerfEnabled ? Number(input.sawKerfMeters) * 100 : null,
      calibrationCutEnabled: result.calibrationEnabled,
      cuttingCostPerMeter: input.longitudinalCutRateToman === undefined
        ? draft.cuttingCostPerMeter
        : Number(input.longitudinalCutRateToman)
    }
  };
};

export const createFreshStairPartDraft = (part: StairStepperPart): StairPartDraftV2 => ({
  layerConfigurations: [],
  lengthUnit: 'm',
  widthUnit: 'cm',
  widthCm: part === 'tread' ? 30 : part === 'riser' ? 17 : null,
  tools: [],
  layerSourceKind: null,
  layerSelectedRemainingStoneIds: [],
  finishingEnabled: false,
  calibrationCutEnabled: getFreshContractProductDefaults('stair').calibrationCutEnabled,
  calibrationSelection: 'automatic',
  useMandatory: part === 'riser' || part === 'landing',
  mandatoryPercentage: part === 'riser' || part === 'landing' ? 20 : null,
  description: ''
});

const legacyOperationEdges = (
  edges: AppliedSubService['edges'] | undefined
): OperationEdge[] => {
  if (!edges) return [];
  const selected = (['front', 'back', 'left', 'right'] as const)
    .filter(edge => Boolean(edges[edge]));
  if (edges.perimeter) {
    return ['front', 'back', 'left', 'right'];
  }
  return selected;
};

/**
 * Reads historical stair add-ons through the canonical operations seam.
 *
 * Legacy linear tools did not always record a physical edge. Those selections
 * are intentionally retained with no edge so the canonical validator asks for
 * an explicit seller decision during edit instead of inventing workshop data.
 */
export const adaptLegacyStairOperations = ({
  product,
  productRowId,
  lengthMeters,
  widthMeters,
  quantity
}: {
  product: Pick<
    ContractProduct,
    'appliedSubServices' | 'finishings' | 'finishingId' | 'finishingName' |
    'finishingCode' | 'finishingCalculationBase' | 'finishingUnitPrice' |
    'finishingPricePerSquareMeter' | 'finishingQuantity' | 'finishingSquareMeters' |
    'finishingCost'
  >;
  productRowId: string;
  lengthMeters: number;
  widthMeters: number;
  quantity?: number | null;
}): ProductOperationsInput | undefined => {
  const legacyTools = product.appliedSubServices || [];
  const collectionFinishings = product.finishings || [];
  const singularFinishing: AppliedProductFinishing[] =
    collectionFinishings.length === 0 && (
      product.finishingId ||
      product.finishingName ||
      product.finishingCost
    )
      ? [{
          selectionId: `legacy-finishing:${product.finishingId || productRowId}`,
          finishingId: product.finishingId || `legacy-finishing:${productRowId}`,
          code: product.finishingCode,
          name: product.finishingName || 'پرداخت سنگ',
          calculationBase:
            product.finishingCalculationBase === 'length' ? 'length' : 'squareMeters',
          unitPrice: Number(
            product.finishingUnitPrice ??
            product.finishingPricePerSquareMeter ??
            0
          ),
          automaticQuantity: Number(
            product.finishingQuantity ??
            product.finishingSquareMeters ??
            0
          ),
          quantity: Number(
            product.finishingQuantity ??
            product.finishingSquareMeters ??
            0
          ),
          quantityMode: 'manual',
          overrideStatus: 'current',
          cost: Number(product.finishingCost || 0)
        }]
      : [];
  const legacyFinishings = collectionFinishings.length > 0
    ? collectionFinishings
    : singularFinishing;

  if (legacyTools.length === 0 && legacyFinishings.length === 0) {
    return undefined;
  }

  const stableProductRowId = parseStableIdentity('product-row', productRowId);
  const groupId = parseStableIdentity(
    'operation-group',
    `legacy-operation-group:${stableProductRowId}`
  );
  const scope = quantity && quantity > 0
    ? String(Math.trunc(quantity))
    : String(lengthMeters);

  return {
    policyVersion: 'calculation-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    productRowId: stableProductRowId,
    lengthMeters: parseCanonicalDecimal(String(lengthMeters)),
    widthMeters: parseCanonicalDecimal(String(widthMeters)),
    ...(quantity && quantity > 0 ? { quantity: Math.trunc(quantity) } : {}),
    groups: [{
      operationGroupId: groupId,
      scope: parseCanonicalDecimal(scope)
    }],
    tools: legacyTools.map((tool, index) => {
      const unit = tool.calculationBase === 'squareMeters'
        ? 'squareMeter' as const
        : 'meter' as const;
      const finalQuantity = Math.max(0, Number(tool.meter || 0));
      const edges = unit === 'meter' ? legacyOperationEdges(tool.edges) : [];
      return {
        toolSelectionId: parseStableIdentity(
          'tool-selection',
          tool.id || `legacy-tool:${stableProductRowId}:${index}`
        ),
        operationGroupId: groupId,
        catalogItemId: tool.subServiceId || `legacy-tool:${index}`,
        catalogSnapshotVersion: 'legacy-contract-snapshot-v1',
        name:
          tool.subService?.namePersian ||
          tool.subService?.name ||
          `ابزار ${index + 1}`,
        unit,
        rateToman: parseCanonicalDecimal(String(
          Number(tool.subService?.pricePerMeter ?? 0)
        )),
        edges,
        quantityOverride: {
          value: parseCanonicalDecimal(String(finalQuantity)),
          automaticQuantitySnapshot: parseCanonicalDecimal(String(finalQuantity)),
          resolution: 'keep' as const
        },
        outsideCurrentCatalog: tool.subService?.isActive === false
      };
    }),
    finishings: legacyFinishings
      .filter(finishing => finishing.calculationBase !== 'count')
      .map((finishing, index) => {
        const finalQuantity = Math.max(0, Number(finishing.quantity || 0));
        return {
          finishingSelectionId: parseStableIdentity(
            'finishing-selection',
            finishing.selectionId ||
              `legacy-finishing:${stableProductRowId}:${index}`
          ),
          operationGroupId: groupId,
          catalogItemId:
            finishing.finishingId || `legacy-finishing:${index}`,
          catalogSnapshotVersion: 'legacy-contract-snapshot-v1',
          name: finishing.name || `پرداخت ${index + 1}`,
          unit: finishing.calculationBase === 'length'
            ? 'meter' as const
            : 'squareMeter' as const,
          rateToman: parseCanonicalDecimal(String(
            Math.max(0, Number(finishing.unitPrice || 0))
          )),
          incompatibleCatalogItemIds: [],
          quantityOverride: {
            value: parseCanonicalDecimal(String(finalQuantity)),
            automaticQuantitySnapshot: parseCanonicalDecimal(String(finalQuantity)),
            resolution: 'keep' as const
          }
        };
      })
  };
};

export const appendStairLayerConfiguration = (
  draft: StairPartDraftV2,
  configurationId: string
): StairPartDraftV2 => {
  const configurations = materializeStairLayerConfigurations(
    draft,
    configurationId
  );
  return {
    ...draft,
    layerConfigurations: configurations,
    layerConfigurationDraftId: undefined,
    activeLayerConfigurationDraftId: undefined,
    numberOfLayersPerStair: null,
    layerWidthCm: null,
    layerTypeId: null,
    layerTypeName: null,
    layerTypePrice: null,
    layerEdges: undefined,
    layerSourceKind: null,
    layerSelectedRemainingStoneIds: [],
    layerDescription: null,
    layerSideOperations: {},
    layerUseDifferentStone: false,
    layerStoneProductId: null,
    layerStoneProduct: null,
    layerStoneLabel: null,
    layerPricePerSquareMeter: null,
    layerUseMandatory: undefined,
    layerMandatoryPercentage: null,
    layerShortageSource: null,
    layerManualSourceWidthCm: null,
    layerManualSourceLengthM: null,
    layerManualSourceQuantity: null
  };
};

const hasActiveLayerValues = (draft: StairPartDraftV2): boolean =>
  Number(draft.numberOfLayersPerStair || 0) > 0;

const toLayerConfigurationSnapshot = (
  draft: StairPartDraftV2,
  configurationId: string
): StairPartDraftV2 => ({
  ...draft,
  layerConfigurationDraftId: configurationId,
  activeLayerConfigurationDraftId: undefined,
  layerConfigurations: []
});

export const materializeStairLayerConfigurations = (
  draft: StairPartDraftV2,
  fallbackConfigurationId?: string
): StairPartDraftV2[] => {
  const configurations = [...(draft.layerConfigurations || [])];
  if (!hasActiveLayerValues(draft)) return configurations;

  const activeId =
    draft.activeLayerConfigurationDraftId ||
    draft.layerConfigurationDraftId ||
    fallbackConfigurationId;
  if (!activeId) return configurations;

  const snapshot = toLayerConfigurationSnapshot(draft, activeId);
  const activeIndex = configurations.findIndex(
    configuration =>
      configuration.layerConfigurationDraftId === activeId
  );
  if (activeIndex >= 0) {
    configurations[activeIndex] = snapshot;
  } else {
    configurations.push(snapshot);
  }
  return configurations;
};

export const selectStairLayerConfiguration = (
  draft: StairPartDraftV2,
  configurationId: string
): StairPartDraftV2 => {
  const configurations = materializeStairLayerConfigurations(draft);
  const selected = configurations.find(
    configuration =>
      configuration.layerConfigurationDraftId === configurationId
  );
  if (!selected) return draft;
  return {
    ...selected,
    layerConfigurations: configurations,
    layerConfigurationDraftId: configurationId,
    activeLayerConfigurationDraftId: configurationId
  };
};

export const removeStairLayerConfiguration = (
  draft: StairPartDraftV2,
  configurationId: string
): StairPartDraftV2 => {
  const configurations = materializeStairLayerConfigurations(draft)
    .filter(configuration =>
      configuration.layerConfigurationDraftId !== configurationId
    );
  if (
    draft.activeLayerConfigurationDraftId !== configurationId
  ) {
    return {
      ...draft,
      layerConfigurations: configurations
    };
  }
  const next = configurations[0];
  if (next?.layerConfigurationDraftId) {
    return selectStairLayerConfiguration({
      ...draft,
      activeLayerConfigurationDraftId: undefined,
      layerConfigurationDraftId: undefined,
      numberOfLayersPerStair: null,
      layerConfigurations: configurations
    }, next.layerConfigurationDraftId);
  }
  return {
    ...draft,
    layerConfigurations: [],
    layerConfigurationDraftId: undefined,
    activeLayerConfigurationDraftId: undefined,
    numberOfLayersPerStair: null,
    layerWidthCm: null,
    layerTypeId: null,
    layerTypeName: null,
    layerTypePrice: null,
    layerEdges: undefined,
    layerSourceKind: null,
    layerSelectedRemainingStoneIds: [],
    layerDescription: null,
    layerSideOperations: {}
  };
};

export const getContractQuantityInputPolicy = (
  productType: ContractUsageType | null | undefined,
  value: number | null | undefined
): ContractQuantityInputPolicy => {
  const enteredQuantity = Math.max(0, Number(value) || 0);
  const optimizerRequested = productType === 'longitudinal' && enteredQuantity === 0;
  const quantity = optimizerRequested ? 0 : Math.max(1, enteredQuantity);

  return {
    minimum: productType === 'longitudinal' ? 0 : 1,
    quantity,
    calculationQuantity: optimizerRequested ? 1 : quantity,
    optimizerRequested
  };
};

export const resolveLongitudinalOptimizerEditOwnership = ({
  enteredQuantity,
  inheritedDerivedQuantity,
  inheritedDerivedDimension,
  touchedFields,
  previousPolicyInput,
  currentPolicyInput
}: {
  enteredQuantity: number | null | undefined;
  inheritedDerivedQuantity: boolean | null | undefined;
  inheritedDerivedDimension: 'length' | 'width' | null | undefined;
  touchedFields: ReadonlySet<string>;
  previousPolicyInput?: LongitudinalProductInput | null;
  currentPolicyInput?: LongitudinalProductInput | null;
}) => {
  const effectiveTouchedFields = new Set(touchedFields);
  if (previousPolicyInput && currentPolicyInput) {
    if (previousPolicyInput.lengthMeters !== currentPolicyInput.lengthMeters) {
      effectiveTouchedFields.add('length');
    }
    if (previousPolicyInput.widthMeters !== currentPolicyInput.widthMeters) {
      effectiveTouchedFields.add('width');
    }
    if (
      previousPolicyInput.requestedAreaSquareMeters !==
      currentPolicyInput.requestedAreaSquareMeters
    ) {
      effectiveTouchedFields.add('squareMeters');
    }
    if (previousPolicyInput.quantity !== currentPolicyInput.quantity) {
      effectiveTouchedFields.add('quantity');
    }
  }
  const explicitPieceCount = Math.max(0, Number(enteredQuantity) || 0) > 0;
  return {
    preserveDerivedQuantity: !explicitPieceCount && !!inheritedDerivedQuantity &&
      !effectiveTouchedFields.has('quantity') &&
      !effectiveTouchedFields.has('length') &&
      !effectiveTouchedFields.has('squareMeters'),
    preserveDerivedLength: !explicitPieceCount && inheritedDerivedDimension === 'length' &&
      !effectiveTouchedFields.has('length') &&
      !effectiveTouchedFields.has('squareMeters'),
    preserveDerivedWidth: !explicitPieceCount && inheritedDerivedDimension === 'width' &&
      !effectiveTouchedFields.has('width') &&
      !effectiveTouchedFields.has('squareMeters')
  };
};

export const resolveLongitudinalQuantityOptimizationFailure = (
  quantityOptimizationRequested: boolean,
  plan: Pick<SmartLongitudinalCutPlan, 'derivedQuantity' | 'requestedQuantity' | 'warnings'>
): string | null => {
  if (!quantityOptimizationRequested) return null;
  if (plan.derivedQuantity && plan.requestedQuantity > 0) return null;

  return 'بهینه‌سازی تعداد با ابعاد واردشده ممکن نیست. ابعاد سنگ و محصول را بررسی کنید.';
};

export const getOriginalWidthForProduct = (
  selectedProduct: Pick<Product, 'widthValue'> | null | undefined,
  draft: Partial<ContractProduct>,
  isEditMode: boolean
): number => (
  isEditMode && draft.originalWidth ? draft.originalWidth : selectedProduct?.widthValue || 0
);

export const widthCmToUnit = (widthCm: number, unit: 'cm' | 'm'): number =>
  unit === 'm' ? widthCm / 100 : widthCm;

export const resolveLongitudinalWidth = (
  draft: Partial<ContractProduct>,
  selectedProduct: Pick<Product, 'widthValue'> | null | undefined,
  widthUnit: 'cm' | 'm',
  isEditMode: boolean
): Partial<ContractProduct> => {
  const hasWidth = Number(draft.width || 0) > 0;
  const calculationNeedsWidth = Number(draft.length || 0) > 0 || Number(draft.squareMeters || 0) > 0;
  const canDeriveWidth =
    Number(draft.width || 0) <= 0 &&
    Number(draft.length || 0) > 0 &&
    Number(draft.squareMeters || 0) > 0 &&
    Number(draft.quantity || 0) > 0;
  const originalWidth = getOriginalWidthForProduct(selectedProduct, draft, isEditMode);

  if (hasWidth || canDeriveWidth || !calculationNeedsWidth || originalWidth <= 0) {
    return draft;
  }

  return {
    ...draft,
    width: widthCmToUnit(originalWidth, widthUnit)
  };
};

export interface RemainingStoneEditMergeResult {
  remainingStones: RemainingStone[];
  usedRemainingStones: RemainingStone[];
  totalUsedRemainingWidth: number;
  totalUsedRemainingLength: number;
  warning?: string;
}

export const mergeEditedRemainingStoneState = ({
  geometryChanged,
  nextAvailableRemainingStones,
  previousProduct
}: {
  geometryChanged: boolean;
  nextAvailableRemainingStones: RemainingStone[];
  previousProduct: ContractProduct | null;
}): RemainingStoneEditMergeResult => {
  if (!previousProduct) {
    return {
      remainingStones: normalizeRemainingStoneCollection(nextAvailableRemainingStones),
      usedRemainingStones: [],
      totalUsedRemainingWidth: 0,
      totalUsedRemainingLength: 0
    };
  }

  const usedRemainingStones = previousProduct.usedRemainingStones || [];

  if (!geometryChanged) {
    return {
      remainingStones: normalizeRemainingStoneCollection(previousProduct.remainingStones || nextAvailableRemainingStones),
      usedRemainingStones,
      totalUsedRemainingWidth: previousProduct.totalUsedRemainingWidth || 0,
      totalUsedRemainingLength: previousProduct.totalUsedRemainingLength || 0
    };
  }

  return {
    remainingStones: normalizeRemainingStoneCollection(nextAvailableRemainingStones),
    usedRemainingStones,
    totalUsedRemainingWidth: previousProduct.totalUsedRemainingWidth || 0,
    totalUsedRemainingLength: previousProduct.totalUsedRemainingLength || 0,
    warning: usedRemainingStones.length > 0
      ? 'باقی‌مانده‌های در دسترس با ابعاد جدید به‌روزرسانی شدند. محصولاتی که قبلاً از باقی‌مانده ساخته شده‌اند حذف نشدند؛ لطفاً ظرفیت آن‌ها را بررسی کنید.'
      : undefined
  };
};

export const restoreRemainingStoneAfterChildRemoval = (
  products: ContractProduct[],
  removedIndex: number
): ContractProduct[] => {
  const productToRemove = products[removedIndex];
  const remainingSourceMeta = productToRemove?.meta?.remainingSource;

  if (!remainingSourceMeta) {
    return products.filter((_, index) => index !== removedIndex);
  }

  const sourceProductIndex = remainingSourceMeta.sourceProductIndex as number;
  const partitionId = remainingSourceMeta.partitionId as string | undefined;
  const sourceRemainingStoneId = remainingSourceMeta.sourceRemainingStoneId as string | undefined;
  const productsAfterRemoval = products.filter((_, index) => index !== removedIndex);
  const normalizedSourceIndex = removedIndex < sourceProductIndex ? sourceProductIndex - 1 : sourceProductIndex;

  if (normalizedSourceIndex < 0 || normalizedSourceIndex >= productsAfterRemoval.length) {
    return productsAfterRemoval;
  }

  const sourceProduct = productsAfterRemoval[normalizedSourceIndex];
  const sourceRemainingStoneSnapshot = remainingSourceMeta.sourceRemainingStone
    ? sanitizeRemainingStoneEntry(remainingSourceMeta.sourceRemainingStone as RemainingStone)
    : null;
  const generatedRemainingStoneIds = new Set(
    Array.isArray(remainingSourceMeta.generatedRemainingStoneIds)
      ? remainingSourceMeta.generatedRemainingStoneIds.filter(Boolean)
      : []
  );
  const physicalPieces = Array.isArray(remainingSourceMeta.physicalPieces)
    ? remainingSourceMeta.physicalPieces
    : [];
  const fallbackRestoredRemainingStones = physicalPieces.length > 0
    ? physicalPieces.map((piece: any, pieceIndex: number) => sanitizeRemainingStoneEntry({
        id: `restored_${Date.now()}_${partitionId || 'partition'}_${pieceIndex}`,
        width: piece.width,
        length: piece.length,
        squareMeters: piece.squareMeters,
        isAvailable: true,
        sourceCutId: sourceRemainingStoneId || '',
        quantity: piece.quantity || 1
      } as RemainingStone))
    : [sanitizeRemainingStoneEntry({
        id: `restored_${Date.now()}_${partitionId || 'partition'}`,
        width: productToRemove.width,
        length: productToRemove.length,
        squareMeters: productToRemove.squareMeters,
        isAvailable: true,
        sourceCutId: sourceRemainingStoneId || '',
        quantity: productToRemove.quantity
      } as RemainingStone)];

  const restoredRemainingStones = sourceRemainingStoneSnapshot?.isAvailable
    ? [sourceRemainingStoneSnapshot]
    : fallbackRestoredRemainingStones;
  const cleanedUsedRemaining = (sourceProduct.usedRemainingStones || []).filter(stone => {
    if (!partitionId) return true;
    return !(stone.id && stone.id.includes(partitionId));
  });
  const recalculated = recalculateUsedRemainingDimensions(cleanedUsedRemaining);
  const retainedRemainingStones = (sourceProduct.remainingStones || []).filter(stone => {
    if (generatedRemainingStoneIds.has(stone.id)) return false;
    if (sourceRemainingStoneSnapshot && stone.id === sourceRemainingStoneSnapshot.id) return false;
    return true;
  });
  const mergedRemaining = mergeRemainingStoneCollection([
    ...retainedRemainingStones,
    ...restoredRemainingStones
  ]);

  productsAfterRemoval[normalizedSourceIndex] = {
    ...sourceProduct,
    usedRemainingStones: cleanedUsedRemaining,
    remainingStones: mergedRemaining,
    totalUsedRemainingWidth: recalculated.totalUsedWidth,
    totalUsedRemainingLength: recalculated.totalUsedLength
  };

  return productsAfterRemoval;
};
