'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  FaArrowRight,
  FaArrowLeft,
  FaCheck,
  FaCalendarAlt,
  FaUser,
  FaBuilding,
  FaWarehouse,
  FaTruck,
  FaCreditCard,
  FaSignature,
  FaFileContract,
  FaPlus,
  FaTrash,
  FaSearch,
  FaTimes,
  FaEdit,
  FaRuler,
  FaSquare,
  FaCubes,
  FaThLarge,
  FaChevronDown,
  FaChevronUp,
  FaTools
} from 'react-icons/fa';
import { salesAPI, crmAPI, dashboardAPI, servicesAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { downloadBlobResponse } from '@/lib/downloadFile';
import { formatDisplayNumber, formatPrice, formatPriceWithRial, formatDimensions, formatSquareMeters, formatQuantity, normalizeDigits, sumNumericValues, tomanToRial, toFiniteNumber } from '@/lib/numberFormat';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import StoneCanvas from '@/components/StoneCanvas';
import { ErpInput, ErpInlineState, ErpPressable, ErpSelect, ErpTextarea } from '@/components/erp';

// Import new step components
import { Step1ContractDate } from '@/features/contract-creation/components/steps/Step1ContractDate';
import { Step2CustomerSelection } from '@/features/contract-creation/components/steps/Step2CustomerSelection';
import { Step3ProjectManagement } from '@/features/contract-creation/components/steps/Step3ProjectManagement';
import { Step5ProductSelection } from '@/features/contract-creation/components/steps/Step5ProductSelection';
import { Step6DeliverySchedule } from '@/features/contract-creation/components/steps/Step6DeliverySchedule';
import { Step7PaymentMethod } from '@/features/contract-creation/components/steps/Step7PaymentMethod';
import { Step8DigitalSignature } from '@/features/contract-creation/components/steps/Step8DigitalSignature';

// Import shared components
import { WizardProgressBar, type WizardStep } from '@/features/contract-creation/components/shared/WizardProgressBar';
import { WizardNavigation } from '@/features/contract-creation/components/shared/WizardNavigation';

// Import modal components
import { ProductConfigurationModal } from '@/features/contract-creation/components/modals/ProductConfigurationModal';
import { RemainingStoneModal } from '@/features/contract-creation/components/modals/RemainingStoneModal';
import { PaymentEntryModal } from '@/features/contract-creation/components/modals/PaymentEntryModal';
import {
  AutoGrowingDescription,
  CompactSegmentedControl,
  CompactSwitch,
  CompactUnitSwitch,
  OperationCollectionsSection,
  ReservedRowsSkeleton,
  StairQuantityModeSection,
  toStaircaseQuantityIntent,
  type StairQuantityInputDraft
} from '@/features/contract-creation/components/product-modal-system';

const CanonicalStairLayerSummary = dynamic(
  () => import(
    '@/features/contract-creation/components/product-modal-system/CanonicalStairLayerSummary'
  ).then(module => module.CanonicalStairLayerSummary),
  {
    ssr: false,
    loading: () => (
      <div className="border-y border-[var(--sds-border-default)] py-2 dark:border-[var(--sds-border-subtle)]">
        <ReservedRowsSkeleton rows={6} />
      </div>
    )
  }
);

// Import hooks
import { useContractWizard } from '@/features/contract-creation/hooks/useContractWizard';
import { useProductModal } from '@/features/contract-creation/hooks/useProductModal';
import { useProductCalculations } from '@/features/contract-creation/hooks/useProductCalculations';
import { useRemainingStoneModal } from '@/features/contract-creation/hooks/useRemainingStoneModal';
import { usePaymentHandlers } from '@/features/contract-creation/hooks/usePaymentHandlers';
import { useDigitalSignature } from '@/features/contract-creation/hooks/useDigitalSignature';
import { useStairSystemV2 } from '@/features/contract-creation/hooks/useStairSystemV2';
import { useStairLayerManagement } from '@/features/contract-creation/hooks/useStairLayerManagement';
import { useDeliverySchedule } from '@/features/contract-creation/hooks/useDeliverySchedule';
import { useContractSubmission } from '@/features/contract-creation/hooks/useContractSubmission';
import { useDataLoading } from '@/features/contract-creation/hooks/useDataLoading';
import { useContractSummary } from '@/features/contract-creation/hooks/useContractSummary';
import { useProductFiltering } from '@/features/contract-creation/hooks/useProductFiltering';
import { useContractProductCartController } from '@/features/contract-creation/hooks/useContractProductCartController';
import { useSellerProductHistory } from '@/features/contract-creation/hooks/useSellerProductHistory';
import {
  getOrCreateContractDraftId,
  useContractEditRecovery
} from '@/features/contract-creation/hooks/useContractEditRecovery';
import { resolveProductModalRecoveryState } from '@/features/contract-creation/utils/contractRecoveryModalPolicy';

// Import constants
import { PRODUCT_TYPES, WIZARD_STEPS } from '@/features/contract-creation/constants/contract.constants';

// Import utilities
import { generateCompactProductName, generateFullProductName, generateSlabContractProductName, inferCatalogContractType, productSupportsContractRoute, productSupportsContractType } from '@/features/contract-creation/utils/productUtils';
import {
  hasLayerEdgeSelection,
  deriveLayerEdgesFromTools,
  getPartDisplayLabel,
  getProductCuttingCost,
  getProductServiceCost
} from '@/features/contract-creation/utils/stairSystemHelpers';
import { generateContractHTML } from '@/features/contract-creation/utils/contractHTMLGenerator';
import {
  getAvailableRemainingStoneInventory,
  isUsableRemainingStone,
  normalizeRemainingStoneCollection,
  sanitizeRemainingStoneEntry
} from '@/features/contract-creation/utils/remainingStoneGuards';
import { validatePartitions, calculateRemainingAreasAfterPartitions } from '@/features/contract-creation/services/stoneCuttingService';
import { calculatePartitionPositions } from '@/features/contract-creation/services/partitionPositioningService';
import {
  resolveLayerBulkOperationView,
  selectNewLayerStone
} from '@/features/contract-creation/services/stairLayerInteractionState';
import {
  validateDraftNumericFields,
  validateDraftRequiredFields,
  clearDraftFieldError
} from '@/features/contract-creation/services/stairValidationService';
import {
  executeStairCreateTransaction,
  hasMeaningfulStairDraft,
  reportStairTransactionDiagnostic,
  shouldConfirmStairDraftDiscard
} from '@/features/contract-creation/services/stairConfigurationTransaction';
import {
  getStairRowWithAttachedLayers as resolveStairRowWithAttachedLayers,
  resolveAttachedStairLayers,
  resolveStairParentIndex
} from '@/features/contract-creation/services/stairEditGraph';
import {
  calculateLongitudinalMaterialPricing,
  calculateSmartLongitudinalCutPlan,
  hasLongitudinalGeometryChanged
} from '@/features/contract-creation/services/remainingStoneService';
import {
  adaptLegacyStairOperations,
  appendStairLayerConfiguration,
  createFreshStairPartDraft,
  getFreshContractProductDefaults,
  materializeStairLayerConfigurations,
  mergeEditedRemainingStoneState,
  removeStairLayerConfiguration,
  resolveExistingCalibrationCutEnabled,
  resolveLongitudinalQuantityOptimizationFailure,
  resolveLongitudinalWidth,
  selectStairLayerConfiguration
} from '@/features/contract-creation/utils/productConfigurationController';
import {
  createContractProductRowId,
  ensureContractProductRowIds,
  normalizeContractProductRowIdentities,
  prepareStairEditReplacementRowIdentities,
  resolveEditedContractProductRowId,
  isRemainingStoneChild
} from '@/features/contract-creation/utils/contractProductIdentity';
import {
  formatRemainingStoneReplayConflicts,
  replayRemainingStoneAllocations
} from '@/features/contract-creation/services/remainingStoneAllocationReplayService';
import {
  recalculateRemainingChildAddOns,
  resolveLegacyRemainingChildAddOns
} from '@/features/contract-creation/services/remainingStoneChildAddOnService';
import {
  CONTRACT_DRAFT_STORAGE_KEY,
  clampContractDraftStep,
  createContractAutosaveDraft,
  parseContractAutosaveDraft
} from '@/features/contract-creation/utils/contractDraftStorage';
import {
  CONTRACT_RECOVERY_SCHEMA_VERSION,
  type ContractRecoveryScope
} from '@/features/contract-creation/utils/contractRecoveryJournal';
import {
  getContractGrossPayableTotal,
  getContractProductNonServiceSubtotal,
  getContractProductPayableTotal,
  getContractProductsPayableTotal,
  reconcileContractProductPricing
} from '@/features/contract-creation/utils/contractProductPricing';
import { getBillableCuttingBreakdown, getBillableCuttingCost } from '@/features/contract-creation/utils/mandatoryCuttingPricing';
import {
  getDeliverableProductEntries,
  getDeliveryTargetAmount as getContractDeliveryTargetAmount,
  getSchedulableServiceEntries,
  reconcileDeliveryProductReferences
} from '@/features/contract-creation/utils/deliveryScheduleController';
import {
  resolveLongitudinalCustomerFields,
  restoreLongitudinalCustomerRequest
} from '@/features/contract-creation/utils/longitudinalOptimizerGeometry';
import {
  createContractServiceRow,
  getServiceRowSourceLabel,
  getServiceRowUnitLabel,
  recalculateContractServiceRow
} from '@/features/contract-creation/utils/contractServiceRows';
import {
  getPreparedQuantity,
  getPreparedUnit,
  inferPreparedKindFromProduct,
  isPreparedProductType,
  normalizeContractProductType
} from '@/features/contract-creation/utils/preparedProductUtils';
import {
  toMeters,
  convertMetersToUnit,
  getDraftStandardLengthMeters,
  getActualLengthMeters,
  getPricingLengthMeters
} from '@/features/contract-creation/utils/stairCalculations';
import {
  activateFinishingSelection,
  calculateDefaultFinishingQuantity,
  calculateFinishingCost,
  getFinishingCalculationBase,
  getFinishingUnitLabel,
  getFinishingUnitPrice,
  normalizeProductFinishing
} from '@/features/contract-creation/utils/finishingUtils';
import { SAW_KERF_CM } from '@/features/contract-creation/utils/sawKerf';
import {
  calculateCanonicalLayerDraft,
  calculateLayerSourcePlan,
  applyInventoryLayerTypeSelection,
  createCanonicalLayerCalculationRequest,
  createCanonicalStairDraftInput,
  formatCanonicalLayerConflict,
  normalizeAutomaticLayerOperationGroups,
  toCanonicalLayerInventory,
  computeTotalsV2 as computeCanonicalStairTotalsV2
} from '@/features/contract-creation/services/stairCalculationService';
import {
  calculateProductOperations,
  calculateSlab,
  calculateStairPart,
  materializePaidRemainderStocks,
  parseCanonicalDecimal,
  parseStableIdentity,
  resolveStaircaseQuantity,
  type ProductOperationsInput
} from '@sabalanerp/contract-product-graph';

const refreshOperationGeometry = (
  input: ProductOperationsInput | undefined,
  length: number,
  lengthUnit: 'cm' | 'm',
  width: number,
  widthUnit: 'cm' | 'm',
  quantity: number
): ProductOperationsInput | undefined => input ? {
  ...input,
  lengthMeters: parseCanonicalDecimal(String(lengthUnit === 'cm' ? length / 100 : length)),
  widthMeters: parseCanonicalDecimal(String(widthUnit === 'cm' ? width / 100 : width)),
  ...(quantity > 0 ? { quantity: Math.trunc(quantity) } : { quantity: undefined })
} : undefined;

const materializeOperationSnapshots = (
  input: ProductOperationsInput | undefined
) => {
  if (!input) {
    return {
      ok: true as const,
      appliedSubServices: [] as AppliedSubService[],
      finishings: [] as ContractProduct['finishings'],
      toolsCost: 0,
      finishingsCost: 0
    };
  }

  const calculation = calculateProductOperations(input);
  if (!calculation.ok) {
    return {
      ok: false as const,
      message: 'اطلاعات ابزار و پرداخت را بررسی و خطاهای مشخص‌شده را برطرف کنید'
    };
  }

  return {
    ok: true as const,
    appliedSubServices: calculation.result.tools.map(tool => ({
      id: tool.toolSelectionId,
      subServiceId: tool.catalogItemId,
      subService: {
        id: tool.catalogItemId,
        code: tool.catalogItemId,
        name: tool.name,
        namePersian: tool.name,
        pricePerMeter: Number(tool.rateToman),
        calculationBase:
          tool.unit === 'meter' ? 'length' as const : 'squareMeters' as const,
        isActive: !tool.outsideCurrentCatalog
      },
      meter: Number(tool.finalQuantity),
      cost: Number(tool.amountToman),
      calculationBase: tool.unit === 'meter' ? 'length' as const : 'squareMeters' as const,
      edges: Object.fromEntries((tool.edges || []).map(edge => [edge, true]))
    })),
    finishings: calculation.result.finishings.map(finishing => ({
      selectionId: finishing.finishingSelectionId,
      finishingId: finishing.catalogItemId,
      name: finishing.name,
      calculationBase:
        finishing.unit === 'meter' ? 'length' as const : 'squareMeters' as const,
      unitPrice: Number(finishing.rateToman),
      automaticQuantity: Number(finishing.automaticQuantity),
      quantity: Number(finishing.finalQuantity),
      quantityMode: finishing.quantityOverride ? 'manual' as const : 'auto' as const,
      overrideStatus: 'current' as const,
      cost: Number(finishing.amountToman)
    })),
    toolsCost: calculation.result.tools.reduce(
      (sum, tool) => sum + Number(tool.amountToman),
      0
    ),
    finishingsCost: calculation.result.finishings.reduce(
      (sum, finishing) => sum + Number(finishing.amountToman),
      0
    )
  };
};

const createStairOperationInput = (
  part: StairStepperPart,
  draft: StairPartDraftV2,
  productId: string
): ProductOperationsInput => ({
  policyVersion: 'calculation-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  productRowId: draft.operationPolicyInput?.productRowId || parseStableIdentity(
    'product-row',
    `stair-draft:${productId}:${part}`
  ),
  lengthMeters: parseCanonicalDecimal(String(getActualLengthMeters(draft))),
  widthMeters: parseCanonicalDecimal(String(Number(draft.widthCm || 0) / 100)),
  ...(Number.isSafeInteger(draft.quantity) && Number(draft.quantity) > 0
    ? { quantity: Number(draft.quantity) }
    : {}),
  groups: draft.operationPolicyInput?.groups ?? [],
  tools: draft.operationPolicyInput?.tools ?? [],
  finishings: draft.operationPolicyInput?.finishings ?? []
});

const createLayerSideOperationInput = (
  part: StairStepperPart,
  draft: StairPartDraftV2,
  side: 'front' | 'back' | 'left' | 'right',
  productId: string
): ProductOperationsInput => {
  const current = draft.layerSideOperations?.[side];
  const sideLengthMeters =
    side === 'front' || side === 'back'
      ? getActualLengthMeters(draft)
      : Number(draft.widthCm || 0) / 100;
  const quantity =
    Number(draft.quantity || 0) *
    Number(draft.numberOfLayersPerStair || 0);
  return normalizeAutomaticLayerOperationGroups({
    policyVersion: 'calculation-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    productRowId: current?.productRowId || parseStableIdentity(
      'product-row',
      `stair-layer-draft:${productId}:${part}:${
        draft.layerConfigurationDraftId || 'current'
      }:${side}`
    ),
    lengthMeters: parseCanonicalDecimal(String(sideLengthMeters)),
    widthMeters: parseCanonicalDecimal(
      String(Number(draft.layerWidthCm || 0) / 100)
    ),
    ...(Number.isSafeInteger(quantity) && quantity > 0 ? { quantity } : {}),
    groups: current?.groups ?? [],
    tools: current?.tools ?? [],
    finishings: current?.finishings ?? []
  }, quantity);
};

const cloneLayerOperationsForSide = (
  template: ProductOperationsInput,
  target: ProductOperationsInput,
  side: 'front' | 'back' | 'left' | 'right'
): ProductOperationsInput => {
  const scopedIdentity = (value: string) =>
    `${value.replace(/:layer-side:(front|back|left|right)$/, '')}:layer-side:${side}`;
  const groupIds = new Map(
    template.groups.map(group => [
      String(group.operationGroupId),
      parseStableIdentity(
        'operation-group',
        scopedIdentity(String(group.operationGroupId))
      )
    ])
  );
  return {
    ...target,
    groups: template.groups.map(group => ({
      ...group,
      operationGroupId: groupIds.get(String(group.operationGroupId))!
    })),
    tools: template.tools.map(tool => ({
      ...tool,
      toolSelectionId: parseStableIdentity(
        'tool-selection',
        scopedIdentity(String(tool.toolSelectionId))
      ),
      operationGroupId: groupIds.get(String(tool.operationGroupId))!
    })),
    finishings: template.finishings.map(finishing => ({
      ...finishing,
      finishingSelectionId: parseStableIdentity(
        'finishing-selection',
        scopedIdentity(String(finishing.finishingSelectionId))
      ),
      operationGroupId: groupIds.get(String(finishing.operationGroupId))!
    }))
  };
};

// Import all types from types file
import type {
  CrmCustomer,
  ProjectAddress,
  PhoneNumber,
  Product,
  StoneCut,
  RemainingStone,
  SlabStandardDimensionEntry,
  StonePartition,
  SubService,
  StoneFinishing,
  AppliedSubService,
  CuttingBreakdownEntry,
  ServiceEntry,
  StairPart,
  StairSystemConfig,
  ContractProduct,
  ContractServiceRow,
  ContractServiceRowSourceType,
  CuttingType,
  DeliveryProductItem,
  DeliverySchedule,
  PaymentEntry,
  PaymentMethod,
  PaymentInstallment,
  ContractStep8ProductDetail,
  ContractStep8ServiceDetail,
  ContractStep8DeliveryDetail,
  ContractStep8PaymentDetail,
  ContractStep8FinancialSummary,
  ContractWizardData,
  ContractKind,
  ContractUsageType,
  SlabLineCutPlan,
  WidthSlice,
  PartitionPositioningResult,
  PartitionValidationResult,
  StairStepperPart,
  UnitType,
  ToolSelectionV2,
  StairPartDraftV2,
  StairDraftFieldErrors,
  LayerTypeOption,
  LayerEdgeDemand
} from '@/features/contract-creation/types/contract.types';

interface DiscountRange {
  id: string;
  minAmount: number;
  maxAmount: number | null;
  maxDiscountPercent: number;
  isActive: boolean;
}

const getContractBaseSubtotal = (products: ContractProduct[]) =>
  sumNumericValues(products, (product) => {
    if ((product.meta as any)?.isLayer) return 0;
    const originalTotal = toFiniteNumber(product.originalTotalPrice);
    if (originalTotal > 0) return originalTotal;
    if (isPreparedProductType(product.productType)) return toFiniteNumber(product.totalPrice);
    return toFiniteNumber(product.squareMeters) * toFiniteNumber(product.pricePerSquareMeter);
  });

const LAYER_SHORTAGE_SOURCE_LABELS = {
  fullOrigin: 'سنگ کامل هم‌مبدا',
  manualWarehouse: 'ابعاد انبار',
  autoSuggested: 'محاسبه خودکار'
} as const;

const isStairLayerProduct = (product: ContractProduct | undefined): boolean =>
  Boolean(product && (product.meta as any)?.isLayer);

const isStairMainProduct = (product: ContractProduct | undefined): boolean =>
  Boolean(product && product.productType === 'stair' && !isStairLayerProduct(product));

const isGeneratedStairCutTool = (tool: any): boolean => {
  const toolId = String(tool?.toolId || tool?.id || '');
  return toolId.startsWith('cut-cross-') || toolId.startsWith('cut-longitudinal-');
};

const getAttachedLayerIndicesForStairRow = (
  products: ContractProduct[],
  parentIndex: number
): number[] => {
  const resolution = resolveAttachedStairLayers(products, parentIndex);
  return resolution.status === 'resolved' ? resolution.indices : [];
};

const getStairRowWithAttachedLayers = (
  products: ContractProduct[],
  parentIndex: number
): ContractProduct[] => {
  const parent = products[parentIndex];
  if (!parent) return [];
  const attachedLayerIndices = getAttachedLayerIndicesForStairRow(products, parentIndex);
  return [parent, ...attachedLayerIndices.map((index) => products[index]).filter(Boolean)];
};

const replaceStairRowWithAttachedLayers = (
  products: ContractProduct[],
  parentIndex: number,
  replacements: ContractProduct[]
): ContractProduct[] => {
  const attachedLayerIndices = getAttachedLayerIndicesForStairRow(products, parentIndex);
  const removedIndices = new Set([parentIndex, ...attachedLayerIndices]);
  const oldIndexToNewIndex = new Map<number, number>();
  let replacementStartIndex = -1;
  let replacementEndIndex = -1;
  const result: ContractProduct[] = [];

  products.forEach((product, index) => {
    if (index === parentIndex) {
      replacementStartIndex = result.length;
      replacements.forEach((replacement) => {
        result.push(replacement);
      });
      replacementEndIndex = result.length - 1;
      return;
    }

    if (removedIndices.has(index)) return;

    oldIndexToNewIndex.set(index, result.length);
    result.push(product);
  });

  return result.map((product, index) => {
    if (!isStairLayerProduct(product)) return product;

    if (index >= replacementStartIndex && index <= replacementEndIndex) {
      return {
        ...product,
        parentProductIndex: replacementStartIndex >= 0 ? replacementStartIndex : product.parentProductIndex
      };
    }

    if (typeof product.parentProductIndex === 'number' && oldIndexToNewIndex.has(product.parentProductIndex)) {
      return {
        ...product,
        parentProductIndex: oldIndexToNewIndex.get(product.parentProductIndex)
      };
    }

    return product;
  });
};

const findMatchingDiscountRange = (ranges: DiscountRange[], baseSubtotal: number) =>
  ranges
    .filter((range) => range.isActive)
    .find((range) => {
      const min = toFiniteNumber(range.minAmount);
      const max = range.maxAmount === null || range.maxAmount === undefined
        ? Number.POSITIVE_INFINITY
        : toFiniteNumber(range.maxAmount);
      return baseSubtotal >= min && baseSubtotal < max;
    }) || null;

interface CreateContractWizardProps {
  mode?: 'create' | 'edit';
  contractKind?: ContractKind;
  contractId?: string;
  initialWizardData?: ContractWizardData | null;
  initialContractStatus?: string | null;
}

const normalizeProductSearchText = (value: unknown): string =>
  normalizeDigits(String(value ?? ''))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .toLowerCase();

const productMatchesSearch = (
  product: Product,
  term: string,
  generatedName?: string
): boolean => {
  const searchTerms = normalizeProductSearchText(term).trim().split(/\s+/).filter(Boolean);
  if (searchTerms.length === 0) return true;

  const searchableFields = [
    product.code,
    product.namePersian,
    product.name,
    product.fullName,
    generatedName,
    product.cuttingDimensionNamePersian,
    product.stoneTypeNamePersian,
    product.widthName,
    product.thicknessName,
    product.mineNamePersian,
    product.finishNamePersian,
    product.colorNamePersian,
    product.qualityNamePersian,
    product.description,
    product.widthValue?.toString(),
    product.thicknessValue?.toString(),
    product.basePrice?.toString(),
    `${product.widthValue}×${product.thicknessValue}`,
    `عرض ${product.widthValue}×ضخامت ${product.thicknessValue}`
  ].filter(Boolean);

  const searchableText = normalizeProductSearchText(searchableFields.join(' '));
  return searchTerms.every((searchTerm) => searchableText.includes(searchTerm));
};

const uniqueProductsByIdentity = (items: Product[]): Product[] => {
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();

  return items.filter((item) => {
    if (item.id) {
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    }
    if (item.code) {
      if (seenCodes.has(item.code)) return false;
      seenCodes.add(item.code);
      return true;
    }
    return true;
  });
};

const sumRemainingStoneArea = (stones: RemainingStone[] | undefined): number =>
  (stones || []).reduce((sum, stone) => sum + toFiniteNumber(stone.squareMeters), 0);

const findRemainingStoneBalanceError = (products: ContractProduct[]): string | null => {
  for (const product of products) {
    const generatedCapacity = sumRemainingStoneArea(product.smartCutPlan?.remainingStones || []);
    const consumedArea = sumRemainingStoneArea(product.usedRemainingStones || []);
    if (generatedCapacity <= 0 || consumedArea <= 0) continue;

    const availableArea = sumRemainingStoneArea(product.remainingStones || []);
    const trackedArea = availableArea + consumedArea;
    if (trackedArea > generatedCapacity + 0.01) {
      const productName = product.stoneName || product.product?.namePersian || 'محصول';
      return `باقی‌مانده‌های "${productName}" با مصرف ثبت‌شده متعادل نیست. لطفاً ردیف‌های ساخته‌شده از باقی‌مانده را بررسی یا دوباره تنظیم کنید.`;
    }
  }

  return null;
};

export default function CreateContractWizard({
  mode = 'create',
  contractKind = 'standard',
  contractId,
  initialWizardData,
  initialContractStatus = null
}: CreateContractWizardProps = {}) {
  const router = useRouter();
  const isContractEditMode = mode === 'edit';

  const normalizeWizardStep = (step: number): number => {
    if (Number.isNaN(step)) return 1;
    if (step <= 3) return step;
    if (step === 4) return 4;
    return Math.max(1, Math.min(step - 1, WIZARD_STEPS.length));
  };

  // Use contract wizard hook for step management
  const {
    currentStep,
    setCurrentStep,
    wizardData,
    setWizardData,
    updateWizardData,
    errors: wizardErrors,
    setErrors: setWizardErrors,
    loading: wizardLoading,
    setLoading: setWizardLoading,
    customerSearchTerm,
    setCustomerSearchTerm,
    productSearchTerm,
    setProductSearchTerm,
    stateRestored,
    setStateRestored,
    restorationAttempted
  } = useContractWizard();

  // Use wizard state, but allow local overrides if needed
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [autosaveHydrated, setAutosaveHydrated] = useState(false);
  const [discountRanges, setDiscountRanges] = useState<DiscountRange[]>([]);
  const [discountPercentInput, setDiscountPercentInput] = useState<number>(0);
  const [serviceSearchTerm, setServiceSearchTerm] = useState('');
  const [serviceSourceType, setServiceSourceType] = useState<ContractServiceRowSourceType>('tool');
  const [productSaveFeedback, setProductSaveFeedback] = useState<{
    id: number;
    mode: 'created' | 'edited';
    rowId?: string;
  } | null>(null);
  const productSaveFeedbackIdRef = useRef(0);
  const publishProductSaveFeedback = useCallback((
    mode: 'created' | 'edited',
    rowId?: string
  ) => {
    productSaveFeedbackIdRef.current += 1;
    setProductSaveFeedback({
      id: productSaveFeedbackIdRef.current,
      mode,
      rowId
    });
  }, []);
  const expireProductSaveFeedback = useCallback((id: number) => {
    setProductSaveFeedback(current => current?.id === id ? null : current);
  }, []);
  const effectiveContractKind = wizardData.contractKind || contractKind;
  const isCollaborationContract = effectiveContractKind === 'collaboration';
  const baseVisibleWizardSteps = useMemo(
    () => WIZARD_STEPS.filter((step) => !isCollaborationContract || step.id !== 3),
    [isCollaborationContract]
  );

  useEffect(() => {
    if (isContractEditMode) return;
    if (wizardData.contractKind === contractKind) return;
    updateWizardData({ contractKind });
  }, [contractKind, isContractEditMode, updateWizardData, wizardData.contractKind]);

  useEffect(() => {
    if (isCollaborationContract && currentStep === 3) {
      setCurrentStep(4);
    }
  }, [currentStep, isCollaborationContract, setCurrentStep]);

  // Stair stepper v2 states are now provided by useStairSystemV2 hook
  const stairSystemV2 = useStairSystemV2({
    onError: (error) => setErrors({ stairSystem: error })
  });
  const [stairQuantityDraft, setStairQuantityDraft] =
    useState<StairQuantityInputDraft>({
      mode: 'steps',
      totalSteps: '',
      numberOfStaircases: '',
      stepsPerStaircase: ''
    });
  const [stairQuantityManuallyEdited, setStairQuantityManuallyEdited] = useState({
    tread: false,
    riser: false
  });
  const [
    stairDiscardConfirmationVisible,
    setStairDiscardConfirmationVisible
  ] = useState(false);

  const updateStairQuantityDraft = useCallback((next: StairQuantityInputDraft) => {
    setStairQuantityDraft(next);
    try {
      const totalSteps = resolveStaircaseQuantity(
        toStaircaseQuantityIntent(next)
      ).totalSteps;
      if (!stairQuantityManuallyEdited.tread) {
        stairSystemV2.setDraftTread(current => ({
          ...current,
          quantity: totalSteps
        }));
      }
      if (!stairQuantityManuallyEdited.riser) {
        stairSystemV2.setDraftRiser(current => ({
          ...current,
          quantity: totalSteps
        }));
      }
    } catch {
      // Incomplete staircase quantity stays in the draft without overwriting parts.
    }
  }, [
    stairQuantityManuallyEdited.riser,
    stairQuantityManuallyEdited.tread,
    stairSystemV2
  ]);

  // Layer management functions are now provided by useStairLayerManagement hook
  const layerManagement = useStairLayerManagement({
    getDraftByPart: stairSystemV2.getDraftByPart
  });

  // Memoized error handler to prevent infinite loop
  const handleDataLoadingError = useCallback((error: string) => {
    setErrors({ general: error });
  }, []);

  // Data loading is now provided by useDataLoading hook
  const dataLoading = useDataLoading({
    autoLoad: !stateRestored, // Only auto-load if not restoring from localStorage
    onError: handleDataLoadingError
  });

  // Extract data from dataLoading hook
  const {
    customers,
    products,
    departments,
    cuttingTypes,
    subServices,
    stoneFinishings,
    stoneFinishingLoadState,
    userDepartment,
    currentUser,
    capabilities,
    setCustomers,
    setProducts,
    setDepartments,
    setCuttingTypes,
    setSubServices,
    setStoneFinishings,
    loadCustomers,
    loadInitialData: loadData,
    getCuttingTypePricePerMeter
  } = dataLoading;
  const sellerProductHistory = useSellerProductHistory(
    currentUser?.id || currentUser?.username || null
  );

  const customerOptions = useMemo(
    () => isCollaborationContract
      ? customers.filter((customer) => customer.customerType === 'Collaborative')
      : customers,
    [customers, isCollaborationContract]
  );

  const discountBaseSubtotal = useMemo(
    () => getContractBaseSubtotal(wizardData.products),
    [wizardData.products]
  );
  const matchingDiscountRange = useMemo(
    () => findMatchingDiscountRange(discountRanges, discountBaseSubtotal),
    [discountRanges, discountBaseSubtotal]
  );
  const maxDiscountPercent = matchingDiscountRange
    ? toFiniteNumber(matchingDiscountRange.maxDiscountPercent)
    : 0;
  const appliedDiscountPercent = Math.min(Math.max(toFiniteNumber(discountPercentInput), 0), maxDiscountPercent);
  const appliedDiscountAmount = discountBaseSubtotal > 0
    ? discountBaseSubtotal * (appliedDiscountPercent / 100)
    : 0;
  const deliverableProductEntries = useMemo(
    () => getDeliverableProductEntries(wizardData.products),
    [wizardData.products]
  );
  const schedulableServiceEntries = useMemo(
    () => getSchedulableServiceEntries(wizardData.serviceRows || []),
    [wizardData.serviceRows]
  );
  const hasAnyContractRows = wizardData.products.length > 0 || (wizardData.serviceRows || []).length > 0;
  const shouldSkipDeliveryStep = hasAnyContractRows && deliverableProductEntries.length === 0 && schedulableServiceEntries.length === 0;
  const visibleWizardSteps = useMemo(
    () => baseVisibleWizardSteps.filter((step) => !shouldSkipDeliveryStep || step.id !== 5),
    [baseVisibleWizardSteps, shouldSkipDeliveryStep]
  );
  const visibleCurrentStep = Math.max(
    1,
    (visibleWizardSteps.findIndex((step) => step.id === currentStep) >= 0
      ? visibleWizardSteps.findIndex((step) => step.id === currentStep)
      : 0) + 1
  );
  const isContractCreationComplete =
    !isContractEditMode &&
    currentStep === 7 &&
    !!wizardData.signature?.contractId;

  useEffect(() => {
    if (shouldSkipDeliveryStep && currentStep === 5) {
      setCurrentStep(6);
    }
  }, [currentStep, setCurrentStep, shouldSkipDeliveryStep]);
  const grossContractTotal = getContractGrossPayableTotal(wizardData.products, wizardData.serviceRows || []);
  const payableContractTotal = Math.max(grossContractTotal - appliedDiscountAmount, 0);

  useEffect(() => {
    let isMounted = true;
    salesAPI.getDiscountRanges({ activeOnly: true })
      .then((response) => {
        if (isMounted && response.data.success) {
          setDiscountRanges(response.data.data || []);
        }
      })
      .catch((error) => {
        console.error('Failed to load discount ranges:', error);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (discountPercentInput > maxDiscountPercent) {
      setDiscountPercentInput(maxDiscountPercent);
    }
  }, [discountPercentInput, maxDiscountPercent]);

  useEffect(() => {
    const discountSnapshot = appliedDiscountPercent > 0 && matchingDiscountRange
      ? {
          enabled: true,
          rangeId: matchingDiscountRange.id,
          rangeMinAmount: matchingDiscountRange.minAmount,
          rangeMaxAmount: matchingDiscountRange.maxAmount,
          maxDiscountPercent,
          baseSubtotal: discountBaseSubtotal,
          percent: appliedDiscountPercent,
          amount: appliedDiscountAmount,
          currency: 'تومان',
          appliedAt: new Date().toISOString()
        }
      : null;

    setWizardData(prev => ({
      ...prev,
      discount: discountSnapshot,
      payment: {
        ...prev.payment,
        totalContractAmount: payableContractTotal
      }
    }));
  }, [
    appliedDiscountAmount,
    appliedDiscountPercent,
    discountBaseSubtotal,
    matchingDiscountRange,
    maxDiscountPercent,
    payableContractTotal,
    setWizardData
  ]);

  useEffect(() => {
    if (!capabilities.canLoadCustomers) return;

    const search = customerSearchTerm.trim();
    const timeoutId = window.setTimeout(() => {
      loadCustomers({
        limit: search ? 20 : 3,
        search: search || undefined
      });
    }, search ? 300 : 0);

    return () => window.clearTimeout(timeoutId);
  }, [capabilities.canLoadCustomers, customerSearchTerm, loadCustomers]);

  // Delivery step state is now provided by useDeliverySchedule hook
  const deliverySchedule = useDeliverySchedule(wizardData.products);

  // Digital Signature (Step 8) state is now provided by useDigitalSignature hook
  const digitalSignature = useDigitalSignature({
    onError: (error) => setErrors({ signature: error }),
    onSuccess: () => undefined
  });
  const [pdfActionLoading, setPdfActionLoading] = useState(false);
  const [printActionLoading, setPrintActionLoading] = useState(false);

  // NOTE: Layer session items sync is now handled internally by useStairSystemV2 hook
  // The hook has its own useEffect that syncs when drafts change

  // hasLayerEdgeSelection and deriveLayerEdgesFromTools are now imported from stairSystemHelpers

  // Layer types loading is now handled by useStairSystemV2 hook

  // Ensure stair drafts always use original product thickness (قطر)
  // Thickness sync effects are now handled by useStairSystemV2 hook

  // stairSystemV2.ensureStairSessionId is now provided by useStairSystemV2 hook

  const getActiveDraft = (): [
    StairPartDraftV2,
    React.Dispatch<React.SetStateAction<StairPartDraftV2>>
  ] => {
    if (stairSystemV2.stairActivePart === 'tread') return [stairSystemV2.draftTread, stairSystemV2.setDraftTread];
    if (stairSystemV2.stairActivePart === 'riser') return [stairSystemV2.draftRiser, stairSystemV2.setDraftRiser];
    return [stairSystemV2.draftLanding, stairSystemV2.setDraftLanding];
  };

  // getPartDisplayLabel, getProductCuttingCost, getProductServiceCost are now imported from stairSystemHelpers
  // validateDraftNumericFields, validateDraftRequiredFields, clearDraftFieldError are now imported from stairValidationService

  // Wrapper for clearDraftFieldError with stairSystemV2 state
  const clearDraftFieldErrorWrapper = (part: StairStepperPart, field: keyof StairDraftFieldErrors) => {
    stairSystemV2.setStairDraftErrors(prev => ({
      ...prev,
      [part]: {
        ...prev[part],
        [field]: undefined
      }
    }));
    setErrors(prev => {
      if (!prev.products) return prev;
      const { products, ...rest } = prev;
      return rest;
    });
  };

  const calculateStairStoneUsage = (draft: StairPartDraftV2) => {
    const originalWidthCm = draft.stoneProduct?.widthValue || 0;
    const userWidthCm = draft.widthCm || 0;
    const quantity = draft.quantity || 0;
    const sawKerfCm = draft.sawKerfEnabled && userWidthCm > 0 && userWidthCm < originalWidthCm
      ? (draft.sawKerfCm || SAW_KERF_CM)
      : 0;
    const consumedPieceWidthCm = userWidthCm + sawKerfCm;

    let piecesPerStone = 1;
    let leftoverWidthCm = 0;
    let remainingStoneQuantity = 0;

    if (originalWidthCm > 0 && userWidthCm > 0) {
      piecesPerStone = Math.max(1, Math.floor(originalWidthCm / consumedPieceWidthCm));
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
      const leftoverFromFullSourceWidth = Math.max(0, originalWidthCm - piecesPerStone * consumedPieceWidthCm);
      const leftoverFromPartialSourceWidth = remainingRequestedPieces > 0
        ? Math.max(0, originalWidthCm - remainingRequestedPieces * consumedPieceWidthCm)
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

  const formatStairRemainingGroups = (
    groups: Array<{ widthCm: number; quantity: number }> = []
  ): string =>
    groups
      .filter(group => group.widthCm > 0 && group.quantity > 0)
      .map(group => `${formatDisplayNumber(group.quantity)} عدد با عرض ${formatDisplayNumber(group.widthCm)}cm`)
      .join('، ');

  const hasLengthMeasurement = (draft: StairPartDraftV2): boolean => {
    if (draft.lengthValue && draft.lengthValue > 0) return true;
    return getDraftStandardLengthMeters(draft) > 0;
  };

  const computeSqmV2 = (draft: StairPartDraftV2): number => {
    const lengthM = getActualLengthMeters(draft);
    const widthM = (draft.widthCm || 0) / 100;
    const qty = draft.quantity || 0;
    const sqm = lengthM * widthM * qty;
    return Number.isFinite(sqm) ? sqm : 0;
  };


  const computeToolMetersForTool = (_part: StairStepperPart, draft: StairPartDraftV2, tool: ToolSelectionV2): number => {
    const lengthM = getActualLengthMeters(draft);
    const widthM = (draft.widthCm || 0) / 100;
    const qty = draft.quantity || 0;
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
    return meters * qty;
  };

  const computeToolsMetersV2 = (part: StairStepperPart, draft: StairPartDraftV2): number => {
    if (!draft.tools || draft.tools.length === 0) return 0;
    return draft.tools.reduce((sum, tool) => sum + computeToolMetersForTool(part, draft, tool), 0);
  };

  // 🎯 Calculate total layer length per stair (sum of all selected edge lengths)
  // This is used for layer type cost calculation: total length per stair × number of stairs × layer type price per meter
  // Example: front (0.26m) + left (1.22m) = 1.48m per stair

type LayerEdgeDemand = {
  edge: 'front' | 'back' | 'left' | 'right' | 'perimeter';
  layersNeeded: number;
  lengthM: number;
};

const getLayerEdgeDemands = (_part: StairStepperPart, draft: StairPartDraftV2): LayerEdgeDemand[] => {
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

  // ============================================================================
  // 🎯 LAYER PRODUCT HELPER FUNCTIONS - Refactored for clarity and reliability
  // ============================================================================

  /**
   * Find an existing layer product with the same configuration
   * Same configuration = same parent part, same edges, same dimensions, same layers per stair
   */
  const findExistingLayerProduct = (
    sessionItems: ContractProduct[],
    draft: StairPartDraftV2,
    parentPartType: StairStepperPart,
    parentProductIndexInSession: number
  ): ContractProduct | null => {
    if (!draft.layerEdges || !draft.layerWidthCm || !draft.numberOfLayersPerStair) {
      return null;
    }

    return sessionItems.find(item => {
      const itemIsLayer = ((item.meta as any)?.isLayer) || false;
      if (!itemIsLayer) return false;

      const itemLayerInfo = (item.meta as any)?.layerInfo;
      const itemLayerEdges = (item.meta as any)?.layerEdges;

      if (itemLayerInfo?.parentProductIndexInSession !== parentProductIndexInSession) return false;

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
   * Excludes already used remaining stones
   */
  const collectAvailableRemainingStones = (
    sessionItems: ContractProduct[],
    currentProductRemainingStones: RemainingStone[]
  ): RemainingStone[] => {
    const allAvailable: RemainingStone[] = [];

    // Collect from all non-layer products in session (including longitudinal and slab)
    sessionItems.forEach(item => {
      const itemIsLayer = ((item.meta as any)?.isLayer) || false;
      if (!itemIsLayer && item.remainingStones && item.remainingStones.length > 0) {
        allAvailable.push(...getAvailableRemainingStoneInventory(item));
      }
    });

    // Also include remaining stones from the current product (if any)
    currentProductRemainingStones.forEach(rs => {
      const sanitizedStone = sanitizeRemainingStoneEntry(rs);
      if (isUsableRemainingStone(sanitizedStone)) {
        allAvailable.push(sanitizedStone);
      }
    });

    return normalizeRemainingStoneCollection(allAvailable).filter(isUsableRemainingStone);
  };

  const remainingStoneLineageKeys = (stone: RemainingStone): string[] => {
    const keys = [stone.id, stone.sourceCutId].filter(
      (value): value is string => Boolean(value)
    );
    const layerSourceMatch = stone.id.match(/^used_layer_(.*)_\d+$/);
    if (layerSourceMatch?.[1]) keys.push(layerSourceMatch[1]);
    return keys;
  };

  useEffect(() => {
    if (currentStep !== 5 || !wizardData.products.length) return;

    const normalizedProducts = wizardData.products.map(product => ({
      ...product,
      remainingStones: normalizeRemainingStoneCollection(product.remainingStones || [])
    }));

    const hasChanges = wizardData.products.some((product, index) => {
      const before = product.remainingStones || [];
      const after = normalizedProducts[index].remainingStones || [];
      if (before.length !== after.length) return true;

      for (let i = 0; i < before.length; i++) {
        const b = before[i];
        const a = after[i];
        if (
          b.id !== a.id ||
          b.width !== a.width ||
          b.length !== a.length ||
          b.squareMeters !== a.squareMeters ||
          (b.quantity || 0) !== (a.quantity || 0) ||
          b.isAvailable !== a.isAvailable
        ) {
          return true;
        }
      }

      return false;
    });

    if (hasChanges) {
      updateWizardData({ products: normalizedProducts });
    }
  }, [currentStep, wizardData.products, updateWizardData]);

  /**
   * Calculate layer metrics: how many layers from remaining stones vs new stones,
   * cutting costs, and used remaining stones
   */
  const calculateLayerMetrics = (params: {
    totalLayers: number;
    layerWidthCm: number;
    layerLengthM: number;
    availableRemainingStones: RemainingStone[];
    cuttingCostPerMeter: number;
    edgeDemands?: LayerEdgeDemand[];
    sawKerfEnabled?: boolean;
    sawKerfCm?: number;
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
    longitudinalCuttingMeters?: number;
    crossCuttingMeters?: number;
  } => {
    const {
      totalLayers,
      layerWidthCm,
      layerLengthM,
      availableRemainingStones,
      edgeDemands
    } = params;
    const layerKerfCm = params.sawKerfEnabled ? (params.sawKerfCm || SAW_KERF_CM) : 0;

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
      const columnsPerStone = Math.floor(stone.width / (layerWidthCm + layerKerfCm));
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

      const leftoverWidth = stone.width - (columnsPerStone * (layerWidthCm + layerKerfCm));
      if (leftoverWidth > 0) {
        residualWidthPieces.push({
          id: `layer_width_leftover_${stone.id}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
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
    const usedColumnIds = new Set<string>();
    let crossCuttingMeters = 0;
    const unfulfilledDemands: Array<{ edge: LayerEdgeDemand['edge']; lengthM: number; quantity: number }> = [];

    const canUseRemainingForEdge = (_edge: LayerEdgeDemand['edge']) => true;

    sortedDemands.forEach(demand => {
      let needed = demand.layersNeeded;
      totalLayerDemand += demand.layersNeeded;

      if (canUseRemainingForEdge(demand.edge)) {
        for (const column of columns) {
          if (needed <= 0) break;
          if (column.lengthRemaining + 1e-6 < demand.lengthM) continue;

          let used = 0;
          while (needed > 0 && column.lengthRemaining + 1e-6 >= demand.lengthM) {
            const needsCrossCut = demand.lengthM + 1e-6 < column.lengthRemaining;
            const consumedLength = demand.lengthM + (needsCrossCut ? layerKerfCm / 100 : 0);
            if (column.lengthRemaining + 1e-6 < consumedLength) break;
            column.lengthRemaining = Math.max(0, column.lengthRemaining - consumedLength);
            if (needsCrossCut) crossCuttingMeters += widthMeters;
            needed -= 1;
            used += 1;
            layersFromRemainingStones += 1;
            squareMetersFromRemaining += demand.lengthM * widthMeters;
            usedColumnIds.add(column.id);
          }
          if (used > 0) {
            usageEntries.push({ source: column.source, lengthM: demand.lengthM, quantity: used });
          }
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
      unfulfilledDemands,
      longitudinalCuttingMeters: columns
        .filter((column) => usedColumnIds.has(column.id))
        .reduce((sum, column) => sum + column.originalLength, 0),
      crossCuttingMeters
    };
  };

  /**
   * Create a new layer product
   */

  const computeLegacyTotalsV2 = (
    part: StairStepperPart,
    draft: StairPartDraftV2
  ): {
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

    // 🎯 CRITICAL: Use original width for pricing (like long stone products)
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
        (draft.stoneProduct as any)?.cuttingCostPerMeter ??
        getCuttingTypePricePerMeter('LONG') ??
        0;
      if (cuttingCostPerMeterLongitudinal > 0) {
        cuttingCostLongitudinal = cuttingCostPerMeterLongitudinal * cuttingMetersLongitudinal;
      }
    }

    if (needsLengthCut && stoneQuantityForPricing > 0) {
      const crossRateFromConfig =
        (draft.stoneProduct as any)?.crossCuttingCostPerMeter ??
        getCuttingTypePricePerMeter('CROSS') ??
        getCuttingTypePricePerMeter('LONG') ??
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

    // Mandatory/Hukmi stone still bills longitudinal cutting. Cross cutting is
    // the only free cutting service under ADR-0012.
    const mandatoryCuttingPolicy = isMandatoryEnabled && mandatoryPercentageValue > 0;
    const billableCuttingCostLongitudinal = cuttingCostLongitudinal;
    const billableCuttingCostCross = mandatoryCuttingPolicy ? 0 : cuttingCostCross;
    const billableCuttingCost = billableCuttingCostLongitudinal + billableCuttingCostCross;

    const partTotal = materialPriceWithMandatory + toolsPrice + billableCuttingCost;
    return {
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
      shouldChargeCuttingCost: billableCuttingCost > 0
    };
  };

  const computeTotalsV2 = (
    part: StairStepperPart,
    draft: StairPartDraftV2
  ) => computeCanonicalStairTotalsV2(
    part,
    draft,
    getCuttingTypePricePerMeter
  );

  const stairConflictMessage = (
    code: string,
    motherLength?: number | null,
    field?: string
  ) => {
    if (code === 'stair-mother-dimensions-required') {
      return 'عرض مادر در موجودی ثبت نشده است';
    }
    if (code === 'stair-maximum-mother-length-exceeded') {
      return `حداکثر طول این سنگ ${formatDisplayNumber(motherLength || 0)} متر است`;
    }
    if (code === 'stair-maximum-mother-width-exceeded') {
      return 'بعد عرضی از عرض مادر سنگ بیشتر است';
    }
    if (code === 'stair-price-required') return 'قیمت را وارد کنید';
    if (code === 'stair-cut-rate-missing') {
      return field?.includes('cross')
        ? 'نرخ برش عرضی در موجودی ثبت نشده است'
        : 'نرخ برش طولی در موجودی ثبت نشده است';
    }
    if (code === 'stair-quantity-required') return 'تعداد را وارد کنید';
    return 'ابعاد را کامل کنید';
  };

  const focusCalculationError = (targetId: string) => {
    requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.focus({ preventScroll: true });
    });
  };

  const computeFinishingCost = (
    draft: StairPartDraftV2,
    pricingSquareMeters: number
  ): number => {
    if (!draft.finishingEnabled || !draft.finishingId) {
      return 0;
    }
    const unitPrice = toFiniteNumber(draft.finishingUnitPrice) || toFiniteNumber(draft.finishingPricePerSquareMeter);
    const calculationBase = draft.finishingCalculationBase === 'length' ? 'length' : 'squareMeters';
    const defaultQuantity = calculateDefaultFinishingQuantity({
      calculationBase,
      productType: 'stair',
      length: draft.lengthValue,
      lengthUnit: draft.lengthUnit || 'm',
      quantity: draft.quantity,
      squareMeters: pricingSquareMeters
    });
    const rawQuantity = toFiniteNumber(draft.finishingQuantity) || defaultQuantity;
    const quantity = calculationBase === 'squareMeters' && defaultQuantity > 0
      ? Math.min(rawQuantity, defaultQuantity)
      : rawQuantity;
    if (quantity <= 0 || unitPrice <= 0) return 0;
    return calculateFinishingCost(quantity, unitPrice);
  };

  const normalizeWizardFinishingProducts = (data: ContractWizardData): ContractWizardData => {
    const restoredProducts = (data.products || []).map((savedProduct) => {
      const product = restoreLongitudinalCustomerRequest(savedProduct);
      const finishing = normalizeProductFinishing(product);
      if (!finishing) return product;
      return {
        ...product,
        finishingCalculationBase: product.finishingCalculationBase || finishing.calculationBase,
        finishingUnitPrice: product.finishingUnitPrice ?? finishing.unitPrice,
        finishingQuantity: product.finishingQuantity ?? finishing.quantity,
        finishingPricePerSquareMeter: product.finishingPricePerSquareMeter ?? finishing.unitPrice,
        finishingSquareMeters:
          product.finishingSquareMeters ??
          (finishing.calculationBase === 'squareMeters' ? finishing.quantity : null),
        finishingCost: product.finishingCost ?? finishing.cost
      };
    });
    const products = normalizeContractProductRowIdentities(restoredProducts).products;
    const deliveryReferences = reconcileDeliveryProductReferences(products, data.deliveries || []);
    return {
      ...data,
      serviceRows: data.serviceRows || [],
      products,
      deliveries: deliveryReferences.deliveries
    };
  };

  useEffect(() => {
    if (!isContractEditMode || !initialWizardData) return;
    setWizardData(normalizeWizardFinishingProducts({
      ...initialWizardData,
      contractKind: initialWizardData.contractKind || 'standard',
      customerId: initialWizardData.customerId || initialWizardData.customer?.id || '',
      projectId: initialWizardData.projectId || initialWizardData.project?.id || '',
      selectedProductTypeForAddition: initialWizardData.selectedProductTypeForAddition || null,
      signature: {
        ...(initialWizardData.signature || {
          phoneNumber: null,
          contractId: contractId || null,
          contractStatus: initialContractStatus || null,
          confirmationSent: false,
          confirmationStatus: null,
          linkExpiresAt: null,
          otpExpiresAt: null,
          attemptsUsed: 0,
          maxAttempts: 5,
          resendCount: 0,
          lastSentAt: null,
          lastOpenedAt: null
        }),
        contractId: contractId || initialWizardData.signature?.contractId || null,
        contractStatus: initialContractStatus || initialWizardData.signature?.contractStatus || null
      }
    }));
    setCurrentStep(1);
    setStateRestored(true);
    setAutosaveHydrated(true);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CONTRACT_DRAFT_STORAGE_KEY);
      localStorage.removeItem('contractWizardState');
    }
  }, [isContractEditMode, initialWizardData, contractId, initialContractStatus]);

  const resolveFinishingSnapshot = ({
    enabled,
    selectedFinishing,
    config,
    productType,
    length,
    lengthUnit,
    quantity,
    squareMeters
  }: {
    enabled: boolean;
    selectedFinishing?: StoneFinishing;
    config: any;
    productType: ContractProduct['productType'];
    length?: number | null;
    lengthUnit?: 'cm' | 'm' | null;
    quantity?: number | null;
    squareMeters?: number | null;
  }) => {
    if (!enabled || !config?.finishingId) {
      return {
        calculationBase: null,
        unitPrice: null,
        quantity: null,
        cost: 0,
        requestedQuantity: null,
        maximumQuantity: null,
        exceedsGeometry: false
      };
    }

    const calculationBase =
      config.finishingCalculationBase ||
      getFinishingCalculationBase(selectedFinishing);
    const unitPrice =
      toFiniteNumber(config.finishingUnitPrice) ||
      toFiniteNumber(config.finishingPricePerSquareMeter) ||
      getFinishingUnitPrice(selectedFinishing);
    const defaultQuantity = calculateDefaultFinishingQuantity({
      calculationBase,
      productType,
      length,
      lengthUnit,
      quantity,
      squareMeters
    });
    const rawFinishingQuantity = toFiniteNumber(config.finishingQuantity) || defaultQuantity;
    const finishingQuantity = calculationBase === 'squareMeters' && defaultQuantity > 0
      ? Math.min(rawFinishingQuantity, defaultQuantity)
      : rawFinishingQuantity;
    const cost = unitPrice > 0 && finishingQuantity > 0
      ? calculateFinishingCost(finishingQuantity, unitPrice)
      : 0;

    return {
      calculationBase,
      unitPrice,
      quantity: finishingQuantity,
      cost,
      requestedQuantity: rawFinishingQuantity,
      maximumQuantity: defaultQuantity,
      exceedsGeometry: defaultQuantity > 0 && rawFinishingQuantity > defaultQuantity + 0.000001
    };
  };

  // Debounced stone search using products endpoint (acts as master data + price source)
  useEffect(() => {
    let active = true;
    const term = stairSystemV2.stoneSearchTerm?.trim();
    if (!term) {
      stairSystemV2.setStoneSearchResults([]);
      return;
    }
    stairSystemV2.setIsSearchingStones(true);
    const timeout = setTimeout(async () => {
      try {
        const [stairResponse, longitudinalResponse] = await Promise.all([
          salesAPI.getProducts({ search: term, limit: 10, contractType: 'stair' }),
          salesAPI.getProducts({
            search: term,
            limit: 10,
            contractType: 'longitudinal'
          })
        ]);
        if (!active) return;
        const rawItems: Product[] = [
          ...(stairResponse?.data?.items || stairResponse?.data?.data || []),
          ...(longitudinalResponse?.data?.items ||
            longitudinalResponse?.data?.data ||
            [])
        ] as Product[];

        const localFallbackProducts = products.filter(product =>
          productSupportsContractRoute(product, 'stair') &&
          productMatchesSearch(product, term, generateFullProductName(product))
        );
        const uniqueProducts = uniqueProductsByIdentity([...rawItems, ...localFallbackProducts]);
        const stairEligibleProducts = uniqueProducts.filter(product =>
          productSupportsContractRoute(product, 'stair')
        );
        stairSystemV2.setStoneSearchResults(stairEligibleProducts);
      } catch (e) {
        console.error('Stone search failed', e);
        if (active) stairSystemV2.setStoneSearchResults([]);
      } finally {
        if (active) stairSystemV2.setIsSearchingStones(false);
      }
    }, 300);
    return () => { active = false; clearTimeout(timeout); };
  }, [stairSystemV2.stoneSearchTerm, products]);

  useEffect(() => {
    let active = true;
    const term = stairSystemV2.layerStoneSearchTerm?.trim();
    if (!term) {
      stairSystemV2.setLayerStoneSearchResults([]);
      return;
    }
    stairSystemV2.setIsSearchingLayerStones(true);
    const timeout = setTimeout(async () => {
      try {
        const [stairResponse, longitudinalResponse] = await Promise.all([
          salesAPI.getProducts({ search: term, limit: 10, contractType: 'stair' }),
          salesAPI.getProducts({
            search: term,
            limit: 10,
            contractType: 'longitudinal'
          })
        ]);
        if (!active) return;
        const rawItems: Product[] = [
          ...(stairResponse?.data?.items || stairResponse?.data?.data || []),
          ...(longitudinalResponse?.data?.items ||
            longitudinalResponse?.data?.data ||
            [])
        ] as Product[];
        const localFallbackProducts = products.filter(product =>
          productSupportsContractRoute(product, 'stair') &&
          productMatchesSearch(product, term, generateFullProductName(product))
        );
        const stairEligible = uniqueProductsByIdentity([...rawItems, ...localFallbackProducts])
          .filter(product => productSupportsContractRoute(product, 'stair'));
        stairSystemV2.setLayerStoneSearchResults(stairEligible);
      } catch (e) {
        console.error('Layer stone search failed', e);
        if (active) stairSystemV2.setLayerStoneSearchResults([]);
      } finally {
        if (active) stairSystemV2.setIsSearchingLayerStones(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [stairSystemV2.layerStoneSearchTerm, products]);

  // Debounced tools search
  useEffect(() => {
    let active = true;
    const term = stairSystemV2.toolsSearchTerm?.trim();
    if (!capabilities.canLoadSubServices) {
      stairSystemV2.setToolsResults([]);
      stairSystemV2.setIsSearchingTools(false);
      return;
    }
    // If no term, load top tools (initial list) instead of clearing
    stairSystemV2.setIsSearchingTools(true);
    const timeout = setTimeout(async () => {
      try {
        const params: any = { isActive: true, limit: 1000 };
        if (term) params.search = term;
        const res = await servicesAPI.getSubServices(params);
        if (!active) return;
        const items = res?.data?.items || res?.data?.data || [];
        stairSystemV2.setToolsResults(items);
      } catch (e) {
        console.error('Tools search failed', e);
        if (active) stairSystemV2.setToolsResults([]);
      } finally {
        if (active) stairSystemV2.setIsSearchingTools(false);
      }
    }, 300);
    return () => { active = false; clearTimeout(timeout); };
  }, [stairSystemV2.toolsSearchTerm, capabilities.canLoadSubServices]);

  // Preload tools list once when modal flow is used
  useEffect(() => {
    if (!capabilities.canLoadSubServices) {
      stairSystemV2.setToolsResults([]);
      return;
    }
    (async () => {
      try {
        const res = await servicesAPI.getSubServices({ isActive: true, limit: 1000 });
        const items = res?.data?.items || res?.data?.data || [];
        stairSystemV2.setToolsResults(items);
      } catch (e) {
        console.error('Initial tools preload failed', e);
      }
    })();
  }, [capabilities.canLoadSubServices]);

  // Product modal state is now managed by useProductModal hook (see above)


  // Payment entry modal state is now provided by usePaymentHandlers hook

  // Stair stone specific state (old - keeping for backward compatibility during transition)
  const [treadWidthUnit, setTreadWidthUnit] = useState<'cm' | 'm'>('m'); // Default to meters for tread width

  // Product modal state (mandatory, quantity, touched fields, stair system) is now managed by useProductModal hook

  // Helper function to initialize stair system config
  const initializeStairSystemConfig = (defaultProduct: Product | null): StairSystemConfig => {
    return {
      numberOfSteps: 0,
      quantityType: 'steps',
      numberOfStaircases: 1,
      defaultProduct: defaultProduct,
      tread: {
        partType: 'tread',
        isSelected: false,
        productId: defaultProduct?.id || null,
        product: defaultProduct,
        treadWidth: 0,
        treadDepth: 30,
        quantity: 0,
        squareMeters: 0,
        pricePerSquareMeter: defaultProduct?.basePrice || 0,
        totalPrice: 0,
        nosingType: 'none',
        nosingOverhang: 30,
        nosingCuttingCost: 0,
        nosingCuttingCostPerMeter: 0,
        isMandatory: false,
        mandatoryPercentage: 20,
        originalTotalPrice: 0,
        description: '',
        currency: 'تومان',
        lengthUnit: 'm'
      },
      riser: {
        partType: 'riser',
        isSelected: false,
        productId: defaultProduct?.id || null,
        product: defaultProduct,
        riserHeight: 17,
        quantity: 0,
        squareMeters: 0,
        pricePerSquareMeter: defaultProduct?.basePrice || 0,
        totalPrice: 0,
        isMandatory: true,
        mandatoryPercentage: 20,
        originalTotalPrice: 0,
        description: '',
        currency: 'تومان'
      },
      landing: {
        partType: 'landing',
        isSelected: false,
        productId: defaultProduct?.id || null,
        product: defaultProduct,
        landingWidth: 0,
        landingDepth: 0,
        numberOfLandings: 0,
        quantity: 0,
        squareMeters: 0,
        pricePerSquareMeter: defaultProduct?.basePrice || 0,
        totalPrice: 0,
        isMandatory: true,
        mandatoryPercentage: 20,
        originalTotalPrice: 0,
        description: '',
        currency: 'تومان'
      }
    };
  };

  // Helper functions are now provided by useProductModal and useProductCalculations hooks
  // Remaining stone modal state is now provided by useRemainingStoneModal hook

  // Get current Persian date with fallback
  const getCurrentPersianDate = () => {
    try {
      const date = PersianCalendar.now('jYYYY/jMM/jDD');
      // Validate the date format (should be YYYY/MM/DD)
      if (date && date.match(/^\d{4}\/\d{2}\/\d{2}$/)) {
        return date;
      }
    } catch (error) {
      console.error('Error getting Persian date:', error);
    }
    // Fallback to a valid Persian date
    return '1403/01/01';
  };

  // Wizard data is now provided by useContractWizard hook

  // Contract summary hook provides all computed values
  const contractSummary = useContractSummary(wizardData.products, wizardData.serviceRows || []);
  const {
    productsSummary,
    serviceEntries,
    serviceTotals,
    productPriceEntries,
    contractGrandTotal
  } = contractSummary;
  const contractCartSummary = useMemo(() => ({
    ...productsSummary,
    totalPrice: contractGrandTotal
  }), [contractGrandTotal, productsSummary]);


  const serviceTypeMeta: Record<'tool' | 'layer' | 'cut' | 'finishing', { label: string; badgeClass: string; chipClass: string }> = {
    tool: {
      label: 'ابزار',
      badgeClass: 'bg-[var(--sds-warning-surface)] dark:bg-[var(--sds-warning-surface)] text-[var(--sds-warning)] dark:text-[var(--sds-warning)]',
      chipClass: 'bg-[var(--sds-warning-surface)] dark:bg-[var(--sds-warning-surface)] text-[var(--sds-warning)] dark:text-[var(--sds-warning)] border border-[var(--sds-warning-border)] dark:border-[var(--sds-warning-border)]'
    },
    layer: {
      label: 'لایه',
      badgeClass: 'bg-[var(--sds-purple-surface)] dark:bg-[var(--sds-purple-surface)] text-[var(--sds-purple)] dark:text-[var(--sds-purple)]',
      chipClass: 'bg-[var(--sds-purple-surface)] dark:bg-[var(--sds-purple-surface)] text-[var(--sds-purple)] dark:text-[var(--sds-purple)] border border-[var(--sds-purple-border)] dark:border-[var(--sds-purple-border)]'
    },
    cut: {
      label: 'برش',
      badgeClass: 'bg-[var(--sds-info-surface)] text-[var(--sds-info)] dark:bg-[var(--sds-info-surface)] dark:text-[var(--sds-info)]',
      chipClass: 'bg-[var(--sds-info-surface)] dark:bg-[var(--sds-info-surface)] text-[var(--sds-info)] dark:text-[var(--sds-info)] border border-[var(--sds-info-border)] dark:border-[var(--sds-info-border)]'
    },
    finishing: {
      label: 'پرداخت',
      badgeClass: 'bg-[var(--sds-accent-soft)] text-[var(--sds-accent)] dark:bg-[var(--sds-accent-soft)] dark:text-[var(--sds-accent)]',
      chipClass: 'bg-[var(--sds-accent-soft)] dark:bg-[var(--sds-accent-soft)] text-[var(--sds-accent)] dark:text-[var(--sds-accent)] border border-[var(--sds-accent)] dark:border-[var(--sds-accent)]'
    }
  };

  const hasInvoiceData = wizardData.products.length > 0 || serviceEntries.length > 0;


  // Load data

  // Initialize product modal hook
  const productModal = useProductModal({
    errors,
    setErrors
  });

  // Initialize product calculations hook with values from productModal
  const productCalculations = useProductCalculations({
    productConfig: productModal.productConfig,
    setProductConfig: productModal.setProductConfig,
    lengthUnit: productModal.lengthUnit,
    widthUnit: productModal.widthUnit,
    hasQuantityBeenInteracted: productModal.hasQuantityBeenInteracted,
    cuttingTypes,
    wizardData,
    selectedProduct: productModal.selectedProduct,
    isEditMode: productModal.isEditMode,
    isMandatory: productModal.isMandatory,
    mandatoryPercentage: productModal.mandatoryPercentage,
    errors,
    setErrors
  });

  // Initialize remaining stone modal hook
  const remainingStoneModal = useRemainingStoneModal({
    wizardData,
    updateWizardData,
    getCuttingTypePricePerMeter: productCalculations.getCuttingTypePricePerMeter,
    calculatePartitionPositions,
    setErrors,
    handleSmartCalculation: productCalculations.handleSmartCalculation,
    getEffectiveQuantity: productCalculations.getEffectiveQuantity,
    onProductCreated: rowId =>
      publishProductSaveFeedback('created', rowId)
  });

  // Initialize payment handlers hook
  const paymentHandlers = usePaymentHandlers({
    wizardData,
    updateWizardData,
    setErrors,
    getCurrentPersianDate
  });

  // Create aliases for easier refactoring (temporary - will remove after full migration)
  const selectedProduct = productModal.selectedProduct;
  const setSelectedProduct = productModal.setSelectedProduct;
  const productConfig = productModal.productConfig;
  const setProductConfig = productModal.setProductConfig;
  const lengthUnit = productModal.lengthUnit;
  const setLengthUnit = productModal.setLengthUnit;
  const widthUnit = productModal.widthUnit;
  const setWidthUnit = productModal.setWidthUnit;
  const isMandatory = productModal.isMandatory;
  const setIsMandatory = productModal.setIsMandatory;
  const mandatoryPercentage = productModal.mandatoryPercentage;
  const setMandatoryPercentage = productModal.setMandatoryPercentage;
  const isEditMode = productModal.isEditMode;
  const setIsEditMode = productModal.setIsEditMode;
  const editingProductIndex = productModal.editingProductIndex;
  const setEditingProductIndex = productModal.setEditingProductIndex;
  const touchedFields = productModal.touchedFields;
  const setTouchedFields = productModal.setTouchedFields;
  const stairSystemConfig = productModal.stairSystemConfig;
  const setStairSystemConfig = productModal.setStairSystemConfig;
  const quantityType = productModal.quantityType;
  const setQuantityType = productModal.setQuantityType;
  const treadExpanded = productModal.treadExpanded;
  const setTreadExpanded = productModal.setTreadExpanded;
  const riserExpanded = productModal.riserExpanded;
  const setRiserExpanded = productModal.setRiserExpanded;
  const landingExpanded = productModal.landingExpanded;
  const setLandingExpanded = productModal.setLandingExpanded;
  const showProductModal = productModal.showProductModal;
  const setShowProductModal = productModal.setShowProductModal;
  const closeProductModal = productModal.closeModal;
  const returnToProductModalAfterRemainderRef = useRef(false);
  const requestedStairFooterActionRef = useRef<'stage' | 'finish'>('stage');
  const commitStagedStairSessionRef = useRef(false);
  const stairStageButtonRef = useRef<HTMLButtonElement | null>(null);
  const stairFinishButtonRef = useRef<HTMLButtonElement | null>(null);
  const hasQuantityBeenInteracted = productModal.hasQuantityBeenInteracted;
  const setHasQuantityBeenInteracted = productModal.setHasQuantityBeenInteracted;
  const treadProductSearchTerm = productModal.treadProductSearchTerm;
  const setTreadProductSearchTerm = productModal.setTreadProductSearchTerm;
  const riserProductSearchTerm = productModal.riserProductSearchTerm;
  const setRiserProductSearchTerm = productModal.setRiserProductSearchTerm;
  const landingProductSearchTerm = productModal.landingProductSearchTerm;
  const setLandingProductSearchTerm = productModal.setLandingProductSearchTerm;
  const clearProductAdditionSearches = useCallback(() => {
    setProductSearchTerm('');
    setTreadProductSearchTerm('');
    setRiserProductSearchTerm('');
    setLandingProductSearchTerm('');
    stairSystemV2.setStoneSearchTerm('');
  }, [
    setProductSearchTerm,
    setTreadProductSearchTerm,
    setRiserProductSearchTerm,
    setLandingProductSearchTerm,
    stairSystemV2
  ]);

  // Calculation handler aliases
  const getEffectiveQuantity = productCalculations.getEffectiveQuantity;
  const getQuantityDisplayValue = productCalculations.getQuantityDisplayValue;
  // getCuttingTypePricePerMeter is provided by dataLoading hook
  const calculateAutoCuttingCost = productCalculations.calculateAutoCuttingCost;
  const handleSmartCalculation = productCalculations.handleSmartCalculation;
  const calculateStoneMetrics = productCalculations.calculateStoneMetrics;
  const generateFullProductName = productCalculations.generateFullProductName;
  const handleFieldFocus = productModal.handleFieldFocus;

  // Update productModal handlers to use calculation handlers
  // We need to create enhanced handlers that integrate smart calculation
  const handleLengthUnitChangeWithCalc = useCallback((newUnit: 'cm' | 'm') => {
    if (!productModal.productConfig.length) {
      productModal.setLengthUnit(newUnit);
      return;
    }

    const currentLength = productModal.productConfig.length;
    let convertedLength = currentLength;

    if (productModal.lengthUnit === 'cm' && newUnit === 'm') {
      convertedLength = currentLength / 100;
    } else if (productModal.lengthUnit === 'm' && newUnit === 'cm') {
      convertedLength = currentLength * 100;
    }

    productModal.setLengthUnit(newUnit);

    productModal.setProductConfig(prev => {
      const updatedConfig = { ...prev, length: convertedLength };
      const smartResult = productCalculations.handleSmartCalculation('length', convertedLength, updatedConfig, newUnit, productModal.widthUnit, productCalculations.getEffectiveQuantity());
      return {
        ...updatedConfig,
        width: smartResult.width,
        squareMeters: smartResult.squareMeters
      };
    });
  }, [productModal, productCalculations]);

  const handleWidthUnitChangeWithCalc = useCallback((newUnit: 'cm' | 'm') => {
    if (!productModal.productConfig.width) {
      productModal.setWidthUnit(newUnit);
      return;
    }

    const currentWidth = productModal.productConfig.width;
    let convertedWidth = currentWidth;

    if (productModal.widthUnit === 'cm' && newUnit === 'm') {
      convertedWidth = currentWidth / 100;
    } else if (productModal.widthUnit === 'm' && newUnit === 'cm') {
      convertedWidth = currentWidth * 100;
    }

    // Validate width after unit conversion
    if (productModal.selectedProduct) {
      const originalWidth = (productModal.isEditMode && productModal.productConfig.originalWidth)
        ? productModal.productConfig.originalWidth
        : (productModal.selectedProduct?.widthValue || 0);

      if (convertedWidth > 0 && originalWidth > 0) {
        const convertedWidthInCm = newUnit === 'm' ? convertedWidth * 100 : convertedWidth;
        if (convertedWidthInCm > originalWidth) {
          setErrors({
            products: `عرض وارد شده (${convertedWidth}${newUnit === 'm' ? 'm' : 'cm'}) بیشتر از عرض اصلی سنگ (${originalWidth}cm) است. لطفاً عرضی کمتر یا مساوی با ${originalWidth}cm وارد کنید.`
          });
        } else {
          if (errors.products && errors.products.includes('عرض وارد شده')) {
            setErrors({});
          }
        }
      }
    }

    productModal.setWidthUnit(newUnit);

    productModal.setProductConfig(prev => {
      const updatedConfig = { ...prev, width: convertedWidth };
      const smartResult = productCalculations.handleSmartCalculation('width', convertedWidth, updatedConfig, productModal.lengthUnit, newUnit, productCalculations.getEffectiveQuantity());
      return {
        ...updatedConfig,
        length: smartResult.length,
        squareMeters: smartResult.squareMeters
      };
    });
  }, [productModal, productCalculations, errors, setErrors]);

  const applyContractAutosaveDraft = useCallback((draft: ReturnType<typeof createContractAutosaveDraft>) => {
    setCurrentStep(clampContractDraftStep(draft.currentStep, WIZARD_STEPS.length));
    setWizardData(normalizeWizardFinishingProducts(draft.wizardData));
    setCustomerSearchTerm(draft.searches?.customerSearchTerm || '');
    setProductSearchTerm(draft.searches?.productSearchTerm || '');
    setTreadProductSearchTerm(draft.searches?.treadProductSearchTerm || '');
    setRiserProductSearchTerm(draft.searches?.riserProductSearchTerm || '');
    setLandingProductSearchTerm(draft.searches?.landingProductSearchTerm || '');
    stairSystemV2.setStoneSearchTerm(draft.searches?.stairStoneSearchTerm || '');

    const savedProductModal = draft.productModal || {};
    if (savedProductModal.selectedProduct !== undefined) setSelectedProduct(savedProductModal.selectedProduct as Product | null);
    if (savedProductModal.productConfig) setProductConfig(savedProductModal.productConfig as Partial<ContractProduct>);
    if (savedProductModal.lengthUnit === 'cm' || savedProductModal.lengthUnit === 'm') setLengthUnit(savedProductModal.lengthUnit);
    if (savedProductModal.widthUnit === 'cm' || savedProductModal.widthUnit === 'm') setWidthUnit(savedProductModal.widthUnit);
    if (typeof savedProductModal.isMandatory === 'boolean') setIsMandatory(savedProductModal.isMandatory);
    if (typeof savedProductModal.mandatoryPercentage === 'number') setMandatoryPercentage(savedProductModal.mandatoryPercentage);
    if (typeof savedProductModal.hasQuantityBeenInteracted === 'boolean') {
      setHasQuantityBeenInteracted(savedProductModal.hasQuantityBeenInteracted);
    }
    if (savedProductModal.quantityType === 'steps' || savedProductModal.quantityType === 'staircases') {
      setQuantityType(savedProductModal.quantityType);
    }
    if (savedProductModal.stairSystemConfig) setStairSystemConfig(savedProductModal.stairSystemConfig as any);
    if (typeof savedProductModal.showProductModal === 'boolean') {
      setShowProductModal(savedProductModal.showProductModal);
    }

    const savedRemaining = savedProductModal.remainingStone as Record<string, unknown> | undefined;
    if (savedRemaining) {
      if (typeof savedRemaining.isOpen === 'boolean') remainingStoneModal.setShowRemainingStoneModal(savedRemaining.isOpen);
      if ('selectedStone' in savedRemaining) remainingStoneModal.setSelectedRemainingStone(savedRemaining.selectedStone as RemainingStone | null);
      if ('sourceProduct' in savedRemaining) remainingStoneModal.setSelectedRemainingStoneSourceProduct(savedRemaining.sourceProduct as ContractProduct | null);
      if (savedRemaining.config) remainingStoneModal.setRemainingStoneConfig(savedRemaining.config as Partial<ContractProduct>);
      if (Array.isArray(savedRemaining.partitions)) remainingStoneModal.setPartitions(savedRemaining.partitions as StonePartition[]);
      if (savedRemaining.lengthUnit === 'cm' || savedRemaining.lengthUnit === 'm') remainingStoneModal.setRemainingStoneLengthUnit(savedRemaining.lengthUnit);
      if (savedRemaining.widthUnit === 'cm' || savedRemaining.widthUnit === 'm') remainingStoneModal.setRemainingStoneWidthUnit(savedRemaining.widthUnit);
      if (savedRemaining.partitionLengthUnit === 'cm' || savedRemaining.partitionLengthUnit === 'm') remainingStoneModal.setPartitionLengthUnit(savedRemaining.partitionLengthUnit);
      if (savedRemaining.partitionWidthUnit === 'cm' || savedRemaining.partitionWidthUnit === 'm') remainingStoneModal.setPartitionWidthUnit(savedRemaining.partitionWidthUnit);
      if (typeof savedRemaining.isMandatory === 'boolean') remainingStoneModal.setRemainingStoneIsMandatory(savedRemaining.isMandatory);
      if (typeof savedRemaining.mandatoryPercentage === 'number') remainingStoneModal.setRemainingStoneMandatoryPercentage(savedRemaining.mandatoryPercentage);
      if (typeof savedRemaining.sawKerfEnabled === 'boolean') remainingStoneModal.setRemainingStoneSawKerfEnabled(savedRemaining.sawKerfEnabled);
    }

    const savedStairSystem = draft.stairSystemV2 || {};
    if (savedStairSystem.draftTread) stairSystemV2.setDraftTread(savedStairSystem.draftTread as StairPartDraftV2);
    if (savedStairSystem.draftRiser) stairSystemV2.setDraftRiser(savedStairSystem.draftRiser as StairPartDraftV2);
    if (savedStairSystem.draftLanding) stairSystemV2.setDraftLanding(savedStairSystem.draftLanding as StairPartDraftV2);
    if (savedStairSystem.stairActivePart === 'tread' || savedStairSystem.stairActivePart === 'riser' || savedStairSystem.stairActivePart === 'landing') {
      stairSystemV2.setStairActivePart(savedStairSystem.stairActivePart);
    }
    if (Array.isArray(savedStairSystem.stairSessionItems)) {
      stairSystemV2.setStairSessionItems(savedStairSystem.stairSessionItems as ContractProduct[]);
    }
    if (typeof savedStairSystem.stairSessionId === 'string' || savedStairSystem.stairSessionId === null) {
      stairSystemV2.setStairSessionId(savedStairSystem.stairSessionId as string | null);
    }
    if (savedStairSystem.quantityDraft) {
      setStairQuantityDraft(savedStairSystem.quantityDraft as StairQuantityInputDraft);
    }
    if (savedStairSystem.quantityManuallyEdited) {
      setStairQuantityManuallyEdited(
        savedStairSystem.quantityManuallyEdited as {
          tread: boolean;
          riser: boolean;
        }
      );
    }

    const savedPaymentModal = draft.productModal?.paymentEntryForm;
    if (savedPaymentModal) paymentHandlers.setPaymentEntryForm(savedPaymentModal as any);
    if (typeof savedProductModal.showPaymentEntryModal === 'boolean') {
      paymentHandlers.setShowPaymentEntryModal(savedProductModal.showPaymentEntryModal);
    }

    setStateRestored(true);
    restorationAttempted.current = true;
  }, [
    paymentHandlers,
    remainingStoneModal,
    restorationAttempted,
    setCurrentStep,
    setCustomerSearchTerm,
    setHasQuantityBeenInteracted,
    setIsMandatory,
    setLandingProductSearchTerm,
    setLengthUnit,
    setMandatoryPercentage,
    setProductConfig,
    setProductSearchTerm,
    setQuantityType,
    setRiserProductSearchTerm,
    setSelectedProduct,
    setShowProductModal,
    setStairSystemConfig,
    setStateRestored,
    setTreadProductSearchTerm,
    setWidthUnit,
    setWizardData,
    stairSystemV2
  ]);

  const recoveryUserId = currentUser?.id || currentUser?.username || null;
  const recoveryBaseRevision = Number(
    (initialWizardData as any)?.productGraphRevision ??
    (initialWizardData as any)?.canonicalRevision ??
    0
  );
  const recoveryDraftId = useMemo(
    () => recoveryUserId
      ? getOrCreateContractDraftId(recoveryUserId, contractId || wizardData.signature?.contractId)
      : null,
    [contractId, recoveryUserId, wizardData.signature?.contractId]
  );
  const recoveryScope = useMemo<ContractRecoveryScope | null>(
    () => recoveryUserId && recoveryDraftId
      ? {
          userId: recoveryUserId,
          draftId: recoveryDraftId,
          schemaVersion: CONTRACT_RECOVERY_SCHEMA_VERSION,
          baseRevision: recoveryBaseRevision
        }
      : null,
    [recoveryBaseRevision, recoveryDraftId, recoveryUserId]
  );
  const editRecovery = useContractEditRecovery({
    scope: recoveryScope,
    contractId: contractId || wizardData.signature?.contractId || null,
    onRestore: applyContractAutosaveDraft
  });
  const editRecoveryBlocked = editRecovery.blocked;
  const takeoverEditRecovery = editRecovery.takeover;
  useEffect(() => {
    const resolvedModalState = resolveProductModalRecoveryState({
      showProductModal,
      selectedProduct,
      returnToProductModalAfterRemainder: returnToProductModalAfterRemainderRef.current
    }, editRecoveryBlocked);
    if (
      resolvedModalState.showProductModal === showProductModal &&
      resolvedModalState.selectedProduct === selectedProduct &&
      resolvedModalState.returnToProductModalAfterRemainder ===
        returnToProductModalAfterRemainderRef.current
    ) {
      return;
    }
    closeProductModal();
    returnToProductModalAfterRemainderRef.current = false;
  }, [
    closeProductModal,
    editRecoveryBlocked,
    selectedProduct,
    showProductModal
  ]);
  const handleEditRecoveryTakeover = useCallback(async () => {
    closeProductModal();
    returnToProductModalAfterRemainderRef.current = false;
    await takeoverEditRecovery();
    closeProductModal();
    returnToProductModalAfterRemainderRef.current = false;
  }, [closeProductModal, takeoverEditRecovery]);

  // Product filtering hook provides all filtered lists
  const productFiltering = useProductFiltering({
    customers: customerOptions,
    products,
    customerSearchTerm,
    productSearchTerm,
    treadProductSearchTerm,
    riserProductSearchTerm,
    landingProductSearchTerm,
    selectedProductTypeForAddition: wizardData.selectedProductTypeForAddition,
    sellerProductHistory: sellerProductHistory.history
  });
  const {
    filteredCustomers,
    filteredProducts,
    filteredTreadProducts,
    filteredRiserProducts,
    filteredLandingProducts
  } = productFiltering;

  useEffect(() => {
    if (isContractEditMode) {
      setAutosaveHydrated(true);
      return;
    }
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('returnTo') === 'contract') {
      if (!urlParams.get('step')) {
        setAutosaveHydrated(true);
      }
      return;
    }

    const draft = parseContractAutosaveDraft(localStorage.getItem(CONTRACT_DRAFT_STORAGE_KEY));
    if (!draft) {
      localStorage.removeItem(CONTRACT_DRAFT_STORAGE_KEY);
      setAutosaveHydrated(true);
      return;
    }

    applyContractAutosaveDraft(draft);
    setAutosaveHydrated(true);
  }, []);

  const buildContractAutosaveDraft = useCallback(() => {
    const hasMeaningfulDraftProgress =
      currentStep > 1 ||
      Boolean(wizardData.customerId) ||
      Boolean(wizardData.projectId) ||
      wizardData.products.length > 0 ||
      wizardData.deliveries.length > 0 ||
      wizardData.payment.payments.length > 0 ||
      Boolean(customerSearchTerm.trim()) ||
      Boolean(productSearchTerm.trim()) ||
      Boolean(treadProductSearchTerm.trim()) ||
      Boolean(riserProductSearchTerm.trim()) ||
      Boolean(landingProductSearchTerm.trim()) ||
      Boolean(stairSystemV2.stoneSearchTerm.trim()) ||
      Boolean(selectedProduct) ||
      remainingStoneModal.showRemainingStoneModal ||
      paymentHandlers.showPaymentEntryModal ||
      stairSystemV2.stairSessionItems.length > 0;

    if (!hasMeaningfulDraftProgress) {
      return null;
    }

    return createContractAutosaveDraft({
      currentStep,
      wizardData,
      searches: {
        customerSearchTerm,
        productSearchTerm,
        treadProductSearchTerm,
        riserProductSearchTerm,
        landingProductSearchTerm,
        stairStoneSearchTerm: stairSystemV2.stoneSearchTerm
      },
      productModal: {
        selectedProduct,
        productConfig,
        lengthUnit,
        widthUnit,
        isMandatory,
        mandatoryPercentage,
        hasQuantityBeenInteracted,
        quantityType,
        stairSystemConfig,
        showProductModal,
        paymentEntryForm: paymentHandlers.paymentEntryForm,
        showPaymentEntryModal: paymentHandlers.showPaymentEntryModal,
        remainingStone: {
          isOpen: remainingStoneModal.showRemainingStoneModal,
          selectedStone: remainingStoneModal.selectedRemainingStone,
          sourceProduct: remainingStoneModal.selectedRemainingStoneSourceProduct,
          config: remainingStoneModal.remainingStoneConfig,
          partitions: remainingStoneModal.partitions,
          lengthUnit: remainingStoneModal.remainingStoneLengthUnit,
          widthUnit: remainingStoneModal.remainingStoneWidthUnit,
          partitionLengthUnit: remainingStoneModal.partitionLengthUnit,
          partitionWidthUnit: remainingStoneModal.partitionWidthUnit,
          isMandatory: remainingStoneModal.remainingStoneIsMandatory,
          mandatoryPercentage: remainingStoneModal.remainingStoneMandatoryPercentage,
          sawKerfEnabled: remainingStoneModal.remainingStoneSawKerfEnabled
        }
      },
      stairSystemV2: {
        draftTread: stairSystemV2.draftTread,
        draftRiser: stairSystemV2.draftRiser,
        draftLanding: stairSystemV2.draftLanding,
        stairActivePart: stairSystemV2.stairActivePart,
        stairSessionId: stairSystemV2.stairSessionId,
        stairSessionItems: stairSystemV2.stairSessionItems,
        quantityDraft: stairQuantityDraft,
        quantityManuallyEdited: stairQuantityManuallyEdited
      }
    });
  }, [
    currentStep,
    wizardData,
    customerSearchTerm,
    productSearchTerm,
    treadProductSearchTerm,
    riserProductSearchTerm,
    landingProductSearchTerm,
    stairSystemV2.stoneSearchTerm,
    selectedProduct,
    productConfig,
    lengthUnit,
    widthUnit,
    isMandatory,
    mandatoryPercentage,
    hasQuantityBeenInteracted,
    quantityType,
    stairSystemConfig,
    paymentHandlers.paymentEntryForm,
    paymentHandlers.showPaymentEntryModal,
    remainingStoneModal.partitions,
    remainingStoneModal.remainingStoneConfig,
    remainingStoneModal.remainingStoneIsMandatory,
    remainingStoneModal.remainingStoneLengthUnit,
    remainingStoneModal.remainingStoneMandatoryPercentage,
    remainingStoneModal.remainingStoneSawKerfEnabled,
    remainingStoneModal.remainingStoneWidthUnit,
    remainingStoneModal.selectedRemainingStone,
    remainingStoneModal.selectedRemainingStoneSourceProduct,
    remainingStoneModal.showRemainingStoneModal,
    remainingStoneModal.partitionLengthUnit,
    remainingStoneModal.partitionWidthUnit,
    showProductModal,
    stairSystemV2.draftTread,
    stairSystemV2.draftRiser,
    stairSystemV2.draftLanding,
    stairSystemV2.stairActivePart,
    stairSystemV2.stairSessionId,
    stairSystemV2.stairSessionItems,
    stairQuantityDraft,
    stairQuantityManuallyEdited
  ]);

  const flushContractAutosaveDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (isContractEditMode || !autosaveHydrated) return;
    if (wizardData.signature?.contractId) {
      localStorage.removeItem(CONTRACT_DRAFT_STORAGE_KEY);
      return;
    }

    const draft = buildContractAutosaveDraft();
    if (!draft) {
      localStorage.removeItem(CONTRACT_DRAFT_STORAGE_KEY);
      return;
    }

    localStorage.setItem(CONTRACT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [
    autosaveHydrated,
    buildContractAutosaveDraft,
    isContractEditMode,
    wizardData.signature?.contractId
  ]);

  useEffect(() => {
    if (!editRecovery.ready || editRecovery.blocked) return;
    const draft = buildContractAutosaveDraft();
    if (!draft) return;
    editRecovery.queueRecovery(draft);
  }, [
    buildContractAutosaveDraft,
    editRecovery.blocked,
    editRecovery.queueRecovery,
    editRecovery.ready
  ]);

  useEffect(() => {
    flushContractAutosaveDraft();
  }, [flushContractAutosaveDraft]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isContractEditMode) return;

    const handlePageHide = () => {
      flushContractAutosaveDraft();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushContractAutosaveDraft();
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [flushContractAutosaveDraft, isContractEditMode]);

  useEffect(() => {
    const initializeData = async () => {
      await loadData();
      if (!isContractEditMode) {
        await generateContractNumber();
      }
    };
    initializeData();

    if (isContractEditMode) {
      setStateRestored(true);
      restorationAttempted.current = true;
      setAutosaveHydrated(true);
      return;
    }

    // Check for return from quick create
    const urlParams = new URLSearchParams(window.location.search);
    const returnTo = urlParams.get('returnTo');
    const step = urlParams.get('step');

    if (returnTo === 'contract' && step && !restorationAttempted.current) {
      // Restore wizard state from localStorage
      (async () => {
        const savedState = localStorage.getItem('contractWizardState');

        if (savedState) {
          try {
            const { currentStep: savedStep, wizardData: savedWizardData } = JSON.parse(savedState);

            // Use the saved step instead of URL step parameter
            setCurrentStep(normalizeWizardStep(savedStep));
            setWizardData(normalizeWizardFinishingProducts(savedWizardData));
            setStateRestored(true);
            restorationAttempted.current = true;

            // Clear the saved state after successful restoration
            localStorage.removeItem('contractWizardState');

            // Refresh data to show newly created entities
            await loadData();
            await generateContractNumber();

            // Re-fetch customer so project list (Step 3) includes newly added projects
            if (savedWizardData.customerId) {
              try {
                const customerRes = await crmAPI.getCustomer(savedWizardData.customerId);
                if (customerRes.data.success && customerRes.data.data) {
                  updateWizardData({ customer: customerRes.data.data });
                }
              } catch (err) {
                console.error('Error refreshing customer after restore:', err);
              }
            }

          } catch (error) {
            console.error('❌ Error restoring wizard state:', error);
            // If restoration fails, use URL step as fallback
            setCurrentStep(normalizeWizardStep(parseInt(step, 10)));
            setStateRestored(true);
            restorationAttempted.current = true;

            // Refresh data to show newly created entities
            await loadData();
            await generateContractNumber();
          }
        } else {
          // If no saved state, use URL step as fallback
          setCurrentStep(normalizeWizardStep(parseInt(step, 10)));
          setStateRestored(true);
          restorationAttempted.current = true;

          // Refresh data to show newly created entities
          await loadData();
          await generateContractNumber();
        }
      })().finally(() => setAutosaveHydrated(true));
    }
  }, []);

  const generateContractNumber = async () => {
    try {
      // Get next contract number from backend
      const response = await salesAPI.getNextContractNumber();
      if (response.data.success) {
        setWizardData(prev => ({
          ...prev,
          contractNumber: response.data.data.contractNumber,
          creatorSequenceNumber: response.data.data.creatorSequenceNumber ?? null
        }));
      }
    } catch (error) {
      console.error('Error generating contract number:', error);
      // Fallback to manual generation
      const contractCount = Math.floor(Math.random() * 1000) + 1000;
      setWizardData(prev => ({
        ...prev,
        contractNumber: String(contractCount)
      }));
    }
  };

  // updateWizardData is now provided by useContractWizard hook

  // Helper function to update stair system config
  const updateStairSystemConfig = (updates: Partial<StairSystemConfig> | ((prev: StairSystemConfig | null) => StairSystemConfig | null)) => {
    setStairSystemConfig(prev => {
      if (!prev) return prev;
      if (typeof updates === 'function') {
        return updates(prev);
      }
      return { ...prev, ...updates };
    });
  };

  // Helper function to update a specific stair part
  const updateStairPart = (partType: 'tread' | 'riser' | 'landing', updates: Partial<StairPart>) => {
    setStairSystemConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        [partType]: { ...prev[partType], ...updates }
      };
    });
  };

  const syncDraftWithProduct = (partType: 'tread' | 'riser' | 'landing', product: Product | null) => {
    const updater =
      partType === 'tread' ? stairSystemV2.setDraftTread :
      partType === 'riser' ? stairSystemV2.setDraftRiser :
      stairSystemV2.setDraftLanding;

    // 🎯 Use generateFullProductName to show complete product name
    const productLabel = product ? generateFullProductName(product) : '';
    updater(prev => ({
      ...prev,
      stoneId: product ? product.id : null,
      stoneLabel: productLabel,
      stoneProduct: product,
      contractualTitle: product ? productLabel : '',
      pricePerSquareMeter: null,
      thicknessCm: product ? (product.thicknessValue ?? null) : null,
      standardLengthValue: null,
      standardLengthUnit: 'm',
      operationPolicyInput: product
        ? createStairOperationInput(partType, prev, product.id)
        : undefined
    }));

    if (product) {
      stairSystemV2.setLastSelectedStoneProduct(product);
      stairSystemV2.setAutoFillOptOut(prev => ({ ...prev, [partType]: false }));
      stairSystemV2.setStairDraftErrors(prev => ({
        ...prev,
        [partType]: {
          ...prev[partType],
          thickness: undefined,
          pricePerSquareMeter: undefined
        }
      }));
    } else {
      stairSystemV2.setAutoFillOptOut(prev => ({ ...prev, [partType]: true }));
    }

    if (productLabel) {
      stairSystemV2.setLastSelectedStoneLabel(productLabel);
    }

    if (stairSystemV2.stairActivePart === partType) {
      stairSystemV2.setStoneSearchTerm(productLabel || stairSystemV2.lastSelectedStoneLabel);
    }
  };

  const setActivePart = (part: StairStepperPart) => {
    stairSystemV2.setStairActivePart(part);
    const currentDraft =
      part === 'tread' ? stairSystemV2.draftTread :
      part === 'riser' ? stairSystemV2.draftRiser :
      stairSystemV2.draftLanding;
    if (!currentDraft.stoneId && stairSystemV2.lastSelectedStoneProduct && !stairSystemV2.autoFillOptOut[part]) {
      selectProductForStairPart(part, stairSystemV2.lastSelectedStoneProduct);
    }
    // Note: Search term will be synced via useEffect below to ensure we read latest state
  };

  // Sync search term when active part changes - ensures we read latest draft state
  // This ensures each part maintains its own product selection independently
  useEffect(() => {
    // Get the draft for the currently active part
    const draft =
      stairSystemV2.stairActivePart === 'tread' ? stairSystemV2.draftTread :
      stairSystemV2.stairActivePart === 'riser' ? stairSystemV2.draftRiser :
      stairSystemV2.draftLanding;

    // Extract the product label from the draft
    // Priority: stoneLabel (explicitly set with full name) > generateFullProductName from stoneProduct > fallback
    const label = draft.stoneLabel ||
                  (draft.stoneProduct ? generateFullProductName(draft.stoneProduct) : '') ||
                  draft.stoneProduct?.namePersian ||
                  draft.stoneProduct?.name || '';

    // Update search term to reflect the active part's product selection
    // This ensures when switching parts, the search term shows the product for that part
    stairSystemV2.setStoneSearchTerm(label);
  }, [
    stairSystemV2.stairActivePart,
    // Track all draft changes - React will optimize, but we need to react to any part's changes
    // when switching to that part, we want the latest state
    stairSystemV2.draftTread.stoneProduct?.id,
    stairSystemV2.draftTread.stoneLabel,
    stairSystemV2.draftRiser.stoneProduct?.id,
    stairSystemV2.draftRiser.stoneLabel,
    stairSystemV2.draftLanding.stoneProduct?.id,
    stairSystemV2.draftLanding.stoneLabel
  ]);

  // Helper function to select a product for a specific stair part
  const selectProductForStairPart = (partType: 'tread' | 'riser' | 'landing', product: Product) => {
    updateStairPart(partType, {
      productId: product.id,
      product: product,
      pricePerSquareMeter: 0
    });
    syncDraftWithProduct(partType, product);
  };

  const initializeProductConfigForType = (product: Product, selectedProductType: ContractUsageType | null) => {
    if (!selectedProductType) {
      setStairSystemConfig(null);
      setProductConfig({
        productId: product.id,
        product,
        stoneCode: product.code,
        stoneName: product.namePersian,
        diameterOrWidth: product.widthValue,
        pricePerSquareMeter: product.basePrice || 0
      });
      setLengthUnit('m');
      setWidthUnit('cm');
      return;
    }

    if (selectedProductType === 'prepared' || selectedProductType === 'volumetric') {
      const preparedKind = inferPreparedKindFromProduct(product);
      const defaultConfig: Partial<ContractProduct> = {
        productId: product.id,
        product,
        productType: 'prepared',
        preparedKind,
        preparedUnit: 'count',
        preparedQuantity: 1,
        stoneCode: product.code,
        stoneName: product.namePersian,
        diameterOrWidth: product.widthValue,
        length: 0,
        width: 0,
        quantity: 1,
        squareMeters: 0,
        pricePerSquareMeter: product.basePrice || 0,
        unitPrice: product.basePrice || 0,
        totalPrice: product.basePrice || 0,
        description: '',
        images: [...(product.images || [])],
        currency: 'تومان',
        sawKerfEnabled: false,
        sawKerfCm: null,
        lengthUnit: 'm',
        widthUnit: 'cm',
        isMandatory: false,
        mandatoryPercentage: 0,
        originalTotalPrice: product.basePrice || 0,
        isCut: false,
        cutType: null,
        originalWidth: product.widthValue,
        originalLength: 0,
        cuttingCost: 0,
        cuttingCostPerMeter: 0,
        cutDescription: '',
        remainingStones: [],
        cutDetails: [],
        usedRemainingStones: [],
        totalUsedRemainingWidth: 0,
        totalUsedRemainingLength: 0,
        appliedSubServices: [],
        totalSubServiceCost: 0,
        usedLengthForSubServices: 0,
        usedSquareMetersForSubServices: 0
      };
      setStairSystemConfig(null);
      setProductConfig(defaultConfig);
      setLengthUnit('m');
      setWidthUnit('cm');
      return;
    }

    if (selectedProductType === 'stair') {
      const freshStairDefaults = getFreshContractProductDefaults('stair');

        const productLabel = product.namePersian || product.name || '';
        stairSystemV2.reset();
        const freshTreadDraft = createFreshStairPartDraft('tread');
        setStairQuantityDraft({
          mode: 'steps',
          totalSteps: '',
          numberOfStaircases: '',
          stepsPerStaircase: ''
        });
        setStairQuantityManuallyEdited({ tread: false, riser: false });

        stairSystemV2.setDraftTread({
          ...freshTreadDraft,
          stoneId: product.id,
          stoneLabel: productLabel,
          contractualTitle: productLabel,
          stoneProduct: product,
          pricePerSquareMeter: null,
          thicknessCm: product.thicknessValue || null,
          calibrationCutEnabled: freshStairDefaults.calibrationCutEnabled
        });

        stairSystemV2.setStoneSearchTerm(productLabel);
        setProductConfig({
          productId: product.id,
          product,
          productType: 'stair'
        });

      return;
    }

    if (selectedProductType === 'slab') {
      const defaultStandardWidthCm = product.widthValue || 0;
      const defaultStandardLengthCm = (product as any)?.lengthValue || 300;
      const defaultOriginalLength = lengthUnit === 'm'
        ? defaultStandardLengthCm / 100
        : defaultStandardLengthCm;
      const slabProductName = product.namePersian || generateSlabContractProductName(product);
      const defaultConfig: Partial<ContractProduct> = {
        productId: product.id,
        product,
        productType: 'slab',
        stoneCode: product.code,
        stoneName: slabProductName,
        diameterOrWidth: product.widthValue,
        length: 0,
        width: 0,
        quantity: 1,
        squareMeters: 0,
        pricePerSquareMeter: product.basePrice || 0,
        totalPrice: 0,
        description: '',
        currency: 'تومان',
        sawKerfEnabled: false,
        sawKerfCm: null,
        isCut: false,
        originalWidth: defaultStandardWidthCm,
        originalLength: defaultOriginalLength,
        cuttingCost: 0,
        cuttingCostPerMeter: 0,
        remainingStones: [],
        cutDetails: [],
        slabStandardLengthCm: defaultStandardLengthCm,
        slabStandardWidthCm: defaultStandardWidthCm,
        slabStandardDimensions: [],
        slabCuttingMode: 'lineBased',
        slabCuttingPricePerSquareMeter: 0,
        slabLineCuttingStrategy: 'length',
        slabLineCuttingLongitudinalMeters: null,
        slabLineCuttingCrossMeters: null,
        slabVerticalCutSides: {
          top: true,
          bottom: true,
          left: true,
          right: true
        },
        slabVerticalCutCost: 0,
        slabVerticalCutCostPerMeter: 0,
        usedRemainingStones: [],
        totalUsedRemainingWidth: 0,
        totalUsedRemainingLength: 0,
        appliedSubServices: [],
        totalSubServiceCost: 0,
        usedLengthForSubServices: 0,
        usedSquareMetersForSubServices: 0
      };

      setProductConfig(defaultConfig);
      setLengthUnit('m');
      setWidthUnit('cm');
      return;
    }

    const freshLongitudinalDefaults = getFreshContractProductDefaults('longitudinal');
    const defaultConfig: Partial<ContractProduct> = {
      productId: product.id,
      product,
      productType: 'longitudinal',
      stoneCode: product.code,
      stoneName: product.namePersian,
      diameterOrWidth: product.widthValue,
      length: 0,
      width: 0,
      quantity: freshLongitudinalDefaults.quantity,
      squareMeters: 0,
      pricePerSquareMeter: product.basePrice || 0,
      totalPrice: 0,
      description: '',
      currency: 'تومان',
      sawKerfEnabled: false,
      sawKerfCm: null,
      calibrationCutEnabled: freshLongitudinalDefaults.calibrationCutEnabled,
      isCut: false,
      originalWidth: product.widthValue,
      originalLength: 0,
      cuttingCost: 0,
      cuttingCostPerMeter: 0,
      remainingStones: [],
      cutDetails: [],
      usedRemainingStones: [],
      totalUsedRemainingWidth: 0,
      totalUsedRemainingLength: 0,
      appliedSubServices: [],
      totalSubServiceCost: 0,
      usedLengthForSubServices: 0,
      usedSquareMetersForSubServices: 0
    };

    setProductConfig(defaultConfig);
    setLengthUnit('m');
    setWidthUnit('cm');
  };

  // Handle product selection and open configuration modal
  const handleProductSelection = (product: Product) => {
    const rememberedType = wizardData.selectedProductTypeForAddition;
    const selectedProductType = rememberedType && productSupportsContractRoute(product, rememberedType)
      ? rememberedType
      : inferCatalogContractType(product);

    setSelectedProduct(product);
    initializeProductConfigForType(product, selectedProductType);
    setIsEditMode(false);
    setEditingProductIndex(null);
    setHasQuantityBeenInteracted(false);
    setTouchedFields(new Set());
    setErrors({});
    setShowProductModal(true);
  };

  const handleModalProductTypeChange = (type: ContractUsageType, selectedModalProduct: Product | null) => {
    if (isEditMode || !selectedModalProduct) return;
    initializeProductConfigForType(selectedModalProduct, type);
  };

  // Handle unit conversion for length
  const handleLengthUnitChange = (newUnit: 'cm' | 'm') => {
    if (!productConfig.length) return;

    const currentLength = productConfig.length;
    let convertedLength = currentLength;

    if (lengthUnit === 'cm' && newUnit === 'm') {
      // Convert cm to m
      convertedLength = currentLength / 100;
    } else if (lengthUnit === 'm' && newUnit === 'cm') {
      // Convert m to cm
      convertedLength = currentLength * 100;
    }


    setLengthUnit(newUnit);
    setProductConfig(prev => {
      const updatedConfig = { ...prev, length: convertedLength };
      // Trigger smart calculation with new unit
      const smartResult = handleSmartCalculation('length', convertedLength, updatedConfig, newUnit, widthUnit, getEffectiveQuantity());
      return {
        ...updatedConfig,
        width: smartResult.width,
        squareMeters: smartResult.squareMeters
      };
    });
  };

  // Handle unit conversion for width
  const handleWidthUnitChange = (newUnit: 'cm' | 'm') => {
    if (!productConfig.width) return;

    const currentWidth = productConfig.width;
    let convertedWidth = currentWidth;

    if (widthUnit === 'cm' && newUnit === 'm') {
      // Convert cm to m
      convertedWidth = currentWidth / 100;
    } else if (widthUnit === 'm' && newUnit === 'cm') {
      // Convert m to cm
      convertedWidth = currentWidth * 100;
    }


    // Validate width after unit conversion
    const originalWidth = (isEditMode && productConfig.originalWidth)
      ? productConfig.originalWidth
      : (selectedProduct?.widthValue || 0);

    if (convertedWidth > 0 && originalWidth > 0) {
      const convertedWidthInCm = newUnit === 'm' ? convertedWidth * 100 : convertedWidth;
      if (convertedWidthInCm > originalWidth) {
        // Show error message
        setErrors({
          products: `عرض وارد شده (${convertedWidth}${newUnit === 'm' ? 'm' : 'cm'}) بیشتر از عرض اصلی سنگ (${originalWidth}cm) است. لطفاً عرضی کمتر یا مساوی با ${originalWidth}cm وارد کنید.`
        });
      } else {
        // Clear error if width is valid after unit conversion
        if (errors.products && errors.products.includes('عرض وارد شده')) {
          setErrors({});
        }
      }
    }

    setWidthUnit(newUnit);
    setProductConfig(prev => {
      const updatedConfig = { ...prev, width: convertedWidth };
      // Trigger smart calculation with new unit
      const smartResult = handleSmartCalculation('width', convertedWidth, updatedConfig, lengthUnit, newUnit, getEffectiveQuantity());
      return {
        ...updatedConfig,
        length: smartResult.length,
        squareMeters: smartResult.squareMeters
      };
    });

    // Log stone cutting eligibility after unit change
  };

  // Remaining stone handlers are now provided by useRemainingStoneModal hook
  // Handle editing an existing product
  const handleEditProduct = (index: number) => {
    const savedProduct = wizardData.products[index];
    const product = savedProduct ? restoreLongitudinalCustomerRequest(savedProduct) : savedProduct;
    if (!product) {
      console.error('❌ Product not found at index:', index);
      return;
    }

    // Check if this is a stair system product
    if (!isRemainingStoneChild(product) && product.productType === 'stair' && product.stairSystemId) {
      // Handle stair system editing
      // Find all products with the same stairSystemId
      const stairSystemProducts = wizardData.products.filter(p =>
        p.productType === 'stair' &&
        p.stairSystemId === product.stairSystemId
      );

      // Find tread, riser, and landing products (exclude layer products)
      const treadProduct = stairSystemProducts.find(p =>
        p.stairPartType === 'tread' && !((p.meta as any)?.isLayer)
      );
      const riserProduct = stairSystemProducts.find(p =>
        p.stairPartType === 'riser' && !((p.meta as any)?.isLayer)
      );
      const landingProduct = stairSystemProducts.find(p =>
        p.stairPartType === 'landing' && !((p.meta as any)?.isLayer)
      );

      // Check if using new V2 flow

        const clickedParentIndex = resolveStairParentIndex(
          wizardData.products,
          product,
          index
        );
        const safeParentIndex = clickedParentIndex >= 0 ? clickedParentIndex : index;
        const parentProduct = wizardData.products[safeParentIndex] || product;
        const clickedPartType: StairStepperPart =
          parentProduct.stairPartType === 'riser' || parentProduct.stairPartType === 'landing'
            ? parentProduct.stairPartType
            : 'tread';
        const scopedStairResolution =
          resolveStairRowWithAttachedLayers(
            wizardData.products,
            safeParentIndex
          );
        if (scopedStairResolution.resolution.status === 'conflict') {
          setErrors({
            products: `${scopedStairResolution.resolution.message} (کد: ${scopedStairResolution.resolution.code})`
          });
          console.error('[stair-configuration-transaction]', {
            code: scopedStairResolution.resolution.code,
            action: 'edit-save',
            phase: 'detect',
            mode: 'edit',
            parentRowId: parentProduct.rowId,
            stairSessionId: parentProduct.stairSystemId,
            candidateParentRowIds:
              scopedStairResolution.resolution.candidateParentRowIds,
            stagedRowCount: 0
          });
          return;
        }
        const scopedStairProducts = scopedStairResolution.products;
        const clickedMainProduct = scopedStairProducts.find(isStairMainProduct) || parentProduct;

        // NEW V2 FLOW: Reconstruct only the clicked row and its attached layer.
        // Set session ID to existing stairSystemId
        stairSystemV2.setStairSessionId(product.stairSystemId);

        // Reconstruct session items from the clicked row scope only.
        stairSystemV2.setStairSessionItems([...scopedStairProducts]);

        const cutRateSnapshotsFromProduct = (p: ContractProduct) => {
          const longitudinal = p.cuttingBreakdown?.find(
            cut => cut.type === 'longitudinal'
          );
          const cross = p.cuttingBreakdown?.find(
            cut => cut.type === 'cross'
          );
          return {
            ...(longitudinal
              ? {
                  longitudinal: longitudinal.rate,
                  calibration: longitudinal.rate
                }
              : {}),
            ...(cross ? { cross: cross.rate } : {})
          };
        };

        // Helper function to convert ContractProduct to StairPartDraftV2
        const productToDraft = (p: ContractProduct, partType: StairStepperPart): StairPartDraftV2 => {
          const metaTools = ((p.meta as any)?.tools || []).filter((tool: any) => !isGeneratedStairCutTool(tool));
          const appliedTools = (p.appliedSubServices || []).map((applied: AppliedSubService) => ({
            toolId: applied.subServiceId,
            name: applied.subService?.namePersian || applied.subService?.name || '',
            pricePerMeter: applied.subService?.pricePerMeter || 0,
            edges: (applied as any).edges || {},
            computedMeters: applied.meter || 0,
            totalPrice: applied.cost || 0
          }));
          const tools = metaTools.length > 0 ? metaTools : appliedTools;
          const metaFinishing = (p.meta as any)?.finishing || {};
          const layerInfo = (p.meta as any)?.layerInfo || null;
          // For layer products, extract layer info from meta
          // For regular products, layer info should be null
          const isLayer = (p.meta as any)?.isLayer || false;
          const draftLengthMeters = (p.lengthUnit || 'm') === 'cm'
            ? Number(p.length || 0) / 100
            : Number(p.length || 0);
          const draftWidthMeters = (p.widthUnit || 'cm') === 'm'
            ? Number(p.width || 0)
            : Number(p.width || 0) / 100;
          const legacyOperationPolicyInput = p.operationPolicyInput ||
            adaptLegacyStairOperations({
              product: p,
              productRowId:
                p.rowId ||
                `legacy-stair-row:${p.stairSystemId || 'unknown'}:${partType}`,
              lengthMeters: draftLengthMeters,
              widthMeters: draftWidthMeters,
              quantity: p.quantity
            });

          return {
            cutRateSnapshots: cutRateSnapshotsFromProduct(p),
            operationPolicyInput: legacyOperationPolicyInput,
            stoneId: p.productId,
            stoneLabel: p.stoneName,
            contractualTitle: p.stoneName,
            stoneProduct: p.product,
            pricePerSquareMeter: p.pricePerSquareMeter ?? p.unitPrice ?? p.product?.basePrice ?? 0,
            useMandatory: typeof p.isMandatory === 'boolean' ? p.isMandatory : undefined,
            mandatoryPercentage: p.isMandatory
              ? (p.mandatoryPercentage || 20)
              : (p.mandatoryPercentage ?? null),
            thicknessCm: p.diameterOrWidth,
            lengthValue: p.length,
            lengthUnit: p.lengthUnit || 'm', // Default to meters for length
            widthCm: (p.widthUnit || 'cm') === 'm'
              ? Number(p.width || 0) * 100
              : p.width,
            widthUnit: p.widthUnit || 'cm',
            quantity: p.quantity,
            squareMeters: p.squareMeters,
            sawKerfEnabled: !!p.sawKerfEnabled,
            sawKerfCm: p.sawKerfEnabled ? (p.sawKerfCm || SAW_KERF_CM) : null,
            tools: legacyOperationPolicyInput ? [] : tools.map((t: any) => ({
              selectionId: t.selectionId || t.id || crypto.randomUUID(),
              toolId: t.toolId,
              name: t.name,
              pricePerMeter: t.pricePerMeter,
              calculationBase: t.calculationBase || 'length',
              coveredQuantity: t.coveredQuantity ?? p.quantity,
              front: t.edges?.front || false,
              left: t.edges?.left || false,
              right: t.edges?.right || false,
              back: t.edges?.back || false,
              perimeter: t.edges?.perimeter || false,
              computedMeters: t.computedMeters,
              totalPrice: t.totalPrice
            })),
            totalPrice: p.totalPrice,
            // Load layer fields if this is a layer product or if layer info exists
            // Note: layerPricePerSquareMeter is not needed - layers use the same price as the main stair part
            numberOfLayersPerStair: isLayer && layerInfo ? layerInfo.numberOfLayersPerStair : null,
            layerWidthCm: isLayer ? p.width : null,
            standardLengthValue:
              (p.meta as any)?.stair?.motherLengthMode === 'explicit'
                ? Number(
                    p.standardLengthValue ||
                    (p.meta as any)?.stair?.motherLengthMeters ||
                    0
                  ) || null
                : null,
            standardLengthUnit:
              (p.meta as any)?.stair?.motherLengthMode === 'explicit'
                ? (
                    p.standardLengthUnit ||
                    (p.meta as any)?.stair?.motherLengthDisplayUnit ||
                    'm'
                  )
                : 'm',
            finishingEnabled: legacyOperationPolicyInput
              ? false
              : !!(p.finishingId || p.finishingCost || metaFinishing.id || metaFinishing.cost),
            finishingId: p.finishingId || metaFinishing.id || null,
            finishingCode: p.finishingCode || metaFinishing.code || null,
            finishingLabel: p.finishingName || metaFinishing.name || null,
            finishingPricePerSquareMeter: p.finishingPricePerSquareMeter || p.finishingUnitPrice || metaFinishing.unitPrice || null,
            finishingUnitPrice: p.finishingUnitPrice || p.finishingPricePerSquareMeter || metaFinishing.unitPrice || null,
            finishingCalculationBase: p.finishingCalculationBase || metaFinishing.calculationBase || 'squareMeters',
            finishingQuantity: p.finishingQuantity || p.finishingSquareMeters || metaFinishing.quantity || null,
            calibrationCutEnabled: resolveExistingCalibrationCutEnabled(p.calibrationCutEnabled),
            calibrationSelection: (p.meta as any)?.stair?.calibrationSelection || 'manual',
            description: p.description || ''
          };
        };

        // Helper function to find and merge layer info into draft
        const mergeLayerInfo = (draft: StairPartDraftV2, partType: 'tread' | 'riser' | 'landing'): StairPartDraftV2 => {
          const layerProducts = scopedStairProducts.filter(p =>
            (p.meta as any)?.isLayer &&
            (p.meta as any)?.layerInfo?.parentPartType === partType
          );

          if (layerProducts.length > 0) {
            const configurations = layerProducts.map((layerProduct, index) => {
            const layerInfo = (layerProduct.meta as any)?.layerInfo;
            const layerTypeMeta = (layerProduct.meta as any)?.layerType;
            const layerAltStoneMeta = (layerProduct.meta as any)?.layerAltStone;
            return {
              ...draft,
              cutRateSnapshots: cutRateSnapshotsFromProduct(layerProduct),
              layerConfigurationDraftId:
                layerInfo?.layerConfigurationId ||
                layerProduct.rowId ||
                `legacy-layer:${partType}:${index}`,
              layerConfigurations: [],
              numberOfLayersPerStair: layerInfo?.numberOfLayersPerStair || null,
              layerWidthCm: layerProduct.width || null,
              layerEdges: ((layerProduct.meta as any)?.layerEdges) || undefined,
              layerTypeId: layerProduct.layerTypeId ?? layerTypeMeta?.id ?? null,
              layerTypeName: layerProduct.layerTypeName ?? layerTypeMeta?.name ?? null,
              layerTypePrice: layerProduct.layerTypePrice ?? layerTypeMeta?.pricePerLayer ?? null,
              layerTypeCalculationUnit:
                layerInfo?.calculationUnit ??
                layerTypeMeta?.calculationUnit ??
                null,
              layerSourceKind: layerInfo?.sourceKind ||
                (layerProduct.layerUseDifferentStone || layerAltStoneMeta
                  ? 'newMaterial'
                  : Array.isArray(layerProduct.usedRemainingStones) &&
                    layerProduct.usedRemainingStones.length > 0
                    ? 'contractRemainder'
                    : 'parentMaterial'),
              layerSelectedRemainingStoneIds:
                layerInfo?.selectedRemainingStoneIds ||
                (layerProduct.usedRemainingStones || []).map(stone => stone.id),
              layerDescription:
                layerInfo?.description || layerProduct.description || '',
              layerSideOperations: Array.isArray(
                (layerProduct.meta as any)?.layerSideOperations
              )
                ? Object.fromEntries(
                    (layerProduct.meta as any).layerSideOperations
                      .filter((entry: any) => entry?.side && entry?.input)
                      .map((entry: any) => [entry.side, entry.input])
                  )
                : {},
              layerOperationEditingScope:
                (layerProduct.meta as any)?.layerOperationEditingScope ||
                'all',
              layerDetachedOperationSides:
                (layerProduct.meta as any)?.layerDetachedOperationSides ||
                (
                  Array.isArray((layerProduct.meta as any)?.layerSideOperations)
                    ? (layerProduct.meta as any).layerSideOperations
                        .map((entry: any) => entry?.side)
                        .filter(Boolean)
                    : []
                ),
              layerRemovedSideConflicts: [],
              layerUseDifferentStone: layerProduct.layerUseDifferentStone || !!layerAltStoneMeta,
              layerStoneProductId: layerProduct.layerUseDifferentStone
                ? (layerProduct.layerStoneProductId || layerAltStoneMeta?.id || layerProduct.productId)
                : null,
              layerStoneProduct: layerProduct.layerUseDifferentStone ? layerProduct.product : null,
              layerStoneLabel: layerProduct.layerUseDifferentStone
                ? (layerProduct.layerStoneName || layerAltStoneMeta?.name || layerProduct.stoneName)
                : null,
              layerPricePerSquareMeter: layerProduct.layerUseDifferentStone
                ? (layerProduct.layerStoneBasePricePerSquareMeter || layerAltStoneMeta?.basePricePerSquareMeter || layerProduct.layerStonePricePerSquareMeter || layerProduct.pricePerSquareMeter)
                : null,
              layerUseMandatory: layerProduct.layerUseDifferentStone
                ? (layerProduct.layerUseMandatory ?? ((layerAltStoneMeta?.mandatoryPercentage ?? 0) > 0))
                : undefined,
              layerMandatoryPercentage: layerProduct.layerUseDifferentStone
                ? (layerProduct.layerMandatoryPercentage ?? layerAltStoneMeta?.mandatoryPercentage ?? 20)
                : null,
              layerShortageSource: layerInfo?.shortageSource || null,
              layerManualSourceWidthCm: layerInfo?.manualSource?.widthCm || null,
              layerManualSourceLengthM: layerInfo?.manualSource?.lengthM || null,
              layerManualSourceQuantity: layerInfo?.manualSource?.quantity || null
            };
            });
            return {
              ...draft,
              layerConfigurations: configurations
            };
          }
          return draft;
        };

        const baseDraft = productToDraft(clickedMainProduct, clickedPartType);
        const mergedDraft = mergeLayerInfo(baseDraft, clickedPartType);
        const firstLayerConfigurationId =
          mergedDraft.layerConfigurations?.[0]
            ?.layerConfigurationDraftId;
        const selectedDraft = firstLayerConfigurationId
          ? selectStairLayerConfiguration(
              mergedDraft,
              firstLayerConfigurationId
            )
          : mergedDraft;
        const scopedDraft =
          layerManagement.normalizeLayerAltStoneSettings(selectedDraft);
        stairSystemV2.setDraftTread(clickedPartType === 'tread' ? scopedDraft : createFreshStairPartDraft('tread'));
        stairSystemV2.setDraftRiser(clickedPartType === 'riser' ? scopedDraft : createFreshStairPartDraft('riser'));
        stairSystemV2.setDraftLanding(clickedPartType === 'landing' ? scopedDraft : createFreshStairPartDraft('landing'));
        stairSystemV2.setStairActivePart(clickedPartType);

        // Set product config for modal type detection
        setProductConfig({
          productId: product.productId,
          product: product.product,
          productType: 'stair'
        });

        // Set product type for wizard
        updateWizardData({ selectedProductTypeForAddition: 'stair' });

        setIsEditMode(true);
        setEditingProductIndex(safeParentIndex);
        setTouchedFields(new Set());
        setErrors({});
        setShowProductModal(true);


        return;


      // OLD FLOW: Continue with existing logic

      // Get common stair system info from first product
      const firstProduct = stairSystemProducts[0] || product;
      const numberOfSteps = firstProduct.numberOfSteps || 0;
      const quantityType = firstProduct.quantityType || 'steps';
      // numberOfStaircases is stored in the product, but we'll default to 1 if not found
      // This is a common field across all parts of the same stair system
      const numberOfStaircases = quantityType === 'staircases' ? Math.max(1, Math.floor(numberOfSteps / Math.max(1, (treadProduct?.quantity || numberOfSteps)))) : 1;

      // Reconstruct stair system config
      const editedStairConfig: StairSystemConfig = {
        numberOfSteps: numberOfSteps,
        quantityType: quantityType as 'steps' | 'staircases',
        numberOfStaircases: numberOfStaircases,
        defaultProduct: null,
        tread: {
          partType: 'tread',
          isSelected: !!treadProduct,
          productId: treadProduct?.productId || null,
          product: treadProduct?.product || null,
          treadWidth: treadProduct?.treadWidth || 0,
          treadDepth: treadProduct?.treadDepth || 30,
          quantity: treadProduct?.quantity || numberOfSteps || 0,
          squareMeters: treadProduct?.squareMeters || 0,
          pricePerSquareMeter: treadProduct?.pricePerSquareMeter ?? treadProduct?.unitPrice ?? treadProduct?.product?.basePrice ?? 0,
          totalPrice: treadProduct?.totalPrice || 0,
          nosingType: treadProduct?.nosingType || 'none',
          nosingOverhang: treadProduct?.nosingOverhang || 30,
          nosingCuttingCost: treadProduct?.nosingCuttingCost || 0,
          nosingCuttingCostPerMeter: treadProduct?.nosingCuttingCostPerMeter || 0,
          isMandatory: treadProduct?.isMandatory || false,
          mandatoryPercentage: treadProduct?.mandatoryPercentage || 20,
          originalTotalPrice: treadProduct?.originalTotalPrice || 0,
          description: treadProduct?.description || '',
          currency: treadProduct?.currency || 'تومان',
          lengthUnit: treadProduct?.lengthUnit || 'm'
        },
        riser: {
          partType: 'riser',
          isSelected: !!riserProduct,
          productId: riserProduct?.productId || null,
          product: riserProduct?.product || null,
          riserHeight: riserProduct?.riserHeight || 17,
          quantity: riserProduct?.quantity || numberOfSteps || 0,
          squareMeters: riserProduct?.squareMeters || 0,
          pricePerSquareMeter: riserProduct?.pricePerSquareMeter ?? riserProduct?.unitPrice ?? riserProduct?.product?.basePrice ?? 0,
          totalPrice: riserProduct?.totalPrice || 0,
          isMandatory: riserProduct?.isMandatory || false,
          mandatoryPercentage: riserProduct?.mandatoryPercentage || 20,
          originalTotalPrice: riserProduct?.originalTotalPrice || 0,
          description: riserProduct?.description || '',
          currency: riserProduct?.currency || 'تومان'
        },
        landing: {
          partType: 'landing',
          isSelected: !!landingProduct,
          productId: landingProduct?.productId || null,
          product: landingProduct?.product || null,
          landingWidth: landingProduct?.landingWidth || 0,
          landingDepth: landingProduct?.landingDepth || 0,
          numberOfLandings: landingProduct?.numberOfLandings || 0,
          quantity: landingProduct?.quantity || 0,
          squareMeters: landingProduct?.squareMeters || 0,
          pricePerSquareMeter: landingProduct?.pricePerSquareMeter ?? landingProduct?.unitPrice ?? landingProduct?.product?.basePrice ?? 0,
          totalPrice: landingProduct?.totalPrice || 0,
          isMandatory: landingProduct?.isMandatory || false,
          mandatoryPercentage: landingProduct?.mandatoryPercentage || 20,
          originalTotalPrice: landingProduct?.originalTotalPrice || 0,
          description: landingProduct?.description || '',
          currency: landingProduct?.currency || 'تومان'
        }
      };

      // Set stair system config
      setStairSystemConfig(editedStairConfig);

      // Set product config for modal (needed for modal type detection)
      setProductConfig({
        ...product,
        productType: 'stair'
      });

      // IMPORTANT: Set selectedProduct to enable modal rendering (modal requires selectedProduct && showProductModal)
      // Use the first available product from the stair system, or the current product as fallback
      const defaultProductForModal = treadProduct?.product || riserProduct?.product || landingProduct?.product || product.product;
      setSelectedProduct(defaultProductForModal);

      // Set product type for wizard
      updateWizardData({ selectedProductTypeForAddition: 'stair' });

      // Reset product search terms
      setTreadProductSearchTerm('');
      setRiserProductSearchTerm('');
      setLandingProductSearchTerm('');

      // Expand all sections
      setTreadExpanded(true);
      setRiserExpanded(true);
      setLandingExpanded(true);

      setIsEditMode(true);
      setEditingProductIndex(index); // Store the index of the first product in the stair system
      setTouchedFields(new Set());
      setErrors({}); // Clear errors when opening edit modal
      setShowProductModal(true);


      return;
    }

    // Handle longitudinal product editing (existing logic)
    setSelectedProduct(product.product);

    // Set unit information for proper display
    setLengthUnit(product.lengthUnit || 'm');
    setWidthUnit(product.widthUnit || 'cm');

    // Set mandatory pricing state
    setIsMandatory(product.isMandatory || false);
    setMandatoryPercentage(product.mandatoryPercentage || 20);

    // Set quantity interaction tracking - if quantity > 1, it has been interacted with
    setHasQuantityBeenInteracted((product.quantity || 0) > 0);

    // Set product config with all fields including remaining stone tracking
    // For slab products, ensure slabStandardDimensions is properly loaded
    let slabStandardDimensions = product.slabStandardDimensions || [];

    // Backward compatibility: if slabStandardDimensions is empty but legacy fields exist, create an entry
    if (product.productType === 'slab' && slabStandardDimensions.length === 0) {
      if (product.slabStandardLengthCm && product.slabStandardWidthCm) {
        slabStandardDimensions = [{
          id: `std_legacy_${Date.now()}`,
          standardLengthCm: product.slabStandardLengthCm,
          standardWidthCm: product.slabStandardWidthCm,
          quantity: product.quantity || 1
        }];
      }
    }

    setProductConfig({
      ...product,
      productType: normalizeContractProductType(product.productType) || product.productType,
      finishingEnabled: !!(product.finishingId || product.finishingCost || (product.meta as any)?.finishing?.id || (product.meta as any)?.finishing?.cost),
      calibrationCutEnabled: product.calibrationCutEnabled ?? (product.productType === 'longitudinal' || product.productType === 'stair'),
      ...(isPreparedProductType(product.productType) && {
        preparedKind: product.preparedKind || inferPreparedKindFromProduct(product.product),
        preparedUnit: getPreparedUnit(product),
        preparedQuantity: getPreparedQuantity(product),
        unitPrice: product.unitPrice ?? product.pricePerSquareMeter ?? 0
      }),
      // For slab products, ensure slabStandardDimensions is set
      ...(product.productType === 'slab' && { slabStandardDimensions }),
      // For slab products, ensure slabVerticalCutSides is set (default to all 4 sides active if not present)
      ...(product.productType === 'slab' && {
        slabVerticalCutSides: product.slabVerticalCutSides || {
          top: true,
          bottom: true,
          left: true,
          right: true
        }
      }),
      // Preserve remaining stone tracking
      usedRemainingStones: product.usedRemainingStones || [],
      totalUsedRemainingWidth: product.totalUsedRemainingWidth || 0,
      totalUsedRemainingLength: product.totalUsedRemainingLength || 0,
      // Preserve remaining stones and cut details
      remainingStones: product.remainingStones || [],
      cutDetails: product.cutDetails || [],
      // Preserve SubService tracking
      appliedSubServices: product.appliedSubServices || [],
      totalSubServiceCost: product.totalSubServiceCost || 0,
      usedLengthForSubServices: product.usedLengthForSubServices || 0,
      usedSquareMetersForSubServices: product.usedSquareMetersForSubServices || 0,
    });

    // Set product type for wizard
    updateWizardData({
      selectedProductTypeForAddition: isRemainingStoneChild(product)
        ? 'longitudinal'
        : (normalizeContractProductType(product.productType) || 'longitudinal')
    });

    setIsEditMode(true);
    setEditingProductIndex(index);
    setTouchedFields(new Set()); // Reset touched fields for edit session
    setErrors({}); // Clear errors when opening edit modal
    setShowProductModal(true);
  };

  // Handle creating product from remaining stone
  const handleCreateFromRemainingStone = (remainingStone: RemainingStone, sourceProduct: ContractProduct) => {
    const sanitizedRemainingStone = sanitizeRemainingStoneEntry(remainingStone);
    if (!isUsableRemainingStone(sanitizedRemainingStone)) {
      setErrors({ products: 'این سنگ باقی‌مانده قابل استفاده نیست یا موجودی آن به پایان رسیده است.' });
      return;
    }


    remainingStoneModal.setSelectedRemainingStone(sanitizedRemainingStone);
    remainingStoneModal.setSelectedRemainingStoneSourceProduct(sourceProduct); // Store source product for later use
    returnToProductModalAfterRemainderRef.current = showProductModal;
    setShowProductModal(false);

    // Find parent product index in wizardData.products for explicit parent-child relationship
    const parentProductIndex = wizardData.products.findIndex((product) =>
      (!!sourceProduct.rowId && product.rowId === sourceProduct.rowId) || product === sourceProduct
    );

    // Initialize configuration with remaining stone data
    // Use source product's quantity as default (represents remaining pieces available)
    // IMPORTANT: The child's stoneCode is parent's stoneCode + "-R" + last 4 chars of remainingStone.id
    // This creates a unique code for each child product (for backward compatibility)
    const childStoneCode = `${sourceProduct.stoneCode}-R${sanitizedRemainingStone.id.slice(-4)}`;
    const defaultConfig: Partial<ContractProduct> = {
      productId: sourceProduct.productId,
      product: sourceProduct.product,
      productType: sourceProduct.productType, // NEW: Inherit product type from source
      stoneCode: childStoneCode, // Add remaining stone identifier
      stoneName: `${sourceProduct.stoneName} (از باقی‌مانده)`,
      diameterOrWidth: sanitizedRemainingStone.width,
      length: sanitizedRemainingStone.length, // Initialize with remaining stone length
      width: sanitizedRemainingStone.width, // Initialize with remaining stone width, but allow editing
      quantity: sanitizedRemainingStone.quantity || 1,
      squareMeters: sanitizedRemainingStone.squareMeters,
      pricePerSquareMeter: 0, // No pricing for remaining stone
      totalPrice: 0,
      description: `ساخته شده از سنگ باقی‌مانده (${sanitizedRemainingStone.width}cm عرض)`,
      currency: sourceProduct.currency,
      sawKerfEnabled: false,
      sawKerfCm: null,
      // Unit information for proper display
      lengthUnit: sourceProduct.lengthUnit || 'm',
      widthUnit: sourceProduct.widthUnit || 'cm',
      // Remaining-stone child is always non-mandatory and zero-base-price
      isMandatory: false,
      mandatoryPercentage: 0,
      originalTotalPrice: 0,
      // Stone cutting fields - inherit cutting cost per meter from source product
      isCut: false,
      originalWidth: sanitizedRemainingStone.width,
      originalLength: sanitizedRemainingStone.length, // Store the original remaining length
      cuttingCost: 0,
      cuttingCostPerMeter: sourceProduct.cuttingCostPerMeter || 0, // Inherit from source product
      remainingStones: [],
      cutDetails: [],
      // Initialize SubService tracking
      appliedSubServices: [],
      totalSubServiceCost: 0,
      usedLengthForSubServices: 0,
      usedSquareMetersForSubServices: 0,
      // Set explicit parent reference (if parent found)
      parentProductIndex: parentProductIndex >= 0 ? parentProductIndex : undefined
    };


    remainingStoneModal.setRemainingStoneConfig(defaultConfig);
    // Inherit unit information from source product
    remainingStoneModal.setRemainingStoneLengthUnit(sourceProduct.lengthUnit || 'm');
    remainingStoneModal.setRemainingStoneWidthUnit(sourceProduct.widthUnit || 'cm');
    remainingStoneModal.setRemainingStoneIsMandatory(false);
    remainingStoneModal.setRemainingStoneMandatoryPercentage(0);

    // Initialize partitions array (start with one empty partition)
    remainingStoneModal.setPartitions([{
      id: `partition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      width: 0,
      length: 0,
      quantity:
        sanitizedRemainingStone.inventoryGroupSelection?.requestedQuantity || 1,
      squareMeters: 0
    }]);
    remainingStoneModal.setPartitionLengthUnit(sourceProduct.lengthUnit || 'm');
    remainingStoneModal.setPartitionWidthUnit(sourceProduct.widthUnit || 'cm');

    remainingStoneModal.setShowRemainingStoneModal(true);
  };

  const removeProductFromDeliveries = (deliveries: DeliverySchedule[], removedIndex: number): DeliverySchedule[] => {
    const removedRowId = wizardData.products[removedIndex]?.rowId;
    return deliveries.map((delivery) => ({
      ...delivery,
      products: (delivery.products || []).filter((item) => {
        if (item.rowType === 'service') return true;
        if (item.productRowId && removedRowId) return item.productRowId !== removedRowId;
        return item.productIndex !== removedIndex;
      })
    }));
  };

  const removeProductsFromDeliveries = (deliveries: DeliverySchedule[], removedIndices: number[]): DeliverySchedule[] => {
    const removed = new Set(removedIndices);
    const removedRowIds = new Set(
      removedIndices.map((removedIndex) => wizardData.products[removedIndex]?.rowId).filter((rowId): rowId is string => !!rowId)
    );
    return deliveries.map((delivery) => ({
      ...delivery,
      products: (delivery.products || [])
        .filter((item) => {
          if (item.rowType === 'service') return true;
          if (item.productRowId) return !removedRowIds.has(item.productRowId);
          return !removed.has(item.productIndex as number);
        })
    }));
  };

  const handleDuplicateProduct = (index: number) => {
    const productsWithRowIds = ensureContractProductRowIds(wizardData.products);
    const source = productsWithRowIds[index];
    if (!source) return;

    if (isRemainingStoneChild(source)) {
      setErrors({ products: 'برای ساخت محصول دیگری از باقی‌مانده، همان سنگ باقی‌مانده را انتخاب و تخصیص جدید ایجاد کنید.' });
      return;
    }

    const cloneProduct = (product: ContractProduct, sourceIndex: number, stairSystemId?: string): ContractProduct => {
      const duplicate = JSON.parse(JSON.stringify(product)) as ContractProduct;
      duplicate.rowId = createContractProductRowId();
      duplicate.finishingEnabled = !!(
        duplicate.finishingEnabled ||
        duplicate.finishingId ||
        duplicate.finishingCost ||
        (duplicate.meta as any)?.finishing?.id ||
        (duplicate.meta as any)?.finishing?.cost
      );
      duplicate.calibrationCutEnabled = duplicate.calibrationCutEnabled ?? (duplicate.productType === 'longitudinal' || duplicate.productType === 'stair');
      if (stairSystemId) {
        duplicate.stairSystemId = stairSystemId;
      } else {
        delete duplicate.stairSystemId;
      }
      delete duplicate.parentProductIndex;
      delete duplicate.parentProductRowId;
      delete duplicate.remainingStoneAllocationOrder;
      duplicate.usedRemainingStones = [];
      duplicate.totalUsedRemainingWidth = 0;
      duplicate.totalUsedRemainingLength = 0;
      duplicate.remainingStones = normalizeRemainingStoneCollection(
        duplicate.remainingStoneSourceInventory || duplicate.smartCutPlan?.remainingStones || duplicate.remainingStones || []
      );
      duplicate.remainingStoneSourceInventory = normalizeRemainingStoneCollection(duplicate.remainingStones);
      duplicate.meta = {
        ...(duplicate.meta || {}),
        duplicatedFromProductIndex: sourceIndex,
        remainingSource: undefined
      };
      return duplicate;
    };

    const duplicateProducts = source.productType === 'stair' && source.stairSystemId
      ? (() => {
          const parentIndex = resolveStairParentIndex(
            productsWithRowIds,
            source,
            index
          );
          if (parentIndex < 0) return [];
          const scopedProducts = getStairRowWithAttachedLayers(productsWithRowIds, parentIndex);
          if (!window.confirm('این پله همراه با لایه‌های وابسته، با شناسه‌های جدید و محاسبه مستقل تکثیر می‌شود. ادامه می‌دهید؟')) {
            return [];
          }
          const newStairSystemId = `stair_duplicate_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const clones = scopedProducts.map((product) =>
            cloneProduct(product, productsWithRowIds.indexOf(product), newStairSystemId)
          );
          const clonedParent = clones.find(isStairMainProduct);
          return clones.map((clone) => isStairLayerProduct(clone) && clonedParent
            ? {
                ...clone,
                parentProductIndex: productsWithRowIds.length,
                parentProductRowId: clonedParent.rowId,
                meta: {
                  ...clone.meta,
                  layerInfo: {
                    ...(clone.meta as any)?.layerInfo,
                    parentProductRowId: clonedParent.rowId
                  }
                }
              }
            : clone
          );
        })()
      : [cloneProduct(source, index, source.productType === 'stair' ? `stair_duplicate_${Date.now()}_${Math.random().toString(36).slice(2, 9)}` : undefined)];

    if (duplicateProducts.length === 0) return;
    updateWizardData({
      products: [...productsWithRowIds, ...duplicateProducts]
    });
  };

  const handleUpdateProductImages = (index: number, images: string[]) => {
    updateWizardData({
      products: wizardData.products.map((product, productIndex) =>
        productIndex === index ? { ...product, images } : product
      )
    });
  };

  const uploadContractRowImage = async (file: File): Promise<string> => {
    const response = await salesAPI.uploadImage(file);
    const url = response.data?.data?.url;
    if (!url) {
      throw new Error('Image upload failed');
    }
    return url;
  };

  const handleRemoveProductFromContract = (index: number) => {
    const productsWithRowIds = ensureContractProductRowIds(wizardData.products);
    const productToRemove = productsWithRowIds[index];
    const sourceRowId = productToRemove?.parentProductRowId;

    if (!sourceRowId) {
      const attachedChildren = productToRemove?.rowId
        ? productsWithRowIds.filter((product) => product.parentProductRowId === productToRemove.rowId)
        : [];
      const attachedLayers = attachedChildren.filter(isStairLayerProduct);
      const independentChildren = attachedChildren.filter((child) => !isStairLayerProduct(child));
      if (independentChildren.length > 0) {
        setErrors({ products: `این محصول منبع دارای ${attachedChildren.length} محصول ساخته‌شده از باقی‌مانده است. ابتدا آن تخصیص‌ها را حذف کنید.` });
        return;
      }

      if (attachedLayers.length > 0 && !window.confirm('این پله و تمام لایه‌های وابسته به آن حذف می‌شوند. ادامه می‌دهید؟')) {
        return;
      }
      const removedIndices = productsWithRowIds
        .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
        .filter(({ candidate, candidateIndex }) => candidateIndex === index || attachedLayers.includes(candidate))
        .map(({ candidateIndex }) => candidateIndex);
      const removedIndexSet = new Set(removedIndices);
      const newProducts = productsWithRowIds.filter((_, productIndex) => !removedIndexSet.has(productIndex));
      updateWizardData({
        products: newProducts,
        deliveries: removeProductsFromDeliveries(wizardData.deliveries || [], removedIndices)
      });
      return;
    }

    const candidateProducts = productsWithRowIds.filter((_, productIndex) => productIndex !== index);
    const sourceProductIndex = candidateProducts.findIndex((product) => product.rowId === sourceRowId);
    if (isStairLayerProduct(productToRemove) && sourceProductIndex >= 0) {
      const sourceProduct = candidateProducts[sourceProductIndex];
      candidateProducts[sourceProductIndex] = {
        ...sourceProduct,
        remainingStones: normalizeRemainingStoneCollection(
          sourceProduct.remainingStoneSourceInventory || sourceProduct.remainingStones
        )
      };
    }
    const sourceProduct = sourceProductIndex >= 0 ? candidateProducts[sourceProductIndex] : undefined;
    const replay = replayRemainingStoneAllocations({
      products: candidateProducts,
      sourceRowId,
      sourceInventory: sourceProduct?.remainingStoneSourceInventory || sourceProduct?.smartCutPlan?.remainingStones
    });
    if (!replay.ok) {
      setErrors({ products: formatRemainingStoneReplayConflicts(replay.conflicts) });
      return;
    }

    const deliveriesAfterRemoval = removeProductFromDeliveries(wizardData.deliveries || [], index);
    updateWizardData({ products: replay.products, deliveries: deliveriesAfterRemoval });
    setErrors({});
  };

  const handleCreateProductFromContractFlow = () => {
    localStorage.setItem('contractWizardState', JSON.stringify({
      currentStep,
      wizardData
    }));
    router.push(`/dashboard/sales/products/create?returnTo=contract&step=${currentStep}`);
  };

  const handleAddServiceRow = (
    sourceType: ContractServiceRowSourceType,
    item: SubService | CuttingType | StoneFinishing
  ) => {
    const row = createContractServiceRow(sourceType, item);
    updateWizardData({
      serviceRows: [...(wizardData.serviceRows || []), row]
    });
    setErrors(prev => {
      const { products: _productsError, ...rest } = prev;
      return rest;
    });
  };

  const handleUpdateServiceRow = (
    rowId: string,
    updates: Partial<Pick<ContractServiceRow, 'quantity' | 'unitPrice' | 'description' | 'images'>>
  ) => {
    updateWizardData({
      serviceRows: (wizardData.serviceRows || []).map((row) =>
        row.id === rowId ? recalculateContractServiceRow(row, updates) : row
      )
    });
  };

  const handleDuplicateServiceRow = (rowId: string) => {
    const source = (wizardData.serviceRows || []).find((row) => row.id === rowId);
    if (!source) return;

    const duplicate = {
      ...source,
      id: `${source.sourceType}-${source.sourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      images: [...(source.images || [])]
    };

    updateWizardData({
      serviceRows: [...(wizardData.serviceRows || []), duplicate]
    });
  };

  const handleRemoveServiceRow = (rowId: string) => {
    updateWizardData({
      serviceRows: (wizardData.serviceRows || []).filter((row) => row.id !== rowId),
      deliveries: (wizardData.deliveries || []).map((delivery) => ({
        ...delivery,
        products: (delivery.products || []).filter((item) => !(item.rowType === 'service' && item.serviceRowId === rowId))
      }))
    });
  };

  const handleResolveLegacyRemainingAddOns = (index: number, action: 'adopt' | 'remove') => {
    const productsWithRowIds = ensureContractProductRowIds(wizardData.products);
    const product = productsWithRowIds[index];
    if (!product) return;

    const resolution = resolveLegacyRemainingChildAddOns(product, action);
    if (!resolution.ok) {
      setErrors({ products: 'افزونه‌های قدیمی با هندسه این محصول سازگار نیستند.' });
      return;
    }

    const nextProducts = productsWithRowIds.map((item, itemIndex) => itemIndex === index ? resolution.product : item);
    if (resolution.product.parentProductRowId) {
      const replay = replayRemainingStoneAllocations({
        products: nextProducts,
        sourceRowId: resolution.product.parentProductRowId
      });
      if (!replay.ok) {
        setErrors({ products: formatRemainingStoneReplayConflicts(replay.conflicts) });
        return;
      }
      updateWizardData({ products: replay.products });
    } else {
      updateWizardData({ products: nextProducts });
    }
    setErrors({});
  };

  const productCartController = useContractProductCartController({
    wizardData,
    updateWizardData,
    products,
    subServices,
    cuttingTypes,
    stoneFinishings,
    filteredProducts,
    productSearchTerm,
    setProductSearchTerm,
    serviceSearchTerm,
    setServiceSearchTerm,
    serviceSourceType,
    setServiceSourceType,
    productsSummary: contractCartSummary,
    selectProduct: (product) => {
      sellerProductHistory.recordSelection(product.id);
      handleProductSelection(product);
    },
    editProduct: handleEditProduct,
    duplicateProduct: handleDuplicateProduct,
    removeProduct: handleRemoveProductFromContract,
    updateProductImages: handleUpdateProductImages,
    addServiceRow: handleAddServiceRow,
    updateServiceRow: handleUpdateServiceRow,
    duplicateServiceRow: handleDuplicateServiceRow,
    removeServiceRow: handleRemoveServiceRow,
    uploadImage: uploadContractRowImage,
    useRemainingStone: handleCreateFromRemainingStone,
    resolveLegacyRemainingAddOns: handleResolveLegacyRemainingAddOns,
    createProduct: handleCreateProductFromContractFlow
  });

  // Digital confirmation handlers
  const refreshConfirmationStatus = async () => {
    const signatureContractId = wizardData.signature?.contractId;
    if (!signatureContractId) {
      return;
    }

    try {
      const response = await salesAPI.getConfirmationStatus(signatureContractId);
      if (!response.data.success) {
        return;
      }

      const statusData = response.data.data;
      const existingSignature = wizardData.signature;
      updateWizardData({
        signature: {
          ...(existingSignature || {
            phoneNumber: null,
            contractId: signatureContractId,
            confirmationSent: false,
            confirmationStatus: null,
            linkExpiresAt: null,
            otpExpiresAt: null,
            attemptsUsed: 0,
            maxAttempts: 5,
            resendCount: 0,
            lastSentAt: null,
            lastOpenedAt: null
          }),
          phoneNumber: statusData.phoneNumber || existingSignature?.phoneNumber || null,
          contractStatus: statusData.contractStatus || existingSignature?.contractStatus || null,
          confirmationSent: !!statusData.sessionStatus,
          confirmationStatus: statusData.sessionStatus,
          linkExpiresAt: statusData.linkExpiresAt || null,
          otpExpiresAt: statusData.otpExpiresAt || null,
          attemptsUsed: statusData.attemptsUsed || 0,
          maxAttempts: statusData.maxAttempts || 5,
          resendCount: statusData.resendCount || 0,
          lastSentAt: statusData.lastSentAt || null,
          lastOpenedAt: statusData.lastOpenedAt || null
        }
      });
    } catch (error: any) {
      setErrors(prev => ({
        ...prev,
        signature: error.response?.data?.error || 'خطا در دریافت وضعیت تایید'
      }));
    }
  };

  const getPrintablePdfUrl = async (contractId: string, fresh = false): Promise<string | null> => {
    const response = await salesAPI.getContractPdf(contractId, { fresh });
    if (!response.data?.success) {
      return null;
    }
    return response.data?.data?.url || null;
  };

  const openPdfUrl = (url: string, tryPrint: boolean) => {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win || !tryPrint) return;

    // Best effort. Some browsers/PDF viewers may block programmatic print.
    try {
      const triggerPrint = () => {
        try {
          win.focus();
          win.print();
        } catch (error) {
          console.error('Print trigger failed:', error);
        }
      };
      win.addEventListener('load', triggerPrint, { once: true });
      setTimeout(triggerPrint, 1200);
    } catch (error) {
      console.error('Print setup failed:', error);
    }
  };

  const handleDownloadContractPdf = async () => {
    const signatureContractId = wizardData.signature?.contractId;
    if (!signatureContractId) {
      setErrors(prev => ({ ...prev, signature: 'ابتدا قرارداد را ثبت کنید' }));
      return;
    }

    setPdfActionLoading(true);
    setErrors(prev => ({ ...prev, signature: '' }));
    try {
      const response = await salesAPI.downloadContractPdf(signatureContractId, { fresh: false });
      downloadBlobResponse(response, `sales_contract_${signatureContractId}.pdf`);
    } catch (error: any) {
      setErrors(prev => ({ ...prev, signature: error.response?.data?.error || 'خطا در دانلود PDF قرارداد' }));
    } finally {
      setPdfActionLoading(false);
    }
  };

  const handlePrintContractPdf = async () => {
    const signatureContractId = wizardData.signature?.contractId;
    if (!signatureContractId) {
      setErrors(prev => ({ ...prev, signature: 'ابتدا قرارداد را ثبت کنید' }));
      return;
    }

    setPrintActionLoading(true);
    setErrors(prev => ({ ...prev, signature: '' }));
    try {
      const printResponse = await salesAPI.printContract(signatureContractId);
      if (!printResponse.data?.success) {
        setErrors(prev => ({ ...prev, signature: printResponse.data?.error || 'پرینت قرارداد ناموفق بود' }));
        return;
      }

      const url = await getPrintablePdfUrl(signatureContractId, false);
      if (!url) {
        setErrors(prev => ({ ...prev, signature: 'فایل PDF برای پرینت در دسترس نیست' }));
        return;
      }

      await refreshConfirmationStatus();
      openPdfUrl(url, true);
    } catch (error: any) {
      setErrors(prev => ({ ...prev, signature: error.response?.data?.error || 'خطا در پرینت قرارداد' }));
    } finally {
      setPrintActionLoading(false);
    }
  };

  const handleSendForConfirmation = async () => {
    const signatureContractId = wizardData.signature?.contractId;
    if (!signatureContractId) {
      setErrors(prev => ({ ...prev, signature: 'ابتدا قرارداد را ثبت کنید' }));
      return;
    }

    digitalSignature.setSendingCode(true);
    setErrors(prev => ({ ...prev, signature: '' }));
    try {
      const response = await salesAPI.sendForConfirmation(signatureContractId);
      if (!response.data.success) {
        setErrors(prev => ({ ...prev, signature: response.data.error || 'ارسال تایید ناموفق بود' }));
        return;
      }

      const existingSignature = wizardData.signature;
      updateWizardData({
        signature: {
          ...(existingSignature || {
            phoneNumber: null,
            contractId: signatureContractId,
            confirmationSent: false,
            confirmationStatus: null,
            linkExpiresAt: null,
            otpExpiresAt: null,
            attemptsUsed: 0,
            maxAttempts: 5,
            resendCount: 0,
            lastSentAt: null,
            lastOpenedAt: null
          }),
          phoneNumber: response.data.data?.phoneNumber || existingSignature?.phoneNumber || null,
          contractStatus: response.data.data?.status || existingSignature?.contractStatus || null,
          confirmationSent: true,
          confirmationStatus: 'PENDING',
          linkExpiresAt: response.data.data?.expiresAt || null,
          otpExpiresAt: response.data.data?.otpExpiresAt || null,
          lastSentAt: new Date().toISOString()
        }
      });
      await refreshConfirmationStatus();
    } catch (error: any) {
      setErrors(prev => ({ ...prev, signature: error.response?.data?.error || 'خطا در ارسال پیامک تایید' }));
    } finally {
      digitalSignature.setSendingCode(false);
    }
  };

  const handleResendConfirmation = async () => {
    if (!wizardData.signature?.contractId) {
      return;
    }
    digitalSignature.setSendingCode(true);
    try {
      const response = await salesAPI.resendConfirmation(wizardData.signature.contractId);
      if (!response.data.success) {
        setErrors(prev => ({ ...prev, signature: response.data.error || 'ارسال مجدد ناموفق بود' }));
        return;
      }
      await refreshConfirmationStatus();
    } catch (error: any) {
      setErrors(prev => ({ ...prev, signature: error.response?.data?.error || 'خطا در ارسال مجدد' }));
    } finally {
      digitalSignature.setSendingCode(false);
    }
  };

  const handleCancelContract = async () => {
    if (!wizardData.signature?.contractId) {
      return;
    }

    digitalSignature.setSendingCode(true);
    try {
      const response = await salesAPI.cancelContract(wizardData.signature.contractId);
      if (!response.data.success) {
        setErrors(prev => ({ ...prev, signature: response.data.error || 'لغو قرارداد ناموفق بود' }));
        return;
      }
      await refreshConfirmationStatus();
      router.push('/dashboard/sales/contracts');
    } catch (error: any) {
      setErrors(prev => ({ ...prev, signature: error.response?.data?.error || 'خطا در لغو قرارداد' }));
    } finally {
      digitalSignature.setSendingCode(false);
    }
  };

  useEffect(() => {
    if (currentStep === 7 && wizardData.signature?.contractId) {
      refreshConfirmationStatus();
    }
  }, [currentStep, wizardData.signature?.contractId]);

  // Handle product configuration and add to contract
  const handleAddProductToContract = () => {

    if (!selectedProduct || !productConfig) {
      return;
    }

    // Resolve product type from modal selection (fallback to remembered type)
    const productType = normalizeContractProductType(productConfig.productType || wizardData.selectedProductTypeForAddition);
    if (!productType) {
      console.error('❌ Product type not selected');
      setErrors({ products: 'لطفاً ابتدا نوع محصول را انتخاب کنید' });
      return;
    }

    if (productType === 'prepared') {
      const preparedKind = productConfig.preparedKind || inferPreparedKindFromProduct(selectedProduct);
      const preparedUnit = getPreparedUnit(productConfig as ContractProduct);
      const preparedQuantity = Number(productConfig.preparedQuantity ?? productConfig.quantity ?? 0) || 0;
      const unitPrice = Number(productConfig.unitPrice ?? productConfig.pricePerSquareMeter ?? 0) || 0;

      if (!preparedKind || !preparedUnit || preparedQuantity <= 0 || unitPrice < 0) {
        setErrors({ products: 'لطفاً نوع، واحد، مقدار و قیمت واحد ردیف کیوبیک و قطعات آماده را کامل کنید' });
        return;
      }

      const squareMeters = preparedUnit === 'squareMeter' ? preparedQuantity : 0;
      const totalPrice = preparedQuantity * unitPrice;
      const finalProduct: ContractProduct = {
        rowId: isEditMode && editingProductIndex !== null
          ? wizardData.products[editingProductIndex]?.rowId || createContractProductRowId()
          : createContractProductRowId(),
        productId: selectedProduct.id,
        product: selectedProduct,
        productType: 'prepared',
        preparedKind,
        preparedUnit,
        preparedQuantity,
        stoneCode: productConfig.stoneCode || selectedProduct.code,
        stoneName: productConfig.stoneName || selectedProduct.namePersian,
        diameterOrWidth: productConfig.diameterOrWidth || selectedProduct.widthValue || 0,
        length: 0,
        width: 0,
        quantity: preparedQuantity,
        squareMeters,
        pricePerSquareMeter: unitPrice,
        unitPrice,
        totalPrice,
        description: productConfig.description || '',
        images: Array.isArray(productConfig.images) ? [...productConfig.images] : [...(selectedProduct.images || [])],
        currency: 'تومان',
        sawKerfEnabled: false,
        sawKerfCm: null,
        lengthUnit: 'm',
        widthUnit: 'cm',
        isMandatory: false,
        mandatoryPercentage: 0,
        originalTotalPrice: totalPrice,
        isCut: false,
        cutType: null,
        originalWidth: selectedProduct.widthValue || 0,
        originalLength: 0,
        cuttingCost: 0,
        cuttingCostPerMeter: 0,
        cutDescription: '',
        remainingStones: [],
        cutDetails: [],
        usedRemainingStones: [],
        totalUsedRemainingWidth: 0,
        totalUsedRemainingLength: 0,
        appliedSubServices: [],
        totalSubServiceCost: 0,
        usedLengthForSubServices: 0,
        usedSquareMetersForSubServices: 0
      };

      if (isEditMode && editingProductIndex !== null) {
        const updatedProducts = [...wizardData.products];
        updatedProducts[editingProductIndex] = finalProduct;
        updateWizardData({ products: updatedProducts, selectedProductTypeForAddition: 'prepared' });
      } else {
        updateWizardData({ products: [...wizardData.products, finalProduct], selectedProductTypeForAddition: 'prepared' });
      }

      publishProductSaveFeedback(
        isEditMode ? 'edited' : 'created',
        finalProduct.rowId
      );
      setShowProductModal(false);
      setSelectedProduct(null);
      setProductConfig({});
      setLengthUnit('m');
      setWidthUnit('cm');
      setIsMandatory(false);
      setMandatoryPercentage(20);
      setIsEditMode(false);
      setEditingProductIndex(null);
      setTouchedFields(new Set());
      clearProductAdditionSearches();
      setErrors({});
      return;
    }

    // Handle different product types
    // SLAB STONE VALIDATION AND CALCULATION
    if (productType === 'slab' && productConfig.slabPolicyInput) {
      const canonicalSlabCalculation = calculateSlab(productConfig.slabPolicyInput);
      if (!canonicalSlabCalculation.ok) {
        setErrors({
          products: 'ابعاد، تعداد، قیمت و چیدمان اسلب را بررسی کنید'
        });
        return;
      }

      const slab = canonicalSlabCalculation.result;
      const slabLengthUnit = slab.lengthDisplayUnit;
      const slabWidthUnit = slab.widthDisplayUnit;
      const displayLength = slabLengthUnit === 'cm'
        ? Number(slab.lengthMeters) * 100
        : Number(slab.lengthMeters);
      const displayWidth = slabWidthUnit === 'cm'
        ? Number(slab.widthMeters) * 100
        : Number(slab.widthMeters);
      const standardDimensions: SlabStandardDimensionEntry[] = slab.sourceRows.map(source => ({
        id: source.sourceRowId,
        standardLengthCm: Number(source.lengthMeters) * 100,
        standardWidthCm: Number(source.widthMeters) * 100,
        quantity: source.quantity
      }));
      const firstSource = standardDimensions[0];
      const sawKerfCm = Number(productConfig.slabPolicyInput.kerfMeters) * 100;
      const sawKerfEnabled = sawKerfCm > 0;
      const lineBased = slab.cuttingPricingMethod === 'lineBased';
      const longitudinalMeters = Number(slab.packingPlan.longitudinalCutMeters);
      const crossMeters = Number(slab.packingPlan.crossCutMeters);
      const longitudinalRate = Number(
        productConfig.slabPolicyInput.longitudinalCutRateToman ?? 0
      );
      const crossRate = Number(productConfig.slabPolicyInput.crossCutRateToman ?? 0);
      const totalCuttingCost =
        Number(slab.cuttingAmountToman) + Number(slab.verticalCutAmountToman);
      const remainingStones: RemainingStone[] = slab.packingPlan.remainders.map(
        remainder => ({
          id: remainder.remainingStoneId,
          width: Number(remainder.widthMeters) * 100,
          length: Number(remainder.lengthMeters),
          squareMeters:
            Number(remainder.widthMeters) * Number(remainder.lengthMeters),
          isAvailable: true,
          sourceCutId: `${remainder.sourceBatchId}:${remainder.sourceOrdinal}`,
          position: {
            startWidth: Number(remainder.xMeters) * 100,
            startLength: Number(remainder.yMeters)
          },
          quantity: 1
        })
      );
      const cutDetails: StoneCut[] = slab.packingPlan.cuts.map(cut => {
        const isLongitudinal = cut.axis === 'longitudinal';
        const rate = isLongitudinal ? longitudinalRate : crossRate;
        const meters = Number(cut.meters);
        return {
          id: cut.cutId,
          type: isLongitudinal ? 'longitudinal' : 'cross',
          orientation: cut.axis,
          meters,
          rate,
          cost: Math.round(meters * rate),
          originalWidth: firstSource?.standardWidthCm ?? 0,
          cutWidth: displayWidth,
          remainingWidth: 0,
          length: meters,
          cuttingCost: Math.round(meters * rate),
          cuttingCostPerMeter: rate
        };
      });
      if (slab.verticalCutPricingLine) {
        const verticalMeters = Number(slab.verticalCutPricingLine.quantity);
        const verticalRate = Number(slab.verticalCutPricingLine.rateToman);
        cutDetails.push({
          id: `${productConfig.slabPolicyInput.sourceBatchId}:vertical`,
          type: 'vertical',
          selectedSides: [...productConfig.slabPolicyInput.verticalCutSides],
          meters: verticalMeters,
          rate: verticalRate,
          cost: Number(slab.verticalCutPricingLine.amountToman),
          originalWidth: firstSource?.standardWidthCm ?? 0,
          cutWidth: displayWidth,
          remainingWidth: 0,
          length: verticalMeters,
          cuttingCost: Number(slab.verticalCutPricingLine.amountToman),
          cuttingCostPerMeter: verticalRate
        });
      }

      const operationPolicyInput = refreshOperationGeometry(
        productConfig.operationPolicyInput,
        displayLength,
        slabLengthUnit,
        displayWidth,
        slabWidthUnit,
        slab.quantity
      );
      const operations = materializeOperationSnapshots(operationPolicyInput);
      if (!operations.ok) {
        setErrors({ products: operations.message });
        return;
      }

      const previousSlabProduct =
        isEditMode && editingProductIndex !== null
          ? wizardData.products[editingProductIndex]
          : null;
      const finalProduct: ContractProduct = reconcileContractProductPricing({
        rowId: previousSlabProduct?.rowId || createContractProductRowId(),
        productId: selectedProduct.id,
        product: selectedProduct,
        productType: 'slab',
        slabPolicyInput: productConfig.slabPolicyInput,
        stoneCode: productConfig.stoneCode || selectedProduct.code,
        stoneName:
          productConfig.stoneName || generateSlabContractProductName(selectedProduct),
        diameterOrWidth: productConfig.diameterOrWidth || selectedProduct.widthValue,
        length: displayLength,
        width: displayWidth,
        quantity: slab.quantity,
        squareMeters: Number(slab.finishedAreaSquareMeters),
        pricePerSquareMeter: Number(
          productConfig.slabPolicyInput.baseMaterialRateToman
        ),
        totalPrice:
          Number(slab.totalAmountToman) +
          operations.toolsCost +
          operations.finishingsCost,
        description: productConfig.description || '',
        images: Array.isArray(productConfig.images)
          ? [...productConfig.images]
          : [...(selectedProduct.images || [])],
        currency: 'تومان',
        lengthUnit: slabLengthUnit,
        widthUnit: slabWidthUnit,
        isMandatory: false,
        mandatoryPercentage: 0,
        originalTotalPrice: Number(slab.materialAmountToman),
        sawKerfEnabled,
        sawKerfCm: sawKerfEnabled ? sawKerfCm : null,
        isCut: slab.packingPlan.cuts.length > 0,
        cutType:
          longitudinalMeters > 0 && crossMeters > 0
            ? 'cross'
            : longitudinalMeters > 0
              ? 'longitudinal'
              : null,
        originalWidth: firstSource?.standardWidthCm ?? 0,
        originalLength:
          slabLengthUnit === 'm'
            ? (firstSource?.standardLengthCm ?? 0) / 100
            : firstSource?.standardLengthCm ?? 0,
        cuttingCost: totalCuttingCost,
        physicalCuttingCost: totalCuttingCost,
        cuttingCostPerMeter: lineBased
          ? longitudinalRate || crossRate
          : 0,
        cutDescription: lineBased ? 'برش براساس خطوط واقعی چیدمان' : 'برش براساس مترمربع',
        slabVerticalCutSides: Object.fromEntries(
          (['top', 'bottom', 'left', 'right'] as const).map(side => [
            side,
            productConfig.slabPolicyInput!.verticalCutSides.includes(side)
          ])
        ) as ContractProduct['slabVerticalCutSides'],
        slabVerticalCutCost: Number(slab.verticalCutAmountToman),
        slabVerticalCutCostPerMeter:
          productConfig.slabPolicyInput.verticalCutRateToman === undefined
            ? 0
            : Number(productConfig.slabPolicyInput.verticalCutRateToman),
        remainingStones,
        remainingStoneSourceInventory: normalizeRemainingStoneCollection(remainingStones),
        cutDetails,
        usedRemainingStones: [],
        totalUsedRemainingWidth: 0,
        totalUsedRemainingLength: 0,
        operationPolicyInput,
        appliedSubServices: operations.appliedSubServices,
        totalSubServiceCost: operations.toolsCost,
        usedLengthForSubServices: 0,
        usedSquareMetersForSubServices: 0,
        finishings: operations.finishings,
        finishingCost: operations.finishingsCost,
        slabStandardLengthCm: firstSource?.standardLengthCm ?? 0,
        slabStandardWidthCm: firstSource?.standardWidthCm ?? 0,
        slabStandardDimensions: standardDimensions,
        slabCuttingMode: lineBased ? 'lineBased' : 'perSquareMeter',
        slabCuttingPricePerSquareMeter:
          lineBased
            ? null
            : Number(productConfig.slabPolicyInput.squareMeterCutRateToman ?? 0),
        slabLineCuttingStrategy: 'length',
        slabLineCuttingLongitudinalMeters: longitudinalMeters,
        slabLineCuttingCrossMeters: crossMeters,
        meta: {
          calculation: {
            policyVersion: slab.calculationPolicyVersion,
            inputHash: slab.inputHash,
            resultHash: slab.resultHash,
            packingPolicyVersion: slab.packingPlan.policyVersion
          },
          sawKerf: sawKerfEnabled
            ? { enabled: true, cm: sawKerfCm }
            : undefined
        } as any
      });

      if (isEditMode && editingProductIndex !== null) {
        const updatedProducts = ensureContractProductRowIds(wizardData.products);
        updatedProducts[editingProductIndex] = finalProduct;
        const sourceRowId = finalProduct.rowId as string;
        const hasRemainingChildren = updatedProducts.some(
          product => product.parentProductRowId === sourceRowId
        );
        if (hasRemainingChildren) {
          const replay = replayRemainingStoneAllocations({
            products: updatedProducts,
            sourceRowId,
            sourceInventory: finalProduct.remainingStoneSourceInventory
          });
          if (!replay.ok) {
            setErrors({
              products: formatRemainingStoneReplayConflicts(replay.conflicts)
            });
            return;
          }
          updateWizardData({
            products: replay.products,
            selectedProductTypeForAddition: productType
          });
        } else {
          updateWizardData({
            products: updatedProducts,
            selectedProductTypeForAddition: productType
          });
        }
      } else {
        updateWizardData({
          products: [...wizardData.products, finalProduct],
          selectedProductTypeForAddition: productType
        });
      }

      publishProductSaveFeedback(
        isEditMode ? 'edited' : 'created',
        finalProduct.rowId
      );
      setShowProductModal(false);
      setSelectedProduct(null);
      setProductConfig({});
      setLengthUnit('m');
      setWidthUnit('cm');
      setIsMandatory(false);
      setMandatoryPercentage(20);
      setIsEditMode(false);
      setEditingProductIndex(null);
      setTouchedFields(new Set());
      clearProductAdditionSearches();
      setErrors({});
      return;
    }

    if (productType === 'slab' && !productConfig.slabPolicyInput) {
      setErrors({ products: 'ابعاد، تعداد و اسلب‌های منبع را کامل کنید' });
      return;
    }

    // LONGITUDINAL STONE VALIDATION AND CALCULATION (existing logic)
    const widthResolvedProductConfig = resolveLongitudinalWidth(
      productConfig,
      selectedProduct,
      widthUnit,
      isEditMode
    );
    if (widthResolvedProductConfig.width !== productConfig.width) {
      Object.assign(productConfig, widthResolvedProductConfig);
      setProductConfig(prev => ({ ...prev, width: widthResolvedProductConfig.width }));
    }

    // Validate required fields - at least one of length/width or squareMeters must be provided
    const previousLongitudinalProduct =
      isEditMode && editingProductIndex !== null ? wizardData.products[editingProductIndex] : null;
    const editingRemainingStoneChild = isRemainingStoneChild(previousLongitudinalProduct);
    const preserveDerivedQuantity =
      !!productConfig.smartCutDerivedQuantity &&
      !touchedFields.has('quantity') &&
      !touchedFields.has('length');
    const hasDimensions = (productConfig.length && productConfig.width) || productConfig.squareMeters;
    const enteredLongitudinalQuantity = Math.max(0, Number(productConfig.quantity) || 0);
    const longitudinalQuantityOptimizerIntent =
      (productConfig.productType || previousLongitudinalProduct?.productType) === 'longitudinal' &&
      (enteredLongitudinalQuantity === 0 || preserveDerivedQuantity);
    const quantityOptimizerRequested =
      longitudinalQuantityOptimizerIntent &&
      Number(productConfig.length || 0) > 0 &&
      Number(productConfig.width || 0) > 0;
    const hasRequiredFields =
      (enteredLongitudinalQuantity > 0 || longitudinalQuantityOptimizerIntent) &&
      (editingRemainingStoneChild || productConfig.pricePerSquareMeter);


    if (!hasDimensions) {
      setErrors({ products: 'لطفاً طول و عرض یا متر مربع را وارد کنید' });
      return;
    }

    if (!hasRequiredFields) {

      // Provide more specific error messages
      if (!productConfig.quantity && !longitudinalQuantityOptimizerIntent) {
        setErrors({ products: 'لطفاً تعداد را وارد کنید' });
      } else if (!productConfig.pricePerSquareMeter && !editingRemainingStoneChild) {
        setErrors({ products: 'لطفاً فی هر متر مربع را وارد کنید' });
      } else {
        setErrors({ products: 'لطفاً تعداد و فی هر متر مربع را وارد کنید' });
      }
      return;
    }

    // Use productConfig.originalWidth when editing, otherwise use selectedProduct.widthValue
    const originalWidthForCalculation = (isEditMode && productConfig.originalWidth)
      ? productConfig.originalWidth
      : selectedProduct.widthValue;

    // Validate width: cannot exceed original width
    if (productConfig.width && originalWidthForCalculation > 0) {
      const userWidthInCm = widthUnit === 'm' ? productConfig.width * 100 : productConfig.width;
      if (userWidthInCm > originalWidthForCalculation) {
        setErrors({
          products: `عرض وارد شده (${productConfig.width}${widthUnit === 'm' ? 'm' : 'cm'}) بیشتر از عرض اصلی سنگ (${originalWidthForCalculation}cm) است. لطفاً عرضی کمتر یا مساوی با ${originalWidthForCalculation}cm وارد کنید.`
        });
        return;
      }
    }

    // Determine if longitudinal cut should be automatically selected (before calculating metrics)
    // Convert width to cm for comparison
    const userWidthForComparison = productConfig.width
      ? (widthUnit === 'm' ? productConfig.width * 100 : productConfig.width)
      : 0;
    const shouldAutoSelectLongitudinalCut = userWidthForComparison > 0 && userWidthForComparison < originalWidthForCalculation && originalWidthForCalculation > 0;

    // Automatically fetch cutting cost per meter if cut should be applied
    let cuttingCostPerMeterForCalc = productConfig.cuttingCostPerMeter || 0;
    if (shouldAutoSelectLongitudinalCut && !cuttingCostPerMeterForCalc) {
      // Fetch price from cutting types for "LONG" (برش طولی)
      cuttingCostPerMeterForCalc = getCuttingTypePricePerMeter('LONG') || 0;
    }

    // Calculate metrics - use effective quantity (default to 1 if not interacted)
    const effectiveQuantity = enteredLongitudinalQuantity > 0 ? enteredLongitudinalQuantity : 1;
    const calculated = calculateStoneMetrics({
      length: productConfig.length,
      width: productConfig.width,
      quantity: quantityOptimizerRequested ? 0 : effectiveQuantity,
      squareMeters: productConfig.squareMeters,
      pricePerSquareMeter: productConfig.pricePerSquareMeter,
      lengthUnit: lengthUnit,
      widthUnit: widthUnit,
      isMandatory: isMandatory,
      mandatoryPercentage: mandatoryPercentage,
      isCut: productConfig.isCut || shouldAutoSelectLongitudinalCut, // Use auto-selection result
      originalWidth: originalWidthForCalculation,
      cuttingCostPerMeter: cuttingCostPerMeterForCalc // Use fetched value if available
    });

    // Get final width for display/logging
    const userEnteredWidth = calculated.width;
    const originalWidth = originalWidthForCalculation;
    const userEnteredWidthInCm = widthUnit === 'm' ? userEnteredWidth * 100 : userEnteredWidth;


    const finishingEnabled = !!(productConfig as any).finishingEnabled;
    const selectedFinishing = finishingEnabled && productConfig.finishingId
      ? stoneFinishings.find(option => option.id === productConfig.finishingId)
      : undefined;
    const finishingSnapshot = resolveFinishingSnapshot({
      enabled: finishingEnabled,
      selectedFinishing,
      config: productConfig,
      productType: editingRemainingStoneChild
        ? (previousLongitudinalProduct?.productType || 'longitudinal')
        : 'longitudinal',
      length: calculated.length,
      lengthUnit,
      quantity: effectiveQuantity,
      squareMeters: calculated.squareMeters
    });
    const finishingPricePerSquareMeter = finishingSnapshot.unitPrice;
    const finishingSquareMeters = finishingSnapshot.calculationBase === 'squareMeters' ? finishingSnapshot.quantity || 0 : 0;
    const finishingCost = finishingSnapshot.cost;

    if (editingRemainingStoneChild && finishingSnapshot.exceedsGeometry) {
      setErrors({
        products: `مقدار پرداخت سنگ (${formatDisplayNumber(finishingSnapshot.requestedQuantity || 0)}) از ظرفیت هندسی جدید (${formatDisplayNumber(finishingSnapshot.maximumQuantity || 0)}) بیشتر است. ابعاد یا مقدار پرداخت را اصلاح کنید.`
      });
      return;
    }

    // Use cutting cost from calculated result (which already includes the auto-fetched price if applicable)
    const finalCuttingCost = calculated.cuttingCost || 0;
    const finalCuttingCostPerMeter = cuttingCostPerMeterForCalc;
    const sawKerfEnabled = !!productConfig.sawKerfEnabled && userEnteredWidthInCm > 0 && userEnteredWidthInCm < originalWidth;
    const sawKerfCm = sawKerfEnabled ? (productConfig.sawKerfCm || SAW_KERF_CM) : null;
    const calibrationCutEnabled = productConfig.calibrationCutEnabled ?? true;
    const preserveDerivedWidth = productConfig.smartCutDerivedDimension === 'width' && !touchedFields.has('width');
    const preserveDerivedLength = productConfig.smartCutDerivedDimension === 'length' && !touchedFields.has('length');
    const optimizerTotalLength = preserveDerivedQuantity
      ? Number(productConfig.smartCutPlan?.totalRequestedLengthM || 0)
      : 0;
    const smartCutPlan = calculateSmartLongitudinalCutPlan({
      originalWidthCm: originalWidth,
      enteredWidth: preserveDerivedWidth ? 0 : Number(productConfig.width || 0),
      enteredWidthUnit: widthUnit as 'cm' | 'm',
      enteredLength: preserveDerivedLength
        ? 0
        : (optimizerTotalLength > 0 ? optimizerTotalLength : Number(productConfig.length || 0)),
      enteredLengthUnit: lengthUnit as 'cm' | 'm',
      quantity: quantityOptimizerRequested ? 0 : effectiveQuantity,
      requestedAreaSqm: Number(productConfig.squareMeters || calculated.squareMeters || 0),
      allowPhysicalSplitting: !!productConfig.smartCutAllowPhysicalSplitting,
      longitudinalRatePerMeter: finalCuttingCostPerMeter,
      crossRatePerMeter: getCuttingTypePricePerMeter('CROSS') || 0,
      sawKerfEnabled,
      sawKerfCm,
      calibrationCutEnabled
    });
    const quantityOptimizationFailure = resolveLongitudinalQuantityOptimizationFailure(
      quantityOptimizerRequested,
      smartCutPlan
    );
    if (quantityOptimizationFailure) {
      setErrors({ products: quantityOptimizationFailure });
      return;
    }
    const longitudinalPricePerSquareMeter = Number(productConfig.pricePerSquareMeter) || 0;
    const longitudinalMaterialPricing = calculateLongitudinalMaterialPricing({
      plan: smartCutPlan,
      fallbackPricingSquareMeters: longitudinalPricePerSquareMeter > 0
        ? calculated.originalTotalPrice / longitudinalPricePerSquareMeter
        : calculated.squareMeters,
      pricePerSquareMeter: longitudinalPricePerSquareMeter,
      isMandatory,
      mandatoryPercentage
    });
    const shouldCutByGeometry = smartCutPlan.enabled;
    const customerFields = resolveLongitudinalCustomerFields({
      enteredLength: calculated.length,
      enteredLengthUnit: lengthUnit as 'cm' | 'm',
      enteredWidth: calculated.width,
      enteredQuantity: effectiveQuantity,
      plan: smartCutPlan
    });
    const longitudinalGeometryChanged = hasLongitudinalGeometryChanged({
      previousProduct: previousLongitudinalProduct
        ? {
            originalWidth: previousLongitudinalProduct.originalWidth || 0,
            width: previousLongitudinalProduct.width,
            widthUnit: previousLongitudinalProduct.widthUnit as 'cm' | 'm',
            length: previousLongitudinalProduct.length,
            lengthUnit: previousLongitudinalProduct.lengthUnit as 'cm' | 'm',
            quantity: previousLongitudinalProduct.quantity
          }
        : null,
      nextOriginalWidthCm: originalWidth,
      nextWidthValue: userEnteredWidth,
      nextWidthUnit: widthUnit as 'cm' | 'm',
      nextLengthValue: calculated.length,
      nextLengthUnit: lengthUnit as 'cm' | 'm',
      nextQuantity: customerFields.quantity
    });
    const remainingStoneEditState = editingRemainingStoneChild
      ? {
          remainingStones: [] as RemainingStone[],
          usedRemainingStones: [] as RemainingStone[],
          totalUsedRemainingWidth: 0,
          totalUsedRemainingLength: 0
        }
      : mergeEditedRemainingStoneState({
          geometryChanged: !!(isEditMode && longitudinalGeometryChanged),
          nextAvailableRemainingStones: smartCutPlan.remainingStones,
          previousProduct: previousLongitudinalProduct
        });
    const missingCuttingRateWarning = shouldCutByGeometry && finalCuttingCostPerMeter <= 0;
    const calculatedCuttingCost = smartCutPlan.enabled ? smartCutPlan.totalCuttingCost : finalCuttingCost;
    const billableCuttingCost = getBillableCuttingCost({
      productType: 'longitudinal',
      isMandatory: editingRemainingStoneChild ? false : isMandatory,
      mandatoryPercentage: editingRemainingStoneChild ? 0 : mandatoryPercentage,
      cuttingCost: calculatedCuttingCost,
      cutType: shouldCutByGeometry ? 'longitudinal' : null,
      cuttingBreakdown: smartCutPlan.enabled ? smartCutPlan.cuttingBreakdown : undefined
    });
    const operationPolicyInput = refreshOperationGeometry(
      productConfig.operationPolicyInput,
      customerFields.length,
      lengthUnit,
      customerFields.width,
      widthUnit,
      customerFields.quantity
    );
    const operationSnapshots = materializeOperationSnapshots(operationPolicyInput);
    if (!operationSnapshots.ok) {
      setErrors({ products: operationSnapshots.message });
      return;
    }

    // Create final product configuration for longitudinal stone
    const finalProduct: ContractProduct = {
      rowId: previousLongitudinalProduct?.rowId || createContractProductRowId(),
      productId: selectedProduct.id,
      product: selectedProduct,
      productType: editingRemainingStoneChild
        ? (previousLongitudinalProduct?.productType || 'longitudinal')
        : 'longitudinal',
      longitudinalPolicyInput: productConfig.longitudinalPolicyInput,
      stoneCode: productConfig.stoneCode || selectedProduct.code,
      stoneName: productConfig.stoneName || selectedProduct.namePersian,
      diameterOrWidth: productConfig.diameterOrWidth || selectedProduct.widthValue,
      length: customerFields.length,
      width: customerFields.width,
      quantity: customerFields.quantity,
      squareMeters: smartCutPlan.enabled ? smartCutPlan.requestedAreaSqm : calculated.squareMeters,
      pricePerSquareMeter: editingRemainingStoneChild ? 0 : (productConfig.pricePerSquareMeter || 0),
      totalPrice: editingRemainingStoneChild
        ? 0
        : longitudinalMaterialPricing.totalPrice,
      description: productConfig.description || '',
      images: Array.isArray(productConfig.images) ? [...productConfig.images] : [...(selectedProduct.images || [])],
      sawKerfEnabled,
      sawKerfCm,
      calibrationCutEnabled,
      finishingId: finishingEnabled ? (productConfig.finishingId || null) : null,
      finishingCode: finishingEnabled ? (productConfig.finishingCode || selectedFinishing?.code || null) : null,
      finishingName: finishingEnabled
        ? (productConfig.finishingName || selectedFinishing?.namePersian || selectedFinishing?.name || null)
        : null,
      finishingPricePerSquareMeter: finishingEnabled ? finishingPricePerSquareMeter : null,
      finishingUnitPrice: finishingEnabled ? finishingSnapshot.unitPrice : null,
      finishingCalculationBase: finishingEnabled ? finishingSnapshot.calculationBase : null,
      finishingQuantity: finishingEnabled ? finishingSnapshot.quantity : null,
      finishingCost: finishingEnabled ? finishingCost : null,
      finishingSquareMeters: finishingEnabled && finishingCost > 0 ? finishingSquareMeters : null,
      currency: 'تومان', // Use Toman currency
      // Unit information for proper display
      lengthUnit: lengthUnit,
      widthUnit: widthUnit,
      // Mandatory pricing fields
      isMandatory: editingRemainingStoneChild ? false : isMandatory,
      mandatoryPercentage: editingRemainingStoneChild ? 0 : mandatoryPercentage,
      originalTotalPrice: editingRemainingStoneChild
        ? 0
        : longitudinalMaterialPricing.originalTotalPrice,
      // Stone cutting is geometry-driven; pricing can be unavailable while cut still exists.
      isCut: shouldCutByGeometry,
      cutType: shouldCutByGeometry ? 'longitudinal' : null,
      // Preserve originalWidth if editing, otherwise use selectedProduct.widthValue
      originalWidth: (isEditMode && productConfig.originalWidth) ? productConfig.originalWidth : selectedProduct.widthValue,
      // Store originalLength when product is first created (when not from remaining stone)
      // For products created from remaining stone, originalLength is set in handleCreateFromRemainingStone
      originalLength: (isEditMode && productConfig.originalLength !== undefined)
        ? productConfig.originalLength
        : (lengthUnit === 'm' ? customerFields.length : (customerFields.length / 100)),
      cuttingCost: billableCuttingCost,
      physicalCuttingCost: calculatedCuttingCost,
      cuttingCostPerMeter: finalCuttingCostPerMeter,
      cuttingBreakdown: smartCutPlan.enabled ? smartCutPlan.cuttingBreakdown : undefined,
      smartCutPlan: (smartCutPlan.enabled || smartCutPlan.derivedQuantity) ? smartCutPlan : null,
      smartCutAllowPhysicalSplitting: !!productConfig.smartCutAllowPhysicalSplitting,
      smartCutDerivedDimension: smartCutPlan.derivedDimension || null,
      smartCutDerivedQuantity: !!smartCutPlan.derivedQuantity,
      cutDescription:
        productConfig.cutDescription ||
        (shouldCutByGeometry
          ? `برش طولی خودکار (${originalWidth}cm → ${userEnteredWidthInCm.toFixed(2)}cm)${
              missingCuttingRateWarning ? ' - نرخ برش طولی یافت نشد و هزینه برش صفر شد.' : ''
            }`
          : ''),
      remainingStones: remainingStoneEditState.remainingStones,
      cutDetails: (isEditMode && productConfig.cutDetails) ? productConfig.cutDetails : [],
      // Preserve remaining stone usage tracking when editing
      usedRemainingStones: remainingStoneEditState.usedRemainingStones,
      totalUsedRemainingWidth: remainingStoneEditState.totalUsedRemainingWidth,
      totalUsedRemainingLength: remainingStoneEditState.totalUsedRemainingLength,
      parentProductIndex: previousLongitudinalProduct?.parentProductIndex,
      parentProductRowId: previousLongitudinalProduct?.parentProductRowId,
      remainingStoneAllocationOrder: previousLongitudinalProduct?.remainingStoneAllocationOrder,
      remainingStoneSourceInventory: editingRemainingStoneChild
        ? undefined
        : normalizeRemainingStoneCollection(smartCutPlan.remainingStones),
      // SubService tracking - preserve when editing
      operationPolicyInput,
      appliedSubServices: operationSnapshots.appliedSubServices,
      totalSubServiceCost: operationSnapshots.toolsCost,
      usedLengthForSubServices: productConfig.usedLengthForSubServices ?? 0,
      usedSquareMetersForSubServices: productConfig.usedSquareMetersForSubServices ?? 0,
      finishings: operationSnapshots.finishings,
      meta: {
        ...(editingRemainingStoneChild && previousLongitudinalProduct?.meta?.remainingSource
          ? { remainingSource: previousLongitudinalProduct.meta.remainingSource }
          : {}),
        sawKerf: sawKerfEnabled
          ? {
              enabled: true,
              cm: sawKerfCm,
              consumedWidthCm: smartCutPlan.consumedWidthCm,
              sourceBandsNeeded: smartCutPlan.sourceBandsNeeded || 1
            }
          : undefined,
        finishing: finishingEnabled && finishingCost > 0
          ? {
              id: productConfig.finishingId || null,
              code: productConfig.finishingCode || selectedFinishing?.code || null,
              name: productConfig.finishingName || selectedFinishing?.namePersian || selectedFinishing?.name || null,
              pricePerSquareMeter: finishingPricePerSquareMeter,
              unitPrice: finishingSnapshot.unitPrice,
              calculationBase: finishingSnapshot.calculationBase,
              quantity: finishingSnapshot.quantity,
              unitLabel: getFinishingUnitLabel(finishingSnapshot.calculationBase),
              squareMeters: finishingSquareMeters,
              cost: finishingCost
            }
          : undefined
      } as any
    };

    if (smartCutPlan.derivedQuantity) {
      const recalculatedAddOns = recalculateRemainingChildAddOns(finalProduct);
      if (!recalculatedAddOns.ok) {
        setErrors({ products: 'افزونه‌های محصول با خروجی بهینه‌سازی‌شده سازگار نیستند.' });
        return;
      }
      Object.assign(finalProduct, recalculatedAddOns.product);
    }

    // Add operation costs after optimizer-owned geometry has recalculated its add-ons.
    const existingSubServiceCost = Number(finalProduct.totalSubServiceCost || 0);
    const resolvedFinishingCost =
      operationSnapshots.finishingsCost + Number(finalProduct.finishingCost || 0);
    finalProduct.totalPrice =
      (editingRemainingStoneChild ? 0 : longitudinalMaterialPricing.totalPrice) +
      billableCuttingCost +
      existingSubServiceCost +
      resolvedFinishingCost;

    // Add to contract or update existing product
    if (isEditMode && editingProductIndex !== null) {
      const updatedProducts = ensureContractProductRowIds(wizardData.products);
      updatedProducts[editingProductIndex] = finalProduct;
      const sourceRowId = editingRemainingStoneChild
        ? finalProduct.parentProductRowId
        : finalProduct.rowId;
      const hasRemainingChildren = !!sourceRowId && updatedProducts.some((product) => product.parentProductRowId === sourceRowId);

      if (sourceRowId && (editingRemainingStoneChild || hasRemainingChildren)) {
        const sourceProduct = editingRemainingStoneChild
          ? updatedProducts.find((product) => product.rowId === sourceRowId)
          : finalProduct;
        const sourceInventory = editingRemainingStoneChild
          ? (sourceProduct?.remainingStoneSourceInventory || sourceProduct?.smartCutPlan?.remainingStones)
          : finalProduct.remainingStoneSourceInventory;
        const replay = replayRemainingStoneAllocations({
          products: updatedProducts,
          sourceRowId,
          sourceInventory
        });
        if (!replay.ok) {
          setErrors({ products: formatRemainingStoneReplayConflicts(replay.conflicts) });
          return;
        }
        updateWizardData({
          products: replay.products,
          selectedProductTypeForAddition: productType
        });
      } else {
        updateWizardData({
          products: updatedProducts,
          selectedProductTypeForAddition: productType
        });
      }
    } else {
      // Add new product
      updateWizardData({
        products: [...wizardData.products, finalProduct],
        selectedProductTypeForAddition: productType
      });
    }


    publishProductSaveFeedback(
      isEditMode ? 'edited' : 'created',
      finalProduct.rowId
    );
    // Close modal and reset state
    setShowProductModal(false);
    setSelectedProduct(null);
    setProductConfig({});
    setLengthUnit('m');
    setWidthUnit('cm');
    setIsMandatory(false);
    setMandatoryPercentage(20);
    setIsEditMode(false);
    setEditingProductIndex(null);
    setTouchedFields(new Set()); // Reset touched fields
    clearProductAdditionSearches();
    const smartCutWarning = smartCutPlan.warnings.find((warning) => warning.includes('خوراک اره')) || '';
    setErrors(
      remainingStoneEditState.warning || smartCutWarning
        ? { products: remainingStoneEditState.warning || smartCutWarning }
        : {}
    );
  };

  // Partition handlers are now provided by useRemainingStoneModal hook
  // The handleAddRemainingStoneToContract function is now provided by remainingStoneModal.handleAddRemainingStoneToContract

  const validateCurrentStep = (stepOverride?: number): boolean => {
    const newErrors: Record<string, string> = {};
    const stepToValidate = stepOverride ?? currentStep;

    switch (stepToValidate) {
      case 1:
        if (!wizardData.contractDate) {
          newErrors.contractDate = 'تاریخ قرارداد الزامی است';
        }
        break;
      case 2:
        if (!wizardData.customerId) {
          newErrors.customerId = 'انتخاب مشتری الزامی است';
        }
        break;
      case 3:
        if (isCollaborationContract) {
          break;
        }
        if (!wizardData.projectId) {
          newErrors.projectId = 'انتخاب پروژه الزامی است';
        }
        break;
      case 4:
        if (wizardData.products.length === 0 && (wizardData.serviceRows || []).length === 0) {
          newErrors.products = 'انتخاب حداقل یک محصول یا خدمت الزامی است';
        }
        if (!newErrors.products) {
          const remainingStoneBalanceError = findRemainingStoneBalanceError(wizardData.products);
          if (remainingStoneBalanceError) {
            newErrors.products = remainingStoneBalanceError;
          }
        }
        break;
      case 5:
        if (shouldSkipDeliveryStep) {
          break;
        }
        if (wizardData.deliveries.length === 0) {
          newErrors.deliveries = 'تعیین حداقل یک تحویل الزامی است';
        } else {
          const deliveryReferences = reconcileDeliveryProductReferences(wizardData.products, wizardData.deliveries);
          const deliveriesToValidate = deliveryReferences.deliveries;
          if (deliveryReferences.conflicts.length > 0) {
            newErrors.deliveries = `برنامه تحویل نیاز به بازبینی دارد: ${deliveryReferences.conflicts.map((conflict) => conflict.message).join(' | ')}`;
          }

          deliveriesToValidate.forEach((delivery, index) => {
            if (!delivery.deliveryDate) {
              newErrors[`delivery_${index}_date`] = 'تاریخ تحویل الزامی است';
            }
            if (!delivery.projectManagerName || delivery.projectManagerName.trim() === '') {
              newErrors[`delivery_${index}_projectManager`] = 'نام مدیر پروژه الزامی است';
            }
            if (!delivery.receiverName || delivery.receiverName.trim() === '') {
              newErrors[`delivery_${index}_receiver`] = 'نام تحویل گیرنده الزامی است';
            }
            if (delivery.products.length === 0) {
              newErrors[`delivery_${index}_products`] = 'حداقل یک محصول باید در تحویل وجود داشته باشد';
            }
          });

          const getDeliveryUnit = (product: ContractProduct | undefined): 'meter' | 'squareMeter' | 'ton' | 'count' => {
            if (isPreparedProductType(product?.productType)) {
              const unit = getPreparedUnit(product as ContractProduct);
              return unit === 'ton' ? 'ton' : unit === 'squareMeter' ? 'squareMeter' : 'count';
            }
            if (product?.productType === 'longitudinal') return 'meter';
            if (product?.productType === 'slab') return 'squareMeter';
            return 'count';
          };
          const getDeliveryTargetAmount = (product: ContractProduct): number => {
            return getContractDeliveryTargetAmount(product);
          };
          const getDeliveryUnitLabel = (unit: 'meter' | 'squareMeter' | 'ton' | 'count') => {
            if (unit === 'meter') return 'متر';
            if (unit === 'squareMeter') return 'متر مربع';
            if (unit === 'ton') return 'تن';
            return 'عدد';
          };

          const remainingByProductIndex = new Map<number, number>();
          deliverableProductEntries.forEach(({ product, productIndex }) => {
            remainingByProductIndex.set(productIndex, getDeliveryTargetAmount(product));
          });

          deliveriesToValidate.forEach(delivery => {
            delivery.products.forEach(dp => {
              if (dp.rowType === 'service' || !dp.productRowId) return;
              const productIndex = wizardData.products.findIndex((product) => product.rowId === dp.productRowId);
              if (productIndex < 0) return;
              const current = remainingByProductIndex.get(productIndex) || 0;
              remainingByProductIndex.set(productIndex, current - (dp.amount ?? dp.quantity ?? 0));
            });
          });

          remainingByProductIndex.forEach((remaining, productIndex) => {
            if (remaining < -0.01 && !newErrors.deliveries) {
              const product = wizardData.products[productIndex];
              newErrors.deliveries = `مقدار تحویل برای محصول "${product.stoneName || product.product?.namePersian || 'نامشخص'}" بیشتر از مقدار کل است`;
            }
          });

          const undistributedProducts: string[] = [];
          remainingByProductIndex.forEach((remaining, productIndex) => {
            if (remaining > 0.01) {
              const product = wizardData.products[productIndex];
              undistributedProducts.push(
                `"${product.stoneName || product.product?.namePersian || 'نامشخص'}" (${formatDisplayNumber(remaining)} ${getDeliveryUnitLabel(getDeliveryUnit(product))} باقی مانده)`
              );
            }
          });

          if (undistributedProducts.length > 0 && !newErrors.deliveries) {
            newErrors.deliveries = `تمام محصولات باید در تحویل ها توزیع شوند. این موارد هنوز کامل توزیع نشده اند: ${undistributedProducts.join('، ')}`;
          }
        }
        break;
      case 6:
        if (wizardData.payment.payments.length === 0) {
          newErrors.paymentMethod = 'حداقل یک پرداخت باید اضافه شود';
        } else {
          wizardData.payment.payments.forEach((payment, index) => {
            const method = (payment as { method?: string }).method;
            if (!method) {
              newErrors.paymentMethod = `نوع پرداخت برای پرداخت ${index + 1} الزامی است`;
              return;
            }
            if (!payment.amount || payment.amount <= 0) {
              newErrors.paymentMethod = `مبلغ پرداخت ${index + 1} باید بیشتر از صفر باشد`;
              return;
            }
            if ((method === 'CASH_CARD' || method === 'CASH_SHIBA' || method === 'CUSTOMER_BALANCE') && !String(payment.paymentDate || '').trim()) {
              newErrors.paymentMethod = method === 'CUSTOMER_BALANCE'
                ? `تاریخ استفاده از مانده مشتری برای پرداخت ${index + 1} الزامی است`
                : `تاریخ پرداخت برای پرداخت ${index + 1} الزامی است`;
              return;
            }
            if (method === 'CHECK') {
              if (!String(payment.checkOwnerName || '').trim()) {
                newErrors.paymentMethod = `نام صاحب چک برای پرداخت ${index + 1} الزامی است`;
                return;
              }
              if (!String(payment.handoverDate || '').trim()) {
                newErrors.paymentMethod = `تاریخ تحویل چک برای پرداخت ${index + 1} الزامی است`;
                return;
              }
              if (!String(payment.paymentDate || '').trim()) {
                newErrors.paymentMethod = `تاریخ سررسید چک برای پرداخت ${index + 1} الزامی است`;
                return;
              }
            }
            if (!isContractEditMode && method !== 'CUSTOMER_BALANCE' && payment.paymentDate && String(payment.paymentDate).trim() !== getCurrentPersianDate()) {
              const paymentNationalCode = String(payment.nationalCode || '').trim();
              if (!paymentNationalCode) {
                newErrors.paymentMethod = `کد ملی برای پرداخت ${index + 1} با تاریخ غیر از امروز الزامی است`;
                return;
              }
              if (paymentNationalCode.length !== 10) {
                newErrors.paymentMethod = `کد ملی پرداخت ${index + 1} باید 10 رقم باشد`;
              }
            }
          });
        }
        if (wizardData.payment.payments.length > 0 && !newErrors.paymentMethod) {
          const paymentTotal = sumNumericValues(wizardData.payment.payments, (payment) => payment.amount);
          const payableTotal = toFiniteNumber(wizardData.payment.totalContractAmount) ||
            sumNumericValues(wizardData.products, (product) => product.totalPrice) +
            sumNumericValues(wizardData.serviceRows || [], (row) => row.totalPrice);
          const remainingPaymentAmount = payableTotal - paymentTotal;
          const extraPaymentAmount = paymentTotal - payableTotal;

          if (remainingPaymentAmount > 0.01) {
            newErrors.paymentMethod = `مجموع پرداخت‌ها (${formatPrice(paymentTotal, wizardData.payment.currency)}) نباید کمتر از مبلغ قرارداد (${formatPrice(payableTotal, wizardData.payment.currency)}) باشد. مانده: ${formatPrice(remainingPaymentAmount, wizardData.payment.currency)}`;
          } else if (extraPaymentAmount > 0.01 && !wizardData.payment.extraPaymentReason) {
            newErrors.paymentMethod = `برای مبلغ اضافه (${formatPrice(extraPaymentAmount, wizardData.payment.currency)}) باید توضیحات انتخاب شود`;
          }
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateAllSteps = (): boolean => {
    for (const step of visibleWizardSteps.map((wizardStep) => wizardStep.id).filter((step) => step <= 6)) {
      if (!validateCurrentStep(step)) {
        setCurrentStep(step);
        return false;
      }
    }
    setErrors({});
    return true;
  };

  // Reset delivery step selection when leaving the step
  useEffect(() => {
    if (currentStep !== 5) {
      deliverySchedule.setSelectedProductIndices(new Set());
    }
  }, [currentStep]);

  const goToNextStep = () => {
    if (validateCurrentStep()) {
      setCurrentStep(prev => {
        const currentIndex = visibleWizardSteps.findIndex((step) => step.id === prev);
        const nextStep = visibleWizardSteps[currentIndex + 1];
        return nextStep?.id ?? prev;
      });
      setErrors({});
    }
  };

  const goToPreviousStep = () => {
    setCurrentStep(prev => {
      const currentIndex = visibleWizardSteps.findIndex((step) => step.id === prev);
      const previousStep = visibleWizardSteps[currentIndex - 1];
      return previousStep?.id ?? prev;
    });
    setErrors({});
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <Step1ContractDate
            wizardData={wizardData}
            updateWizardData={updateWizardData}
            errors={errors}
            currentUser={currentUser || undefined}
          />
        );

      case 2:
        return (
          <Step2CustomerSelection
            wizardData={wizardData}
            updateWizardData={updateWizardData}
            errors={errors}
            customerSearchTerm={customerSearchTerm}
            setCustomerSearchTerm={setCustomerSearchTerm}
            customers={customerOptions}
            filteredCustomers={filteredCustomers}
            currentStep={currentStep}
            isOwnerScopedUser={currentUser?.role !== 'ADMIN'}
          />
        );

      case 3:
        return (
          <Step3ProjectManagement
            wizardData={wizardData}
            updateWizardData={updateWizardData}
            errors={errors}
            currentStep={currentStep}
          />
        );

      case 4:
        return (
          <Step5ProductSelection
            controller={productCartController}
            errors={errors}
            saveFeedback={productSaveFeedback}
            onSaveFeedbackExpired={expireProductSaveFeedback}
          />
        );

      case 5: // Delivery Schedule
        return (
          <Step6DeliverySchedule
            wizardData={wizardData}
            updateWizardData={updateWizardData}
            errors={errors}
          />
        );

      case 6: // Payment Method
        return (
          <Step7PaymentMethod
            wizardData={wizardData}
            updateWizardData={updateWizardData}
            errors={errors}
            baseSubtotal={discountBaseSubtotal}
            productsTotal={grossContractTotal}
            discountPercent={appliedDiscountPercent}
            maxDiscountPercent={maxDiscountPercent}
            discountAmount={appliedDiscountAmount}
            hasMatchingDiscountRange={!!matchingDiscountRange}
            onDiscountPercentChange={setDiscountPercentInput}
            showPaymentEntryModal={paymentHandlers.showPaymentEntryModal}
            setShowPaymentEntryModal={paymentHandlers.setShowPaymentEntryModal}
            onAddPaymentEntry={paymentHandlers.handleAddPaymentEntry}
            onEditPaymentEntry={paymentHandlers.handleEditPaymentEntry}
          />
        );

      case 7: { // Digital Signature
        const mapProductTypeLabel = (type?: string) => {
          if (type === 'longitudinal') return 'طولی';
          if (type === 'stair') return 'پله';
          if (type === 'slab') return 'اسلب';
          return '—';
        };
        const mapStairPartLabel = (part?: string) => {
          if (part === 'tread') return 'کف پله';
          if (part === 'riser') return 'خیز پله';
          if (part === 'landing') return 'پاگرد';
          return '—';
        };
        const mapPaymentMethodLabel = (method?: string) => {
          if (method === 'CASH_CARD') return 'نقدی (کارت)';
          if (method === 'CASH_SHIBA') return 'نقدی (شبا)';
          if (method === 'CHECK') return 'چک';
          if (method === 'CUSTOMER_BALANCE') return 'استفاده از باقی مانده مشتری';
          return '—';
        };
        const mapPaymentStatusLabel = (status?: string) => {
          if (status === 'PAID') return 'پرداخت شده';
          if (status === 'WILL_BE_PAID') return 'پرداخت خواهد شد';
          return '—';
        };

        const productDetails: ContractStep8ProductDetail[] = wizardData.products.map((product, index) => {
          const productThicknessCm = (product as any).thicknessCm;
          const dimensions = [
            product.length ? `طول: ${product.length}${product.lengthUnit || ''}` : null,
            product.width ? `عرض: ${product.width}${product.widthUnit || ''}` : null,
            productThicknessCm ? `ضخامت: ${productThicknessCm}cm` : null
          ].filter(Boolean).join(' | ') || '—';

          return {
            id: `${product.productId}-${index}`,
            code: product.stoneCode || product.product?.code || '—',
            name: product.stoneName || product.product?.namePersian || product.product?.name || '—',
            productType: mapProductTypeLabel(product.productType),
            stairPartType: mapStairPartLabel(product.stairPartType),
            dimensions,
            quantity: toFiniteNumber(product.quantity),
            squareMeters: toFiniteNumber(product.squareMeters),
            unitPrice: toFiniteNumber(product.pricePerSquareMeter) || toFiniteNumber(product.unitPrice),
            totalPrice: getContractProductNonServiceSubtotal(product),
            description: product.description || '—'
          };
        });

        const serviceDetails: ContractStep8ServiceDetail[] = [];
        wizardData.products.forEach((product, productIndex) => {
          const productName = product.stoneName || product.product?.namePersian || `محصول ${productIndex + 1}`;

          (product.appliedSubServices || []).forEach((service, serviceIndex) => {
            serviceDetails.push({
              id: `service-${productIndex}-${serviceIndex}`,
              productName,
              category: 'ابزار/خدمات',
              name: service.subService?.namePersian || service.subService?.name || '—',
              amountLabel: `${service.meter || 0} ${service.calculationBase === 'squareMeters' ? 'متر مربع' : 'متر'}`,
              rateLabel: service.subService?.pricePerMeter ? `${service.subService.pricePerMeter}` : '—',
              cost: toFiniteNumber(service.cost)
            });
          });

          getBillableCuttingBreakdown(product).forEach((cut, cutIndex) => {
            serviceDetails.push({
              id: `cut-${productIndex}-${cutIndex}`,
              productName,
              category: 'برش',
              name: cut.type === 'cross' ? 'برش عرضی' : 'برش طولی',
              amountLabel: `${toFiniteNumber(cut.meters)} متر`,
              rateLabel: `${toFiniteNumber(cut.rate)}`,
              cost: toFiniteNumber(cut.cost)
            });
          });

          if (product.finishingId && product.finishingCost) {
            const finishing = normalizeProductFinishing(product);
            serviceDetails.push({
              id: `finishing-${productIndex}`,
              productName,
              category: 'فینیشینگ',
              name: product.finishingName || '—',
              amountLabel: finishing?.amountLabel || `${toFiniteNumber(product.finishingSquareMeters) || toFiniteNumber(product.squareMeters)} متر مربع`,
              rateLabel: finishing?.rateLabel || (product.finishingPricePerSquareMeter ? `${product.finishingPricePerSquareMeter}` : '—'),
              cost: toFiniteNumber(product.finishingCost)
            });
          }
        });

        const standaloneServiceDetails: ContractStep8ServiceDetail[] = (wizardData.serviceRows || []).map((row, rowIndex) => ({
          id: row.id || `standalone-service-${rowIndex}`,
          productName: 'خدمات مستقل',
          category: getServiceRowSourceLabel(row.sourceType),
          name: row.title || '—',
          amountLabel: `${formatDisplayNumber(row.quantity || 0)} ${getServiceRowUnitLabel(row.unit)}`,
          rateLabel: formatPrice(row.unitPrice || 0, row.currency || wizardData.payment.currency || 'تومان'),
          cost: toFiniteNumber(row.totalPrice)
        }));

        const deliveryDetails: ContractStep8DeliveryDetail[] = wizardData.deliveries.map((delivery, index) => ({
          id: `delivery-${index}`,
          deliveryDate: delivery.deliveryDate || '—',
          deliveryAddress: delivery.deliveryAddress || wizardData.project?.address || '—',
          projectManagerName: delivery.projectManagerName || '—',
          receiverName: delivery.receiverName || '—',
          notes: delivery.notes || '—',
          products: (delivery.products || []).map((deliveryProduct) => {
            if (deliveryProduct.rowType === 'service') {
              const serviceRow = (wizardData.serviceRows || []).find((row) => row.id === deliveryProduct.serviceRowId);
              const quantity = toFiniteNumber(deliveryProduct.amount ?? deliveryProduct.quantity);
              return {
                productName: serviceRow?.title || 'خدمت',
                quantity,
                amountLabel: `${formatDisplayNumber(quantity)} ${serviceRow ? getServiceRowUnitLabel(serviceRow.unit) : ''}`.trim()
              };
            }
            const productIndex = deliveryProduct.productRowId
              ? wizardData.products.findIndex((product) => product.rowId === deliveryProduct.productRowId)
              : (deliveryProduct.productIndex ?? -1);
            const quantity = toFiniteNumber(deliveryProduct.amount ?? deliveryProduct.quantity);
            const unitLabel = deliveryProduct.unit === 'meter'
              ? 'متر'
              : deliveryProduct.unit === 'squareMeter'
                ? 'متر مربع'
                : deliveryProduct.unit === 'ton'
                  ? 'تن'
                : 'عدد';
            return {
              productName: wizardData.products[productIndex]?.stoneName ||
                wizardData.products[productIndex]?.product?.namePersian ||
                `محصول ${productIndex + 1}`,
              quantity,
              amountLabel: `${formatDisplayNumber(quantity)} ${unitLabel}`
            };
          })
        }));

        const paymentDetails: ContractStep8PaymentDetail[] = wizardData.payment.payments.map((payment, index) => ({
          id: payment.id || `payment-${index}`,
          methodLabel: mapPaymentMethodLabel(payment.method),
          amount: toFiniteNumber(payment.amount),
          paymentDate: payment.paymentDate || '—',
          handoverDate: payment.handoverDate || '—',
          checkNumber: payment.checkNumber || '—',
          checkOwnerName: payment.checkOwnerName || '—',
          status: mapPaymentStatusLabel(payment.status),
          description: payment.description || '—'
        }));

        const productsTotal = sumNumericValues(wizardData.products, getContractProductNonServiceSubtotal);
        const cutsTotal = serviceDetails
          .filter((service) => service.category === 'برش')
          .reduce((sum, service) => sum + toFiniteNumber(service.cost), 0);
        const finishingTotal = serviceDetails
          .filter((service) => service.category === 'فینیشینگ')
          .reduce((sum, service) => sum + toFiniteNumber(service.cost), 0);
        const servicesTotal = serviceDetails.reduce((sum, service) => sum + toFiniteNumber(service.cost), 0);
        const standaloneServicesTotal = standaloneServiceDetails.reduce((sum, service) => sum + toFiniteNumber(service.cost), 0);
        const paymentTotal = paymentDetails.reduce((sum, payment) => sum + toFiniteNumber(payment.amount), 0);
        const discountAmount = toFiniteNumber(wizardData.discount?.amount);
        const grandTotal = toFiniteNumber(wizardData.payment.totalContractAmount) || Math.max(productsTotal + standaloneServicesTotal - discountAmount, 0);
        const financialSummary: ContractStep8FinancialSummary = {
          productsTotal,
          servicesTotal: servicesTotal + standaloneServicesTotal,
          cutsTotal,
          finishingTotal,
          discountAmount,
          discountPercent: toFiniteNumber(wizardData.discount?.percent),
          discountBaseSubtotal: toFiniteNumber(wizardData.discount?.baseSubtotal),
          grandTotal,
          paymentTotal,
          remainingAmount: grandTotal - paymentTotal,
          currency: wizardData.payment.currency || 'تومان'
        };

        const canDownloadPdfAction = !!wizardData.signature?.contractId;
        const canPrintPdfAction = !!wizardData.signature?.contractId &&
          ['SIGNED', 'PRINTED'].includes(wizardData.signature?.contractStatus || '');
        return (
          <Step8DigitalSignature
            wizardData={wizardData}
            errors={errors}
            sendingCode={digitalSignature.sendingCode}
            onSendForConfirmation={handleSendForConfirmation}
            onResendConfirmation={handleResendConfirmation}
            onRefreshStatus={refreshConfirmationStatus}
            onCancelContract={handleCancelContract}
            onDownloadContractPdf={handleDownloadContractPdf}
            onPrintContractPdf={handlePrintContractPdf}
            canDownloadPdfAction={canDownloadPdfAction}
            canPrintPdfAction={canPrintPdfAction}
            pdfActionLoading={pdfActionLoading}
            printActionLoading={printActionLoading}
            productDetails={productDetails}
            serviceDetails={serviceDetails}
            standaloneServiceDetails={standaloneServiceDetails}
            deliveryDetails={deliveryDetails}
            paymentDetails={paymentDetails}
            financialSummary={financialSummary}
          />
        );
      }

      default:
        return null;
    }
  };

  // Removed orphaned loading check - legacy code
  // Removed orphaned generateContractHTML function - using the correct one below

  // generateContractHTML is now imported from contractHTMLGenerator

  // Contract submission is now provided by useContractSubmission hook
  const contractSubmission = useContractSubmission({
    wizardData,
    updateWizardData,
    setCurrentStep,
    setErrors,
    setLoading: setWizardLoading,
    validateCurrentStep,
    validateAllSteps,
    generateContractHTML,
    userDepartment: userDepartment || undefined,
    departments,
    mode,
    contractId,
    editSession: recoveryScope && editRecovery.leaseToken ? {
      draftId: recoveryScope.draftId,
      browserSessionId: editRecovery.browserSessionId,
      leaseToken: editRecovery.leaseToken,
      baseRevision: recoveryScope.baseRevision
    } : null,
    onCommitted: editRecovery.release
  });
  const handleWizardSubmit = () => {
    if (!editRecovery.ready || !editRecovery.leaseToken || editRecovery.blocked) {
      setErrors({ general: editRecovery.blocked
        ? 'این قرارداد در محل دیگری در حال ویرایش است'
        : 'اتصال ایمن ویرایش هنوز آماده نیست' });
      return;
    }
    if (isContractCreationComplete) {
      router.push('/dashboard/sales/contracts');
      return;
    }

    contractSubmission.handleCreateContract();
  };

  const resetStairConfigurationSession = () => {
    stairSystemV2.reset();
    setStairQuantityDraft({
      mode: 'steps',
      totalSteps: '',
      numberOfStaircases: '',
      stepsPerStaircase: ''
    });
    setStairQuantityManuallyEdited({
      tread: false,
      riser: false
    });
    setStairDiscardConfirmationVisible(false);
    requestedStairFooterActionRef.current = 'stage';
    commitStagedStairSessionRef.current = false;
    setIsEditMode(false);
    setEditingProductIndex(null);
    clearProductAdditionSearches();
    setErrors({});
  };

  const reportCurrentStairIssue = ({
    code,
    phase,
    focusTarget,
    conflictCodes = [],
    layerCount,
    action
  }: {
    code: string;
    phase: 'detect' | 'validate' | 'calculate' | 'build' | 'commit';
    focusTarget: string;
    conflictCodes?: string[];
    layerCount?: number;
    action?: 'stage' | 'finish' | 'edit-save';
  }) => {
    reportStairTransactionDiagnostic({
      code,
      phase,
      focusTarget
    }, {
      action:
        action ||
        (isEditMode
          ? 'edit-save'
          : requestedStairFooterActionRef.current),
      phase,
      mode: isEditMode ? 'edit' : 'create',
      stairPart: stairSystemV2.stairActivePart,
      parentRowId:
        editingProductIndex !== null
          ? wizardData.products[editingProductIndex]?.rowId
          : undefined,
      stairSessionId: stairSystemV2.stairSessionId || undefined,
      conflictCodes,
      stagedRowCount: stairSystemV2.stairSessionItems.length,
      layerCount
    });
  };

  const requestCloseStairConfiguration = () => {
    if (shouldConfirmStairDraftDiscard({
      drafts: [
        stairSystemV2.draftTread,
        stairSystemV2.draftRiser,
        stairSystemV2.draftLanding
      ],
      stagedRowCount: stairSystemV2.stairSessionItems.length
    })) {
      setStairDiscardConfirmationVisible(true);
      return;
    }
    resetStairConfigurationSession();
    setShowProductModal(false);
  };

  const discardStairConfiguration = () => {
    resetStairConfigurationSession();
    setShowProductModal(false);
  };

  const requestCloseStairConfigurationRef = useRef(requestCloseStairConfiguration);
  requestCloseStairConfigurationRef.current = requestCloseStairConfiguration;
  const stairDialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (
      editRecoveryBlocked ||
      !showProductModal ||
      productConfig.productType !== 'stair'
    ) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const selector = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const focusTimer = window.setTimeout(() => {
      stairDialogRef.current?.querySelector<HTMLElement>(selector)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      const focusable = Array.from(
        stairDialogRef.current?.querySelectorAll<HTMLElement>(selector) ?? []
      );
      if (event.key === 'Escape') {
        event.preventDefault();
        requestCloseStairConfigurationRef.current();
      } else if (event.key === 'Tab' && focusable.length > 0) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [editRecoveryBlocked, productConfig.productType, showProductModal]);

  return (
    <main className="sds-workspace relative z-0 min-h-screen py-4 sm:py-8">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 relative z-0">
        <div className="mb-5 sm:mb-8">
          <h1 className="sds-text-primary text-2xl font-bold sm:text-3xl">
            {isContractEditMode
              ? 'ویرایش قرارداد'
              : isCollaborationContract
                ? 'قرارداد همکاری در فروش'
                : 'ایجاد قرارداد'}
          </h1>
        </div>

        {editRecovery.blocked && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--sds-warning-border)] py-3 text-sm text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:text-[var(--sds-warning)]">
            <span>این قرارداد در محل دیگری در حال ویرایش است</span>
            <ErpPressable
              type="button"
              onClick={() => void handleEditRecoveryTakeover()}
              className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]"
            >
              ادامه ویرایش در اینجا
            </ErpPressable>
          </div>
        )}

        <div
          aria-disabled={editRecovery.blocked}
          {...(editRecovery.blocked ? ({ inert: '' } as any) : {})}
          className={editRecovery.blocked ? 'pointer-events-none select-none opacity-70' : ''}
        >

        {/* Progress Bar */}
        <WizardProgressBar
          currentStep={currentStep}
          steps={visibleWizardSteps as WizardStep[]}
          clickable={isContractEditMode}
          onStepClick={(step) => {
            setCurrentStep(step);
            setErrors({});
          }}
        />

        {/* Step Content */}
        <div className="sds-workspace-surface step-content-card p-4 sm:p-6 lg:p-8 mb-6 sm:mb-8 relative z-0">
          {renderStepContent()}
        </div>

        {/* Navigation */}
        <WizardNavigation
          currentStep={visibleCurrentStep}
          totalSteps={visibleWizardSteps.length}
          onPrevious={goToPreviousStep}
          onNext={goToNextStep}
          onSubmit={handleWizardSubmit}
          loading={loading || wizardLoading || contractSubmission.isSubmitting || !editRecovery.ready}
          canGoNext={true}
          canGoPrevious={visibleCurrentStep > 1}
          showSubmitOnEveryStep={isContractEditMode}
          labels={{
            submit: isContractEditMode
              ? 'ذخیره تغییرات'
              : isContractCreationComplete
                ? 'اتمام و بازگشت به قراردادها'
                : 'ثبت قرارداد',
            submitting: isContractEditMode ? 'در حال ذخیره...' : 'در حال ثبت...'
          }}
        />

        {/* Error Display */}
        {errors.general && (
          <ErpInlineState kind="error" title={errors.general} />
        )}

        {/* Product Configuration Modal */}
        {!editRecoveryBlocked && showProductModal && productConfig.productType === 'stair' && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--sds-surface-overlay)] p-3">
            <div
              ref={stairDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="stair-product-dialog-title"
              className="stair-v2-modal z-[10000] flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--sds-radius-dialog)] border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] shadow-[var(--sds-shadow-raised)]"
            >
              <div className="stair-v2-header flex min-h-14 flex-shrink-0 items-center justify-between border-b border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-4 dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)]">
                <h3 id="stair-product-dialog-title" className="text-base font-bold text-[var(--sds-text-primary)]">
                  تنظیمات محصول
                </h3>
                <ErpPressable
                  type="button"
                  aria-label="بستن"
                  className="text-[var(--sds-text-muted)] hover:text-[var(--sds-text-secondary)] dark:hover:text-[var(--sds-text-secondary)] hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-subtle)] rounded-lg p-2 transition-colors"
                  onClick={requestCloseStairConfiguration}
                  title="بستن"
                >
                  <FaTimes className="w-5 h-5" />
                </ErpPressable>
              </div>

              {/* Product family is fixed for the lifetime of this modal. */}
              <div className="stair-v2-type-selector flex-shrink-0 border-b border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-4 py-2 dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)]">
                <div className="flex min-h-8 items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">نوع محصول</span>
                  <span className="text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">پله</span>
                </div>
              </div>

              <div className="stair-v2-body min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)]">
                <div className="p-6 space-y-6">
                  {!isEditMode && (
                    <StairQuantityModeSection
                      state={stairQuantityDraft}
                      onChange={updateStairQuantityDraft}
                    />
                  )}
                  <div
                    data-stair-active-part
                    tabIndex={-1}
                    className="border-b border-[var(--sds-border-default)] py-3 outline-none dark:border-[var(--sds-border-subtle)]"
                  >
                    <CompactSegmentedControl
                      label="انتخاب بخش پله"
                      value={stairSystemV2.stairActivePart}
                      options={[
                        { value: 'tread', label: 'کف پله' },
                        { value: 'riser', label: 'خیز' },
                        { value: 'landing', label: 'پاگرد' }
                      ]}
                      onChange={(part) => setActivePart(part as StairStepperPart)}
                    />
                  </div>
                {(() => {
                  const [draft, setDraft] = getActiveDraft();
                  const totals = computeTotalsV2(stairSystemV2.stairActivePart, draft);
                  const canonicalStairPreview = totals.canonicalCalculation.ok
                    ? totals.canonicalCalculation.result
                    : null;
                   const stairOperationPreview = draft.operationPolicyInput &&
                     draft.stoneProduct &&
                     getActualLengthMeters(draft) > 0 &&
                     Number(draft.widthCm) > 0 &&
                     Number(draft.quantity) > 0
                       ? calculateProductOperations(createStairOperationInput(
                           stairSystemV2.stairActivePart,
                           draft,
                           draft.stoneProduct.id
                         ))
                       : null;
                   const stairOperationPreviewAmount =
                     stairOperationPreview?.ok
                       ? Number(stairOperationPreview.result.totalAmountToman)
                       : 0;
                   const chargeableCuttingCost = totals.billableCuttingCost;
                  const chargeableCuttingCostLongitudinal = totals.billableCuttingCostLongitudinal;
                  const chargeableCuttingCostCross = totals.billableCuttingCostCross;
                  const draftErrors = stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart] || {};
                  const lengthMInfo = getActualLengthMeters(draft);
                  const selectedFinishing =
                    stoneFinishings.find(option => option.id === draft.finishingId) ||
                    (draft.finishingId
                      ? ({
                          id: draft.finishingId,
                          name: draft.finishingLabel || '',
                          namePersian: draft.finishingLabel || '',
                          description: '',
                          calculationBase: draft.finishingCalculationBase || 'squareMeters',
                          unitPrice: draft.finishingUnitPrice ?? draft.finishingPricePerSquareMeter ?? 0,
                          pricePerSquareMeter: draft.finishingPricePerSquareMeter ?? draft.finishingUnitPrice ?? 0,
                          isActive: false
                        } as StoneFinishing)
                      : undefined);
                  const finishingCalculationBase =
                    draft.finishingCalculationBase ||
                    getFinishingCalculationBase(selectedFinishing);
                  const defaultFinishingQuantity = calculateDefaultFinishingQuantity({
                    calculationBase: finishingCalculationBase,
                    productType: 'stair',
                    length: draft.lengthValue,
                    lengthUnit: draft.lengthUnit || 'm',
                    quantity: draft.quantity,
                    squareMeters: totals.pricingSquareMeters
                  });
                  const finishingPricePerSquareMeter =
                    draft.finishingUnitPrice ??
                    draft.finishingPricePerSquareMeter ??
                    (getFinishingUnitPrice(selectedFinishing) || null);
                  const finishingQuantity =
                    draft.finishingQuantity ?? defaultFinishingQuantity;
                  const maxFinishingQuantity = defaultFinishingQuantity > 0
                    ? defaultFinishingQuantity
                    : null;
                  const finishingUnitLabel = getFinishingUnitLabel(finishingCalculationBase);
                  const finishingPreviewCost =
                    draft.finishingEnabled && finishingPricePerSquareMeter
                      ? calculateFinishingCost(finishingQuantity, finishingPricePerSquareMeter)
                      : 0;
                  const finishingSearchTerm = String((draft as any).finishingSearchTerm || '').trim().toLowerCase();
                  const selectableStoneFinishings =
                    selectedFinishing && !stoneFinishings.some(option => option.id === selectedFinishing.id)
                      ? [selectedFinishing, ...stoneFinishings]
                      : stoneFinishings;
                  const visibleStoneFinishings = finishingSearchTerm
                    ? selectableStoneFinishings.filter((option) =>
                        `${option.namePersian || ''} ${option.name || ''} ${option.description || ''}`
                          .toLowerCase()
                          .includes(finishingSearchTerm)
                      )
                    : selectableStoneFinishings;
                  const defaultMandatoryEnabled = stairSystemV2.stairActivePart === 'riser' || stairSystemV2.stairActivePart === 'landing';
                  const mandatoryEnabled = draft.useMandatory ?? defaultMandatoryEnabled;
                  const supportsMandatory = stairSystemV2.stairActivePart === 'tread' || stairSystemV2.stairActivePart === 'riser' || stairSystemV2.stairActivePart === 'landing';
                  const mandatoryPercentageValue = draft.mandatoryPercentage ?? 20;
                  const setLayerSideEnabled = (
                    side: 'front' | 'back' | 'left' | 'right',
                    enabled: boolean
                  ) => {
                    const currentOperations =
                      draft.layerSideOperations?.[side];
                    const hasOperations = Boolean(
                      currentOperations &&
                      (
                        currentOperations.tools.length > 0 ||
                        currentOperations.finishings.length > 0
                      )
                    );
                    const isDedicated =
                      draft.layerDetachedOperationSides?.includes(side);
                    const nextConflicts = new Set(
                      draft.layerRemovedSideConflicts || []
                    );
                    const nextOperations = {
                      ...(draft.layerSideOperations || {})
                    };
                    if (!enabled && hasOperations && isDedicated) {
                      nextConflicts.add(side);
                    } else if (!enabled) {
                      delete nextOperations[side];
                      nextConflicts.delete(side);
                    } else {
                      nextConflicts.delete(side);
                    }
                    setDraft({
                      ...draft,
                      layerEdges: {
                        ...(draft.layerEdges || {}),
                        perimeter: false,
                        [side]: enabled
                      },
                      layerSideOperations: nextOperations,
                      layerRemovedSideConflicts: Array.from(nextConflicts)
                    });
                  };
                  return (
                    <div className="space-y-6">
                      {!totals.canonicalCalculation.ok && (
                        <div
                          id="stair-calculation-summary"
                          tabIndex={-1}
                          className="border-y border-[var(--sds-danger-border)] py-2 text-xs text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:text-[var(--sds-danger)]"
                          role="alert"
                        >
                          {totals.canonicalCalculation.conflicts.map((conflict) => (
                            <div key={`${conflict.code}:${conflict.field}`}>
                              {stairConflictMessage(
                                conflict.code,
                                draft.stoneProduct?.motherLengthValue,
                                conflict.field
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Input Fields Section - Enhanced */}
                      <div className="border-b border-[var(--sds-border-default)] py-3 dark:border-[var(--sds-border-subtle)]">
                        {draft.stoneProduct && (
                          <div className="mb-3 border-y border-[var(--sds-border-subtle)] py-2 text-xs text-[var(--sds-text-muted)] dark:border-[var(--sds-border-subtle)] dark:text-[var(--sds-text-secondary)]">
                            {draft.stoneProduct.namePersian}
                            {draft.stoneProduct.widthValue
                              ? ` · عرض مادر ${formatDisplayNumber(draft.stoneProduct.widthValue)}cm`
                              : ''}
                            {draft.stoneProduct.thicknessValue
                              ? ` · ضخامت ${formatDisplayNumber(draft.stoneProduct.thicknessValue)}cm`
                              : ''}
                          </div>
                        )}
                        <label className="mb-4 block text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                          عنوان محصول
                          <ErpInput
                            value={draft.contractualTitle || ''}
                            onChange={(event) => setDraft({
                              ...draft,
                              contractualTitle: event.target.value
                            })}
                            className="mt-1 h-9 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 text-sm font-normal outline-none focus:border-[var(--sds-accent)] dark:border-[var(--sds-border-default)]"
                          />
                        </label>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                              نوع سنگ
                            </label>
                            <div className="relative">
                              <ErpInput
                                name="stone"
                                className="w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 py-2 text-[var(--sds-text-primary)] transition-all focus:border-[var(--sds-accent)] focus:outline-none dark:border-[var(--sds-border-default)] dark:text-[var(--sds-text-inverse)]"
                                value={stairSystemV2.stoneSearchTerm}
                                onChange={(e) => stairSystemV2.setStoneSearchTerm(e.target.value)}
                              />
                            </div>
                            {stairSystemV2.stoneSearchTerm &&
                              stairSystemV2.stoneSearchTerm !== draft.stoneLabel && (
                              <div className="mt-2 max-h-48 divide-y divide-[var(--sds-border-subtle)] overflow-auto border-y border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] dark:divide-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)]">
                                {stairSystemV2.isSearchingStones && (
                                  <div className="p-3 text-center text-sm text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                    <span className="animate-pulse">در حال جستجو...</span>
                                  </div>
                                )}
                                {!stairSystemV2.isSearchingStones && stairSystemV2.stoneSearchResults.length === 0 && (
                                  <div className="p-3 text-center text-sm text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">نتیجه‌ای یافت نشد</div>
                                )}
                                {stairSystemV2.stoneSearchResults.map((p: Product) => (
                                  <ErpPressable
                                    key={p.id}
                                    type="button"
                                    className="w-full text-right px-4 py-2.5 hover:bg-[var(--sds-accent-soft)] dark:hover:bg-[var(--sds-accent-soft)] text-sm border-b border-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)] last:border-0 transition-colors"
                                    onClick={() => {
                                      selectProductForStairPart(stairSystemV2.stairActivePart, p);
                                    }}
                                  >
                                    {/* 🎯 Show complete product name using generateFullProductName */}
                                    <div className="font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                                      {p.fullName || generateFullProductName(p) || p.namePersian || p.name}
                                    </div>
                                  </ErpPressable>
                                ))}
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="mb-2 flex items-center justify-between text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                              <span>طول</span>
                              <CompactUnitSwitch
                                label="واحد طول"
                                value={draft.lengthValue === null || draft.lengthValue === undefined
                                  ? ''
                                  : String(draft.lengthValue)}
                                unit={draft.lengthUnit || 'm'}
                                onChange={(next) => setDraft({
                                  ...draft,
                                  lengthValue: next.value ? Number(next.value) : null,
                                  lengthUnit: next.unit
                                })}
                              />
                            </label>
                            <FormattedNumberInput
                                name="length"
                                value={draft.lengthValue ?? null}
                            onChange={(value) => {
                              const normalizedValue = value && value > 0 ? value : null;
                              const updatedDraft: StairPartDraftV2 = { ...draft, lengthValue: normalizedValue };
                              const error = validateDraftNumericFields(stairSystemV2.stairActivePart, updatedDraft, 'length', value);
                              const motherLengthError = validateDraftNumericFields(
                                stairSystemV2.stairActivePart,
                                updatedDraft,
                                'motherLength',
                                updatedDraft.standardLengthValue ?? null
                              );
                              stairSystemV2.setStairDraftErrors(prev => ({
                                ...prev,
                                [stairSystemV2.stairActivePart]: {
                                  ...prev[stairSystemV2.stairActivePart],
                                  length: error || undefined,
                                  motherLength: motherLengthError || undefined
                                }
                              }));
                              setDraft(updatedDraft);
                            }}
                                min={0}
                                step={0.01}
                                className="w-full rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-4 py-2.5 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent transition-all"
                              />
                            <div className="mt-3">
                              <label className="mb-2 flex items-center justify-between text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                <span>طول مادر</span>
                                <CompactUnitSwitch
                                  label="واحد طول مادر"
                                  value={
                                    draft.standardLengthValue === null ||
                                    draft.standardLengthValue === undefined
                                      ? ''
                                      : String(draft.standardLengthValue)
                                  }
                                  unit={
                                    draft.standardLengthUnit ||
                                    draft.lengthUnit ||
                                    'm'
                                  }
                                  onChange={next => {
                                    const updatedDraft: StairPartDraftV2 = {
                                      ...draft,
                                      standardLengthValue: next.value
                                        ? Number(next.value)
                                        : null,
                                      standardLengthUnit: next.unit
                                    };
                                    const error = validateDraftNumericFields(
                                      stairSystemV2.stairActivePart,
                                      updatedDraft,
                                      'motherLength',
                                      updatedDraft.standardLengthValue ?? null
                                    );
                                    stairSystemV2.setStairDraftErrors(previous => ({
                                      ...previous,
                                      [stairSystemV2.stairActivePart]: {
                                        ...previous[stairSystemV2.stairActivePart],
                                        motherLength: error || undefined
                                      }
                                    }));
                                    setDraft(updatedDraft);
                                  }}
                                />
                              </label>
                              <FormattedNumberInput
                                name="motherLength"
                                value={draft.standardLengthValue ?? null}
                                onChange={value => {
                                  const normalized =
                                    value && value > 0 ? value : null;
                                  const updatedDraft: StairPartDraftV2 = {
                                    ...draft,
                                    standardLengthValue: normalized
                                  };
                                  const error = validateDraftNumericFields(
                                    stairSystemV2.stairActivePart,
                                    updatedDraft,
                                    'motherLength',
                                    normalized
                                  );
                                  stairSystemV2.setStairDraftErrors(previous => ({
                                    ...previous,
                                    [stairSystemV2.stairActivePart]: {
                                      ...previous[stairSystemV2.stairActivePart],
                                      motherLength: error || undefined
                                    }
                                  }));
                                  setDraft(updatedDraft);
                                }}
                                min={0}
                                step={0.01}
                                className="w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-4 py-2.5 text-[var(--sds-text-primary)] transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-default)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-inverse)]"
                              />
                              {draftErrors.motherLength && (
                                <p className="mt-1 text-xs text-[var(--sds-danger)]">
                                  {draftErrors.motherLength}
                                </p>
                              )}
                            </div>
                          {draftErrors.length && (
                            <p className="mt-1 text-xs text-[var(--sds-danger)]">{draftErrors.length}</p>
                          )}
                          </div>

                          <div>
                            <label className="mb-2 flex items-center justify-between text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                              <span>
                                {stairSystemV2.stairActivePart === 'tread'
                                  ? 'عمق'
                                  : stairSystemV2.stairActivePart === 'riser'
                                    ? 'ارتفاع'
                                    : 'عرض'}
                              </span>
                              <CompactUnitSwitch
                                label={
                                  stairSystemV2.stairActivePart === 'tread'
                                    ? 'واحد عمق'
                                    : stairSystemV2.stairActivePart === 'riser'
                                      ? 'واحد ارتفاع'
                                      : 'واحد عرض'
                                }
                                value={draft.widthCm === null || draft.widthCm === undefined
                                  ? ''
                                  : String((draft.widthUnit || 'cm') === 'm'
                                    ? draft.widthCm / 100
                                    : draft.widthCm)}
                                unit={draft.widthUnit || 'cm'}
                                onChange={(next) => setDraft({
                                  ...draft,
                                  widthUnit: next.unit
                                })}
                              />
                            </label>
                            <FormattedNumberInput
                              name="width"
                              value={draft.widthCm === null || draft.widthCm === undefined
                                ? null
                                : (draft.widthUnit || 'cm') === 'm'
                                  ? draft.widthCm / 100
                                  : draft.widthCm}
                            onChange={(value) => {
                              const canonicalWidthCm = value && value > 0
                                ? (draft.widthUnit || 'cm') === 'm'
                                  ? value * 100
                                  : value
                                : null;
                              const updatedDraft = { ...draft, widthCm: canonicalWidthCm };
                              // 🎯 Validate using comprehensive validation function
                              const error = validateDraftNumericFields(
                                stairSystemV2.stairActivePart,
                                updatedDraft,
                                'width',
                                canonicalWidthCm
                              );
                              if (error) {
                                stairSystemV2.setStairDraftErrors(prev => ({
                                  ...prev,
                                  [stairSystemV2.stairActivePart]: { ...prev[stairSystemV2.stairActivePart], width: error }
                                }));
                              } else {
                                clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'width');
                              }
                              setDraft(updatedDraft);
                            }}
                              min={0}
                              step={0.1}
                              className="w-full rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-4 py-2.5 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent transition-all"
                            />
                          {draftErrors.width && (
                            <p className="mt-1 text-xs text-[var(--sds-danger)]">{draftErrors.width}</p>
                          )}
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                              تعداد
                            </label>
                            <FormattedNumberInput
                              name="quantity"
                              value={draft.quantity ?? null}
                            onChange={(value) => {
                              if (
                                stairSystemV2.stairActivePart === 'tread' ||
                                stairSystemV2.stairActivePart === 'riser'
                              ) {
                                setStairQuantityManuallyEdited(current => ({
                                  ...current,
                                  [stairSystemV2.stairActivePart]: true
                                }));
                              }
                              // 🎯 Ensure integer value for quantity
                              const intValue = value ? Math.floor(value) : null;
                              const updatedDraft = { ...draft, quantity: intValue && intValue > 0 ? intValue : null };
                              // 🎯 Validate using comprehensive validation function
                              const error = validateDraftNumericFields(stairSystemV2.stairActivePart, updatedDraft, 'quantity', intValue);
                              if (error) {
                                stairSystemV2.setStairDraftErrors(prev => ({
                                  ...prev,
                                  [stairSystemV2.stairActivePart]: { ...prev[stairSystemV2.stairActivePart], quantity: error }
                                }));
                              } else {
                                clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'quantity');
                              }
                              setDraft(updatedDraft);
                            }}
                              min={1}
                              step={1}
                              className="w-full rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-4 py-2.5 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent transition-all"
                            />
                          {draftErrors.quantity && (
                            <p className="mt-1 text-xs text-[var(--sds-danger)]">{draftErrors.quantity}</p>
                          )}
                          </div>
                          {draft.stoneProduct && totals.piecesPerStone > 0 && totals.baseStoneQuantity > 0 && (
                            <div className="md:col-span-2">
                              <div className="mt-2 border-y border-[var(--sds-border-subtle)] py-2 text-xs leading-5 text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-subtle)] dark:text-[var(--sds-text-secondary)]">
                                <div>
                                  ظرفیت برش هر سنگ: تا {formatDisplayNumber(totals.piecesPerStone)} قطعه با عرض {formatDisplayNumber(draft.widthCm ?? 0)} سانتی‌متر.
                                </div>
                                <div>
                                  تعداد سنگ پایه مورد نیاز: {formatDisplayNumber(totals.baseStoneQuantity)} عدد
                                  {totals.remainingStoneGroups.length > 0
                                    ? ` ⬢ باقی‌مانده قابل استفاده: ${formatStairRemainingGroups(totals.remainingStoneGroups)}`
                                    : ''}
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="md:col-span-2 divide-y divide-[var(--sds-border-subtle)] border-y border-[var(--sds-border-subtle)] text-sm dark:divide-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)]">
                            <div className="flex min-h-10 items-center justify-between">
                              <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                محصول نهایی
                              </span>
                              <strong>
                                {formatDisplayNumber(
                                  canonicalStairPreview
                                    ? Number(canonicalStairPreview.requestedAreaSquareMeters)
                                    : totals.sqm
                                )}m²
                              </strong>
                            </div>
                            <div className="flex min-h-10 items-center justify-between">
                              <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                سنگ مادر مصرفی
                              </span>
                              <strong>
                                {canonicalStairPreview
                                  ? `${formatDisplayNumber(Number(canonicalStairPreview.consumedMotherAreaSquareMeters))}m²`
                                  : '—'}
                              </strong>
                            </div>
                            <div className="flex min-h-10 items-center justify-between">
                              <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                باقی‌مانده پرداخت‌شده
                              </span>
                              <strong>
                                {canonicalStairPreview
                                  ? `${formatDisplayNumber(Number(canonicalStairPreview.paidRemainderAreaSquareMeters))}m²`
                                  : '—'}
                              </strong>
                            </div>
                            <div className="flex min-h-10 items-center justify-between">
                              <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                مبلغ ماده
                              </span>
                              <strong>
                                {canonicalStairPreview
                                  ? formatPrice(Number(canonicalStairPreview.baseAmountToman))
                                  : '—'}
                              </strong>
                            </div>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                              {stairSystemV2.stairActivePart === 'tread'
                                ? 'فی کف پله'
                                : stairSystemV2.stairActivePart === 'riser'
                                  ? 'فی خیز'
                                  : 'فی پاگرد'}
                            </label>
                            <FormattedNumberInput
                              name="pricePerSquareMeter"
                              value={draft.pricePerSquareMeter ?? null}
                            onChange={(value) => {
                              const updatedDraft = { ...draft, pricePerSquareMeter: value && value > 0 ? value : null };
                              // 🎯 Validate using comprehensive validation function
                              const error = validateDraftNumericFields(stairSystemV2.stairActivePart, updatedDraft, 'pricePerSquareMeter', value);
                              if (error) {
                                stairSystemV2.setStairDraftErrors(prev => ({
                                  ...prev,
                                  [stairSystemV2.stairActivePart]: { ...prev[stairSystemV2.stairActivePart], pricePerSquareMeter: error }
                                }));
                              } else {
                                clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'pricePerSquareMeter');
                              }
                              setDraft(updatedDraft);
                            }}
                              min={0}
                              step={1000}
                              className="w-full rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-4 py-2.5 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent transition-all"
                            />
                          {draftErrors.pricePerSquareMeter && (
                            <p className="mt-1 text-xs text-[var(--sds-danger)]">{draftErrors.pricePerSquareMeter}</p>
                          )}
                          </div>
                          {supportsMandatory && (
                            <div className="md:col-span-2 border-y border-[var(--sds-border-subtle)] py-2 dark:border-[var(--sds-border-subtle)]">
                              <div className="flex items-center gap-2">
                                <CompactSwitch
                                  label="حکمی"
                                  checked={mandatoryEnabled}
                                  onChange={(nextValue) => {
                                    const updatedDraft = {
                                      ...draft,
                                      useMandatory: nextValue,
                                      mandatoryPercentage: nextValue ? (draft.mandatoryPercentage ?? 20) : null
                                    };
                                    if (!nextValue) {
                                      clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'mandatoryPercentage');
                                    }
                                    setDraft(updatedDraft);
                                  }}
                                />
                                <span className="text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                  حکمی
                                </span>
                              </div>
                              {mandatoryEnabled && (
                                <div className="mt-3 flex items-center gap-2">
                                  <FormattedNumberInput
                                    name="mandatoryPercentage"
                                    value={mandatoryPercentageValue}
                                    onChange={(value) => {
                                      const updatedDraft = { ...draft, mandatoryPercentage: value ?? 0 };
                                      const error = validateDraftNumericFields(stairSystemV2.stairActivePart, updatedDraft, 'mandatoryPercentage', value);
                                      if (error) {
                                        stairSystemV2.setStairDraftErrors(prev => ({
                                          ...prev,
                                          [stairSystemV2.stairActivePart]: { ...prev[stairSystemV2.stairActivePart], mandatoryPercentage: error }
                                        }));
                                      } else {
                                        clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'mandatoryPercentage');
                                      }
                                      setDraft(updatedDraft);
                                    }}
                                    min={0}
                                    max={100}
                                    step={1}
                                    className="w-24 rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-3 py-2 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent text-sm"
                                  />
                                  <span className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">%</span>
                                </div>
                              )}
                              {draftErrors.mandatoryPercentage && (
                                <p className="mt-1 text-xs text-[var(--sds-danger)]">
                                  {draftErrors.mandatoryPercentage}
                                </p>
                              )}
                            </div>
                          )}
                          {totals.billableCuttingCost > 0 && (
                            <div className="md:col-span-2">
                              <div className="mt-2 border-y border-[var(--sds-border-subtle)] py-2 text-xs leading-5 text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-subtle)] dark:text-[var(--sds-text-secondary)]">
                                {totals.billableCuttingCostLongitudinal > 0 && (
                                  <div>
                                    هزینه برش طولی: {formatPrice(totals.billableCuttingCostLongitudinal)} ({formatDisplayNumber(totals.cuttingMetersLongitudinal || (lengthMInfo * totals.baseStoneQuantity))} m × {formatPrice(totals.shouldChargeCuttingCost ? (totals.cuttingCostPerMeterLongitudinal || totals.cuttingCostPerMeter) : 0)})
                                    {totals.cuttingMetersLongitudinalProduction > 0 && totals.cuttingMetersLongitudinalCalibration > 0 && (
                                      <span className="block text-[11px] opacity-80">
                                        {formatDisplayNumber(totals.cuttingMetersLongitudinalProduction)} m برش قطعه‌ها + {formatDisplayNumber(totals.cuttingMetersLongitudinalCalibration)} m برش کالیبر
                                      </span>
                                    )}
                                  </div>
                                )}
                                {totals.billableCuttingCostCross > 0 && (
                                  <div className="mt-1">
                                    هزینه برش عرضی: {formatPrice(totals.billableCuttingCostCross)} ({formatDisplayNumber(totals.cuttingMetersCross || (((draft.stoneProduct?.widthValue || 0) / 100) * totals.baseStoneQuantity))} m × {formatPrice(totals.shouldChargeCuttingCost ? (totals.cuttingCostPerMeterCross || totals.cuttingCostPerMeter) : 0)})
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="border-b border-[var(--sds-border-default)] py-3 dark:border-[var(--sds-border-subtle)]">
                        <label className="block text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                          توضیحات
                        <AutoGrowingDescription
                          value={draft.description || ''}
                          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                          className="mt-1"
                        />
                        </label>
                      </div>

                      {draft.stoneProduct &&
                        getActualLengthMeters(draft) > 0 &&
                        Number(draft.widthCm) > 0 &&
                        Number(draft.quantity) > 0 && (
                          <div id="stair-operations-section">
                            <OperationCollectionsSection
                              input={createStairOperationInput(
                                stairSystemV2.stairActivePart,
                                draft,
                                draft.stoneProduct.id
                              )}
                              onChange={(operationPolicyInput) =>
                                setDraft({ ...draft, operationPolicyInput })}
                              loadTools={async () => subServices.map(tool => ({
                                catalogItemId: tool.id,
                                catalogSnapshotVersion: String(
                                  (tool as SubService & { updatedAt?: string }).updatedAt ||
                                  'current'
                                ),
                                name: tool.namePersian || tool.name || tool.code,
                                unit: tool.calculationBase === 'squareMeters'
                                  ? 'squareMeter' as const
                                  : 'meter' as const,
                                rateToman: tool.pricePerMeter === null ||
                                  tool.pricePerMeter === undefined
                                  ? null
                                  : String(tool.pricePerMeter)
                              }))}
                              loadFinishings={async () => stoneFinishings.map(finishing => ({
                                catalogItemId: finishing.id,
                                catalogSnapshotVersion: String(
                                  (finishing as StoneFinishing & { updatedAt?: string }).updatedAt ||
                                  'current'
                                ),
                                name: finishing.namePersian || finishing.name || finishing.code || 'پرداخت',
                                unit: finishing.calculationBase === 'length'
                                  ? 'meter' as const
                                  : 'squareMeter' as const,
                                rateToman: (() => {
                                  const rate = finishing.calculationBase === 'length'
                                    ? finishing.unitPrice
                                    : finishing.pricePerSquareMeter ?? finishing.unitPrice;
                                  return rate === null || rate === undefined
                                    ? null
                                    : String(rate);
                                })(),
                                incompatibleCatalogItemIds:
                                  finishing.incompatibleWithIds || []
                              }))}
                              toolCacheKey="stair-product-tools"
                              finishingCacheKey="stair-product-finishings"
                            />
                          </div>
                        )}

                      {/* Tools Section - Enhanced */}
                      {false && (
                      <div id="stair-tools-section" className="bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)] p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-[var(--sds-purple)] to-[var(--sds-purple-surface)] rounded-full"></div>
                            <h5 className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">ابزارها (بر متر)</h5>
                          </div>
                          {stairSystemV2.stairActivePart === 'landing' && (
                            <span className="text-xs text-[var(--sds-purple)] dark:text-[var(--sds-purple)] bg-[var(--sds-purple-surface)] dark:bg-[var(--sds-purple-surface)] px-2 py-1 rounded">مدل لبه پاگرد: محیط/جهت‌ها</span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">افزودن ابزار</label>
                            <ErpInput
                              className="w-full rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-4 py-2.5 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent transition-all"
                              value={stairSystemV2.toolsSearchTerm}
                              onChange={(e) => stairSystemV2.setToolsSearchTerm(e.target.value)}
                              onFocus={() => stairSystemV2.setToolsDropdownOpen(true)}
                              onBlur={() => setTimeout(() => stairSystemV2.setToolsDropdownOpen(false), 150)}
                            />
                            {(stairSystemV2.toolsDropdownOpen || stairSystemV2.toolsSearchTerm) && (
                              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)] bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] shadow-lg">
                                {stairSystemV2.isSearchingTools && (
                                  <div className="p-3 text-center text-sm text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                    <span className="animate-pulse">در حال جستجو...</span>
                                  </div>
                                )}
                                {!stairSystemV2.isSearchingTools && stairSystemV2.toolsResults.length === 0 && (
                                  <div className="p-3 text-center text-sm text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">نتیجه‌ای یافت نشد</div>
                                )}
                                {stairSystemV2.toolsResults.map((t: any) => (
                                  <ErpPressable
                                    key={t.id}
                                    type="button"
                                    className="w-full text-right px-4 py-2.5 hover:bg-[var(--sds-purple-surface)] dark:hover:bg-[var(--sds-purple-surface)] text-sm border-b border-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)] last:border-0 transition-colors"
                                    onClick={() => {
                                      setDraft({
                                        ...draft,
                                        tools: [
                                          ...(draft.tools || []),
                                          {
                                            selectionId: crypto.randomUUID(),
                                            toolId: t.id,
                                            name: t.namePersian || t.name,
                                            pricePerMeter: t.pricePerMeter || t.price || t.costPerMeter || 0,
                                            calculationBase: t.calculationBase === 'squareMeters'
                                              ? 'squareMeters'
                                              : 'length',
                                            coveredQuantity: draft.quantity || null,
                                            front: false,
                                            left: false,
                                            right: false,
                                            back: false,
                                            perimeter: false
                                          }
                                        ]
                                      });
                                      stairSystemV2.setToolsSearchTerm('');
                                      stairSystemV2.setToolsDropdownOpen(false);
                                    }}
                                  >
                                    <div className="font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">{t.namePersian || t.name}</div>
                                    {(t.pricePerMeter || t.price || t.costPerMeter) && (
                                      <div className="text-xs text-[var(--sds-purple)] dark:text-[var(--sds-purple)] mt-0.5">
                                        {formatPrice(t.pricePerMeter || t.price || t.costPerMeter)}/m
                                      </div>
                                    )}
                                  </ErpPressable>
                                ))}
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">ابزارهای انتخاب شده و لبه‌ها</label>
                            {(draft.tools || []).length === 0 ? (
                              <div className="text-center py-8 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] rounded-lg border border-dashed border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)]">
                                <p className="text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">ابزاری انتخاب نشده است.</p>
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-64 overflow-y-auto">
                                {(draft.tools || []).map((tool, idx) => {
                                  const meters = computeToolMetersForTool(stairSystemV2.stairActivePart, draft, tool);
                                  const tp = meters * (tool.pricePerMeter || 0);
                                  return (
                                    <div key={tool.selectionId || `${tool.toolId}:${idx}`} className="p-3 rounded-lg border border-[var(--sds-purple-border)] dark:border-[var(--sds-purple-border)] bg-[var(--sds-purple-surface)] dark:bg-[var(--sds-purple-surface)] shadow-sm">
                                      <div className="flex items-center justify-between mb-3">
                                        <div className="font-medium text-[var(--sds-purple)] dark:text-[var(--sds-purple)] text-sm">{tool.name}</div>
                                        <div className="flex items-center gap-2 text-xs">
                                          <span className="px-2 py-1 bg-[var(--sds-purple-surface)] dark:bg-[var(--sds-purple-surface)] text-[var(--sds-purple)] dark:text-[var(--sds-purple)] rounded font-medium">
                                            {formatDisplayNumber(meters)} {tool.calculationBase === 'squareMeters' ? 'm²' : 'm'}
                                          </span>
                                          <span className="font-semibold text-[var(--sds-purple)] dark:text-[var(--sds-purple)]">{formatPrice(tp)}</span>
                                          <ErpPressable
                                            type="button"
                                            className="text-[var(--sds-danger)] hover:text-[var(--sds-danger)] hover:bg-[var(--sds-danger-surface)] dark:hover:bg-[var(--sds-danger-surface)] px-2 py-1 rounded transition-colors"
                                            onClick={() => {
                                              const tools = (draft.tools || []).filter((_, i) => i !== idx);
                                              setDraft({ ...draft, tools });
                                            }}
                                            title="حذف ابزار"
                                          >
                                            <FaTrash className="w-3 h-3" />
                                          </ErpPressable>
                                        </div>
                                      </div>
                                      <label className="mb-2 flex items-center gap-2 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                        <span>تعداد قطعات</span>
                                        <ErpInput
                                          value={tool.coveredQuantity ?? draft.quantity ?? ''}
                                          onChange={(event) => {
                                            const value = Number(event.target.value);
                                            const tools = [...(draft.tools || [])];
                                            tools[idx] = {
                                              ...tool,
                                              coveredQuantity: Number.isInteger(value) && value > 0
                                                ? value
                                                : null
                                            };
                                            setDraft({ ...draft, tools });
                                          }}
                                          inputMode="numeric"
                                          className="h-8 w-20 rounded-md border border-[var(--sds-border-default)] bg-transparent px-2 dark:border-[var(--sds-border-subtle)]"
                                        />
                                      </label>
                                      {(tool.coveredQuantity || 0) > Number(draft.quantity || 0) && (
                                        <div className="mb-2 text-[11px] text-[var(--sds-danger)]">
                                          تعداد تحت عملیات از تعداد محصول بیشتر است
                                        </div>
                                      )}
                                      {tool.calculationBase !== 'squareMeters' && (
                                      <div className="flex flex-wrap gap-2 text-xs">
                                        <label className="flex items-center gap-1.5 px-2 py-1 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] rounded border border-[var(--sds-purple-border)] dark:border-[var(--sds-purple-border)] cursor-pointer hover:bg-[var(--sds-purple-surface)] dark:hover:bg-[var(--sds-purple-surface)] transition-colors">
                                            <ErpInput
                                              type="checkbox"
                                              checked={!!tool.perimeter}
                                              onChange={(e) => {
                                                const tools = [...(draft.tools || [])];
                                                tools[idx] = { ...tool, perimeter: e.target.checked };
                                                setDraft({ ...draft, tools });
                                              }}
                                              className="rounded border-[var(--sds-border-default)] text-[var(--sds-purple)] focus:ring-[var(--sds-focus-ring)]"
                                            />
                                            <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">محیط کامل</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 px-2 py-1 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] rounded border border-[var(--sds-purple-border)] dark:border-[var(--sds-purple-border)] cursor-pointer hover:bg-[var(--sds-purple-surface)] dark:hover:bg-[var(--sds-purple-surface)] transition-colors">
                                          <ErpInput
                                            type="checkbox"
                                            checked={!!tool.front}
                                            onChange={(e) => {
                                              const tools = [...(draft.tools || [])];
                                              tools[idx] = { ...tool, front: e.target.checked };
                                              setDraft({ ...draft, tools });
                                            }}
                                            className="rounded border-[var(--sds-border-default)] text-[var(--sds-purple)] focus:ring-[var(--sds-focus-ring)]"
                                          />
                                          <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">جلو</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 px-2 py-1 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] rounded border border-[var(--sds-purple-border)] dark:border-[var(--sds-purple-border)] cursor-pointer hover:bg-[var(--sds-purple-surface)] dark:hover:bg-[var(--sds-purple-surface)] transition-colors">
                                            <ErpInput
                                              type="checkbox"
                                              checked={!!tool.back}
                                              onChange={(e) => {
                                                const tools = [...(draft.tools || [])];
                                                tools[idx] = { ...tool, back: e.target.checked };
                                                setDraft({ ...draft, tools });
                                              }}
                                              className="rounded border-[var(--sds-border-default)] text-[var(--sds-purple)] focus:ring-[var(--sds-focus-ring)]"
                                            />
                                            <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">عقب</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 px-2 py-1 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] rounded border border-[var(--sds-purple-border)] dark:border-[var(--sds-purple-border)] cursor-pointer hover:bg-[var(--sds-purple-surface)] dark:hover:bg-[var(--sds-purple-surface)] transition-colors">
                                          <ErpInput
                                            type="checkbox"
                                            checked={!!tool.left}
                                            onChange={(e) => {
                                              const tools = [...(draft.tools || [])];
                                              tools[idx] = { ...tool, left: e.target.checked };
                                              setDraft({ ...draft, tools });
                                            }}
                                            className="rounded border-[var(--sds-border-default)] text-[var(--sds-purple)] focus:ring-[var(--sds-focus-ring)]"
                                          />
                                          <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">چپ</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 px-2 py-1 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] rounded border border-[var(--sds-purple-border)] dark:border-[var(--sds-purple-border)] cursor-pointer hover:bg-[var(--sds-purple-surface)] dark:hover:bg-[var(--sds-purple-surface)] transition-colors">
                                          <ErpInput
                                            type="checkbox"
                                            checked={!!tool.right}
                                            onChange={(e) => {
                                              const tools = [...(draft.tools || [])];
                                              tools[idx] = { ...tool, right: e.target.checked };
                                              setDraft({ ...draft, tools });
                                            }}
                                            className="rounded border-[var(--sds-border-default)] text-[var(--sds-purple)] focus:ring-[var(--sds-focus-ring)]"
                                          />
                                          <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">راست</span>
                                        </label>
                                      </div>
                                      )}
                                      {tool.calculationBase !== 'squareMeters' &&
                                        !tool.perimeter &&
                                        !tool.front &&
                                        !tool.back &&
                                        !tool.left &&
                                        !tool.right && (
                                          <div className="mt-2 text-[11px] text-[var(--sds-danger)]">
                                            حداقل یک لبه را انتخاب کنید
                                          </div>
                                        )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      )}

                      {/* Inline stair layer configurations */}
                      {true && (
                      <div className="border-y border-[var(--sds-border-default)] py-3 dark:border-[var(--sds-border-subtle)]">
                        <div className="mb-3 flex items-center justify-between">
                          <h5 className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">لایه‌ها</h5>
                          {(draft.numberOfLayersPerStair || 0) > 0 && (
                            <ErpPressable
                              type="button"
                              className="text-xs font-semibold text-[var(--sds-accent)] hover:underline dark:text-[var(--sds-accent)]"
                              onClick={() => {
                                const layerErrors: StairDraftFieldErrors = {};
                                if (!draft.layerTypeId || !(Number(draft.layerTypePrice) > 0)) {
                                  layerErrors.layerType = !draft.layerTypeId
                                    ? 'نوع لایه را انتخاب کنید'
                                    : 'قیمت نوع لایه در انبار معتبر نیست';
                                }
                                if (!draft.layerWidthCm || !hasLayerEdgeSelection(draft.layerEdges)) {
                                  layerErrors.width = 'عرض و سمت‌های لایه را کامل کنید';
                                }
                                if (!draft.layerSourceKind) {
                                  layerErrors.layerSource = 'منبع سنگ لایه را انتخاب کنید';
                                } else if (draft.layerRemovedSideConflicts?.length) {
                                  layerErrors.layerSource = 'عملیات سمت حذف‌شده را تعیین تکلیف کنید';
                                } else if (
                                  draft.layerSourceKind === 'contractRemainder' &&
                                  !(draft.layerSelectedRemainingStoneIds?.length)
                                ) {
                                  layerErrors.layerSource = 'باقی‌مانده موردنظر را انتخاب کنید';
                                } else if (
                                  draft.layerSourceKind === 'newMaterial' &&
                                  (!draft.layerStoneProductId ||
                                    !(Number(draft.layerPricePerSquareMeter) > 0))
                                ) {
                                  layerErrors.layerStone = !draft.layerStoneProductId
                                    ? 'سنگ جدید را انتخاب کنید'
                                    : undefined;
                                  layerErrors.layerStonePrice =
                                    draft.layerStoneProductId &&
                                    !(Number(draft.layerPricePerSquareMeter) > 0)
                                      ? 'قیمت را وارد کنید'
                                      : undefined;
                                }
                                if (Object.values(layerErrors).some(Boolean)) {
                                  stairSystemV2.setStairDraftErrors(prev => ({
                                    ...prev,
                                    [stairSystemV2.stairActivePart]: {
                                      ...prev[stairSystemV2.stairActivePart],
                                      ...layerErrors
                                    }
                                  }));
                                  return;
                                }
                                setDraft(appendStairLayerConfiguration(
                                  draft,
                                  createContractProductRowId()
                                ));
                              }}
                            >
                              افزودن لایه دیگر
                            </ErpPressable>
                          )}
                        </div>
                        {(draft.layerConfigurations || []).length > 0 && (
                          <div className="mb-3 divide-y divide-[var(--sds-border-subtle)] border-y border-[var(--sds-border-default)] text-xs dark:divide-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)]">
                            {(draft.layerConfigurations || []).map((configuration, index) => (
                              <div
                                key={configuration.layerConfigurationDraftId || index}
                                className="flex items-center justify-between gap-3 py-2"
                              >
                                <span>
                                  {configuration.layerTypeName || 'لایه'} ·{' '}
                                  {formatDisplayNumber(configuration.numberOfLayersPerStair || 0)} برای هر قطعه ·{' '}
                                  {formatDisplayNumber(configuration.layerWidthCm || 0)}cm
                                </span>
                                <span className="flex items-center gap-3">
                                  <ErpPressable
                                    type="button"
                                    className="font-semibold text-[var(--sds-accent)] hover:underline dark:text-[var(--sds-accent)]"
                                    onClick={() => {
                                      const configurationId =
                                        configuration.layerConfigurationDraftId;
                                      if (!configurationId) return;
                                      setDraft(
                                        selectStairLayerConfiguration(
                                          draft,
                                          configurationId
                                        )
                                      );
                                    }}
                                  >
                                    ویرایش
                                  </ErpPressable>
                                  <ErpPressable
                                    type="button"
                                    className="font-semibold text-[var(--sds-danger)] hover:underline"
                                    onClick={() => {
                                      const configurationId =
                                        configuration.layerConfigurationDraftId;
                                      if (!configurationId) return;
                                      setDraft(
                                        removeStairLayerConfiguration(
                                          draft,
                                          configurationId
                                        )
                                      );
                                    }}
                                  >
                                    حذف
                                  </ErpPressable>
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="mb-2 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                              تعداد لایه برای هر پله
                            </label>
                            <FormattedNumberInput
                              value={draft.numberOfLayersPerStair ?? null}
                              onChange={(value) => {
                                // 🎯 Ensure integer value and validate
                                const intValue = value ? Math.floor(value) : null;
                                if (intValue && intValue > 0) {
                                  let updatedDraft: StairPartDraftV2 = { ...draft, numberOfLayersPerStair: intValue };
                                  if (!hasLayerEdgeSelection(updatedDraft.layerEdges)) {
                                    updatedDraft = deriveLayerEdgesFromTools(updatedDraft, stairSystemV2.stairActivePart);
                                  }
                                  setDraft(updatedDraft);
                                  if (!draft.layerTypeId) {
                                    stairSystemV2.setStairDraftErrors(prev => ({
                                      ...prev,
                                      [stairSystemV2.stairActivePart]: {
                                        ...prev[stairSystemV2.stairActivePart],
                                        layerType: 'لطفاً نوع لایه را انتخاب کنید'
                                      }
                                    }));
                                  } else {
                                    clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerType');
                                  }
                                } else if (intValue === null || intValue === 0) {
                                  setDraft({
                                    ...draft,
                                    numberOfLayersPerStair: null,
                                    layerUseDifferentStone: false,
                                    layerStoneProductId: null,
                                    layerStoneProduct: null,
                                    layerStoneLabel: null,
                                    layerPricePerSquareMeter: null,
                                    layerUseMandatory: undefined,
                                    layerMandatoryPercentage: null
                                  });
                                  clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerType');
                                  clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerStone');
                                  clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerStonePrice');
                                  clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerMandatoryPercentage');
                                }
                              }}
                              min={1}
                              step={1}
                              className="w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 py-2 text-[var(--sds-text-primary)] outline-none focus:border-[var(--sds-accent)] dark:border-[var(--sds-border-default)] dark:text-[var(--sds-text-inverse)]"
                            />
                          </div>

                          {draft.numberOfLayersPerStair && draft.numberOfLayersPerStair > 0 && (
                            <>
                              <div>
                                <label className="mb-2 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                  عرض لایه
                                </label>
                                <FormattedNumberInput
                                  value={draft.layerWidthCm ?? null}
                                  onChange={(value) => {
                                    const updatedDraft = { ...draft, layerWidthCm: value && value > 0 ? value : null };
                                    // 🎯 Validate layer width against available remaining width
                                    if (value && value > 0) {
                                      const originalWidthCm = draft.stoneProduct?.widthValue || 0;
                                      const mainWidthCm = draft.widthCm || 0;
                                      const availableWidthCm = originalWidthCm - mainWidthCm;

                                      if (originalWidthCm > 0 && value > availableWidthCm && availableWidthCm > 0) {
                                        stairSystemV2.setStairDraftErrors(prev => ({
                                          ...prev,
                                          [stairSystemV2.stairActivePart]: {
                                            ...prev[stairSystemV2.stairActivePart],
                                            width: `عرض لایه (${formatDisplayNumber(value)}cm) نمی‌تواند بیشتر از عرض باقی‌مانده (${formatDisplayNumber(availableWidthCm)}cm) باشد`
                                          }
                                        }));
                                      } else {
                                        clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'width');
                                      }
                                    }
                                    setDraft(updatedDraft);
                                  }}
                                  min={0}
                                  step={0.1}
                                  className="w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 py-2 text-[var(--sds-text-primary)] outline-none focus:border-[var(--sds-accent)] dark:border-[var(--sds-border-default)] dark:text-[var(--sds-text-inverse)]"
                                />
                              </div>


                              <div className="md:col-span-2 flex min-h-9 items-center justify-between border-b border-[var(--sds-border-default)] py-2 text-xs dark:border-[var(--sds-border-subtle)]">
                                <span className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                                  خوراک اره
                                </span>
                                <CompactSwitch
                                  label="خوراک اره"
                                  checked={Boolean(draft.sawKerfEnabled)}
                                  onChange={(checked) => setDraft({
                                    ...draft,
                                    sawKerfEnabled: checked,
                                    sawKerfCm: checked
                                      ? (draft.sawKerfCm || SAW_KERF_CM)
                                      : null
                                  })}
                                />
                              </div>

                              <div>
                                  <label className="mb-2 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                    نوع لایه
                                  </label>
                                  <EnhancedDropdown
                                    className="w-full"
                                    label="نوع لایه"
                                    value={draft.layerTypeId || ''}
                                    disabled={stairSystemV2.layerTypesStatus !== 'ready'}
                                    placeholder="انتخاب نوع لایه…"
                                    noOptionsText="نوع لایه فعالی وجود ندارد"
                                    options={[
                                      ...(draft.layerTypeId &&
                                      !stairSystemV2.layerTypes.some(option => option.id === draft.layerTypeId)
                                        ? [{
                                            value: draft.layerTypeId,
                                            label: `${draft.layerTypeName || 'نوع لایه ثبت‌شده'}${
                                              stairSystemV2.layerTypesStatus === 'ready' ||
                                              stairSystemV2.layerTypesStatus === 'empty'
                                                ? ' — غیرفعال در کاتالوگ فعلی'
                                                : ' — اطلاعات ذخیره‌شده'
                                            }`,
                                            disabled: true
                                          }]
                                        : []),
                                      ...stairSystemV2.layerTypes.map((option: LayerTypeOption) => ({
                                        value: option.id,
                                        label: option.name
                                      }))
                                    ]}
                                    onChange={(selectedId) => {
                                      if (!selectedId) {
                                        setDraft({
                                          ...draft,
                                          layerTypeId: null,
                                          layerTypeName: null,
                                          layerTypePrice: null,
                                          layerTypeCalculationUnit: null
                                        });
                                        if ((draft.numberOfLayersPerStair || 0) > 0) {
                                          stairSystemV2.setStairDraftErrors(prev => ({
                                            ...prev,
                                            [stairSystemV2.stairActivePart]: {
                                              ...prev[stairSystemV2.stairActivePart],
                                              layerType: 'لطفاً نوع لایه را انتخاب کنید'
                                            }
                                          }));
                                        }
                                        return;
                                      }
                                      const selected = stairSystemV2.layerTypes.find(option => option.id === selectedId);
                                      if (selected) {
                                        setDraft(applyInventoryLayerTypeSelection(draft, selected));
                                        if (selected.pricePerLayer > 0) {
                                          clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerType');
                                        }
                                      }
                                    }}
                                  />
                                  {stairSystemV2.layerTypesStatus === 'loading' && (
                                    <p className="mt-1 text-xs text-[var(--sds-text-muted)]">در حال دریافت انواع لایه…</p>
                                  )}
                                  {stairSystemV2.layerTypesStatus === 'empty' && (
                                    <p className="mt-1 text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">
                                      هیچ نوع لایه فعالی ثبت نشده است؛ با مدیر انبار تماس بگیرید
                                    </p>
                                  )}
                                  {stairSystemV2.layerTypesStatus === 'error' && (
                                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">
                                      <span>{stairSystemV2.layerTypesError}</span>
                                      <ErpPressable
                                        type="button"
                                        className="font-semibold text-[var(--sds-accent)] hover:underline dark:text-[var(--sds-accent)]"
                                        onClick={() => void stairSystemV2.reloadLayerTypes()}
                                      >
                                        تلاش مجدد
                                      </ErpPressable>
                                    </div>
                                  )}
                                  {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerType && (
                                    <p className="mt-1 text-xs text-[var(--sds-danger)]">
                                      {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerType}
                                    </p>
                                  )}
                                  {draft.layerTypeId && (
                                    <div className="mt-3 grid grid-cols-2 gap-3 border-y border-[var(--sds-border-default)] py-2 text-xs dark:border-[var(--sds-border-subtle)]">
                                      <div>
                                        <span className="block text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">قیمت نوع لایه</span>
                                        <strong className="mt-1 block text-sm text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                                          {formatPrice(Number(draft.layerTypePrice) || 0)}
                                        </strong>
                                      </div>
                                      <div>
                                        <span className="block text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">واحد محاسبه</span>
                                        <strong className="mt-1 block text-sm text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                                        {(stairSystemV2.layerTypes.find(
                                          option => option.id === draft.layerTypeId
                                        )?.calculationUnit || draft.layerTypeCalculationUnit) === 'physicalPiece'
                                          ? 'هر قطعه فیزیکی'
                                          : (stairSystemV2.layerTypes.find(
                                              option => option.id === draft.layerTypeId
                                            )?.calculationUnit || draft.layerTypeCalculationUnit) === 'meter'
                                            ? 'متر طول'
                                            : (stairSystemV2.layerTypes.find(
                                                option => option.id === draft.layerTypeId
                                              )?.calculationUnit || draft.layerTypeCalculationUnit) === 'squareMeter'
                                              ? 'مترمربع'
                                              : 'هر مجموعه'}
                                        </strong>
                                      </div>
                                    </div>
                                  )}
                                </div>

                              <div className="md:col-span-2 border-t border-[var(--sds-border-default)] pt-3 dark:border-[var(--sds-border-subtle)]">
                                <div className="mb-2 text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                  منبع سنگ لایه
                                </div>
                                <CompactSegmentedControl
                                  label="منبع سنگ لایه"
                                  value={draft.layerSourceKind || null}
                                  options={[
                                    { value: 'parentMaterial', label: 'سنگ والد' },
                                    { value: 'contractRemainder', label: 'باقی‌مانده قرارداد' },
                                    { value: 'newMaterial', label: 'سنگ جدید' }
                                  ] as const}
                                  onChange={(sourceKind) => {
                                    setDraft({
                                      ...draft,
                                      layerSourceKind: sourceKind,
                                      layerSelectedRemainingStoneIds: [],
                                      layerUseDifferentStone: sourceKind === 'newMaterial',
                                      layerStoneProductId: sourceKind === 'newMaterial'
                                        ? draft.layerStoneProductId
                                        : null,
                                      layerStoneProduct: sourceKind === 'newMaterial'
                                        ? draft.layerStoneProduct
                                        : null,
                                      layerStoneLabel: sourceKind === 'newMaterial'
                                        ? draft.layerStoneLabel
                                        : null,
                                      layerPricePerSquareMeter: sourceKind === 'newMaterial'
                                        ? draft.layerPricePerSquareMeter
                                        : null,
                                      layerShortageSource: null,
                                      layerManualSourceWidthCm: null,
                                      layerManualSourceLengthM: null,
                                      layerManualSourceQuantity: null
                                    });
                                    clearDraftFieldErrorWrapper(
                                      stairSystemV2.stairActivePart,
                                      'layerSource'
                                    );
                                  }}
                                  className="w-full [&_button]:flex-1"
                                />
                                {stairSystemV2.stairDraftErrors[
                                  stairSystemV2.stairActivePart
                                ]?.layerSource && (
                                  <p className="mt-1 text-xs text-[var(--sds-danger)]">
                                    {stairSystemV2.stairDraftErrors[
                                      stairSystemV2.stairActivePart
                                    ]?.layerSource}
                                  </p>
                                )}
                                {draft.layerSourceKind === 'contractRemainder' && (() => {
                                  const availableRemainders = collectAvailableRemainingStones(
                                    [...wizardData.products, ...stairSystemV2.stairSessionItems],
                                    []
                                  );
                                  if (availableRemainders.length === 0) {
                                    return (
                                      <div className="py-2 text-xs text-[var(--sds-text-muted)]">
                                        باقی‌مانده‌ای وجود ندارد
                                      </div>
                                    );
                                  }
                                  return (
                                    <div className="mt-2 divide-y divide-[var(--sds-border-subtle)] border-y border-[var(--sds-border-default)] dark:divide-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)]">
                                      {availableRemainders.map(stone => {
                                        const selected = Boolean(
                                          draft.layerSelectedRemainingStoneIds?.includes(stone.id)
                                        );
                                        return (
                                          <ErpPressable
                                            key={stone.id}
                                            type="button"
                                            aria-pressed={selected}
                                            onClick={() => {
                                              const current =
                                                draft.layerSelectedRemainingStoneIds || [];
                                              setDraft({
                                                ...draft,
                                                layerSelectedRemainingStoneIds: selected
                                                  ? current.filter(id => id !== stone.id)
                                                  : [...current, stone.id]
                                              });
                                              clearDraftFieldErrorWrapper(
                                                stairSystemV2.stairActivePart,
                                                'layerSource'
                                              );
                                            }}
                                            className="flex w-full items-center justify-between gap-3 py-2 text-right text-xs"
                                          >
                                            <span>
                                              {formatDisplayNumber(stone.width)}cm ×{' '}
                                              {formatDisplayNumber(stone.length)}m ·{' '}
                                              {formatDisplayNumber(stone.quantity || 1)} عدد
                                            </span>
                                            <span className={selected
                                              ? 'font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]'
                                              : 'text-[var(--sds-text-muted)]'}
                                            >
                                              {selected ? 'انتخاب‌شده' : 'استفاده'}
                                            </span>
                                          </ErpPressable>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                              </div>

                              {draft.layerSourceKind === 'newMaterial' && (
                              <div className="md:col-span-2">
                                <div className="border-t border-[var(--sds-border-default)] pt-3 dark:border-[var(--sds-border-subtle)]">
                                  <div className="text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                    سنگ جدید
                                  </div>

                                  {draft.layerUseDifferentStone && (
                                    <div className="mt-4 space-y-4">
                                      <div>
                                        <label className="block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                                          انتخاب سنگ برای لایه‌ها
                                        </label>
                                        {!draft.layerStoneProduct ? (
                                          <>
                                            <ErpInput
                                              name="layerStone"
                                              className="w-full rounded-lg bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-4 py-2.5 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent transition-all"
                                              value={stairSystemV2.layerStoneSearchTerm}
                                              onChange={(e) => stairSystemV2.setLayerStoneSearchTerm(e.target.value)}
                                              onFocus={() => stairSystemV2.setLayerStoneDropdownOpen(true)}
                                              onBlur={() => setTimeout(() => stairSystemV2.setLayerStoneDropdownOpen(false), 150)}
                                            />
                                            {stairSystemV2.layerStoneDropdownOpen && (
                                              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)] bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] shadow-lg">
                                                {stairSystemV2.isSearchingLayerStones && (
                                                  <div className="p-3 text-center text-sm text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                                    <span className="animate-pulse">در حال جستجو...</span>
                                                  </div>
                                                )}
                                                {!stairSystemV2.isSearchingLayerStones && stairSystemV2.layerStoneSearchResults.length === 0 && (
                                                  <div className="p-3 text-center text-sm text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">نتیجه‌ای یافت نشد</div>
                                                )}
                                                {stairSystemV2.layerStoneSearchResults.map((p) => (
                                                  <ErpPressable
                                                    key={p.id}
                                                    type="button"
                                                    className="w-full text-right px-4 py-2.5 hover:bg-[var(--sds-warning-surface)] text-sm border-b border-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)] last:border-0 transition-colors"
                                                    onMouseDown={(event) => {
                                                      event.preventDefault();
                                                    }}
                                                    onClick={() => {
                                                      const altLabel = (p as any).fullName || generateFullProductName(p as Product) || p.namePersian || p.name;
                                                      setDraft(current =>
                                                        selectNewLayerStone(
                                                          current,
                                                          p,
                                                          altLabel
                                                        )
                                                      );
                                                      stairSystemV2.setLayerStoneSearchTerm('');
                                                      stairSystemV2.setLayerStoneDropdownOpen(false);
                                                      clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerStone');
                                                    }}
                                                  >
                                                    <div className="font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                                                      {(p as any).fullName || generateFullProductName(p as Product) || p.namePersian || p.name}
                                                    </div>
                                                  </ErpPressable>
                                                ))}
                                              </div>
                                            )}
                                          </>
                                        ) : (
                                          <div className="flex items-center justify-between rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] p-3 dark:bg-[var(--sds-surface-subtle)]">
                                            <div>
                                              <div className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                                                {draft.layerStoneLabel || draft.layerStoneProduct.namePersian || draft.layerStoneProduct.name}
                                              </div>
                                              <div className="text-[11px] text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                                کد: {draft.layerStoneProduct.code || '-'}
                                              </div>
                                            </div>
                                            <div className="flex gap-2">
                                              <ErpPressable
                                                type="button"
                                                className="rounded px-2 py-1 text-xs text-[var(--sds-warning)] hover:bg-[var(--sds-warning-surface)]"
                                                onClick={() => {
                                                  setDraft({
                                                    ...draft,
                                                    layerStoneProductId: null,
                                                    layerStoneProduct: null,
                                                    layerStoneLabel: null
                                                  });
                                                  stairSystemV2.setLayerStoneSearchTerm('');
                                                  clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerStone');
                                                }}
                                              >
                                                تغییر
                                              </ErpPressable>
                                              <ErpPressable
                                                type="button"
                                                className="px-2 py-1 text-xs text-[var(--sds-danger)] hover:text-[var(--sds-danger)] hover:bg-[var(--sds-danger-surface)] dark:hover:bg-[var(--sds-danger-surface)] rounded"
                                                onClick={() => {
                                                  setDraft({
                                                    ...draft,
                                                    layerUseDifferentStone: false,
                                                    layerStoneProductId: null,
                                                    layerStoneProduct: null,
                                                    layerStoneLabel: null,
                                                    layerPricePerSquareMeter: null
                                                  });
                                                  stairSystemV2.setLayerStoneSearchTerm('');
                                                  clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerStone');
                                                  clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerStonePrice');
                                                }}
                                              >
                                                حذف
                                              </ErpPressable>
                                            </div>
                                          </div>
                                        )}
                                        {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerStone && (
                                          <p className="mt-1 text-xs text-[var(--sds-danger)]">
                                            {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerStone}
                                          </p>
                                        )}
                                      </div>

                                      <div>
                                        <label className="block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                                          قیمت هر متر مربع سنگ لایه (تومان)
                                        </label>
                                        <FormattedNumberInput
                                          name="layerStonePrice"
                                          value={draft.layerPricePerSquareMeter ?? null}
                                          onChange={(value) => {
                                            const updatedDraft = {
                                              ...draft,
                                              layerPricePerSquareMeter: value
                                            };
                                            const error = validateDraftNumericFields(stairSystemV2.stairActivePart, updatedDraft, 'layerStonePrice', value);
                                            if (error) {
                                              stairSystemV2.setStairDraftErrors(prev => ({
                                                ...prev,
                                                [stairSystemV2.stairActivePart]: { ...prev[stairSystemV2.stairActivePart], layerStonePrice: error }
                                              }));
                                            } else {
                                              clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerStonePrice');
                                            }
                                            setDraft(updatedDraft);
                                          }}
                                          min={0}
                                          step={1000}
                                          className="w-full rounded-lg bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-4 py-2.5 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent transition-all"
                                        />
                                        {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerStonePrice && (
                                          <p className="mt-1 text-xs text-[var(--sds-danger)]">
                                            {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerStonePrice}
                                          </p>
                                        )}
                                      </div>

                                      <div className="rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] p-3 dark:bg-[var(--sds-surface-subtle)]">
                                        <div className="flex items-center gap-2">
                                          <ErpInput
                                            id="layer-mandatory-pricing-checkbox"
                                            type="checkbox"
                                            className="rounded border-[var(--sds-border-default)] text-[var(--sds-warning)] focus:ring-[var(--sds-focus-ring)]"
                                            checked={draft.layerUseMandatory ?? true}
                                            aria-label="فعال‌سازی قیمت‌گذاری حکمی برای لایه"
                                            onChange={(e) => {
                                              const nextValue = e.target.checked;
                                              const updatedDraft = {
                                                ...draft,
                                                layerUseMandatory: nextValue,
                                                layerMandatoryPercentage: nextValue
                                                  ? (draft.layerMandatoryPercentage ?? 20)
                                                  : null
                                              };
                                              if (!nextValue) {
                                                clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerMandatoryPercentage');
                                              }
                                              setDraft(updatedDraft);
                                            }}
                                          />
                                          <div>
                                            <label className="text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                              حکمی (افزایش قیمت)
                                            </label>
                                            <p className="text-[11px] text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                              در صورت فعال بودن، قیمت سنگ لایه به صورت درصدی افزایش داده می‌شود.
                                            </p>
                                          </div>
                                        </div>
                                        {draft.layerUseMandatory !== false && (
                                          <div className="mt-3 flex items-center gap-2">
                                            <FormattedNumberInput
                                              name="layerMandatoryPercentage"
                                              value={draft.layerMandatoryPercentage ?? 20}
                                              onChange={(value) => {
                                                const updatedDraft = { ...draft, layerMandatoryPercentage: value ?? 0 };
                                                const error = validateDraftNumericFields(stairSystemV2.stairActivePart, updatedDraft, 'layerMandatoryPercentage', value);
                                                if (error) {
                                                  stairSystemV2.setStairDraftErrors(prev => ({
                                                    ...prev,
                                                    [stairSystemV2.stairActivePart]: { ...prev[stairSystemV2.stairActivePart], layerMandatoryPercentage: error }
                                                  }));
                                                } else {
                                                  clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerMandatoryPercentage');
                                                }
                                                setDraft(updatedDraft);
                                              }}
                                              min={0}
                                              max={100}
                                              step={1}
                                              className="w-24 rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-3 py-2 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent text-sm"
                                            />
                                            <span className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">%</span>
                                            <p className="text-[11px] text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                              قیمت نهایی با {formatDisplayNumber(draft.layerMandatoryPercentage ?? 20)}% افزایش محاسبه می‌شود.
                                            </p>
                                          </div>
                                        )}
                                        {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerMandatoryPercentage && (
                                          <p className="mt-1 text-xs text-[var(--sds-danger)]">
                                            {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerMandatoryPercentage}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              )}

                              {/* 🎯 Layer Edge Selection */}
                              <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                                  <span className="flex items-center gap-1">
                                    <span className="h-2 w-2 rounded-full bg-[var(--sds-warning)]"></span>
                                    انتخاب لبه‌های مورد نیاز برای لایه
                                  </span>
                                </label>
                                <div className="flex flex-wrap gap-2 rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3">
                                  <label className="flex cursor-pointer items-center gap-1.5 rounded border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] px-3 py-2 transition-colors hover:bg-[var(--sds-warning-surface)] dark:bg-[var(--sds-surface-subtle)]">
                                      <ErpInput
                                        type="checkbox"
                                        checked={!!(draft.layerEdges?.perimeter)}
                                        onChange={(e) => {
                                          const currentEdges = draft.layerEdges || {};
                                          setDraft({
                                            ...draft,
                                            layerEdges: {
                                              ...currentEdges,
                                              perimeter: e.target.checked,
                                              // If perimeter is checked, uncheck individual edges
                                              front: e.target.checked ? false : currentEdges.front,
                                              left: e.target.checked ? false : currentEdges.left,
                                              right: e.target.checked ? false : currentEdges.right,
                                              back: e.target.checked ? false : currentEdges.back
                                            }
                                          });
                                        }}
                                        className="rounded border-[var(--sds-border-default)] text-[var(--sds-warning)] focus:ring-[var(--sds-focus-ring)]"
                                      />
                                      <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] text-xs font-medium">محیط کامل</span>
                                  </label>
                                  <label className="flex cursor-pointer items-center gap-1.5 rounded border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] px-3 py-2 transition-colors hover:bg-[var(--sds-warning-surface)] dark:bg-[var(--sds-surface-subtle)]">
                                    <ErpInput
                                      type="checkbox"
                                      checked={!!(draft.layerEdges?.front)}
                                      onChange={(e) =>
                                        setLayerSideEnabled('front', e.target.checked)
                                      }
                                      className="rounded border-[var(--sds-border-default)] text-[var(--sds-warning)] focus:ring-[var(--sds-focus-ring)]"
                                      disabled={!!(draft.layerEdges?.perimeter)}
                                    />
                                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] text-xs font-medium">جلو</span>
                                  </label>
                                  <label className="flex cursor-pointer items-center gap-1.5 rounded border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] px-3 py-2 transition-colors hover:bg-[var(--sds-warning-surface)] dark:bg-[var(--sds-surface-subtle)]">
                                      <ErpInput
                                        type="checkbox"
                                        checked={!!(draft.layerEdges?.back)}
                                        onChange={(e) =>
                                          setLayerSideEnabled('back', e.target.checked)
                                        }
                                        className="rounded border-[var(--sds-border-default)] text-[var(--sds-warning)] focus:ring-[var(--sds-focus-ring)]"
                                        disabled={!!(draft.layerEdges?.perimeter)}
                                      />
                                      <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] text-xs font-medium">عقب</span>
                                  </label>
                                  <label className="flex cursor-pointer items-center gap-1.5 rounded border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] px-3 py-2 transition-colors hover:bg-[var(--sds-warning-surface)] dark:bg-[var(--sds-surface-subtle)]">
                                    <ErpInput
                                      type="checkbox"
                                      checked={!!(draft.layerEdges?.left)}
                                      onChange={(e) =>
                                        setLayerSideEnabled('left', e.target.checked)
                                      }
                                      className="rounded border-[var(--sds-border-default)] text-[var(--sds-warning)] focus:ring-[var(--sds-focus-ring)]"
                                      disabled={!!(draft.layerEdges?.perimeter)}
                                    />
                                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] text-xs font-medium">چپ</span>
                                  </label>
                                  <label className="flex cursor-pointer items-center gap-1.5 rounded border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] px-3 py-2 transition-colors hover:bg-[var(--sds-warning-surface)] dark:bg-[var(--sds-surface-subtle)]">
                                    <ErpInput
                                      type="checkbox"
                                      checked={!!(draft.layerEdges?.right)}
                                      onChange={(e) =>
                                        setLayerSideEnabled('right', e.target.checked)
                                      }
                                      className="rounded border-[var(--sds-border-default)] text-[var(--sds-warning)] focus:ring-[var(--sds-focus-ring)]"
                                      disabled={!!(draft.layerEdges?.perimeter)}
                                    />
                                    <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] text-xs font-medium">راست</span>
                                  </label>
                                </div>
                                {(!draft.layerEdges || (!draft.layerEdges.front && !draft.layerEdges.left && !draft.layerEdges.right && !draft.layerEdges.back && !draft.layerEdges.perimeter)) && (
                                  <p className="mt-2 text-xs text-[var(--sds-warning)]">
                                    لطفاً حداقل یک لبه را انتخاب کنید
                                  </p>
                                )}
                                {(draft.layerRemovedSideConflicts || []).map(side => {
                                  const sideLabel = {
                                    front: 'جلو',
                                    back: 'عقب',
                                    left: 'چپ',
                                    right: 'راست'
                                  }[side];
                                  const sideOperations =
                                    draft.layerSideOperations?.[side];
                                  return (
                                    <div
                                      key={`removed-layer-side:${side}`}
                                      className="mt-2 border-y border-[var(--sds-danger-border)] py-2 text-xs dark:border-[var(--sds-danger-border)]"
                                    >
                                      <div className="font-semibold text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">
                                        سمت {sideLabel} دارای عملیات اختصاصی است
                                      </div>
                                      <div className="mt-1 text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                        {(sideOperations?.tools.length || 0)} ابزار · {(sideOperations?.finishings.length || 0)} پرداخت
                                      </div>
                                      <div className="mt-2 flex gap-3">
                                        <ErpPressable
                                          type="button"
                                          className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]"
                                          onClick={() =>
                                            setLayerSideEnabled(side, true)
                                          }
                                        >
                                          بازگرداندن سمت
                                        </ErpPressable>
                                        <ErpPressable
                                          type="button"
                                          className="font-semibold text-[var(--sds-danger)]"
                                          onClick={() => {
                                            const nextOperations = {
                                              ...(draft.layerSideOperations || {})
                                            };
                                            delete nextOperations[side];
                                            setDraft({
                                              ...draft,
                                              layerSideOperations: nextOperations,
                                              layerDetachedOperationSides: (
                                                draft.layerDetachedOperationSides ||
                                                []
                                              ).filter(item => item !== side),
                                              layerRemovedSideConflicts: (
                                                draft.layerRemovedSideConflicts ||
                                                []
                                              ).filter(item => item !== side)
                                            });
                                          }}
                                        >
                                          حذف سمت و عملیات آن
                                        </ErpPressable>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              {draft.layerWidthCm &&
                                draft.numberOfLayersPerStair &&
                                draft.quantity &&
                                draft.stoneProduct &&
                                (() => {
                                  const selectedSides = (
                                    ['front', 'back', 'left', 'right'] as const
                                  ).filter(side =>
                                    draft.layerEdges?.perimeter ||
                                    Boolean(draft.layerEdges?.[side])
                                  );
                                  if (selectedSides.length === 0) return null;
                                  const sideLabels = {
                                    front: 'جلو',
                                    back: 'عقب',
                                    left: 'چپ',
                                    right: 'راست'
                                  } as const;
                                  const requestedScope =
                                    draft.layerOperationEditingScope || 'all';
                                  const editingScope =
                                    requestedScope === 'all' ||
                                    selectedSides.includes(requestedScope)
                                      ? requestedScope
                                      : 'all';
                                  const sideBreakdown = selectedSides.map(side => {
                                    const input = createLayerSideOperationInput(
                                      stairSystemV2.stairActivePart,
                                      draft,
                                      side,
                                      draft.stoneProduct!.id
                                    );
                                    const calculation =
                                      calculateProductOperations(input);
                                    return {
                                      side,
                                      input,
                                      calculation
                                    };
                                  });
                                  const bulkView = editingScope === 'all'
                                    ? resolveLayerBulkOperationView(
                                      sideBreakdown.map(({ input }) => input)
                                    )
                                    : null;
                                  const referenceInput = editingScope === 'all'
                                    ? bulkView!.input
                                    : createLayerSideOperationInput(
                                      stairSystemV2.stairActivePart,
                                      draft,
                                      editingScope,
                                      draft.stoneProduct!.id
                                    );
                                  return (
                                    <div className="md:col-span-2 border-t border-[var(--sds-border-default)] pt-3 dark:border-[var(--sds-border-subtle)]">
                                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                        <span className="text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                          عملیات لایه
                                        </span>
                                        <CompactSegmentedControl
                                          label="اعمال روی"
                                          value={editingScope}
                                          options={[
                                            { value: 'all', label: 'همه نوارها' },
                                            ...selectedSides.map(side => ({
                                              value: side,
                                              label: sideLabels[side]
                                            }))
                                          ]}
                                          onChange={scope => setDraft({
                                            ...draft,
                                            layerOperationEditingScope:
                                              scope as
                                                | 'all'
                                                | 'front'
                                                | 'back'
                                                | 'left'
                                                | 'right'
                                          })}
                                        />
                                      </div>
                                      {bulkView?.mixed && (
                                        <ErpInlineState
                                          kind="stale"
                                          title={bulkView.message!}
                                          className="mb-3"
                                        />
                                      )}
                                      <OperationCollectionsSection
                                        input={referenceInput}
                                        onChange={operationInput => {
                                          if (editingScope === 'all') {
                                            const nextSideOperations = {
                                              ...(draft.layerSideOperations || {})
                                            };
                                            selectedSides.forEach(side => {
                                              nextSideOperations[side] =
                                                cloneLayerOperationsForSide(
                                                  operationInput,
                                                  createLayerSideOperationInput(
                                                    stairSystemV2.stairActivePart,
                                                    draft,
                                                    side,
                                                    draft.stoneProduct!.id
                                                  ),
                                                  side
                                                );
                                            });
                                            setDraft({
                                              ...draft,
                                              layerSideOperations:
                                                nextSideOperations,
                                              layerDetachedOperationSides: (
                                                draft.layerDetachedOperationSides ||
                                                []
                                              ).filter(side =>
                                                !selectedSides.includes(side)
                                              )
                                            });
                                            return;
                                          }
                                          setDraft({
                                            ...draft,
                                            layerSideOperations: {
                                              ...(draft.layerSideOperations || {}),
                                              [editingScope]: operationInput
                                            },
                                            layerDetachedOperationSides: Array.from(
                                              new Set([
                                                ...(
                                                  draft.layerDetachedOperationSides ||
                                                  []
                                                ),
                                                editingScope
                                              ])
                                            )
                                          });
                                        }}
                                        toolCacheKey="stair-layer-tools"
                                        finishingCacheKey="stair-layer-finishings"
                                        loadTools={async () => subServices.map(tool => ({
                                          catalogItemId: tool.id,
                                          catalogSnapshotVersion: String(
                                            (tool as SubService & { updatedAt?: string }).updatedAt ||
                                            'current'
                                          ),
                                          name: tool.namePersian || tool.name || tool.code,
                                          unit: tool.calculationBase === 'squareMeters'
                                            ? 'squareMeter' as const
                                            : 'meter' as const,
                                          rateToman: tool.pricePerMeter === null ||
                                            tool.pricePerMeter === undefined
                                            ? null
                                            : String(tool.pricePerMeter)
                                        }))}
                                        loadFinishings={async () => stoneFinishings.map(finishing => ({
                                          catalogItemId: finishing.id,
                                          catalogSnapshotVersion: String(
                                            (finishing as StoneFinishing & { updatedAt?: string }).updatedAt ||
                                            'current'
                                          ),
                                          name: finishing.namePersian ||
                                            finishing.name ||
                                            finishing.code ||
                                            'پرداخت',
                                          unit: finishing.calculationBase === 'length'
                                            ? 'meter' as const
                                            : 'squareMeter' as const,
                                          rateToman: (() => {
                                            const rate = finishing.calculationBase === 'length'
                                              ? (finishing as StoneFinishing & {
                                                  pricePerMeter?: number | null
                                                }).pricePerMeter
                                              : (finishing as StoneFinishing & {
                                                  pricePerSquareMeter?: number | null
                                                }).pricePerSquareMeter;
                                            return rate === null || rate === undefined
                                              ? null
                                              : String(rate);
                                          })()
                                        }))}
                                      />
                                      <div className="mt-2 divide-y divide-[var(--sds-border-subtle)] border-y border-[var(--sds-border-subtle)] text-xs dark:divide-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)]">
                                        {sideBreakdown.map(entry => (
                                          <div
                                            key={entry.side}
                                            className="flex min-h-8 items-center justify-between gap-3"
                                          >
                                            <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                              {sideLabels[entry.side]} — {entry.input.quantity || 0} × {formatDisplayNumber(Number(entry.input.lengthMeters))}m
                                            </span>
                                            <strong>
                                              {entry.calculation.ok
                                                ? formatPrice(Number(entry.calculation.result.totalAmountToman))
                                                : '—'}
                                            </strong>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })()}
                              <label className="md:col-span-2 border-t border-[var(--sds-border-default)] pt-3 text-xs font-semibold text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-subtle)] dark:text-[var(--sds-text-secondary)]">
                                توضیحات لایه
                                <ErpTextarea
                                  value={draft.layerDescription || ''}
                                  onChange={event => setDraft({
                                    ...draft,
                                    layerDescription: event.target.value
                                  })}
                                  rows={1}
                                  className="mt-1 max-h-24 min-h-9 w-full resize-none overflow-y-auto rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 py-2 text-sm font-normal focus:border-[var(--sds-accent)] focus:outline-none dark:border-[var(--sds-border-subtle)]"
                                />
                              </label>

                              {draft.numberOfLayersPerStair && draft.layerWidthCm && draft.pricePerSquareMeter && draft.quantity &&
                               draft.layerTypeId && Number(draft.layerTypePrice) > 0 &&
                               draft.layerEdges && (draft.layerEdges.front || draft.layerEdges.left || draft.layerEdges.right || draft.layerEdges.back || draft.layerEdges.perimeter) && (() => {
                                // 🎯 Use computeLayerSqmV2 for consistent calculation (accounts for overlap)
                                const totalLayers = draft.quantity * draft.numberOfLayersPerStair;
                                const totalLayerSqm = layerManagement.computeLayerSqmV2(stairSystemV2.stairActivePart, draft);

                                const layerWidthCm = draft.layerWidthCm || 0;
                                const stoneWidthCm = draft.layerUseDifferentStone
                                  ? (draft.layerStoneProduct?.widthValue || draft.stoneProduct?.widthValue || 0)
                                  : (draft.stoneProduct?.widthValue || 0);
                                const stairLengthM = getActualLengthMeters(draft);

                                const edgeDemandsPreview = getLayerEdgeDemands(stairSystemV2.stairActivePart, draft);
                                const previewMainRemainingStones: RemainingStone[] = (() => {
                                  const usagePreview = computeTotalsV2(stairSystemV2.stairActivePart, draft);
                                  if (draft.layerSourceKind !== 'parentMaterial' || stairLengthM <= 0) {
                                    return [];
                                  }
                                  if (!usagePreview.canonicalCalculation.ok) {
                                    return [];
                                  }
                                  return usagePreview.canonicalCalculation.result
                                    .packingPlan.remainders.map(remainder => ({
                                      id: remainder.remainingStoneId,
                                      width: Number(remainder.widthMeters) * 100,
                                      length: Number(remainder.lengthMeters),
                                      squareMeters:
                                        Number(remainder.widthMeters) *
                                        Number(remainder.lengthMeters),
                                      isAvailable: true,
                                      sourceCutId:
                                        `${remainder.sourceBatchId}:${remainder.sourceOrdinal}`,
                                      quantity: 1
                                    }));
                                })();
                                const previewAvailableRemainingStones =
                                  draft.layerSourceKind === 'parentMaterial'
                                    ? previewMainRemainingStones
                                    : draft.layerSourceKind === 'contractRemainder'
                                      ? collectAvailableRemainingStones(
                                          [...wizardData.products, ...stairSystemV2.stairSessionItems],
                                          []
                                        ).filter(stone =>
                                          (draft.layerSelectedRemainingStoneIds || []).includes(
                                            stone.id
                                          )
                                        )
                                      : [];
                                const layerMetricsPreview = draft.layerSourceKind === 'newMaterial'
                                  ? {
                                      layersFromRemainingStones: 0,
                                      layersFromNewStones: edgeDemandsPreview.length
                                        ? edgeDemandsPreview.reduce((sum, demand) => sum + demand.layersNeeded, 0)
                                        : totalLayers,
                                      squareMetersFromNew: totalLayerSqm,
                                      totalLayerDemand: edgeDemandsPreview.length
                                        ? edgeDemandsPreview.reduce((sum, demand) => sum + demand.layersNeeded, 0)
                                        : totalLayers,
                                      unfulfilledDemands: edgeDemandsPreview.map(demand => ({
                                        edge: demand.edge,
                                        lengthM: demand.lengthM,
                                        quantity: demand.layersNeeded
                                      }))
                                    }
                                  : calculateLayerMetrics({
                                      totalLayers: edgeDemandsPreview.length
                                        ? edgeDemandsPreview.reduce((sum, demand) => sum + demand.layersNeeded, 0)
                                        : totalLayers,
                                      layerWidthCm,
                                      layerLengthM: layerManagement.getMaxLayerLengthM(stairSystemV2.stairActivePart, draft) || stairLengthM,
                                      availableRemainingStones: previewAvailableRemainingStones,
                                       cuttingCostPerMeter: 0,
                                      edgeDemands: edgeDemandsPreview,
                                      sawKerfEnabled: !!draft.sawKerfEnabled,
                                      sawKerfCm: draft.sawKerfCm || SAW_KERF_CM
                                    });

                                const previewSourceLengthM = draft.layerShortageSource === 'manualWarehouse'
                                  ? (draft.layerManualSourceLengthM || 0)
                                  : (getPricingLengthMeters(draft) || stairLengthM);
                                const previewSourceWidthCm = draft.layerShortageSource === 'manualWarehouse'
                                  ? (draft.layerManualSourceWidthCm || 0)
                                  : stoneWidthCm;
                                const previewSourcePlan = calculateLayerSourcePlan({
                                  demands: draft.layerSourceKind === 'newMaterial'
                                    ? (layerMetricsPreview.unfulfilledDemands || []) as Array<{
                                        edge: LayerEdgeDemand['edge'];
                                        lengthM: number;
                                        quantity: number;
                                      }>
                                    : [],
                                  sourceWidthCm: previewSourceWidthCm,
                                  sourceLengthM: previewSourceLengthM,
                                  layerWidthCm,
                                  sawKerfEnabled: !!draft.sawKerfEnabled,
                                  sawKerfCm: draft.sawKerfCm || SAW_KERF_CM
                                });
                                const legacyStoneAreaUsedSqm = previewSourcePlan.sourceAreaSqm;

                                // Use the same price as the main stair part
                                const pricePerSqm = draft.layerSourceKind === 'newMaterial'
                                  ? (draft.layerPricePerSquareMeter || 0)
                                  : 0;
                                const layerTypeUnitPrice = draft.layerTypePrice || 0;

                                const totalLayerLengthPerStairM = layerManagement.getTotalLayerLengthPerStairM(stairSystemV2.stairActivePart, draft);
                                const totalLayerLengthM = totalLayerLengthPerStairM * draft.quantity;
                                const layerCalculationUnit = stairSystemV2.layerTypes.find(
                                  option => option.id === draft.layerTypeId
                                )?.calculationUnit || draft.layerTypeCalculationUnit || 'set';
                                const previewParentRowId =
                                  draft.operationPolicyInput?.productRowId ||
                                  `stair-layer-preview:${draft.stoneId || 'main'}:${stairSystemV2.stairActivePart}`;
                                const canonicalLayerPreviewRequest =
                                  createCanonicalLayerCalculationRequest({
                                    part: stairSystemV2.stairActivePart,
                                    draft,
                                    parentProductRowId: previewParentRowId,
                                    creationOrder:
                                      (draft.layerConfigurations || []).length,
                                    availableInventory: toCanonicalLayerInventory({
                                      stones: previewAvailableRemainingStones,
                                      ownerProductRowId: previewParentRowId,
                                      catalogProductId:
                                        draft.layerStoneProductId ||
                                        draft.stoneId ||
                                        ''
                                    }),
                                    parentRemainingStoneIds:
                                      previewMainRemainingStones.map(stone =>
                                        stone.id
                                      ),
                                    layerUnit: layerCalculationUnit,
                                    getCuttingTypePricePerMeter
                                  });
                                const stoneAreaUsedSqm =
                                  legacyStoneAreaUsedSqm;
                                const physicalStripCount = edgeDemandsPreview.reduce(
                                  (sum, demand) => sum + demand.layersNeeded,
                                  0
                                );
                                const layerPricingQuantity =
                                  layerCalculationUnit === 'physicalPiece'
                                    ? physicalStripCount
                                    : layerCalculationUnit === 'meter'
                                      ? totalLayerLengthM
                                      : layerCalculationUnit === 'squareMeter'
                                        ? totalLayerSqm
                                        : totalLayers;
                                const layerTypeCostPreview =
                                  layerPricingQuantity * layerTypeUnitPrice;

                                // 🎯 FIX: Calculate layer stone price based on stone area used, NOT layer square meters
                                // Use stone area used for pricing (includes waste/remaining pieces)
                                const pricingStoneAreaSqm = stoneAreaUsedSqm > 0 ? stoneAreaUsedSqm : (layerMetricsPreview.squareMetersFromNew || 0);
                                const baseLayerCost = pricingStoneAreaSqm * pricePerSqm;
                                const layerTotalPrice =
                                  baseLayerCost + layerTypeCostPreview;

                                return (
                                  <div className="md:col-span-2">
                                    <CanonicalStairLayerSummary
                                      request={canonicalLayerPreviewRequest}
                                    />
                                    <div className="hidden">
                                      <div className="py-2 font-semibold">خلاصه لایه</div>
                                      <div>تعداد کل لایه‌ها: {formatDisplayNumber(totalLayers)} عدد ({formatDisplayNumber(draft.quantity)} پله × {formatDisplayNumber(draft.numberOfLayersPerStair)} لایه)</div>
                                      <div className="mt-1">
                                        <span className="font-medium">لبه‌های انتخاب شده: </span>
                                        {draft.layerEdges?.perimeter && (
                                          <span className="text-[var(--sds-warning)]">محیط کامل</span>
                                        )}
                                        {!draft.layerEdges?.perimeter && (
                                          <>
                                            {draft.layerEdges?.front && <span className="text-[var(--sds-warning)]">جلو </span>}
                                            {draft.layerEdges?.back && <span className="text-[var(--sds-warning)]">عقب </span>}
                                            {draft.layerEdges?.left && <span className="text-[var(--sds-warning)]">چپ </span>}
                                            {draft.layerEdges?.right && <span className="text-[var(--sds-warning)]">راست </span>}
                                          </>
                                        )}
                                      </div>
                                      <div>متر مربع تمام‌شده لایه: {formatSquareMeters(totalLayerSqm)}</div>
                                      <div>سنگ منبع مصرفی: {formatDisplayNumber(
                                        previewSourcePlan.sourceStoneQuantity
                                      )} قطعه / {formatSquareMeters(stoneAreaUsedSqm)}</div>
                                      <div>قطعات فیزیکی کارگاه: {formatDisplayNumber(
                                        edgeDemandsPreview.reduce((sum, demand) => sum + demand.layersNeeded, 0)
                                      )} نوار</div>
                                      {draft.layerSourceKind !== 'newMaterial' && (
                                        <div className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                                          از باقی‌مانده سنگ اصلی: {formatDisplayNumber(layerMetricsPreview.layersFromRemainingStones || 0)} لایه
                                          {` | نیاز به سنگ اصلی جدید: ${formatDisplayNumber(layerMetricsPreview.layersFromNewStones || 0)} لایه`}
                                        </div>
                                      )}
                                      {false && (layerMetricsPreview.layersFromNewStones || 0) > 0 && (
                                        <div className="mt-3 rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] p-3 dark:bg-[var(--sds-surface-subtle)]">
                                          <div className="mb-2 font-semibold text-[var(--sds-warning)]">منبع تامین کمبود لایه</div>
                                          <div className="grid gap-2 md:grid-cols-3">
                                            {([
                                              ['fullOrigin', 'سنگ کامل هم‌مبدا'],
                                              ['manualWarehouse', 'ابعاد انبار'],
                                              ['autoSuggested', 'محاسبه خودکار']
                                            ] as const).map(([value, label]) => (
                                              <ErpPressable
                                                key={value}
                                                type="button"
                                                onClick={() => setDraft({
                                                  ...draft,
                                                  layerShortageSource: value,
                                                  layerManualSourceWidthCm: value === 'manualWarehouse' ? draft.layerManualSourceWidthCm : null,
                                                  layerManualSourceLengthM: value === 'manualWarehouse' ? draft.layerManualSourceLengthM : null,
                                                  layerManualSourceQuantity: value === 'manualWarehouse' ? draft.layerManualSourceQuantity : null
                                                })}
                                                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                                                  draft.layerShortageSource === value
                                                    ? 'border-[var(--sds-warning)] bg-[var(--sds-warning)] text-[var(--sds-text-inverse)]'
                                                    : 'border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] text-[var(--sds-warning)] hover:border-[var(--sds-warning)]'
                                                }`}
                                              >
                                                {label}
                                              </ErpPressable>
                                            ))}
                                          </div>
                                          {draft.layerShortageSource === 'manualWarehouse' && (
                                            <div className="mt-3 grid gap-2 md:grid-cols-3">
                                              <FormattedNumberInput
                                                value={draft.layerManualSourceWidthCm ?? null}
                                                onChange={(value) => setDraft({ ...draft, layerManualSourceWidthCm: value || null })}
                                                className="rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm dark:bg-[var(--sds-surface-subtle)]"
                                                min={0}
                                                step={0.1}
                                              />
                                              <FormattedNumberInput
                                                value={draft.layerManualSourceLengthM ?? null}
                                                onChange={(value) => setDraft({ ...draft, layerManualSourceLengthM: value || null })}
                                                className="rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm dark:bg-[var(--sds-surface-subtle)]"
                                                min={0}
                                                step={0.1}
                                              />
                                              <FormattedNumberInput
                                                value={draft.layerManualSourceQuantity ?? null}
                                                onChange={(value) => setDraft({ ...draft, layerManualSourceQuantity: value ? Math.floor(value) : null })}
                                                className="rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm dark:bg-[var(--sds-surface-subtle)]"
                                                min={1}
                                                step={1}
                                              />
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {stoneAreaUsedSqm > 0 && (
                                        <div>متر مربع سنگ: {formatSquareMeters(stoneAreaUsedSqm)}</div>
                                      )}
                                      <div className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mt-1">
                                        قیمت هر متر مربع: {formatPrice(pricePerSqm)} (همان سنگ اصلی)
                                      </div>
                                      <div className="mt-1 border-t border-[var(--sds-warning-border)] pt-1">
                                        <div className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mb-1">
                                            قیمت سنگ لایه: {formatPrice(pricingStoneAreaSqm * pricePerSqm)}
                                            {stoneAreaUsedSqm > 0 && (
                                            <span className="text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)] mr-1">
                                                (بر اساس متر مربع سنگ: {formatSquareMeters(stoneAreaUsedSqm)})
                                            </span>
                                          )}
                                        </div>
                                        {layerTypeUnitPrice > 0 && (
                                          <div className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mb-1">
                                            هزینه نوع لایه ({draft.layerTypeName || '-'}): {formatPrice(layerTypeCostPreview)}
                                            <span className="text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)] ml-1">
                                              ({formatDisplayNumber(layerPricingQuantity)} × {formatPrice(layerTypeUnitPrice)})
                                            </span>
                                          </div>
                                        )}
                                        <div className="mt-1 border-t border-[var(--sds-warning-border)] pt-1">
                                          <span className="font-semibold">قیمت کل لایه‌ها: {formatPrice(layerTotalPrice)}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </>
                          )}
                        </div>
                      </div>
                      )}

                      <div className="flex min-h-9 items-center justify-between border-b border-[var(--sds-border-default)] py-2 text-xs dark:border-[var(--sds-border-subtle)]">
                        <span className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">برش کالیبر</span>
                        <CompactSwitch
                          label="برش کالیبر"
                          checked={draft.calibrationSelection === 'manual'
                            ? Boolean(draft.calibrationCutEnabled)
                            : totals.canonicalCalculation.ok
                              ? totals.canonicalCalculation.result.calibrationEnabled
                              : false}
                          disabled={totals.canonicalCalculation.ok
                            ? Number(totals.canonicalCalculation.result.crossDimensionMeters) ===
                                Number(totals.canonicalCalculation.result.motherWidthMeters) ||
                              Number(totals.canonicalCalculation.result.packingPlan.longitudinalCutMeters) === 0
                            : true}
                          onChange={checked => setDraft({
                            ...draft,
                            calibrationCutEnabled: checked,
                            calibrationSelection: 'manual'
                          })}
                        />
                      </div>

                      {false && stoneFinishings.length > 0 && (
                        <div className="bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)] p-5 shadow-sm">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <div className="w-1 h-5 bg-gradient-to-b from-[var(--sds-accent)] to-[var(--sds-accent-hover)] rounded-full"></div>
                              <h5 className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">پرداخت سنگ</h5>
                            </div>
                            <span className="text-xs text-[var(--sds-accent)] dark:text-[var(--sds-accent)] bg-[var(--sds-accent-soft)] dark:bg-[var(--sds-accent-soft)] px-2 py-1 rounded">
                              هزینه به ازای {finishingUnitLabel}
                            </span>
                          </div>
                          <div className="space-y-4">
                            <label className="flex items-center gap-2 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                              <ErpInput
                                type="checkbox"
                                className="rounded border-[var(--sds-border-default)] text-[var(--sds-accent)] focus:ring-[var(--sds-focus-ring)]"
                                checked={!!draft.finishingEnabled}
                                onChange={(e) => {
                                  const enabled = e.target.checked;
                                  if (!enabled) {
                                    setDraft({
                                      ...draft,
                                      finishingEnabled: false,
                                      finishingId: null,
                                      finishingCode: null,
                                      finishingLabel: null,
                                      finishingPricePerSquareMeter: null,
                                      finishingUnitPrice: null,
                                      finishingCalculationBase: null,
                                      finishingQuantity: null
                                    });
                                    return;
                                  }
                                  setDraft(activateFinishingSelection(draft));
                                }}
                              />
                              فعال‌سازی پرداخت برای این بخش
                            </label>

                            {draft.finishingEnabled && (
                              <>
                                <div className="space-y-3">
                                  {draft.finishingId && (
                                    <div className="rounded-lg border border-[var(--sds-accent)] dark:border-[var(--sds-accent)] bg-[var(--sds-accent-soft)] dark:bg-[var(--sds-accent-soft)] px-3 py-2 text-xs text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <div className="font-semibold">
                                            {selectedFinishing?.namePersian || selectedFinishing?.name || draft.finishingLabel || 'پرداخت ذخیره‌شده'}
                                          </div>
                                          <div className="mt-1 text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                                            {formatPrice(finishingPricePerSquareMeter || 0)} / {finishingUnitLabel}
                                            {!selectedFinishing && draft.finishingLabel ? ' - خارج از کاتالوگ فعلی' : ''}
                                          </div>
                                        </div>
                                        <ErpPressable
                                          type="button"
                                          onClick={() => setDraft({
                                            ...draft,
                                            finishingId: null,
                                            finishingCode: null,
                                            finishingLabel: null,
                                            finishingPricePerSquareMeter: null,
                                            finishingUnitPrice: null,
                                            finishingCalculationBase: null,
                                            finishingQuantity: null
                                          })}
                                          className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--sds-accent)] hover:bg-[var(--sds-accent-soft)] dark:text-[var(--sds-accent)] dark:hover:bg-[var(--sds-accent-soft)]"
                                        >
                                          حذف
                                        </ErpPressable>
                                      </div>
                                    </div>
                                  )}
                                  <label htmlFor="stone-finishing-picker" className="block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                    جستجو و انتخاب پرداخت سنگ
                                  </label>
                                  <ErpInput
                                    id="stone-finishing-picker"
                                    value={(draft as any).finishingSearchTerm || ''}
                                    onChange={(e) => setDraft({
                                      ...draft,
                                      finishingSearchTerm: e.target.value
                                    } as any)}
                                    className="w-full rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-3 py-2.5 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent transition-all"
                                  />
                                  <div className="max-h-44 overflow-y-auto rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)] bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">
                                    {visibleStoneFinishings.length > 0 ? visibleStoneFinishings.map(option => {
                                      const unitPrice = getFinishingUnitPrice(option);
                                      const calculationBase = getFinishingCalculationBase(option);
                                      const isSelected = draft.finishingId === option.id;
                                      return (
                                        <ErpPressable
                                          key={option.id}
                                          type="button"
                                          onClick={() => setDraft({
                                            ...draft,
                                            finishingEnabled: true,
                                            finishingId: option.id,
                                            finishingCode: option.code || null,
                                            finishingLabel: option.namePersian || option.name || '',
                                            finishingPricePerSquareMeter: unitPrice,
                                            finishingUnitPrice: unitPrice,
                                            finishingCalculationBase: calculationBase,
                                            finishingQuantity: calculateDefaultFinishingQuantity({
                                              calculationBase,
                                              productType: 'stair',
                                              length: draft.lengthValue,
                                              lengthUnit: draft.lengthUnit || 'm',
                                              quantity: draft.quantity,
                                              squareMeters: totals.pricingSquareMeters
                                            })
                                          })}
                                          className={`w-full px-3 py-2.5 text-right transition-colors ${isSelected ? 'bg-[var(--sds-accent-soft)] dark:bg-[var(--sds-accent-soft)] text-[var(--sds-accent)] dark:text-[var(--sds-accent)]' : 'hover:bg-[var(--sds-surface-raised)] dark:hover:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]'}`}
                                        >
                                          <div className="flex items-center justify-between gap-3">
                                            <span className="font-medium">{option.namePersian || option.name}</span>
                                            <span className="text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                              {formatPrice(unitPrice)} / {getFinishingUnitLabel(calculationBase)}
                                            </span>
                                          </div>
                                          {option.description && (
                                            <div className="mt-1 text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)] line-clamp-1">
                                              {option.description}
                                            </div>
                                          )}
                                        </ErpPressable>
                                      );
                                    }) : (
                                      <div className="px-3 py-3 text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                        پرداختی با این جستجو پیدا نشد.
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {draft.finishingEnabled && (
                                  <div>
                                    <label className="block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                                      مقدار فرآوری ({finishingUnitLabel})
                                    </label>
                                    <FormattedNumberInput
                                      value={draft.finishingQuantity ?? finishingQuantity}
                                      onChange={(value) => {
                                        const nextValue = value && value > 0 ? value : null;
                                        const clampedValue =
                                          nextValue && maxFinishingQuantity && maxFinishingQuantity > 0
                                            ? Math.min(nextValue, maxFinishingQuantity)
                                            : nextValue;
                                        setDraft({
                                          ...draft,
                                          finishingQuantity: clampedValue
                                        });
                                      }}
                                      min={0}
                                      max={maxFinishingQuantity || undefined}
                                      step={0.01}
                                      className="w-full rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] px-3 py-2.5 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent transition-all"
                                    />
                                    {Number(maxFinishingQuantity || 0) > 0 && (
                                      <p className="mt-1 text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                        حداکثر قابل استفاده: {formatDisplayNumber(maxFinishingQuantity)} {finishingUnitLabel}
                                      </p>
                                    )}
                                  </div>
                                )}

                                {selectedFinishing && finishingPricePerSquareMeter && (
                                  <div className="rounded-lg border border-[var(--sds-accent)] dark:border-[var(--sds-accent)] bg-[var(--sds-accent-soft)] dark:bg-[var(--sds-accent-soft)] px-4 py-3 text-xs leading-5 text-[var(--sds-accent)] dark:text-[var(--sds-accent)] space-y-1.5">
                                    <div className="flex justify-between">
                                      <span>نرخ هر {finishingUnitLabel}:</span>
                                      <span className="font-semibold">{formatPrice(finishingPricePerSquareMeter)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>مقدار فرآوری:</span>
                                      <span className="font-semibold">
                                        {finishingCalculationBase === 'squareMeters' ? formatSquareMeters(finishingQuantity) : `${formatDisplayNumber(finishingQuantity)} ${finishingUnitLabel}`}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>هزینه تقریبی پرداخت:</span>
                                      <span className="font-semibold">{formatPrice(finishingPreviewCost)}</span>
                                    </div>
                                  </div>
                                )}
                            </>
                          )}
                        </div>
                      </div>
                      )}
                      {false && stoneFinishings.length === 0 && (
                        <div className="rounded-lg border border-[var(--sds-warning-border)] dark:border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] dark:bg-[var(--sds-warning-surface)] px-4 py-3 text-xs text-[var(--sds-warning)] dark:text-[var(--sds-warning)]">
                          {stoneFinishingLoadState === 'forbidden'
                            ? 'دسترسی شما برای مشاهده پرداخت‌ها کافی نیست.'
                            : 'هیچ پرداخت فعالی برای انتخاب یافت نشد.'}
                        </div>
                      )}

                      {/* Part Total - Enhanced */}
                      <div className="flex min-h-10 items-center justify-between border-y border-[var(--sds-border-default)] py-2 text-sm dark:border-[var(--sds-border-subtle)]">
                        <span className="font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                          جمع این بخش
                        </span>
                        <strong className="text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                          {formatPrice(
                            (totals.partTotal || 0) +
                            stairOperationPreviewAmount
                          )}
                        </strong>
                      </div>
                    </div>
                  );
                })()}

                {/* Session group summary */}
                <div className="mt-4 border-t border-[var(--sds-border-default)] pt-4 dark:border-[var(--sds-border-subtle)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">خلاصه اقلام افزوده شده</h4>
                    <span className="rounded-full bg-[var(--sds-accent-soft)] px-2.5 py-1 text-xs font-bold text-[var(--sds-accent)] dark:bg-[var(--sds-accent-soft)] dark:text-[var(--sds-accent)]">
                      {stairSystemV2.stairSessionItems.length} آیتم
                    </span>
                  </div>
                  {stairSystemV2.stairSessionItems.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--sds-border-default)] py-6 text-center dark:border-[var(--sds-border-subtle)]">
                      <p className="text-sm text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">هنوز آیتمی افزوده نشده است.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)]">
                            {['بخش', 'ابعاد', 'تعداد', 'متر مربع', 'قیمت متر مربع', 'ابزارها', 'هزینه ابزار', 'جمع جزء'].map(label => (
                              <th key={label} className="whitespace-nowrap px-4 py-3 text-right text-xs font-bold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {stairSystemV2.stairSessionItems.map((it, idx) => {
                            const toolsTotal = sumNumericValues(((it as any).meta?.tools || []), (tool: any) => tool.totalPrice);
                            const isLayer = ((it as any).meta?.isLayer) || false;
                            const layerInfo = ((it as any).meta?.layerInfo) || null;
                            const partTypeLabel = isLayer
                              ? `لایه ${it.stairPartType === 'tread' ? 'کف پله' : it.stairPartType === 'riser' ? 'خیز پله' : 'پاگرد'}`
                              : (it.stairPartType === 'tread' ? 'کف پله' : it.stairPartType === 'riser' ? 'خیز پله' : 'پاگرد');
                            const partTypeColor = isLayer
                              ? 'orange'
                              : (it.stairPartType === 'tread' ? 'teal' : it.stairPartType === 'riser' ? 'blue' : 'indigo');
                            const lengthDisplay = it.lengthUnit === 'm' ? `${formatDisplayNumber(it.length)} m` : `${formatDisplayNumber(it.length)} cm`;
                            const widthDisplay = `${formatDisplayNumber(it.width)} cm`;
                            const stairMeta = ((it as any).meta?.stair) || {};
                            const baseStoneQuantity = stairMeta.baseStoneQuantity || 0;
                            const piecesPerStoneMeta = stairMeta.piecesPerStone || 0;
                            const leftoverWidthMeta = stairMeta.leftoverWidthCmPerStone || 0;
                            const remainingStoneQuantityMeta = stairMeta.remainingStoneQuantity || 0;
                            const remainingStoneGroupsMeta = Array.isArray(stairMeta.remainingStoneGroups)
                              ? stairMeta.remainingStoneGroups
                              : (leftoverWidthMeta > 0 && remainingStoneQuantityMeta > 0
                                ? [{ widthCm: leftoverWidthMeta, quantity: remainingStoneQuantityMeta }]
                                : []);
                            const finishing = normalizeProductFinishing(it);

                            return (
                              <tr key={idx} className="border-b border-[var(--sds-border-subtle)] transition-colors last:border-b-0 hover:bg-[var(--sds-surface-subtle)] dark:border-[var(--sds-border-subtle)] dark:hover:bg-[var(--sds-surface-subtle)]">
                                <td className="py-3 px-4">
                                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                                    partTypeColor === 'teal' ? 'bg-[var(--sds-accent-soft)] text-[var(--sds-accent)] dark:bg-[var(--sds-accent-soft)] dark:text-[var(--sds-accent)]' :
                                    partTypeColor === 'blue' ? 'bg-[var(--sds-info-surface)] dark:bg-[var(--sds-info-surface)] text-[var(--sds-info)] dark:text-[var(--sds-info)]' :
                                    partTypeColor === 'orange' ? 'bg-[var(--sds-warning-surface)] text-[var(--sds-warning)]' :
                                    'bg-[var(--sds-purple-surface)] dark:bg-[var(--sds-purple-surface)] text-[var(--sds-purple)] dark:text-[var(--sds-purple)]'
                                  }`}>
                                    {partTypeLabel}
                                  </span>
                                  {isLayer && layerInfo && (
                                    <div className="mt-1 text-xs text-[var(--sds-warning)]">
                                      {layerInfo.numberOfLayersPerStair} لایه برای هر پله
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-medium">طول: {lengthDisplay}</span>
                                    <span className="text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">عرض: {widthDisplay}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                  <div className="flex flex-col gap-1">
                                    <span className="font-medium">{formatDisplayNumber(it.quantity || 0)} عدد</span>
                                    {(baseStoneQuantity > 0 || (isLayer && layerInfo)) && (
                                      <details className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                        <summary className="cursor-pointer font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                                          جزئیات
                                        </summary>
                                        <div className="mt-1 space-y-1">
                                          {baseStoneQuantity > 0 && (
                                            <div>
                                              سنگ پایه: {formatDisplayNumber(baseStoneQuantity)} عدد
                                              {piecesPerStoneMeta > 0 ? ` ⬢ ظرفیت هر سنگ: ${formatDisplayNumber(piecesPerStoneMeta)} قطعه` : ''}
                                              {remainingStoneGroupsMeta.length > 0
                                                ? ` ⬢ باقی‌مانده قابل استفاده: ${formatStairRemainingGroups(remainingStoneGroupsMeta)}`
                                                : ''}
                                            </div>
                                          )}
                                          {isLayer && layerInfo && (
                                            <div className="text-[var(--sds-warning)]">
                                              {layerInfo.layersFromRemainingStones > 0 || layerInfo.layersFromNewStones > 0
                                                ? `${layerInfo.layersFromRemainingStones || 0} از باقی‌مانده ${layerInfo.layersFromNewStones || 0} از سنگ جدید`
                                                : ''}
                                              {layerInfo.shortageSource ? ` ⬢ منبع کمبود: ${LAYER_SHORTAGE_SOURCE_LABELS[layerInfo.shortageSource as keyof typeof LAYER_SHORTAGE_SOURCE_LABELS] || layerInfo.shortageSource}` : ''}
                                            </div>
                                          )}
                                        </div>
                                      </details>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] font-medium">
                                  {formatSquareMeters(it.squareMeters || 0)}
                                </td>
                                <td className="py-3 px-4 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                                  {formatPrice(it.pricePerSquareMeter || 0)}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex flex-col gap-1.5">
                                  {(((it as any).meta?.tools) || []).length === 0 && !(finishing && finishing.cost) ? (
                                    <span className="text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">-</span>
                                  ) : (
                                    <details className="text-xs">
                                      <summary className="cursor-pointer font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                                        جزئیات خدمات
                                      </summary>
                                      <div className="mt-2 flex flex-col gap-1.5">
                                        {((it as any).meta?.tools || []).map((t: any, i: number) => (
                                          <div key={i} className="rounded border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-2 py-1 dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)]">
                                            <span className="font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-secondary)]">{t.name}</span>
                                            <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]"> • {formatDisplayNumber(t.computedMeters || 0)} m</span>
                                            <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]"> × {formatPrice(t.pricePerMeter || 0)}</span>
                                          </div>
                                        ))}
                                        {finishing && finishing.cost ? (
                                          <div className="bg-[var(--sds-accent-soft)] dark:bg-[var(--sds-accent-soft)] px-2 py-1 rounded border border-[var(--sds-accent)] dark:border-[var(--sds-accent)]">
                                            <span className="font-medium text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">پرداخت:</span>
                                            <span className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mr-1">
                                              {it.finishingName || 'پرداخت'} • {finishing.amountLabel}
                                            </span>
                                            <span className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)] font-semibold">
                                              {formatPrice(finishing.cost)}
                                            </span>
                                          </div>
                                        ) : null}
                                      </div>
                                    </details>
                                  )}
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  {toolsTotal > 0 ? (
                                    <span className="font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{formatPrice(toolsTotal)}</span>
                                  ) : (
                                    <span className="text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">-</span>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <span className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                                    {formatPrice(
                                      typeof it.totalPrice === 'number' ? it.totalPrice : (typeof it.totalPrice === 'string' ? parseFloat(it.totalPrice) || 0 : 0)
                                    )}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="border-t border-[var(--sds-accent)] bg-[var(--sds-accent-soft)] dark:border-[var(--sds-accent)] dark:bg-[var(--sds-accent-soft)]">
                            <td className="px-4 py-3 font-bold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]" colSpan={7}>جمع کل گروه</td>
                            <td className="py-3 px-4">
                              <span className="font-bold text-lg text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                                {formatPrice(sumNumericValues(stairSystemV2.stairSessionItems, (item) => item.totalPrice))}
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                </div>
              </div>
              {errors.products && (
                <div
                  role="alert"
                  className="mx-4 mb-2 rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] px-3 py-2 text-sm font-medium text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]"
                >
                  {errors.products}
                </div>
              )}
              {stairDiscardConfirmationVisible && (
                <div
                  data-stair-discard-confirmation
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] px-4 py-3 text-xs text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]"
                >
                  <span className="font-semibold">
                    تغییرات این پیکربندی پله ذخیره نشده است
                  </span>
                  <span className="flex items-center gap-3">
                    <ErpPressable
                      type="button"
                      className="font-semibold text-[var(--sds-accent)] hover:underline dark:text-[var(--sds-accent)]"
                      onClick={() =>
                        setStairDiscardConfirmationVisible(false)}
                    >
                      ادامه ویرایش
                    </ErpPressable>
                    <ErpPressable
                      type="button"
                      className="font-semibold text-[var(--sds-danger)] hover:underline dark:text-[var(--sds-danger)]"
                      onClick={discardStairConfiguration}
                    >
                      دور ریختن کل پیش‌نویس
                    </ErpPressable>
                  </span>
                </div>
              )}
              <div className="stair-v2-footer flex min-h-16 flex-shrink-0 items-center justify-end gap-2 border-t border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-4 dark:border-[var(--sds-border-subtle)] dark:bg-[var(--sds-surface-subtle)]">
                <ErpPressable type="button" className="min-h-10 rounded-lg px-4 text-sm font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]" onClick={requestCloseStairConfiguration}>انصراف</ErpPressable>
                <ErpPressable ref={stairStageButtonRef} type="button" className={`min-h-10 min-w-28 rounded-lg bg-[var(--sds-accent-soft)] px-4 text-sm font-bold text-[var(--sds-text-inverse)] transition hover:bg-[var(--sds-accent-soft)] ${isEditMode ? 'hidden' : ''}`} onClick={() => {
                  const requestedFooterAction =
                    requestedStairFooterActionRef.current;
                  requestedStairFooterActionRef.current = 'stage';
                  const [draft] = getActiveDraft();
                  const activeLayerFallbackId =
                    draft.layerConfigurationDraftId ||
                    createContractProductRowId();
                  try {
                  // Validate required fields
                  const fieldErrors = validateDraftRequiredFields(stairSystemV2.stairActivePart, draft, stairSystemV2.layerTypes);
                  const hasErrors = Object.values(fieldErrors).some(Boolean);
                   if (hasErrors) {
                    const firstInvalidField = Object.entries(fieldErrors)
                      .find(([, value]) => Boolean(value))?.[0];
                    stairSystemV2.setStairDraftErrors(prev => ({
                      ...prev,
                      [stairSystemV2.stairActivePart]: {
                        ...prev[stairSystemV2.stairActivePart],
                        ...fieldErrors
                      }
                    }));
                    setErrors({
                      products:
                        'لطفاً خطاهای مشخص‌شده را برطرف کنید (کد: STAIR_DRAFT_REQUIRED_FIELDS)'
                    });
                    reportCurrentStairIssue({
                      code: 'STAIR_DRAFT_REQUIRED_FIELDS',
                      phase: 'validate',
                      focusTarget: 'stair-active-part',
                      conflictCodes: Object.entries(fieldErrors)
                        .filter(([, value]) => Boolean(value))
                        .map(([key]) => key),
                      action: isEditMode
                        ? 'edit-save'
                        : requestedFooterAction
                    });
                    requestAnimationFrame(() => {
                      const focusSelectorByField: Record<string, string> = {
                        thickness: '[name="stone"]',
                        layerType: '[role="combobox"][aria-label="نوع لایه"]',
                        layerSource: '[role="radiogroup"][aria-label="منبع سنگ لایه"] button',
                        layerStone: '[name="layerStone"]',
                        layerStonePrice: '[name="layerStonePrice"]'
                      };
                      const exactField = firstInvalidField
                        ? document.querySelector<HTMLElement>(
                            focusSelectorByField[firstInvalidField] ||
                            `[name="${firstInvalidField}"], [data-field="${firstInvalidField}"]`
                          )
                        : null;
                      (
                        exactField ||
                        document.querySelector<HTMLElement>('[aria-invalid="true"]') ||
                        document.querySelector<HTMLElement>('[data-stair-active-part]')
                      )?.focus();
                    });
                    return;
                  }
                  stairSystemV2.setStairDraftErrors(prev => ({ ...prev, [stairSystemV2.stairActivePart]: {} }));
                  setErrors({});
                   const sid = stairSystemV2.ensureStairSessionId();
                   const totals = computeTotalsV2(stairSystemV2.stairActivePart, draft);
                   if (!totals.canonicalCalculation.ok) {
                     const nextErrors = totals.canonicalCalculation.conflicts.reduce<
                       Record<string, string>
                     >((fieldErrors, conflict) => {
                       const message = stairConflictMessage(
                         conflict.code,
                         draft.stoneProduct?.motherLengthValue,
                         conflict.field
                       );
                       if (conflict.field === 'lengthMeters' || conflict.field === 'motherDimensions') {
                         fieldErrors.length = message;
                       } else if (conflict.field === 'crossDimensionMeters') {
                         fieldErrors.width = message;
                       } else if (conflict.field === 'baseRateToman') {
                         fieldErrors.pricePerSquareMeter = message;
                       } else if (conflict.field === 'quantity') {
                         fieldErrors.quantity = message;
                       } else if (conflict.code === 'stair-cut-rate-missing') {
                         fieldErrors.cutRate = message;
                       }
                       return fieldErrors;
                     }, {});
                     stairSystemV2.setStairDraftErrors(prev => ({
                       ...prev,
                       [stairSystemV2.stairActivePart]: {
                         ...prev[stairSystemV2.stairActivePart],
                         ...nextErrors
                       }
                     }));
                     setErrors({
                       products:
                         'محاسبات بخش پله معتبر نیست (کد: STAIR_CALCULATION_CONFLICT)'
                     });
                     reportCurrentStairIssue({
                       code: 'STAIR_CALCULATION_CONFLICT',
                       phase: 'calculate',
                       focusTarget: 'stair-calculation-summary',
                       conflictCodes:
                         totals.canonicalCalculation.conflicts.map(
                           conflict => conflict.code
                         ),
                       action: isEditMode
                         ? 'edit-save'
                         : requestedFooterAction
                     });
                     focusCalculationError('stair-calculation-summary');
                     return;
                   }
                   const layerDraftsForValidation =
                     materializeStairLayerConfigurations(
                       draft,
                       activeLayerFallbackId
                     );
                   for (const layerDraft of layerDraftsForValidation) {
                     const invalidLayerType =
                       !layerDraft.layerTypeId ||
                       !(Number(layerDraft.layerTypePrice) > 0);
                     const invalidLayerGeometry =
                       !layerDraft.layerWidthCm ||
                       !hasLayerEdgeSelection(layerDraft.layerEdges);
                     const invalidLayerSource =
                       !layerDraft.layerSourceKind ||
                       (
                         layerDraft.layerSourceKind === 'contractRemainder' &&
                         !(layerDraft.layerSelectedRemainingStoneIds?.length)
                       ) ||
                       (
                         layerDraft.layerSourceKind === 'newMaterial' &&
                         (
                           !layerDraft.layerStoneProductId ||
                           !(Number(layerDraft.layerPricePerSquareMeter) > 0)
                         )
                       );
                     if (invalidLayerType || invalidLayerGeometry || invalidLayerSource) {
                       stairSystemV2.setStairDraftErrors(prev => ({
                         ...prev,
                         [stairSystemV2.stairActivePart]: {
                           ...prev[stairSystemV2.stairActivePart],
                           layerType: invalidLayerType
                              ? (!layerDraft.layerTypeId
                                ? 'نوع لایه را انتخاب کنید'
                                : 'قیمت نوع لایه در انبار معتبر نیست')
                             : undefined,
                           width: invalidLayerGeometry
                             ? 'عرض و سمت‌های لایه را کامل کنید'
                             : undefined,
                           layerSource: invalidLayerSource
                             ? 'منبع سنگ لایه را کامل کنید'
                             : undefined
                         }
                       }));
                       setErrors({
                         products:
                           'تنظیمات لایه کامل نیست (کد: STAIR_LAYER_DRAFT_INVALID)'
                       });
                       reportCurrentStairIssue({
                         code: 'STAIR_LAYER_DRAFT_INVALID',
                         phase: 'validate',
                         focusTarget: 'stair-layer-calculation-summary',
                         conflictCodes: [
                           ...(invalidLayerType
                             ? ['layer-type']
                             : []),
                           ...(invalidLayerGeometry
                             ? ['layer-geometry']
                             : []),
                           ...(invalidLayerSource
                             ? ['layer-source']
                             : [])
                         ],
                         layerCount:
                           layerDraftsForValidation.length,
                         action: isEditMode
                           ? 'edit-save'
                           : requestedFooterAction
                       });
                       return;
                     }
                   }
                   const hasInvalidTool = (draft.tools || []).some(tool =>
                     (tool.coveredQuantity || 0) > Number(draft.quantity || 0) ||
                     (
                       tool.calculationBase !== 'squareMeters' &&
                       !tool.perimeter &&
                       !tool.front &&
                       !tool.back &&
                       !tool.left &&
                       !tool.right
                     )
                   );
                   if (hasInvalidTool) {
                     setErrors({
                       products:
                         'تنظیمات ابزار معتبر نیست (کد: STAIR_LEGACY_TOOL_INVALID)'
                     });
                     reportCurrentStairIssue({
                       code: 'STAIR_LEGACY_TOOL_INVALID',
                       phase: 'validate',
                       focusTarget: 'stair-tools-section',
                       action: isEditMode
                         ? 'edit-save'
                         : requestedFooterAction
                     });
                     document.getElementById('stair-tools-section')?.scrollIntoView({
                       block: 'center',
                       behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                         ? 'auto'
                         : 'smooth'
                     });
                     return;
                   }
                   const stairOperationPolicyInput = draft.operationPolicyInput
                     ? createStairOperationInput(
                         stairSystemV2.stairActivePart,
                         draft,
                         draft.stoneProduct?.id || draft.stoneId || 'unselected'
                       )
                     : undefined;
                   let stairOperationsAmount = 0;
                   if (stairOperationPolicyInput) {
                     const operationCalculation = calculateProductOperations(
                       stairOperationPolicyInput
                     );
                     if (!operationCalculation.ok) {
                       setErrors({
                         products:
                           'عملیات ابزار یا پرداخت معتبر نیست (کد: STAIR_OPERATION_CONFLICT)'
                       });
                       reportCurrentStairIssue({
                         code: 'STAIR_OPERATION_CONFLICT',
                         phase: 'calculate',
                         focusTarget: 'stair-operations-section',
                         conflictCodes:
                           operationCalculation.conflicts.map(
                             conflict => conflict.code
                           ),
                         action: isEditMode
                           ? 'edit-save'
                           : requestedFooterAction
                       });
                       document.getElementById('stair-operations-section')?.scrollIntoView({
                         block: 'center',
                         behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                           ? 'auto'
                           : 'smooth'
                       });
                       return;
                     }
                     stairOperationsAmount = Number(
                       operationCalculation.result.totalAmountToman
                     );
                   }
                   const canonicalStairResult = totals.canonicalCalculation.result;
                   const chargeableCuttingCost = totals.billableCuttingCost;
                  const actualLengthM = getActualLengthMeters(draft);
                  const pricingLengthM = getPricingLengthMeters(draft);
                  const widthM = (draft.widthCm || 0) / 100;
                  const toolsMeters = computeToolsMetersV2(stairSystemV2.stairActivePart, draft);
                  let metaTools = (draft.tools || []).map(t => {
                    const meters = computeToolMetersForTool(stairSystemV2.stairActivePart, draft, t);
                     return {
                       selectionId: t.selectionId,
                       toolId: t.toolId,
                       name: t.name,
                       pricePerMeter: t.pricePerMeter,
                       calculationBase: t.calculationBase || 'length',
                       coveredQuantity: t.coveredQuantity ?? draft.quantity,
                       edges: { front: !!t.front, left: !!t.left, right: !!t.right, back: !!t.back, perimeter: !!t.perimeter },
                      computedMeters: meters,
                      totalPrice: meters * (t.pricePerMeter || 0)
                    };
                  });
                  const stoneProduct = draft.stoneProduct!;
                  const selectedFinishing = draft.finishingId
                    ? stoneFinishings.find(option => option.id === draft.finishingId)
                    : undefined;
                  const finishingCost = computeFinishingCost(draft, totals.pricingSquareMeters);
                  const finishingCalculationBase = draft.finishingCalculationBase || getFinishingCalculationBase(selectedFinishing);
                  const finishingUnitPrice =
                    toFiniteNumber(draft.finishingUnitPrice) ||
                    toFiniteNumber(draft.finishingPricePerSquareMeter) ||
                    getFinishingUnitPrice(selectedFinishing) ||
                    null;
                  const finishingQuantity =
                    toFiniteNumber(draft.finishingQuantity) ||
                    calculateDefaultFinishingQuantity({
                      calculationBase: finishingCalculationBase,
                      productType: 'stair',
                      length: draft.lengthValue,
                      lengthUnit: draft.lengthUnit || 'm',
                      quantity: draft.quantity,
                      squareMeters: totals.pricingSquareMeters
                    });
                  const toolsTotal = sumNumericValues(metaTools, (tool) => tool.totalPrice);
                  const appliedSubServices: AppliedSubService[] = (draft.tools || []).map((tool) => {
                    const selectedSubService = subServices.find((subService) => subService.id === tool.toolId);
                    const meters = computeToolMetersForTool(stairSystemV2.stairActivePart, draft, tool);
                    const fallbackSubService: SubService = {
                      id: tool.toolId,
                      code: tool.toolId,
                      name: tool.name,
                      namePersian: tool.name,
                      pricePerMeter: tool.pricePerMeter || 0,
                      calculationBase: 'length',
                      isActive: true
                    };

                    return {
                      id: tool.selectionId || `applied_${tool.toolId}_${crypto.randomUUID()}`,
                      subServiceId: tool.toolId,
                      subService: selectedSubService || fallbackSubService,
                      meter: meters,
                      cost: meters * (tool.pricePerMeter || 0),
                      calculationBase: tool.calculationBase || selectedSubService?.calculationBase || 'length',
                      edges: {
                        front: !!tool.front,
                        left: !!tool.left,
                        right: !!tool.right,
                        back: !!tool.back,
                        perimeter: !!tool.perimeter
                      }
                    };
                  });

                  // 🎯 Use original width for pricing (like long stone products)
                  const originalWidthCm = stoneProduct.widthValue || 0;
                  const userWidthCm = draft.widthCm || 0;
                  const baseStoneQuantity = totals.baseStoneQuantity;

                  const defaultMandatoryForPart = stairSystemV2.stairActivePart === 'riser' || stairSystemV2.stairActivePart === 'landing';
                  const isDraftMandatory = draft.useMandatory ?? defaultMandatoryForPart;
                  const mandatoryPercentageValue = draft.mandatoryPercentage ?? 20;
                  const mandatoryAmount = isDraftMandatory && mandatoryPercentageValue > 0
                    ? totals.baseMaterialPrice * (mandatoryPercentageValue / 100)
                    : 0;
                  const basePrice = totals.baseMaterialPrice + mandatoryAmount;
                   const totalPrice =
                     basePrice +
                     toolsTotal +
                     finishingCost +
                     stairOperationsAmount +
                     chargeableCuttingCost;

                  const hasWidthCut = totals.cuttingMetersLongitudinal > 0;
                  const hasLengthCut = totals.cuttingMetersCross > 0;

                  // Calculate remaining stone if product was cut
                  let remainingStones: RemainingStone[] = [];
                  let isCut = false;
                  let cutType: 'longitudinal' | 'cross' | null = null;
                  let cuttingCost = chargeableCuttingCost;
                  let cuttingCostPerMeter = totals.cuttingCostPerMeter;
                  let cutDetails: StoneCut[] = [];
                  const cuttingBreakdown: CuttingBreakdownEntry[] = [];

                  if (hasWidthCut) {
                    isCut = true;
                    cutType = 'longitudinal';
                    if (actualLengthM > 0 && totals.remainingStoneGroups.length > 0) {
                      const baseRemainingSeed = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                      remainingStones = totals.remainingStoneGroups
                        .filter(group => group.widthCm > 0 && group.quantity > 0)
                        .map((group, index) => {
                          const remainingWidthInMeters = group.widthCm / 100;
                          return {
                            id: `remaining_${baseRemainingSeed}_${index}`,
                            width: group.widthCm,
                            length: actualLengthM,
                            squareMeters: remainingWidthInMeters * actualLengthM * group.quantity,
                            isAvailable: true,
                            sourceCutId: `cut_${draft.stoneId}_${baseRemainingSeed}_${index}`,
                            quantity: group.quantity
                          };
                        });
                    }

                    const cutId = `cut_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const cutDetail: StoneCut = {
                      id: cutId,
                      originalWidth: originalWidthCm,
                      cutWidth: userWidthCm,
                      remainingWidth: totals.leftoverWidthCm,
                      length: actualLengthM * 100 * baseStoneQuantity,
                      cuttingCost: totals.cuttingCostLongitudinal,
                      cuttingCostPerMeter: totals.cuttingCostPerMeterLongitudinal,
                      orientation: 'longitudinal'
                    };
                    cutDetails = [cutDetail];
                    cuttingBreakdown.push({
                      type: 'longitudinal',
                      meters: totals.cuttingMetersLongitudinal,
                      rate: totals.cuttingCostPerMeterLongitudinal,
                      cost: totals.cuttingCostLongitudinal
                    });
                  }

                   if (hasLengthCut) {
                    isCut = true;
                    if (!hasWidthCut) {
                      cutType = 'cross';
                    }
                    if (pricingLengthM > actualLengthM && baseStoneQuantity > 0) {
                      const remainingLength = pricingLengthM - actualLengthM;
                      const crossStoneId = `remaining_cross_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                      const widthMeters = originalWidthCm / 100;
                      const crossRemaining: RemainingStone = {
                        id: crossStoneId,
                        width: originalWidthCm,
                        length: remainingLength,
                        squareMeters: widthMeters * remainingLength * baseStoneQuantity,
                        isAvailable: true,
                        sourceCutId: `cut_cross_${draft.stoneId}_${Date.now()}`,
                        quantity: baseStoneQuantity
                      };
                      remainingStones = [...remainingStones, crossRemaining];

                      const crossCutId = `cut_cross_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                      cutDetails = [
                        ...cutDetails,
                        {
                          id: crossCutId,
                          originalWidth: pricingLengthM * 100,
                          cutWidth: actualLengthM * 100,
                          remainingWidth: remainingLength * 100,
                          length: originalWidthCm * baseStoneQuantity,
                          cuttingCost: totals.cuttingCostCross,
                          cuttingCostPerMeter: totals.cuttingCostPerMeterCross,
                          orientation: 'cross'
                        }
                      ];
                    }
                    cuttingBreakdown.push({
                      type: 'cross',
                      meters: totals.cuttingMetersCross,
                      rate: totals.cuttingCostPerMeterCross,
                      cost: totals.cuttingCostCross
                    });
                   }

                   const storedLengthValue = convertMetersToUnit(actualLengthM, draft.lengthUnit || 'm');
                   const nextProductRowId = isEditMode && editingProductIndex !== null
                     ? resolveEditedContractProductRowId(wizardData.products, editingProductIndex)
                     : createContractProductRowId();
                   const stairPartPolicyInput = {
                     ...createCanonicalStairDraftInput(
                       stairSystemV2.stairActivePart,
                       draft,
                       getCuttingTypePricePerMeter
                     ),
                     stairSystemId: parseStableIdentity('stair-system', sid),
                     sourceBatchId: parseStableIdentity(
                       'source-batch',
                       `stair:${nextProductRowId}`
                     )
                   };
                   const canonicalStairCalculationForRow =
                     calculateStairPart(stairPartPolicyInput);
                   if (!canonicalStairCalculationForRow.ok) {
                     setErrors({
                       products:
                         'محاسبه نهایی شناسه‌های سنگ پله نامعتبر است (کد: STAIR_ROW_IDENTITY_RECALCULATION_FAILED)'
                     });
                     reportCurrentStairIssue({
                       code: 'STAIR_ROW_IDENTITY_RECALCULATION_FAILED',
                       phase: 'calculate',
                       focusTarget: 'stair-calculation-summary',
                       conflictCodes:
                         canonicalStairCalculationForRow.conflicts.map(
                           conflict => conflict.code
                         ),
                       action: isEditMode
                         ? 'edit-save'
                         : requestedFooterAction
                     });
                     return;
                   }
                   const canonicalStairResultForRow =
                     canonicalStairCalculationForRow.result;
                   const canonicalPaidRemaindersForRow =
                     materializePaidRemainderStocks({
                       ownerProductRowId: parseStableIdentity(
                         'product-row',
                         nextProductRowId
                       ),
                       catalogProductId: draft.stoneId!,
                       sourceBatchId: stairPartPolicyInput.sourceBatchId,
                       remainders:
                         canonicalStairResultForRow.packingPlan.remainders
                     });
                   remainingStones =
                     canonicalPaidRemaindersForRow.map(
                       (remainder) => ({
                         id: remainder.remainingStoneId,
                         width: Number(remainder.widthMeters) * 100,
                         length: Number(remainder.lengthMeters),
                         squareMeters:
                           Number(remainder.widthMeters) *
                           Number(remainder.lengthMeters) *
                           remainder.quantity,
                         isAvailable: true,
                         sourceCutId: remainder.sourceBatchId,
                         quantity: remainder.quantity
                       })
                     );
                   const product: ContractProduct = {
                    rowId: nextProductRowId,
                    productId: draft.stoneId!,
                    product: stoneProduct,
                    productType: 'stair',
                    stairPartPolicyInput,
                    operationPolicyInput: stairOperationPolicyInput
                      ? {
                          ...stairOperationPolicyInput,
                          productRowId: parseStableIdentity(
                            'product-row',
                            nextProductRowId
                          )
                        }
                      : undefined,
                    stairSystemId: sid,
                    stairPartType: stairSystemV2.stairActivePart,
                    stoneCode: stoneProduct.code,
                    stoneName: draft.contractualTitle || generateCompactProductName(stoneProduct) || draft.stoneLabel || stoneProduct.namePersian || stoneProduct.name || '',
                    diameterOrWidth: draft.thicknessCm || stoneProduct.thicknessValue || 0, // قطر = ضخامت (thickness)
                    length: storedLengthValue,
                    lengthUnit: draft.lengthUnit || 'cm',
                    width: (draft.widthUnit || 'cm') === 'm'
                      ? draft.widthCm! / 100
                      : draft.widthCm!,
                    widthUnit: draft.widthUnit || 'cm',
                    quantity: draft.quantity!,
                    squareMeters: totals.sqm,
                    pricePerSquareMeter: draft.pricePerSquareMeter!,
                    totalPrice: totalPrice,
                    description: draft.description || '',
                    images: [...(stoneProduct.images || [])],
                    sawKerfEnabled: !!draft.sawKerfEnabled,
                    sawKerfCm: draft.sawKerfEnabled ? (draft.sawKerfCm || SAW_KERF_CM) : null,
                    currency: 'تومان',
                    isMandatory: isDraftMandatory && mandatoryPercentageValue > 0,
                    mandatoryPercentage: isDraftMandatory && mandatoryPercentageValue > 0 ? mandatoryPercentageValue : 0,
                    originalTotalPrice: totals.baseMaterialPrice,
                    isCut: isCut,
                    cutType: cutType,
                    originalWidth: originalWidthCm,
                    originalLength: actualLengthM, // Store original length in meters for canvas visualization
                    cuttingCost: cuttingCost,
                    physicalCuttingCost: totals.cuttingCost,
                    cuttingCostPerMeter: cuttingCostPerMeter,
                    calibrationCutEnabled: canonicalStairResultForRow.calibrationEnabled,
                    cutDescription: isCut
                      ? hasWidthCut && hasLengthCut
                        ? `برش طولی (${originalWidthCm}cm → ${userWidthCm}cm) و برش عرضی (${formatDisplayNumber(pricingLengthM)}m → ${formatDisplayNumber(actualLengthM)}m)`
                        : hasWidthCut
                          ? `برش طولی (${originalWidthCm}cm → ${userWidthCm}cm)`
                          : `برش عرضی (${formatDisplayNumber(pricingLengthM)}m → ${formatDisplayNumber(actualLengthM)}m)`
                      : '',
                    remainingStones: remainingStones,
                    remainingStoneSourceInventory: normalizeRemainingStoneCollection(remainingStones),
                    cutDetails: cutDetails,
                    usedRemainingStones: [],
                    totalUsedRemainingWidth: 0,
                    totalUsedRemainingLength: 0,
                    appliedSubServices,
                    totalSubServiceCost: sumNumericValues(appliedSubServices, (applied) => applied.cost),
                    usedLengthForSubServices: sumNumericValues(
                      appliedSubServices.filter((applied) => applied.calculationBase === 'length'),
                      (applied) => applied.meter
                    ),
                    usedSquareMetersForSubServices: sumNumericValues(
                      appliedSubServices.filter((applied) => applied.calculationBase === 'squareMeters'),
                      (applied) => applied.meter
                    ),
                    cuttingBreakdown: cuttingBreakdown.length ? cuttingBreakdown : undefined,
                    standardLengthValue:
                      draft.standardLengthValue &&
                      draft.standardLengthValue > 0
                        ? draft.standardLengthValue
                        : null,
                    standardLengthUnit:
                      draft.standardLengthUnit || draft.lengthUnit || 'm',
                    actualLengthMeters: actualLengthM || null,
                    finishingId: draft.finishingEnabled ? draft.finishingId || null : null,
                    finishingCode: draft.finishingEnabled ? (selectedFinishing?.code || null) : null,
                    finishingName: draft.finishingEnabled ? (draft.finishingLabel || selectedFinishing?.namePersian || selectedFinishing?.name || null) : null,
                    finishingPricePerSquareMeter: draft.finishingEnabled ? finishingUnitPrice : null,
                    finishingUnitPrice: draft.finishingEnabled ? finishingUnitPrice : null,
                    finishingCalculationBase: draft.finishingEnabled ? finishingCalculationBase : null,
                    finishingQuantity: draft.finishingEnabled ? finishingQuantity : null,
                    finishingCost: draft.finishingEnabled ? finishingCost : null,
                    finishingSquareMeters: draft.finishingEnabled && finishingCost > 0 && finishingCalculationBase === 'squareMeters' ? finishingQuantity : null,
                    meta: {
                      stairStepperV2: true,
                      meters: { lengthM: actualLengthM, widthM, toolsMeters },
                      tools: metaTools,
                      stair: {
                        motherLengthMeters: canonicalStairResultForRow.motherLengthMeters,
                        motherLengthMode: canonicalStairResultForRow.motherLengthMode,
                        motherLengthDisplayUnit:
                          canonicalStairResultForRow.motherLengthDisplayUnit,
                        motherWidthMeters: canonicalStairResultForRow.motherWidthMeters,
                        consumedMotherAreaSquareMeters:
                          canonicalStairResultForRow.consumedMotherAreaSquareMeters,
                        paidRemainderAreaSquareMeters:
                          canonicalStairResultForRow.paidRemainderAreaSquareMeters,
                        calculationPolicyVersion: canonicalStairResultForRow.calculationPolicyVersion,
                        packingPolicyVersion: canonicalStairResultForRow.packingPlan.policyVersion,
                        inputHash: canonicalStairResultForRow.inputHash,
                        resultHash: canonicalStairResultForRow.resultHash,
                        baseStoneQuantity: totals.baseStoneQuantity,
                        piecesPerStone: totals.piecesPerStone,
                        leftoverWidthCmPerStone: totals.leftoverWidthCm,
                        remainingStoneQuantity: totals.remainingStoneQuantity,
                        remainingStoneGroups: totals.remainingStoneGroups,
                        pricingSquareMeters: totals.pricingSquareMeters,
                        calibrationCutEnabled: canonicalStairResultForRow.calibrationEnabled,
                        calibrationSelection: draft.calibrationSelection || 'automatic',
                        cuttingMetersLongitudinal: totals.cuttingMetersLongitudinal,
                        cuttingMetersLongitudinalProduction: totals.cuttingMetersLongitudinalProduction,
                        cuttingMetersLongitudinalCalibration: totals.cuttingMetersLongitudinalCalibration,
                        cuttingMetersCross: totals.cuttingMetersCross,
                      },
                      finishing: draft.finishingEnabled && finishingCost > 0 ? {
                        id: draft.finishingId,
                        code: selectedFinishing?.code || null,
                        name: draft.finishingLabel || selectedFinishing?.namePersian || selectedFinishing?.name,
                        pricePerSquareMeter: finishingUnitPrice,
                        unitPrice: finishingUnitPrice,
                        calculationBase: finishingCalculationBase,
                        quantity: finishingQuantity,
                        unitLabel: getFinishingUnitLabel(finishingCalculationBase),
                        squareMeters: finishingCalculationBase === 'squareMeters' ? finishingQuantity : 0,
                        cost: finishingCost
                        } : undefined
                    } as any
                  };
                  // ============================================================================
                  // 🎯 REFACTORED LAYER HANDLING - Single state update for all changes
                  // ============================================================================

                  // Check if layers are defined with edges selected
                  const hasLayerEdges = draft.layerEdges && (
                    draft.layerEdges.front ||
                    draft.layerEdges.left ||
                    draft.layerEdges.right ||
                    draft.layerEdges.back ||
                    draft.layerEdges.perimeter
                  );

                  const layerDraftsForPreflight =
                    materializeStairLayerConfigurations(
                      draft,
                      activeLayerFallbackId
                    );
                  if (layerDraftsForPreflight.length > 0) {
                    const parentPreflightInventory =
                      getAvailableRemainingStoneInventory(product);
                    const availablePreflightStones =
                      collectAvailableRemainingStones(
                        [
                          ...wizardData.products,
                          ...stairSystemV2.stairSessionItems
                        ],
                        parentPreflightInventory
                      );
                    let canonicalPreflightInventory =
                      toCanonicalLayerInventory({
                        stones: availablePreflightStones,
                        ownerProductRowId: product.rowId!,
                        catalogProductId: product.productId
                      });

                    for (
                      let layerCreationOrder = 0;
                      layerCreationOrder < layerDraftsForPreflight.length;
                      layerCreationOrder += 1
                    ) {
                      const layerDraft = {
                        ...layerDraftsForPreflight[layerCreationOrder],
                        layerConfigurations: [],
                        stoneId: draft.stoneId,
                        stoneLabel: draft.stoneLabel,
                        stoneProduct: draft.stoneProduct,
                        thicknessCm: draft.thicknessCm,
                        lengthValue: draft.lengthValue,
                        lengthUnit: draft.lengthUnit,
                        widthCm: draft.widthCm,
                        widthUnit: draft.widthUnit,
                        quantity: draft.quantity,
                        squareMeters: draft.squareMeters
                      };
                      const layerUnit =
                        stairSystemV2.layerTypes.find(
                          option => option.id === layerDraft.layerTypeId
                        )?.calculationUnit || layerDraft.layerTypeCalculationUnit || 'set';
                      const preflight = calculateCanonicalLayerDraft({
                        part: stairSystemV2.stairActivePart,
                        draft: layerDraft,
                        parentProductRowId: product.rowId!,
                        creationOrder: layerCreationOrder,
                        availableInventory: canonicalPreflightInventory,
                        parentRemainingStoneIds:
                          parentPreflightInventory.map(stone => stone.id),
                        layerUnit,
                        getCuttingTypePricePerMeter
                      });
                      if (!preflight.ok) {
                        stairSystemV2.setStairDraftErrors(previous => ({
                          ...previous,
                          [stairSystemV2.stairActivePart]: {
                            ...previous[stairSystemV2.stairActivePart],
                            layerSource: formatCanonicalLayerConflict(
                              preflight.conflicts[0]
                            )
                          }
                        }));
                        focusCalculationError('stair-layer-calculation-summary');
                        return;
                      }
                      canonicalPreflightInventory = [...preflight.inventory];
                    }
                  }

                  // Prepare all updates in a single transaction
                  let stairSessionCommitSucceeded = true;
                  let builtSessionItems = stairSystemV2.stairSessionItems;
                  flushSync(() => stairSystemV2.setStairSessionItems(prev => {
                    const shouldReplaceActivePartInSession = isEditMode && editingProductIndex !== null;
                    const baseItems = shouldReplaceActivePartInSession
                      ? prev.filter(item => {
                          const isLayerItem = ((item.meta as any)?.isLayer) || false;
                          if (isLayerItem) {
                            const parentPart = (item.meta as any)?.layerInfo?.parentPartType;
                            return parentPart !== stairSystemV2.stairActivePart;
                          }
                          return item.stairPartType !== stairSystemV2.stairActivePart;
                        })
                      : prev;

                    // Start with adding the main stair part product
                    const updatedItems = [...baseItems, product];
                    const mainStairPartIndex = updatedItems.length - 1;

                    // Process every independent layer configuration in stable
                    // creation order. A currently edited configuration is last.
                    const parentDraft = draft;
                    const layerDrafts =
                      materializeStairLayerConfigurations(
                        draft,
                        activeLayerFallbackId
                      );
                    const parentLayerInventory =
                      getAvailableRemainingStoneInventory(product);
                    const parentLayerLineage = new Set(
                      parentLayerInventory.flatMap(remainingStoneLineageKeys)
                    );
                    let layerReplayInventory = collectAvailableRemainingStones(
                      [...wizardData.products, ...baseItems],
                      parentLayerInventory
                    );
                    const initialLayerReplayInventory = [...layerReplayInventory];
                    const layerReplayProductPool = [
                      ...wizardData.products,
                      ...baseItems,
                      product
                    ];
                    const seenCanonicalLayerRemainderIds = new Set<string>();
                    let canonicalLayerReplayInventory =
                      layerReplayInventory
                      .filter(stone => {
                        if (seenCanonicalLayerRemainderIds.has(stone.id)) {
                          return false;
                        }
                        seenCanonicalLayerRemainderIds.add(stone.id);
                        return true;
                      })
                      .flatMap((stone) => {
                        const sourceProduct = layerReplayProductPool.find(
                          candidate =>
                            (candidate.remainingStoneSourceInventory || [])
                              .some(item => item.id === stone.id) ||
                            (candidate.remainingStones || [])
                              .some(item => item.id === stone.id)
                        ) || product;
                        return toCanonicalLayerInventory({
                          stones: [stone],
                          ownerProductRowId:
                            sourceProduct.rowId || product.rowId!,
                          catalogProductId:
                            sourceProduct.productId || product.productId
                        });
                      });
                    let layerProcessingFailed = false;
                    for (
                      let layerCreationOrder = 0;
                      layerCreationOrder < layerDrafts.length;
                      layerCreationOrder += 1
                    ) {
                      const layerDraft = layerDrafts[layerCreationOrder];
                      const draft: StairPartDraftV2 = {
                        ...layerDraft,
                        layerConfigurations: [],
                        stoneId: parentDraft.stoneId,
                        stoneLabel: parentDraft.stoneLabel,
                        stoneProduct: parentDraft.stoneProduct,
                        thicknessCm: parentDraft.thicknessCm,
                        lengthValue: parentDraft.lengthValue,
                        lengthUnit: parentDraft.lengthUnit,
                        widthCm: parentDraft.widthCm,
                        widthUnit: parentDraft.widthUnit,
                        quantity: parentDraft.quantity,
                        squareMeters: parentDraft.squareMeters
                      };
                      const hasLayerEdges = hasLayerEdgeSelection(draft.layerEdges);
                    if (draft.numberOfLayersPerStair && draft.numberOfLayersPerStair > 0 &&
                        draft.layerWidthCm && hasLayerEdges && layerManagement.getLayerEffectivePricePerSquareMeter(draft) &&
                        draft.quantity) {

                      // Every explicit layer configuration remains independent.
                      // Similar names, dimensions, sides, or rates never authorize
                      // silent merging of commercial or allocation snapshots.
                      const existingLayerProduct = (
                        (): ContractProduct | null => null
                      )();

                      // 🎯 STEP 2: Calculate layer metrics
                      const totalLayerSqm = layerManagement.computeLayerSqmV2(stairSystemV2.stairActivePart, draft);
                      const layerWidthCm = draft.layerWidthCm || 0;
                      const totalLayers = draft.quantity * draft.numberOfLayersPerStair;
                      const mainStairLengthM = getActualLengthMeters(draft);
                      // 🎯 FIX: Use maximum layer length needed (accounts for different edge types with different lengths)
                      // This ensures we have enough stone for all layer types (front, left, right, etc.)
                      const layerLengthM = layerManagement.getMaxLayerLengthM(stairSystemV2.stairActivePart, draft) || mainStairLengthM;
                      const layerEdgeDemands = getLayerEdgeDemands(stairSystemV2.stairActivePart, draft);
                      const layerStoneProduct = layerManagement.getLayerStoneProductForDraft(draft, stoneProduct);
                      const usingAlternateLayerStone =
                        draft.layerSourceKind === 'newMaterial' &&
                        !!draft.layerStoneProduct;
                      const baseLayerPricePerSqm = layerManagement.getLayerBasePricePerSquareMeter(draft);
                      const effectiveLayerPricePerSqm = layerManagement.getLayerEffectivePricePerSquareMeter(draft);

                      // Get cutting cost per meter for layer calculations
                      const layerCuttingCostPerMeter =
                        (layerStoneProduct as any)?.cuttingCostPerMeter ??
                        getCuttingTypePricePerMeter('LONG');

                      // 🎯 STEP 3: Collect all available remaining stones
                      // Automatic allocation is intentionally limited to this exact
                      // parent row. Compatible sibling remainders require an explicit
                      // user choice; otherwise two simultaneous edits could consume
                      // the same remainder.
                      const allAvailableRemainingStones = (() => {
                        if (draft.layerSourceKind === 'newMaterial') return [];
                        if (draft.layerSourceKind === 'parentMaterial') {
                          return layerReplayInventory.filter(stone =>
                            remainingStoneLineageKeys(stone).some(key =>
                              parentLayerLineage.has(key)
                            )
                          );
                        }
                        if (draft.layerSourceKind === 'contractRemainder') {
                          const selectedRemainders = initialLayerReplayInventory.filter(
                            stone => (draft.layerSelectedRemainingStoneIds || [])
                              .includes(stone.id)
                          );
                          const selectedLineage = new Set(
                            selectedRemainders.flatMap(remainingStoneLineageKeys)
                          );
                          return layerReplayInventory.filter(stone =>
                            remainingStoneLineageKeys(stone).some(key =>
                              selectedLineage.has(key)
                            )
                          );
                        }
                        return [];
                      })();

                      // 🎯 STEP 4: Calculate layer metrics (remaining stone usage, cutting costs, etc.)
                      const totalLayerDemand = layerEdgeDemands.length
                        ? layerEdgeDemands.reduce((sum, demand) => sum + demand.layersNeeded, 0)
                        : totalLayers;
                      const physicalPiecesPerLayerSet = totalLayers > 0
                        ? totalLayerDemand / totalLayers
                        : 0;
                      const layerMetrics = usingAlternateLayerStone
                        ? {
                            layersFromRemainingStones: 0,
                            layersFromNewStones: totalLayerDemand,
                            totalLayerCuttingCost: 0,
                            longitudinalCuttingMeters: 0,
                            crossCuttingMeters: 0,
                            layerCutDetails: [] as StoneCut[],
                            usedRemainingStonesForLayers: [] as RemainingStone[],
                            layerRemainingPieces: [] as RemainingStone[],
                            squareMetersFromRemaining: 0,
                            squareMetersFromNew: totalLayerSqm,
                            totalLayerDemand,
                            unfulfilledDemands: layerEdgeDemands.length
                              ? layerEdgeDemands.map(demand => ({
                                  edge: demand.edge,
                                  lengthM: demand.lengthM,
                                  quantity: demand.layersNeeded
                                }))
                              : [{
                                  edge: 'front',
                                  lengthM: layerLengthM,
                                  quantity: totalLayerDemand
                                }]
                          }
                        : calculateLayerMetrics({
                            totalLayers: totalLayerDemand,
                            layerWidthCm,
                            layerLengthM,
                            availableRemainingStones: allAvailableRemainingStones,
                            cuttingCostPerMeter: layerCuttingCostPerMeter ?? 0,
                            edgeDemands: layerEdgeDemands,
                            sawKerfEnabled: !!draft.sawKerfEnabled,
                            sawKerfCm: draft.sawKerfCm || SAW_KERF_CM
                          });

                      if (false &&
                        draft.layerSourceKind !== 'newMaterial' &&
                        layerMetrics.layersFromNewStones > 0
                      ) {
                        stairSystemV2.setStairDraftErrors(prev => ({
                          ...prev,
                          [stairSystemV2.stairActivePart]: {
                            ...prev[stairSystemV2.stairActivePart],
                            layerSource: 'منبع انتخاب‌شده برای لایه کافی نیست'
                          }
                        }));
                        layerProcessingFailed = true;
                        break;
                      }

                      // 🎯 STEP 5: Calculate pricing
                      const layerSqmPerStair = totalLayerSqm / (draft.quantity * draft.numberOfLayersPerStair);
                      const layerTypeUnitPrice = draft.layerTypePrice || 0;
                      const totalLayerLengthPerStairM = layerManagement.getTotalLayerLengthPerStairM(stairSystemV2.stairActivePart, draft);
                      const totalLayerLengthM = totalLayerLengthPerStairM * draft.quantity;
                      const layerCalculationUnit = stairSystemV2.layerTypes.find(
                        option => option.id === draft.layerTypeId
                      )?.calculationUnit || draft.layerTypeCalculationUnit || 'set';
                      const canonicalInventoryBefore =
                        canonicalLayerReplayInventory;
                      const canonicalLayerParameters = {
                          part: stairSystemV2.stairActivePart,
                          draft,
                          parentProductRowId: product.rowId!,
                          creationOrder: layerCreationOrder,
                          availableInventory: canonicalLayerReplayInventory,
                          parentRemainingStoneIds:
                            parentLayerInventory.map(stone => stone.id),
                          layerUnit: layerCalculationUnit,
                          getCuttingTypePricePerMeter
                        };
                      const canonicalLayerRequest =
                        createCanonicalLayerCalculationRequest(
                          canonicalLayerParameters
                        );
                      const canonicalLayerCalculation =
                        calculateCanonicalLayerDraft(
                          canonicalLayerParameters
                        );
                      if (!canonicalLayerCalculation.ok) {
                        stairSystemV2.setStairDraftErrors(prev => ({
                          ...prev,
                          [stairSystemV2.stairActivePart]: {
                            ...prev[stairSystemV2.stairActivePart],
                            layerSource:
                              formatCanonicalLayerConflict(
                                canonicalLayerCalculation.conflicts[0]
                              )
                          }
                        }));
                        layerProcessingFailed = true;
                        break;
                      }
                      const canonicalLayerResult =
                        canonicalLayerCalculation.result;
                      const authoritativeLayerSqm =
                        canonicalLayerResult.physicalStrips.reduce(
                          (sum, strip) =>
                            sum +
                            Number(strip.lengthMeters) *
                              Number(strip.widthMeters) *
                              strip.quantity,
                          0
                        );
                      canonicalLayerReplayInventory =
                        [...canonicalLayerCalculation.inventory];
                      const canonicalInventoryAfterById = new Map(
                        canonicalLayerReplayInventory.map(stone => [
                          stone.remainingStoneId,
                          stone
                        ])
                      );
                      const canonicalUsedRemainingStones =
                        canonicalInventoryBefore.flatMap(stock => {
                          const afterQuantity =
                            canonicalInventoryAfterById.get(
                              stock.remainingStoneId
                            )?.quantity || 0;
                          const consumedQuantity =
                            stock.quantity - afterQuantity;
                          return consumedQuantity > 0
                            ? [{
                                id: stock.remainingStoneId,
                                width:
                                  Number(stock.widthMeters) * 100,
                                length:
                                  Number(stock.lengthMeters),
                                squareMeters:
                                  Number(stock.widthMeters) *
                                  Number(stock.lengthMeters) *
                                  consumedQuantity,
                                isAvailable: false,
                                sourceCutId: stock.sourceBatchId,
                                quantity: consumedQuantity
                              } satisfies RemainingStone]
                            : [];
                        });
                      const layerPricingQuantity =
                        Number(canonicalLayerResult.layerPricingQuantity);
                      const layerTypeCost =
                        Number(canonicalLayerResult.layerAmountToman);
                      const selectedLayerSides = (
                        ['front', 'back', 'left', 'right'] as const
                      ).filter(side =>
                        draft.layerEdges?.perimeter ||
                        Boolean(draft.layerEdges?.[side])
                      );
                      const layerSideOperationCalculations = selectedLayerSides
                        .filter(side => Boolean(draft.layerSideOperations?.[side]))
                        .map(side => ({
                          side,
                          input: createLayerSideOperationInput(
                            stairSystemV2.stairActivePart,
                            draft,
                            side,
                            draft.stoneProduct?.id || draft.stoneId || 'unselected'
                          )
                        }))
                        .map(entry => ({
                          ...entry,
                          calculation: calculateProductOperations(entry.input)
                        }));
                      const invalidLayerOperation =
                        layerSideOperationCalculations.find(entry =>
                          !entry.calculation.ok
                        );
                      if (invalidLayerOperation) {
                        stairSystemV2.setStairDraftErrors(prev => ({
                          ...prev,
                          [stairSystemV2.stairActivePart]: {
                            ...prev[stairSystemV2.stairActivePart],
                            layerSource: 'عملیات لایه نیاز به اصلاح دارد'
                          }
                        }));
                        layerProcessingFailed = true;
                        break;
                      }
                      const layerOperationsAmount =
                        Number(canonicalLayerResult.operationsAmountToman);
                      const layerAppliedSubServices: AppliedSubService[] =
                        layerSideOperationCalculations.flatMap(entry =>
                          entry.calculation.ok
                              ? entry.calculation.result.tools.map(tool => ({
                                id: tool.toolSelectionId,
                                subServiceId: tool.catalogItemId,
                                subService: subServices.find(service =>
                                  service.id === tool.catalogItemId
                                ) || ({
                                  id: tool.catalogItemId,
                                  name: tool.name,
                                  namePersian: tool.name,
                                  code: tool.catalogItemId,
                                  pricePerMeter: Number(tool.rateToman),
                                  calculationBase: tool.unit === 'meter'
                                    ? 'length'
                                    : 'squareMeters'
                                } as SubService),
                                meter: Number(tool.finalQuantity),
                                cost: Number(tool.amountToman),
                                calculationBase: tool.unit === 'meter'
                                  ? 'length' as const
                                  : 'squareMeters' as const,
                                edges: Object.fromEntries(
                                  (tool.edges || []).map(edge => [edge, true])
                                ) as AppliedSubService['edges']
                              }))
                            : []
                        );
                      const layerFinishings = layerSideOperationCalculations.flatMap(
                        entry => entry.calculation.ok
                          ? entry.calculation.result.finishings.map(finishing => ({
                              selectionId: finishing.finishingSelectionId,
                              finishingId: finishing.catalogItemId,
                              name: finishing.name,
                              calculationBase: finishing.unit === 'meter'
                                ? 'length' as const
                                : 'squareMeters' as const,
                              unitPrice: Number(finishing.rateToman),
                              automaticQuantity: Number(
                                finishing.automaticQuantity
                              ),
                              quantity: Number(finishing.finalQuantity),
                              quantityMode: finishing.quantityOverride
                                ? 'manual' as const
                                : 'auto' as const,
                              overrideStatus: 'current' as const,
                              cost: Number(finishing.amountToman)
                            }))
                          : []
                      );

                      const sourceWidthCm =
                        layerStoneProduct?.widthValue || originalWidthCm;
                      // A newly charged source uses the catalog/standard pricing
                      // length. Parent remainders already carry their exact length.
                      const sourceLengthM =
                        Number(layerStoneProduct?.motherLengthValue || 0) ||
                        getPricingLengthMeters(draft) ||
                        mainStairLengthM;
                      const inheritedSawKerfEnabled = !!draft.sawKerfEnabled;
                      const inheritedSawKerfCm = inheritedSawKerfEnabled
                        ? (draft.sawKerfCm || SAW_KERF_CM)
                        : 0;
                      const shortageDemands: Array<{
                        edge: LayerEdgeDemand['edge'];
                        lengthM: number;
                        quantity: number;
                      }> = draft.layerSourceKind === 'newMaterial' &&
                        layerMetrics.unfulfilledDemands &&
                        layerMetrics.unfulfilledDemands.length
                        ? layerMetrics.unfulfilledDemands as Array<{
                            edge: LayerEdgeDemand['edge'];
                            lengthM: number;
                            quantity: number;
                          }>
                        : draft.layerSourceKind === 'newMaterial' ? [{
                            edge: 'front' as LayerEdgeDemand['edge'],
                            lengthM: layerLengthM,
                            quantity: layerMetrics.layersFromNewStones
                          }] : [];
                      const layerSourcePlan = calculateLayerSourcePlan({
                        demands: shortageDemands,
                        sourceWidthCm,
                        sourceLengthM,
                        layerWidthCm,
                        sawKerfEnabled: inheritedSawKerfEnabled,
                        sawKerfCm: inheritedSawKerfCm
                      });
                      const shortagePieceQuantity = shortageDemands.reduce((sum, demand) => sum + demand.quantity, 0);
                      if (shortagePieceQuantity > 0 && (
                        layerSourcePlan.sourceStoneQuantity <= 0 ||
                        layerSourcePlan.physicalPieceQuantity !== shortagePieceQuantity
                      )) {
                        setErrors({ products: 'ابعاد سنگ منبع برای تولید لایه کافی نیست.' });
                        layerProcessingFailed = true;
                        break;
                      }

                      const longitudinalLayerRate = Number(
                        canonicalLayerRequest.input.longitudinalCutRateToman ??
                        canonicalLayerRequest.input.calibrationCutRateToman ??
                        0
                      );
                      const crossLayerRate = Number(
                        canonicalLayerRequest.input.crossCutRateToman ?? 0
                      );
                      const totalLongitudinalLayerMeters =
                        Number(
                          canonicalLayerResult.packingPlan
                            .longitudinalCutMeters
                        ) +
                        Number(
                          canonicalLayerResult.packingPlan.calibrationMeters
                        );
                      const totalCrossLayerMeters =
                        Number(
                          canonicalLayerResult.packingPlan.crossCutMeters
                        );
                      const safeLongitudinalLayerRate = longitudinalLayerRate;
                      const safeCrossLayerRate = crossLayerRate;
                      const longitudinalLayerCost =
                        canonicalLayerResult.cuttingPricingLines
                          .filter(line =>
                            line.lineId.endsWith(':longitudinal') ||
                            line.lineId.endsWith(':calibration')
                          )
                          .reduce(
                            (sum, line) => sum + Number(line.amountToman),
                            0
                          );
                      const crossLayerCost =
                        canonicalLayerResult.cuttingPricingLines
                          .filter(line => line.lineId.endsWith(':cross'))
                          .reduce(
                            (sum, line) => sum + Number(line.amountToman),
                            0
                          );
                      const layerMandatoryCuttingPolicy = usingAlternateLayerStone
                        ? ((draft.layerUseMandatory ?? true) && (draft.layerMandatoryPercentage ?? 0) > 0)
                        : (isDraftMandatory && mandatoryPercentageValue > 0);
                      const chargeableLayerCuttingCost =
                        Number(canonicalLayerResult.cuttingAmountToman);
                      const physicalLayerCuttingCost =
                        Number(canonicalLayerResult.cuttingAmountToman);
                      const layerCutDetails: StoneCut[] = [
                        {
                          id: `layer-long-${product.rowId}`,
                          type: 'longitudinal',
                          orientation: 'longitudinal',
                          label: 'برش طولی لایه',
                          meters: totalLongitudinalLayerMeters,
                          rate: safeLongitudinalLayerRate,
                          cost: longitudinalLayerCost,
                          originalWidth: sourceWidthCm,
                          cutWidth: layerWidthCm,
                          remainingWidth: Math.max(0, sourceWidthCm - layerWidthCm),
                          length: sourceLengthM * 100,
                          cuttingCost: longitudinalLayerCost,
                          cuttingCostPerMeter: safeLongitudinalLayerRate
                        },
                        {
                          id: `layer-cross-${product.rowId}`,
                          type: 'cross',
                          orientation: 'cross',
                          label: 'برش عرضی لایه',
                          meters: totalCrossLayerMeters,
                          rate: safeCrossLayerRate,
                          cost: crossLayerCost,
                          originalWidth: sourceWidthCm,
                          cutWidth: layerWidthCm,
                          remainingWidth: Math.max(0, sourceWidthCm - layerWidthCm),
                          length: sourceLengthM * 100,
                          cuttingCost: crossLayerCost,
                          cuttingCostPerMeter: safeCrossLayerRate
                        }
                      ].filter(detail => (detail.meters || 0) > 0) as StoneCut[];
                      const stoneAreaUsedSqm = Number(
                        canonicalLayerResult.materialPricingLine?.quantity || 0
                      );
                      const pricingStoneAreaSqm = stoneAreaUsedSqm;
                      // 🎯 FIX: Layer material price should be based on stone area used, NOT layer square meters
                      // 🎯 NOTE: effectiveLayerPricePerSqm already includes mandatory pricing if applicable
                      // Example: stoneAreaUsedSqm (0.976 m²) × pricePerSqm (700,000) = 683,200 تومان
                      const layerMaterialPrice =
                        Number(canonicalLayerResult.materialAmountToman);
                      // 🎯 FIX: Ensure layerTotalPrice is always a number (not string) and properly rounded
                      const layerTotalPrice = Number(
                        canonicalLayerResult.totalAmountToman
                      );

                      // 🎯 STEP 6: Handle existing session layer merge OR create a new layer product
                      if (existingLayerProduct) {
                        const existingLayerIndex = updatedItems.findIndex(item => item === existingLayerProduct);

                        if (existingLayerIndex >= 0) {
                          // Merge existing layer product in session
                          const mergedLayerProduct = layerManagement.mergeLayerProduct(existingLayerProduct, {
                            draft,
                            parentPartType: stairSystemV2.stairActivePart,
                            newLayersNeeded: totalLayers,
                            newLayerSqm: authoritativeLayerSqm,
                            layerMaterialPrice,
                            layerTypeCost,
                            totalLayerCuttingCost: chargeableLayerCuttingCost,
                            layerCutDetails,
                            usedRemainingStonesForLayers: layerMetrics.usedRemainingStonesForLayers,
                            layersFromRemainingStones: layerMetrics.layersFromRemainingStones,
                            layersFromNewStones: layerMetrics.layersFromNewStones,
                            layerPricePerSquareMeter: effectiveLayerPricePerSqm,
                            layerStoneLabel: usingAlternateLayerStone
                              ? (draft.layerStoneLabel || layerStoneProduct?.namePersian || layerStoneProduct?.name || '')
                              : null,
                            layerUseDifferentStone: usingAlternateLayerStone,
                            layerStoneProductId: usingAlternateLayerStone
                              ? (draft.layerStoneProductId || layerStoneProduct?.id || null)
                              : null,
                            layerStoneBasePricePerSquareMeter: baseLayerPricePerSqm,
                            layerUseMandatory: draft.layerUseDifferentStone ? (draft.layerUseMandatory ?? true) : undefined,
                            layerMandatoryPercentage: draft.layerUseDifferentStone ? (draft.layerMandatoryPercentage ?? 0) : undefined,
                            layerShortageSource: draft.layerShortageSource || null,
                            layerManualSourceWidthCm: draft.layerManualSourceWidthCm || null,
                            layerManualSourceLengthM: draft.layerManualSourceLengthM || null,
                            layerManualSourceQuantity: draft.layerManualSourceQuantity || null,
                            stoneAreaUsedSqm: stoneAreaUsedSqm
                          });
                          updatedItems[existingLayerIndex] = mergedLayerProduct;
                        }
                      } else {
                        // Create new layer product
                        const newLayerProduct = layerManagement.createLayerProduct({
                          draft,
                          stoneProduct: layerStoneProduct || stoneProduct,
                          stairSystemId: sid,
                          parentPartType: stairSystemV2.stairActivePart,
                          totalLayers,
                          totalLayerSqm: authoritativeLayerSqm,
                          layerMaterialPrice,
                          layerTotalPrice,
                          layerTypeCost,
                          layersFromRemainingStones: layerMetrics.layersFromRemainingStones,
                          layersFromNewStones: layerMetrics.layersFromNewStones,
                          totalLayerCuttingCost: chargeableLayerCuttingCost,
                          layerCutDetails,
                          layerRemainingPieces:
                            canonicalLayerResult.generatedRemainders.map(
                              remainder => ({
                                id: remainder.remainingStoneId,
                                width:
                                  Number(remainder.widthMeters) * 100,
                                length:
                                  Number(remainder.lengthMeters),
                                squareMeters:
                                  Number(remainder.widthMeters) *
                                  Number(remainder.lengthMeters) *
                                  remainder.quantity,
                                isAvailable: true,
                                sourceCutId: remainder.sourceBatchId,
                                quantity: remainder.quantity
                              })
                            ),
                          usedRemainingStonesForLayers:
                            canonicalUsedRemainingStones,
                          originalWidthCm: sourceWidthCm,
                          lengthM: sourceLengthM,
                          layerCuttingCostPerMeter:
                            layerCuttingCostPerMeter ?? 0,
                          parentProductIndexInSession: mainStairPartIndex,
                          layerPricePerSquareMeter: effectiveLayerPricePerSqm,
                          layerStoneLabel: draft.layerUseDifferentStone
                            ? (draft.layerStoneLabel || layerStoneProduct?.namePersian || layerStoneProduct?.name || '')
                            : null,
                          layerUseDifferentStone: usingAlternateLayerStone,
                          layerStoneProductId: draft.layerUseDifferentStone
                            ? (draft.layerStoneProductId || layerStoneProduct?.id || null)
                            : null,
                          layerStoneBasePricePerSquareMeter: baseLayerPricePerSqm,
                          layerUseMandatory: draft.layerUseDifferentStone ? (draft.layerUseMandatory ?? true) : undefined,
                          layerMandatoryPercentage: draft.layerUseDifferentStone ? (draft.layerMandatoryPercentage ?? 0) : undefined,
                          layerShortageSource: draft.layerShortageSource || null,
                          layerManualSourceWidthCm: draft.layerManualSourceWidthCm || null,
                          layerManualSourceLengthM: draft.layerManualSourceLengthM || null,
                          layerManualSourceQuantity: draft.layerManualSourceQuantity || null,
                          stoneAreaUsedSqm: stoneAreaUsedSqm
                        });
                        const layerProductRowId =
                          draft.layerConfigurationDraftId ||
                          createContractProductRowId();
                        updatedItems.push({
                          ...newLayerProduct,
                          description:
                            draft.layerDescription || newLayerProduct.description,
                          appliedSubServices: layerAppliedSubServices,
                          totalSubServiceCost: layerAppliedSubServices.reduce(
                            (sum, operation) => sum + operation.cost,
                            0
                          ),
                          usedLengthForSubServices: layerAppliedSubServices
                            .filter(operation =>
                              operation.calculationBase === 'length'
                            )
                            .reduce((sum, operation) => sum + operation.meter, 0),
                          usedSquareMetersForSubServices: layerAppliedSubServices
                            .filter(operation =>
                              operation.calculationBase === 'squareMeters'
                            )
                            .reduce((sum, operation) => sum + operation.meter, 0),
                          finishings: layerFinishings,
                          rowId: layerProductRowId,
                          parentProductRowId: product.rowId,
                          sawKerfEnabled: inheritedSawKerfEnabled,
                          sawKerfCm: inheritedSawKerfEnabled ? inheritedSawKerfCm : null,
                          physicalCuttingCost: physicalLayerCuttingCost,
                          cuttingBreakdown: [
                            {
                              type: 'longitudinal',
                              meters: totalLongitudinalLayerMeters,
                              rate: safeLongitudinalLayerRate,
                              cost: longitudinalLayerCost
                            },
                            {
                              type: 'cross',
                              meters: totalCrossLayerMeters,
                              rate: safeCrossLayerRate,
                              cost: crossLayerCost
                            }
                          ].filter(entry => entry.meters > 0) as CuttingBreakdownEntry[],
                          meta: {
                            ...newLayerProduct.meta,
                            layerInfo: {
                              ...(newLayerProduct.meta as any)?.layerInfo,
                              layerConfigurationId:
                                layerProductRowId,
                              parentProductRowId: product.rowId,
                              layerSetQuantity: totalLayers,
                              physicalPieceQuantity: totalLayerDemand,
                              physicalPiecesPerLayerSet,
                              calculationUnit: layerCalculationUnit,
                              pricingQuantity: layerPricingQuantity,
                              manualRateToman: layerTypeUnitPrice,
                              sourceKind: draft.layerSourceKind,
                              selectedRemainingStoneIds:
                                draft.layerSelectedRemainingStoneIds || [],
                              description: draft.layerDescription || '',
                              edges: draft.layerEdges
                            },
                            layerSideOperations:
                              layerSideOperationCalculations.map(entry => ({
                                side: entry.side,
                                input: entry.input,
                                result: entry.calculation.ok
                                  ? entry.calculation.result
                                  : null
                              })),
                            layerOperationEditingScope:
                              draft.layerOperationEditingScope || 'all',
                            layerDetachedOperationSides:
                              draft.layerDetachedOperationSides || [],
                            layerSourcePlan: {
                              canonicalInput:
                                canonicalLayerRequest.input,
                              canonicalInputHash:
                                canonicalLayerResult.inputHash,
                              canonicalResultHash:
                                canonicalLayerResult.resultHash,
                              calculationPolicyVersion:
                                canonicalLayerResult
                                  .calculationPolicyVersion,
                              packingPlan:
                                canonicalLayerResult.packingPlan,
                              generatedRemainders:
                                canonicalLayerResult.generatedRemainders,
                              sourceStoneQuantity:
                                canonicalLayerResult.packingPlan
                                  .consumedSources.length,
                              sourceAreaSqm: stoneAreaUsedSqm,
                              sourceWidthCm: layerSourcePlan.sourceWidthCm,
                              sourceLengthM: layerSourcePlan.sourceLengthM,
                              columnsPerStone: layerSourcePlan.columnsPerStone,
                              physicalPieceQuantity:
                                canonicalLayerResult.physicalStripCount,
                              fromAlreadyPaidStone:
                                draft.layerSourceKind === 'newMaterial'
                                  ? 0
                                  : canonicalLayerResult.physicalStripCount,
                              fromNewStone:
                                draft.layerSourceKind === 'newMaterial'
                                  ? canonicalLayerResult.physicalStripCount
                                  : 0,
                              fromAlreadyPaidSets: physicalPiecesPerLayerSet > 0
                                ? (
                                    draft.layerSourceKind === 'newMaterial'
                                      ? 0
                                      : canonicalLayerResult
                                          .physicalStripCount /
                                        physicalPiecesPerLayerSet
                                  )
                                : 0,
                              fromNewSets: physicalPiecesPerLayerSet > 0
                                ? (
                                    draft.layerSourceKind === 'newMaterial'
                                      ? canonicalLayerResult
                                          .physicalStripCount /
                                        physicalPiecesPerLayerSet
                                      : 0
                                  )
                                : 0,
                              sawKerfEnabled: inheritedSawKerfEnabled,
                              sawKerfCm: inheritedSawKerfEnabled ? inheritedSawKerfCm : null,
                              mandatoryCuttingPolicy: layerMandatoryCuttingPolicy,
                              allocations:
                                canonicalLayerResult.packingPlan.placements
                            }
                          }
                        });
                      }

                      // 🎯 STEP 7: Update remaining stone usage tracking
                      if (canonicalUsedRemainingStones.length > 0) {
                        const consumedLineage = new Set(
                          canonicalUsedRemainingStones.flatMap(
                            remainingStoneLineageKeys
                          )
                        );
                        layerReplayInventory = normalizeRemainingStoneCollection([
                          ...layerReplayInventory.filter(stone =>
                            !remainingStoneLineageKeys(stone).some(key =>
                              consumedLineage.has(key)
                            )
                          ),
                          ...canonicalLayerResult.generatedRemainders.map(
                            remainder => ({
                              id: remainder.remainingStoneId,
                              width:
                                Number(remainder.widthMeters) * 100,
                              length:
                                Number(remainder.lengthMeters),
                              squareMeters:
                                Number(remainder.widthMeters) *
                                Number(remainder.lengthMeters) *
                                remainder.quantity,
                              isAvailable: true,
                              sourceCutId: remainder.sourceBatchId,
                              quantity: remainder.quantity
                            })
                          )
                        ]).filter(isUsableRemainingStone);
                        const remainingStoneUpdates = layerManagement.updateRemainingStoneUsage(
                          updatedItems,
                          canonicalUsedRemainingStones,
                          mainStairPartIndex
                        );

                        // Apply all remaining stone usage updates
                        remainingStoneUpdates.forEach((updatedProduct, idx) => {
                          if (idx >= 0 && idx < updatedItems.length) {
                            updatedItems[idx] = updatedProduct;
                          }
                        });
                      }
                    }
                    }
                    if (layerProcessingFailed) {
                      stairSessionCommitSucceeded = false;
                      return baseItems;
                    }

                    builtSessionItems = updatedItems;
                    return updatedItems;
                  }));
                  if (!stairSessionCommitSucceeded) {
                    return;
                  }
                  if (requestedFooterAction === 'finish') {
                    const transaction = executeStairCreateTransaction({
                      action: 'finish',
                      stagedItems: builtSessionItems,
                      activeDraftMeaningful: false,
                      buildActiveDraft: () => ({
                        ok: true,
                        sessionItems: builtSessionItems
                      })
                    });
                    if (transaction.status === 'committed') {
                      commitStagedStairSessionRef.current = true;
                      stairFinishButtonRef.current?.click();
                    }
                    // The nested commit handler owns success reset/close and
                    // preserves both the draft and its error on failure.
                    return;
                  }

                  // Reset fields for quick next entry (keep unit toggle)
                  const [, setDraft] = getActiveDraft();
                  setDraft({
                    ...createFreshStairPartDraft(stairSystemV2.stairActivePart),
                    lengthUnit: draft.lengthUnit || 'm',
                    standardLengthUnit: draft.lengthUnit || 'm'
                  });
                  stairSystemV2.setStoneSearchTerm('');
                  stairSystemV2.setToolsSearchTerm('');
                  stairSystemV2.setToolsDropdownOpen(false);
                  setErrors({});
                  } catch {
                    commitStagedStairSessionRef.current = false;
                    setErrors({
                      products:
                        'ذخیره پیکربندی پله انجام نشد؛ اطلاعات واردشده حفظ شده است (کد: STAIR_TRANSACTION_UNEXPECTED)'
                    });
                    reportCurrentStairIssue({
                      code: 'STAIR_TRANSACTION_UNEXPECTED',
                      phase: 'build',
                      focusTarget: 'stair-active-part',
                      action: isEditMode
                        ? 'edit-save'
                        : requestedFooterAction
                    });
                  }
                }}>افزودن این بخش</ErpPressable>
                <ErpPressable ref={stairFinishButtonRef} type="button" className="min-h-11 rounded-lg bg-gradient-to-r from-[var(--sds-accent)] to-[var(--sds-accent-hover)] px-4 py-2 text-sm font-semibold text-[var(--sds-text-inverse)] shadow-sm transition hover:from-[var(--sds-accent)] hover:to-[var(--sds-accent-hover)]" onClick={() => {
                  const [activeDraft] = getActiveDraft();
                  const commitStagedSession =
                    commitStagedStairSessionRef.current;
                  commitStagedStairSessionRef.current = false;
                  if (
                    !commitStagedSession &&
                    hasMeaningfulStairDraft(activeDraft)
                  ) {
                    requestedStairFooterActionRef.current = 'finish';
                    stairStageButtonRef.current?.click();
                    return;
                  }
                  if (!stairSystemV2.stairSessionItems.length) {
                    setErrors({
                      products:
                        'حداقل یک بخش پله را کامل کنید (کد: STAIR_FINISH_EMPTY)'
                    });
                    requestAnimationFrame(() => {
                      document
                        .querySelector<HTMLElement>(
                          '[data-stair-active-part]'
                        )
                        ?.focus();
                    });
                    reportStairTransactionDiagnostic({
                      code: 'STAIR_FINISH_EMPTY',
                      phase: 'detect',
                      focusTarget: 'stair-active-part'
                    }, {
                      action: isEditMode ? 'edit-save' : 'finish',
                      phase: 'detect',
                      mode: isEditMode ? 'edit' : 'create',
                      stairPart: stairSystemV2.stairActivePart,
                      stairSessionId:
                        stairSystemV2.stairSessionId || undefined,
                      stagedRowCount: 0,
                      layerCount: 0
                    });
                    return;
                  }
                  try {

                  // Handle edit mode: replace existing products instead of adding new ones
                  if (isEditMode && editingProductIndex !== null) {
                    const productsWithRowIds = ensureContractProductRowIds(wizardData.products);
                    const oldProduct = productsWithRowIds[editingProductIndex];
                    const oldStairSystemId = oldProduct?.stairSystemId;

                    if (oldStairSystemId) {
                      const productsToAdd = prepareStairEditReplacementRowIdentities(
                        stairSystemV2.stairSessionItems,
                        oldProduct,
                        editingProductIndex
                      );

                      let nextProducts = replaceStairRowWithAttachedLayers(productsWithRowIds, editingProductIndex, productsToAdd);
                      const hasRemainingChildren = !!oldProduct.rowId && nextProducts.some((item) => item.parentProductRowId === oldProduct.rowId);
                      if (oldProduct.rowId && hasRemainingChildren) {
                        const replacementSource = nextProducts.find((item) => item.rowId === oldProduct.rowId);
                        const replay = replayRemainingStoneAllocations({
                          products: nextProducts,
                          sourceRowId: oldProduct.rowId,
                          sourceInventory: replacementSource?.remainingStoneSourceInventory || replacementSource?.remainingStones
                        });
                        if (!replay.ok) {
                          setErrors({ products: formatRemainingStoneReplayConflicts(replay.conflicts) });
                          return;
                        }
                        nextProducts = replay.products;
                      }

                      updateWizardData({
                        products: nextProducts,
                        selectedProductTypeForAddition: 'stair'
                      });
                      clearProductAdditionSearches();
                    } else {
                      // Fallback: just replace the single product
                      const updatedProducts = [...productsWithRowIds];
                      updatedProducts[editingProductIndex] = {
                        ...stairSystemV2.stairSessionItems[0],
                        rowId: oldProduct.rowId
                      };
                      const replay = oldProduct.rowId && updatedProducts.some((item) => item.parentProductRowId === oldProduct.rowId)
                        ? replayRemainingStoneAllocations({
                            products: updatedProducts,
                            sourceRowId: oldProduct.rowId,
                            sourceInventory: updatedProducts[editingProductIndex].remainingStoneSourceInventory || updatedProducts[editingProductIndex].remainingStones
                          })
                        : null;
                      if (replay && !replay.ok) {
                        setErrors({ products: formatRemainingStoneReplayConflicts(replay.conflicts) });
                        return;
                      }
                      updateWizardData({ products: replay?.products || updatedProducts, selectedProductTypeForAddition: 'stair' });
                      clearProductAdditionSearches();
                    }
                  } else {
                    // Add mode: append session items to wizardData
                    // 🎯 Set parentProductIndex for layer products to link them to their parent stair part
                    const currentProductsCount = wizardData.products.length;

                    const sessionItemsToAdd: ContractProduct[] = [...stairSystemV2.stairSessionItems];

                    // Create a map of session items to their final indices in wizardData.products
                    const sessionToFinalIndexMap = new Map<ContractProduct, number>();
                    let nonLayerCount = 0;
                    sessionItemsToAdd.forEach((item) => {
                      const isLayer = ((item.meta as any)?.isLayer) || false;
                      if (!isLayer) {
                        // Non-layer items are added in order
                        sessionToFinalIndexMap.set(item, currentProductsCount + nonLayerCount);
                        nonLayerCount++;
                      }
                    });

                    // Now map all items and set parentProductIndex for layers
                    const productsToAdd = sessionItemsToAdd.map((item) => {
                      const isLayer = ((item.meta as any)?.isLayer) || false;
                      if (isLayer) {
                        const layerInfo = (item.meta as any)?.layerInfo;
                        const parentIndexInSession = layerInfo?.parentProductIndexInSession;

                        if (parentIndexInSession !== undefined && parentIndexInSession >= 0) {
                          // Find the parent product in original session items (not filtered)
                          const parentInSession = stairSystemV2.stairSessionItems[parentIndexInSession];

                          if (parentInSession) {
                            // Get the parent's final index from our map
                            const parentFinalIndex = sessionToFinalIndexMap.get(parentInSession);

                            if (parentFinalIndex !== undefined && parentFinalIndex >= 0) {
                              return {
                                ...item,
                                parentProductIndex: parentFinalIndex
                              };
                            } else {
                              // Fallback: calculate based on session index (shouldn't happen, but handle gracefully)
                              console.warn('⚠️ Could not find parent final index for layer product, using fallback calculation');
                              // Find parent's index in original session
                              const parentSessionIndex = stairSystemV2.stairSessionItems.findIndex(p => p === parentInSession);
                              if (parentSessionIndex >= 0) {
                                // Count non-layer items before parent in session
                                let nonLayerBeforeParent = 0;
                                for (let i = 0; i < parentSessionIndex; i++) {
                                  if (!((stairSystemV2.stairSessionItems[i].meta as any)?.isLayer)) {
                                    nonLayerBeforeParent++;
                                  }
                                }
                                return {
                                  ...item,
                                  parentProductIndex: currentProductsCount + nonLayerBeforeParent
                                };
                              }
                            }
                          }
                        }
                      }
                      return item;
                    });

                    const updatedProducts = [...wizardData.products];
                    let combinedProducts = [...updatedProducts, ...productsToAdd];
                    productsToAdd
                      .filter(item =>
                        (item.meta as any)?.isLayer &&
                        (item.meta as any)?.layerInfo?.sourceKind ===
                          'contractRemainder'
                      )
                      .forEach(layerItem => {
                        const sourceUpdates = layerManagement.updateRemainingStoneUsage(
                          combinedProducts,
                          layerItem.usedRemainingStones || [],
                          -1
                        );
                        sourceUpdates.forEach((updatedProduct, index) => {
                          combinedProducts[index] = updatedProduct;
                        });
                      });
                    updateWizardData({
                      products: combinedProducts,
                      selectedProductTypeForAddition: 'stair'
                    });
                    clearProductAdditionSearches();
                  }

                  const savedStairRowId =
                    isEditMode && editingProductIndex !== null
                      ? wizardData.products[editingProductIndex]?.rowId
                      : stairSystemV2.stairSessionItems.find(
                          item => !((item.meta as any)?.isLayer)
                        )?.rowId;
                  publishProductSaveFeedback(
                    isEditMode ? 'edited' : 'created',
                    savedStairRowId
                  );
                  resetStairConfigurationSession();
                  setShowProductModal(false);
                  } catch {
                    setErrors({
                      products:
                        'ثبت پیکربندی پله انجام نشد؛ اطلاعات واردشده حفظ شده است (کد: STAIR_COMMIT_UNEXPECTED)'
                    });
                    reportCurrentStairIssue({
                      code: 'STAIR_COMMIT_UNEXPECTED',
                      phase: 'commit',
                      focusTarget: 'stair-active-part',
                      action: isEditMode
                        ? 'edit-save'
                        : 'finish'
                    });
                  }
                }}>{isEditMode ? 'ذخیره تغییرات' : 'اتمام و افزودن به قرارداد'}</ErpPressable>
              </div>
            </div>
          </div>
        )}
        {/* New Modal Components */}
        <ProductConfigurationModal
          isOpen={!editRecoveryBlocked && productModal.showProductModal && productModal.productConfig.productType !== 'stair' && !!productModal.selectedProduct}
          onClose={() => {
            productModal.setShowProductModal(false);
            productModal.setSelectedProduct(null);
          }}
          selectedProduct={productModal.selectedProduct}
          productConfig={productModal.productConfig}
          setProductConfig={productModal.setProductConfig}
          setLengthUnit={productModal.setLengthUnit}
          setWidthUnit={productModal.setWidthUnit}
          setIsMandatory={productModal.setIsMandatory}
          setMandatoryPercentage={productModal.setMandatoryPercentage}
          isEditMode={productModal.isEditMode}
          onSave={handleAddProductToContract}
          onProductTypeChange={handleModalProductTypeChange}
          wizardData={wizardData}
          getCuttingTypePricePerMeter={productCalculations.getCuttingTypePricePerMeter}
          stoneFinishings={stoneFinishings}
          subServices={subServices}
          error={errors.products}
        />

        <RemainingStoneModal
          isOpen={remainingStoneModal.showRemainingStoneModal}
          onClose={() => {
            remainingStoneModal.setShowRemainingStoneModal(false);
            remainingStoneModal.setSelectedRemainingStone(null);
            if (returnToProductModalAfterRemainderRef.current) {
              returnToProductModalAfterRemainderRef.current = false;
              setShowProductModal(true);
            }
          }}
          remainingStone={remainingStoneModal.selectedRemainingStone}
          sourceProduct={remainingStoneModal.selectedRemainingStoneSourceProduct}
          remainingStoneConfig={remainingStoneModal.remainingStoneConfig}
          setRemainingStoneConfig={remainingStoneModal.setRemainingStoneConfig}
          subServices={subServices}
          stoneFinishings={stoneFinishings}
          onCreatePartitions={() => {
            returnToProductModalAfterRemainderRef.current = false;
            remainingStoneModal.handleAddRemainingStoneToContract();
          }}
          partitions={remainingStoneModal.partitions}
          setPartitions={remainingStoneModal.setPartitions}
          partitionWidthUnit={remainingStoneModal.partitionWidthUnit}
          setPartitionWidthUnit={remainingStoneModal.setPartitionWidthUnit}
          partitionLengthUnit={remainingStoneModal.partitionLengthUnit}
          setPartitionLengthUnit={remainingStoneModal.setPartitionLengthUnit}
          handleAddPartition={remainingStoneModal.handleAddPartition}
          handleUpdatePartition={remainingStoneModal.handleUpdatePartition}
          handleRemovePartition={remainingStoneModal.handleRemovePartition}
          partitionValidationErrors={remainingStoneModal.partitionValidationErrors}
          errors={errors}
          remainingStoneSawKerfEnabled={remainingStoneModal.remainingStoneSawKerfEnabled}
          setRemainingStoneSawKerfEnabled={remainingStoneModal.setRemainingStoneSawKerfEnabled}
        />

        {paymentHandlers.showPaymentEntryModal && (
          <PaymentEntryModal
            isOpen={paymentHandlers.showPaymentEntryModal}
            onClose={paymentHandlers.handleClosePaymentEntryModal}
            form={paymentHandlers.paymentEntryForm}
            onFormChange={paymentHandlers.updatePaymentEntryForm}
            onSave={paymentHandlers.handleSavePaymentEntry}
            currency={wizardData.payment.currency}
            error={errors.paymentMethod}
            fieldErrors={paymentHandlers.paymentEntryErrors}
            isEdit={!!paymentHandlers.editingPaymentEntryId}
            nationalCodeRequired={paymentHandlers.paymentEntryNationalCodeRequired}
            nationalCodeConflict={paymentHandlers.nationalCodeConflict}
            onContinueNationalCodeConflict={paymentHandlers.handleContinueNationalCodeConflict}
          />
        )}
        </div>
      </div>
    </main>
  );
}
