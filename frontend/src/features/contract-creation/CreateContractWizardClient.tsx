'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
import StoneCanvas from '@/components/StoneCanvas';
import { StoneCADDesigner } from '@/components/stone-cad/StoneCADDesigner';

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
import { SubServiceModal } from '@/features/contract-creation/components/modals/SubServiceModal';
import { PaymentEntryModal } from '@/features/contract-creation/components/modals/PaymentEntryModal';

// Import hooks
import { useContractWizard } from '@/features/contract-creation/hooks/useContractWizard';
import { useProductModal } from '@/features/contract-creation/hooks/useProductModal';
import { useProductCalculations } from '@/features/contract-creation/hooks/useProductCalculations';
import { useRemainingStoneModal } from '@/features/contract-creation/hooks/useRemainingStoneModal';
import { useSubServiceModal } from '@/features/contract-creation/hooks/useSubServiceModal';
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

// Import constants
import { NOSING_TYPES, PRODUCT_TYPES, WIZARD_STEPS } from '@/features/contract-creation/constants/contract.constants';

// Import utilities
import { generateCompactProductName, generateFullProductName, generateSlabContractProductName, productSupportsContractType } from '@/features/contract-creation/utils/productUtils';
import { determineSlabLineCutPlan } from '@/features/contract-creation/utils/productCalculations';
import {
  hasLayerEdgeSelection,
  deriveLayerEdgesFromTools,
  getPartDisplayLabel,
  getProductCuttingCost,
  getProductServiceCost
} from '@/features/contract-creation/utils/stairSystemHelpers';
import { generateContractHTML } from '@/features/contract-creation/utils/contractHTMLGenerator';
import {
  isUsableRemainingStone,
  normalizeRemainingStoneCollection,
  sanitizeRemainingStoneEntry
} from '@/features/contract-creation/utils/remainingStoneGuards';
import { validatePartitions, calculateRemainingAreasAfterPartitions } from '@/features/contract-creation/services/stoneCuttingService';
import { calculatePartitionPositions } from '@/features/contract-creation/services/partitionPositioningService';
import {
  validateDraftNumericFields,
  validateDraftRequiredFields,
  clearDraftFieldError
} from '@/features/contract-creation/services/stairValidationService';
import {
  calculateSmartLongitudinalCutPlan,
  calculateSlabRemainingStones,
  hasLongitudinalGeometryChanged,
  hasSlabGeometryChanged
} from '@/features/contract-creation/services/remainingStoneService';
import {
  mergeEditedRemainingStoneState,
  resolveLongitudinalWidth,
  restoreRemainingStoneAfterChildRemoval
} from '@/features/contract-creation/utils/productConfigurationController';
import {
  CONTRACT_DRAFT_STORAGE_KEY,
  clampContractDraftStep,
  createContractAutosaveDraft,
  parseContractAutosaveDraft
} from '@/features/contract-creation/utils/contractDraftStorage';
import {
  getDeliverableProductEntries,
  getSchedulableServiceEntries
} from '@/features/contract-creation/utils/deliveryScheduleController';
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

const createEmptyStairDraft = (part: StairStepperPart): StairPartDraftV2 => ({
  lengthUnit: 'm',
  tools: [],
  finishingEnabled: false,
  useMandatory: part === 'riser' || part === 'landing',
  mandatoryPercentage: part === 'riser' || part === 'landing' ? 20 : null,
  description: ''
});

const getAttachedLayerIndicesForStairRow = (
  products: ContractProduct[],
  parentIndex: number
): number[] => {
  const parent = products[parentIndex];
  if (!isStairMainProduct(parent)) return [];

  const directMatches = products
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => isStairLayerProduct(product) && product.parentProductIndex === parentIndex)
    .map(({ index }) => index);

  if (directMatches.length > 0) return directMatches;

  const samePartMainRows = products.filter((product) =>
    isStairMainProduct(product) &&
    product.stairSystemId === parent.stairSystemId &&
    product.stairPartType === parent.stairPartType
  );

  if (samePartMainRows.length !== 1) return [];

  return products
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => {
      const layerInfo = (product.meta as any)?.layerInfo;
      return isStairLayerProduct(product) &&
        product.stairSystemId === parent.stairSystemId &&
        layerInfo?.parentPartType === parent.stairPartType;
    })
    .map(({ index }) => index);
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
  const [draftRestoredNotice, setDraftRestoredNotice] = useState(false);
  const [autosaveHydrated, setAutosaveHydrated] = useState(false);
  const [discountRanges, setDiscountRanges] = useState<DiscountRange[]>([]);
  const [discountPercentInput, setDiscountPercentInput] = useState<number>(0);
  const [serviceSearchTerm, setServiceSearchTerm] = useState('');
  const [serviceSourceType, setServiceSourceType] = useState<ContractServiceRowSourceType>('tool');
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
  const [useStairFlowV2, setUseStairFlowV2] = useState(true); // Feature flag - stays local
  const stairSystemV2 = useStairSystemV2({
    onError: (error) => setErrors({ stairSystem: error })
  });

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

  const customerOptions = useMemo(
    () => isCollaborationContract
      ? customers.filter((customer) => customer.customerType === 'Collaborative')
      : customers,
    [customers, isCollaborationContract]
  );

  const contractProductsTotal = useMemo(
    () => sumNumericValues(wizardData.products, (product) => product.totalPrice),
    [wizardData.products]
  );
  const standaloneServicesTotal = useMemo(
    () => sumNumericValues(wizardData.serviceRows || [], (row) => row.totalPrice),
    [wizardData.serviceRows]
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
  const grossContractTotal = contractProductsTotal + standaloneServicesTotal;
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
    standaloneServicesTotal,
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
    onSuccess: (message) => console.log(message)
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

  const getActiveDraft = (): [StairPartDraftV2, (d: StairPartDraftV2) => void] => {
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

    let piecesPerStone = 1;
    let leftoverWidthCm = 0;

    if (originalWidthCm > 0 && userWidthCm > 0) {
      piecesPerStone = Math.max(1, Math.floor(originalWidthCm / userWidthCm));
      leftoverWidthCm = Math.max(0, originalWidthCm - piecesPerStone * userWidthCm);
    }

    const baseStoneQuantity = piecesPerStone > 0 ? Math.ceil(quantity / piecesPerStone) : quantity;

    return {
      originalWidthCm,
      userWidthCm,
      quantity,
      piecesPerStone,
      leftoverWidthCm,
      baseStoneQuantity
    };
  };

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
    parentPartType: StairStepperPart
  ): ContractProduct | null => {
    if (!draft.layerEdges || !draft.layerWidthCm || !draft.numberOfLayersPerStair) {
      return null;
    }
    
    return sessionItems.find(item => {
      const itemIsLayer = ((item.meta as any)?.isLayer) || false;
      if (!itemIsLayer) return false;
      
      const itemLayerInfo = (item.meta as any)?.layerInfo;
      const itemLayerEdges = (item.meta as any)?.layerEdges;
      
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

    const getRemainingStoneUsageKeys = (stone: RemainingStone): string[] => {
      const keys = [stone.id, stone.sourceCutId].filter(Boolean);
      const layerSourceMatch = stone.id.match(/^used_layer_(.*)_\d+$/);
      if (layerSourceMatch?.[1]) {
        keys.push(layerSourceMatch[1]);
      }
      return keys;
    };
    
    // Collect from all non-layer products in session (including longitudinal and slab)
    sessionItems.forEach(item => {
      const itemIsLayer = ((item.meta as any)?.isLayer) || false;
      if (!itemIsLayer && item.remainingStones && item.remainingStones.length > 0) {
        // Get remaining stones that haven't been used yet
        const usedRemainingStones = item.usedRemainingStones || [];
        const usedRemainingStoneIds = new Set(usedRemainingStones.flatMap(getRemainingStoneUsageKeys));
        
        item.remainingStones.forEach(rs => {
          // Only include if not already used and usable after sanitization
          const sanitizedStone = sanitizeRemainingStoneEntry(rs);
          const isAlreadyUsed = getRemainingStoneUsageKeys(sanitizedStone).some(key => usedRemainingStoneIds.has(key));
          if (!isAlreadyUsed) {
            if (isUsableRemainingStone(sanitizedStone)) {
              allAvailable.push(sanitizedStone);
            }
          }
        });
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
   * Create a new layer product
   */

  const computeTotalsV2 = (
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
    cuttingCost: number;
    cuttingCostPerMeter: number;
    cuttingCostLongitudinal: number;
    cuttingCostPerMeterLongitudinal: number;
    cuttingCostCross: number;
    cuttingCostPerMeterCross: number;
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
      leftoverWidthCm
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
    let cuttingCostCross = 0;
    let cuttingCostPerMeterCross = 0;
    const needsWidthCut =
      originalWidthCm > 0 && userWidthCm > 0 && userWidthCm < originalWidthCm && actualLengthM > 0;
    const needsLengthCut =
      pricingLengthM > 0 && actualLengthM > 0 && pricingLengthM - actualLengthM > 0.0001 && userWidthCm > 0;

    if (needsWidthCut && stoneQuantityForPricing > 0) {
      cuttingCostPerMeterLongitudinal =
        (draft.stoneProduct as any)?.cuttingCostPerMeter ??
        getCuttingTypePricePerMeter('LONG') ??
        0;
      if (cuttingCostPerMeterLongitudinal > 0) {
        cuttingCostLongitudinal = cuttingCostPerMeterLongitudinal * actualLengthM * stoneQuantityForPricing;
      }
    }

    if (needsLengthCut && stoneQuantityForPricing > 0) {
      const crossRateFromConfig =
        (draft.stoneProduct as any)?.crossCuttingCostPerMeter ??
        getCuttingTypePricePerMeter('CROSS') ??
        getCuttingTypePricePerMeter('LONG') ??
        0;
      cuttingCostPerMeterCross = crossRateFromConfig;
      if (cuttingCostPerMeterCross > 0) {
        const widthInMeters = userWidthCm / 100;
        cuttingCostCross = cuttingCostPerMeterCross * widthInMeters * stoneQuantityForPricing;
      }
    }

    cuttingCost = cuttingCostLongitudinal + cuttingCostCross;
    cuttingCostPerMeter = cuttingCostLongitudinal > 0
      ? cuttingCostPerMeterLongitudinal
      : (cuttingCostCross > 0 ? cuttingCostPerMeterCross : 0);

    const shouldChargeCuttingCost = !(isMandatoryEnabled && mandatoryPercentageValue > 0);
    const billableCuttingCostLongitudinal = shouldChargeCuttingCost ? cuttingCostLongitudinal : 0;
    const billableCuttingCostCross = shouldChargeCuttingCost ? cuttingCostCross : 0;
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
      cuttingCost,
      cuttingCostPerMeter,
      cuttingCostLongitudinal,
      cuttingCostPerMeterLongitudinal,
      cuttingCostCross,
      cuttingCostPerMeterCross,
      baseMaterialPrice,
      billableCuttingCost,
      billableCuttingCostLongitudinal,
      billableCuttingCostCross,
      shouldChargeCuttingCost
    };
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

  const normalizeWizardFinishingProducts = (data: ContractWizardData): ContractWizardData => ({
    ...data,
    serviceRows: data.serviceRows || [],
    products: (data.products || []).map((product) => {
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
    })
  });

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
    setDraftRestoredNotice(false);
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
        cost: 0
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
      cost
    };
  };

  // Debounced stone search using products endpoint (acts as master data + price source)
  useEffect(() => {
    let active = true;
    const term = stairSystemV2.stoneSearchTerm?.trim();
    if (!useStairFlowV2) return;
    if (!term) {
      stairSystemV2.setStoneSearchResults([]);
      return;
    }
    stairSystemV2.setIsSearchingStones(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await salesAPI.getProducts({ search: term, limit: 10, contractType: 'stair' });
        if (!active) return;
        const rawItems: Product[] = (res?.data?.items || res?.data?.data || []) as Product[];
        
        const localFallbackProducts = products.filter(product =>
          productSupportsContractType(product, 'stair') &&
          productMatchesSearch(product, term, generateFullProductName(product))
        );
        const uniqueProducts = uniqueProductsByIdentity([...rawItems, ...localFallbackProducts]);
        const stairEligibleProducts = uniqueProducts.filter(product =>
          productSupportsContractType(product, 'stair')
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
  }, [stairSystemV2.stoneSearchTerm, useStairFlowV2, products]);

  useEffect(() => {
    let active = true;
    const term = stairSystemV2.layerStoneSearchTerm?.trim();
    if (!useStairFlowV2) return;
    if (!term) {
      stairSystemV2.setLayerStoneSearchResults([]);
      return;
    }
    stairSystemV2.setIsSearchingLayerStones(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await salesAPI.getProducts({ search: term, limit: 10, contractType: 'stair' });
        if (!active) return;
        const rawItems: Product[] = (res?.data?.items || res?.data?.data || []) as Product[];
        const localFallbackProducts = products.filter(product =>
          productSupportsContractType(product, 'stair') &&
          productMatchesSearch(product, term, generateFullProductName(product))
        );
        const stairEligible = uniqueProductsByIdentity([...rawItems, ...localFallbackProducts])
          .filter(product => productSupportsContractType(product, 'stair'));
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
  }, [stairSystemV2.layerStoneSearchTerm, useStairFlowV2, products]);

  // Debounced tools search
  useEffect(() => {
    let active = true;
    const term = stairSystemV2.toolsSearchTerm?.trim();
    if (!useStairFlowV2) return;
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
  }, [stairSystemV2.toolsSearchTerm, useStairFlowV2, capabilities.canLoadSubServices]);

  // Preload tools list once when modal flow is used
  useEffect(() => {
    if (!useStairFlowV2) return;
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
  }, [useStairFlowV2, capabilities.canLoadSubServices]);
  
  // Product modal state is now managed by useProductModal hook (see above)
  
  // SubService modal state is now provided by useSubServiceModal hook
  
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
      badgeClass: 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200',
      chipClass: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-200 border border-amber-200 dark:border-amber-800'
    },
    layer: {
      label: 'لایه',
      badgeClass: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200',
      chipClass: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-200 border border-purple-200 dark:border-purple-800'
    },
    cut: {
      label: 'برش',
      badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
      chipClass: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-800'
    },
    finishing: {
      label: 'پرداخت',
      badgeClass: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
      chipClass: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-200 border border-teal-200 dark:border-teal-700'
    }
  };

  const hasInvoiceData = wizardData.products.length > 0 || serviceEntries.length > 0;


  // Load data

  // Initialize product modal hook
  const productModal = useProductModal({
    useStairFlowV2,
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
    getEffectiveQuantity: productCalculations.getEffectiveQuantity
  });

  // Initialize sub-service modal hook
  const subServiceModal = useSubServiceModal({
    setErrors
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
  const showCADDesigner = productModal.showCADDesigner;
  const setShowCADDesigner = productModal.setShowCADDesigner;
  const showProductModal = productModal.showProductModal;
  const setShowProductModal = productModal.setShowProductModal;
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
  const calculateTreadMetrics = productCalculations.calculateTreadMetrics;
  const calculateRiserMetrics = productCalculations.calculateRiserMetrics;
  const calculateLandingMetrics = productCalculations.calculateLandingMetrics;
  const calculateNosingCuttingCost = productCalculations.calculateNosingCuttingCost;
  const calculateSlabMetrics = productCalculations.calculateSlabMetrics;
  const getSlabStandardDimensions = productCalculations.getSlabStandardDimensions;
  const determineSlabLineCutPlan = productCalculations.determineSlabLineCutPlan;
  const buildSlabCutDetails = productCalculations.buildSlabCutDetails;
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

  // Product filtering hook provides all filtered lists
  const productFiltering = useProductFiltering({
    customers: customerOptions,
    products,
    customerSearchTerm,
    productSearchTerm,
    treadProductSearchTerm,
    riserProductSearchTerm,
    landingProductSearchTerm,
    selectedProductTypeForAddition: wizardData.selectedProductTypeForAddition
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

    const savedPaymentModal = draft.productModal?.paymentEntryForm;
    if (savedPaymentModal) paymentHandlers.setPaymentEntryForm(savedPaymentModal as any);

    setShowProductModal(false);
    remainingStoneModal.setShowRemainingStoneModal(false);
    paymentHandlers.setShowPaymentEntryModal(false);
    setStateRestored(true);
    restorationAttempted.current = true;
    setDraftRestoredNotice(true);
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
        paymentEntryForm: paymentHandlers.paymentEntryForm
      },
      stairSystemV2: {
        draftTread: stairSystemV2.draftTread,
        draftRiser: stairSystemV2.draftRiser,
        draftLanding: stairSystemV2.draftLanding,
        stairActivePart: stairSystemV2.stairActivePart,
        stairSessionId: stairSystemV2.stairSessionId,
        stairSessionItems: stairSystemV2.stairSessionItems
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
    stairSystemV2.draftTread,
    stairSystemV2.draftRiser,
    stairSystemV2.draftLanding,
    stairSystemV2.stairActivePart,
    stairSystemV2.stairSessionId,
    stairSystemV2.stairSessionItems
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
    
    console.log('🔍 Contract wizard useEffect triggered:', {
      returnTo,
      step,
      currentStep,
      stateRestored
    });
    
    if (returnTo === 'contract' && step && !restorationAttempted.current) {
      // Restore wizard state from localStorage
      (async () => {
        const savedState = localStorage.getItem('contractWizardState');
        console.log('💾 Saved state from localStorage:', savedState);

        if (savedState) {
          try {
            const { currentStep: savedStep, wizardData: savedWizardData } = JSON.parse(savedState);
            console.log('🔄 Restoring wizard state:', {
              urlStep: step,
              savedStep,
              savedWizardData,
              currentStepBeforeRestore: currentStep
            });

            // Use the saved step instead of URL step parameter
            setCurrentStep(normalizeWizardStep(savedStep));
            setWizardData(normalizeWizardFinishingProducts(savedWizardData));
            setStateRestored(true);
            restorationAttempted.current = true;

            // Clear the saved state after successful restoration
            localStorage.removeItem('contractWizardState');

            // Refresh data to show newly created entities
            console.log('🔄 Refreshing data after successful creation...');
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

            console.log('✅ Wizard state restored successfully to step:', savedStep);
          } catch (error) {
            console.error('❌ Error restoring wizard state:', error);
            // If restoration fails, use URL step as fallback
            setCurrentStep(normalizeWizardStep(parseInt(step, 10)));
            setStateRestored(true);
            restorationAttempted.current = true;

            // Refresh data to show newly created entities
            console.log('🔄 Refreshing data after successful creation (fallback)...');
            await loadData();
            await generateContractNumber();
          }
        } else {
          // If no saved state, use URL step as fallback
          console.log('⚠️ No saved state found, using URL step:', step);
          setCurrentStep(normalizeWizardStep(parseInt(step, 10)));
          setStateRestored(true);
          restorationAttempted.current = true;

          // Refresh data to show newly created entities
          console.log('🔄 Refreshing data after successful creation (no saved state)...');
          await loadData();
          await generateContractNumber();
        }
      })().finally(() => setAutosaveHydrated(true));
    }
  }, []);


  // Debug effect to track currentStep changes
  useEffect(() => {
    console.log('📊 currentStep changed to:', currentStep);
  }, [currentStep]);


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
      pricePerSquareMeter: product ? (product.basePrice || (product as any).pricePerSquareMeter || 0) : null,
      thicknessCm: product ? (product.thicknessValue ?? null) : null
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
      pricePerSquareMeter: product.basePrice || 0
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
      if (useStairFlowV2) {
        const [currentDraft, setCurrentDraft] = getActiveDraft();
        const productLabel = product.namePersian || product.name || '';

        setCurrentDraft({
          ...currentDraft,
          stoneId: product.id,
          stoneLabel: productLabel,
          stoneProduct: product,
          pricePerSquareMeter: product.basePrice || 0,
          thicknessCm: product.thicknessValue || null
        });

        stairSystemV2.setStoneSearchTerm(productLabel);
        setProductConfig({
          productId: product.id,
          product,
          productType: 'stair'
        });
      } else {
        const stairConfig = initializeStairSystemConfig(product);
        setStairSystemConfig(stairConfig);

        const defaultConfig: Partial<ContractProduct> = {
          productId: product.id,
          product,
          productType: 'stair',
          stoneCode: product.code,
          stoneName: product.namePersian,
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
          lengthUnit: 'm',
          widthUnit: 'cm',
          isMandatory: false,
          mandatoryPercentage: 20,
          originalTotalPrice: 0,
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
        setProductConfig(defaultConfig);
        setTreadWidthUnit('m');
        setQuantityType('steps');
        setTreadExpanded(true);
        setRiserExpanded(true);
        setLandingExpanded(false);
        setTreadProductSearchTerm('');
        setRiserProductSearchTerm('');
        setLandingProductSearchTerm('');
      }
      return;
    }

    if (selectedProductType === 'slab') {
      const defaultStandardWidthCm = product.widthValue || 0;
      const defaultStandardLengthCm = (product as any)?.lengthValue || 300;
      const defaultOriginalLength = lengthUnit === 'm'
        ? defaultStandardLengthCm / 100
        : defaultStandardLengthCm;
      const slabProductName = generateSlabContractProductName(product);
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

    const defaultConfig: Partial<ContractProduct> = {
      productId: product.id,
      product,
      productType: 'longitudinal',
      stoneCode: product.code,
      stoneName: product.namePersian,
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
    const selectedProductType = rememberedType && productSupportsContractType(product, rememberedType)
      ? rememberedType
      : null;

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

  const handleV2ModalProductTypeChange = (type: ContractUsageType) => {
    if (isEditMode || !selectedProduct) return;
    if (type === 'stair') return;
    stairSystemV2.setStairSessionItems([]);
    stairSystemV2.setStairSessionId(null);
    setStairSystemConfig(null);
    initializeProductConfigForType(selectedProduct, type);
    setErrors({});
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
    
    console.log('🔄 Length Unit Conversion:', {
      from: lengthUnit,
      to: newUnit,
      original: currentLength,
      converted: convertedLength
    });
    
    setLengthUnit(newUnit);
    setProductConfig(prev => {
      const updatedConfig = { ...prev, length: convertedLength };
      // Trigger smart calculation with new unit
      const smartResult = handleSmartCalculation('length', convertedLength, updatedConfig, newUnit, widthUnit, getEffectiveQuantity());
      console.log('🔄 Length Unit Change Result:', {
        originalLength: currentLength,
        convertedLength,
        newUnit,
        smartResult,
        finalSquareMeters: smartResult.squareMeters
      });
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
    
    console.log('🔄 Width Unit Conversion:', {
      from: widthUnit,
      to: newUnit,
      original: currentWidth,
      converted: convertedWidth
    });
    
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
      console.log('🔄 Width Unit Change Result:', {
        originalWidth: currentWidth,
        convertedWidth,
        newUnit,
        smartResult,
        finalSquareMeters: smartResult.squareMeters
      });
      return {
        ...updatedConfig,
        length: smartResult.length,
        squareMeters: smartResult.squareMeters
      };
    });
    
    // Log stone cutting eligibility after unit change
    console.log('📏 Width Unit Changed:', {
      userWidth: convertedWidth,
      userWidthUnit: newUnit,
      userWidthInCm: newUnit === 'm' ? convertedWidth * 100 : convertedWidth
    });
  };

  // Remaining stone handlers are now provided by useRemainingStoneModal hook
  // Handle editing an existing product
  const handleEditProduct = (index: number) => {
    console.log('🔵 handleEditProduct called:', { index, totalProducts: wizardData.products.length });
    const product = wizardData.products[index];
    if (!product) {
      console.error('❌ Product not found at index:', index);
      return;
    }
    console.log('🔵 Product found:', { productType: product.productType, stairSystemId: product.stairSystemId });
    
    // Check if this is a stair system product
    if (product.productType === 'stair' && product.stairSystemId) {
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
      if (useStairFlowV2) {
        const clickedPartType: StairStepperPart =
          product.stairPartType === 'riser' || product.stairPartType === 'landing'
            ? product.stairPartType
            : 'tread';
        const scopedStairProducts = getStairRowWithAttachedLayers(wizardData.products, index);
        const clickedMainProduct = scopedStairProducts.find(isStairMainProduct) || product;

        // NEW V2 FLOW: Reconstruct only the clicked row and its attached layer.
        // Set session ID to existing stairSystemId
        stairSystemV2.setStairSessionId(product.stairSystemId);
        
        // Reconstruct session items from the clicked row scope only.
        stairSystemV2.setStairSessionItems([...scopedStairProducts]);
        
        // Helper function to convert ContractProduct to StairPartDraftV2
        const productToDraft = (p: ContractProduct, partType: StairStepperPart): StairPartDraftV2 => {
          const metaTools = (p.meta as any)?.tools || [];
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
          
          return {
            stoneId: p.productId,
            stoneLabel: p.stoneName,
            stoneProduct: p.product,
            pricePerSquareMeter: p.pricePerSquareMeter ?? p.unitPrice ?? p.product?.basePrice ?? 0,
            useMandatory: typeof p.isMandatory === 'boolean' ? p.isMandatory : undefined,
            mandatoryPercentage: p.isMandatory
              ? (p.mandatoryPercentage || 20)
              : (p.mandatoryPercentage ?? null),
            thicknessCm: p.diameterOrWidth,
            lengthValue: p.length,
            lengthUnit: p.lengthUnit || 'm', // Default to meters for length
            widthCm: p.width,
            quantity: p.quantity,
            squareMeters: p.squareMeters,
            tools: tools.map((t: any) => ({
              toolId: t.toolId,
              name: t.name,
              pricePerMeter: t.pricePerMeter,
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
            standardLengthValue: partType === 'riser'
              ? null
              : (p.standardLengthValue ?? (p.meta as any)?.stair?.standardLength?.value ?? null),
            standardLengthUnit: partType === 'riser'
              ? (p.lengthUnit || 'm')
              : ((p.standardLengthUnit as UnitType) ?? (p.meta as any)?.stair?.standardLength?.unit ?? (p.lengthUnit || 'm')),
            finishingEnabled: !!(p.finishingId || p.finishingCost || metaFinishing.id || metaFinishing.cost),
            finishingId: p.finishingId || metaFinishing.id || null,
            finishingLabel: p.finishingName || metaFinishing.name || null,
            finishingPricePerSquareMeter: p.finishingPricePerSquareMeter || p.finishingUnitPrice || metaFinishing.unitPrice || null,
            finishingUnitPrice: p.finishingUnitPrice || p.finishingPricePerSquareMeter || metaFinishing.unitPrice || null,
            finishingCalculationBase: p.finishingCalculationBase || metaFinishing.calculationBase || 'squareMeters',
            finishingQuantity: p.finishingQuantity || p.finishingSquareMeters || metaFinishing.quantity || null,
            description: p.description || ''
          };
        };
        
        // Helper function to find and merge layer info into draft
        const mergeLayerInfo = (draft: StairPartDraftV2, partType: 'tread' | 'riser' | 'landing'): StairPartDraftV2 => {
          // Find layer product for this part type
          const layerProduct = scopedStairProducts.find(p =>
            (p.meta as any)?.isLayer && 
            (p.meta as any)?.layerInfo?.parentPartType === partType
          );
          
          if (layerProduct) {
            const layerInfo = (layerProduct.meta as any)?.layerInfo;
            const layerTypeMeta = (layerProduct.meta as any)?.layerType;
            const layerAltStoneMeta = (layerProduct.meta as any)?.layerAltStone;
            return {
              ...draft,
              numberOfLayersPerStair: layerInfo?.numberOfLayersPerStair || null,
              layerWidthCm: layerProduct.width || null,
              layerEdges: ((layerProduct.meta as any)?.layerEdges) || undefined,
              layerTypeId: layerProduct.layerTypeId ?? layerTypeMeta?.id ?? null,
              layerTypeName: layerProduct.layerTypeName ?? layerTypeMeta?.name ?? null,
              layerTypePrice: layerProduct.layerTypePrice ?? layerTypeMeta?.pricePerLayer ?? null,
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
                : draft.pricePerSquareMeter,
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
          }
          return draft;
        };
        
        const baseDraft = productToDraft(clickedMainProduct, clickedPartType);
        const scopedDraft = layerManagement.normalizeLayerAltStoneSettings(mergeLayerInfo(baseDraft, clickedPartType));
        stairSystemV2.setDraftTread(clickedPartType === 'tread' ? scopedDraft : createEmptyStairDraft('tread'));
        stairSystemV2.setDraftRiser(clickedPartType === 'riser' ? scopedDraft : createEmptyStairDraft('riser'));
        stairSystemV2.setDraftLanding(clickedPartType === 'landing' ? scopedDraft : createEmptyStairDraft('landing'));
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
        setEditingProductIndex(index);
        setTouchedFields(new Set());
        setErrors({});
        setShowProductModal(true);
        
        console.log('✅ Stair V2 edit initialized:', {
          stairSystemId: product.stairSystemId,
          sessionItems: scopedStairProducts.length,
          clickedPartType,
          partsFound: {
            tread: clickedPartType === 'tread',
            riser: clickedPartType === 'riser',
            landing: clickedPartType === 'landing'
          }
        });
        
        return;
      }
      
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
      
      console.log('✅ Stair system edit initialized:', {
        stairSystemId: product.stairSystemId,
        numberOfSteps,
        quantityType,
        partsFound: {
          tread: !!treadProduct,
          riser: !!riserProduct,
          landing: !!landingProduct
        },
        config: editedStairConfig
      });
      
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
    setHasQuantityBeenInteracted((product.quantity || 0) > 1);
    
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
      // Preserve CAD Design if available
      cadDesign: product.cadDesign || null
    });
    
    // Set product type for wizard
    updateWizardData({ selectedProductTypeForAddition: normalizeContractProductType(product.productType) || 'longitudinal' });
    
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

    console.log('🎯 handleCreateFromRemainingStone called!');
    console.log('🔍 Source Product Debug:', {
      sourceProduct: sourceProduct,
      pricePerSquareMeter: sourceProduct.pricePerSquareMeter,
      isMandatory: sourceProduct.isMandatory,
      mandatoryPercentage: sourceProduct.mandatoryPercentage
    });
    
    remainingStoneModal.setSelectedRemainingStone(sanitizedRemainingStone);
    remainingStoneModal.setSelectedRemainingStoneSourceProduct(sourceProduct); // Store source product for later use
    
    // Find parent product index in wizardData.products for explicit parent-child relationship
    const parentProductIndex = wizardData.products.findIndex(
      p => p.stoneCode === sourceProduct.stoneCode && p.productId === sourceProduct.productId
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
    
    console.log('🔍 Default Config Created:', {
      defaultConfig: defaultConfig,
      pricePerSquareMeter: defaultConfig.pricePerSquareMeter
    });
    
    remainingStoneModal.setRemainingStoneConfig(defaultConfig);
    // Inherit unit information from source product
    remainingStoneModal.setRemainingStoneLengthUnit(sourceProduct.lengthUnit || 'm');
    remainingStoneModal.setRemainingStoneWidthUnit(sourceProduct.widthUnit || 'cm');
    remainingStoneModal.setRemainingStoneIsMandatory(sourceProduct.isMandatory || false);
    remainingStoneModal.setRemainingStoneMandatoryPercentage(sourceProduct.mandatoryPercentage || 20);
    
    // Initialize partitions array (start with one empty partition)
    remainingStoneModal.setPartitions([{
      id: `partition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      width: 0,
      length: 0,
      quantity: 1,
      squareMeters: 0
    }]);
    remainingStoneModal.setPartitionLengthUnit(sourceProduct.lengthUnit || 'm');
    remainingStoneModal.setPartitionWidthUnit(sourceProduct.widthUnit || 'cm');
    
    remainingStoneModal.setShowRemainingStoneModal(true);
  };

  const removeProductFromDeliveries = (deliveries: DeliverySchedule[], removedIndex: number): DeliverySchedule[] =>
    deliveries.map((delivery) => ({
      ...delivery,
      products: (delivery.products || [])
        .filter((item) => item.rowType === 'service' || item.productIndex !== removedIndex)
        .map((item) => (
          item.rowType !== 'service' && typeof item.productIndex === 'number' && item.productIndex > removedIndex
            ? { ...item, productIndex: item.productIndex - 1 }
            : item
        ))
    }));

  const handleDuplicateProduct = (index: number) => {
    const source = wizardData.products[index];
    if (!source) return;

    const cloneProduct = (product: ContractProduct, sourceIndex: number, stairSystemId?: string): ContractProduct => {
      const duplicate = JSON.parse(JSON.stringify(product)) as ContractProduct;
      if (stairSystemId) {
        duplicate.stairSystemId = stairSystemId;
      } else {
        delete duplicate.stairSystemId;
      }
      delete duplicate.parentProductIndex;
      duplicate.meta = {
        ...(duplicate.meta || {}),
        duplicatedFromProductIndex: sourceIndex,
        remainingSource: undefined
      };
      return duplicate;
    };

    const duplicateProducts = source.productType === 'stair' && source.stairSystemId
      ? (() => {
          const newStairSystemId = `stair_duplicate_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          return wizardData.products
            .map((product, productIndex) => ({ product, productIndex }))
            .filter(({ product }) => product.productType === 'stair' && product.stairSystemId === source.stairSystemId)
            .map(({ product, productIndex }) => cloneProduct(product, productIndex, newStairSystemId));
        })()
      : [cloneProduct(source, index, source.productType === 'stair' ? `stair_duplicate_${Date.now()}_${Math.random().toString(36).slice(2, 9)}` : undefined)];

    updateWizardData({
      products: [...wizardData.products, ...duplicateProducts]
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
    const productToRemove = wizardData.products[index];
    const remainingSourceMeta = productToRemove?.meta?.remainingSource;

    if (!remainingSourceMeta) {
      const newProducts = wizardData.products.filter((_, i) => i !== index);
      updateWizardData({
        products: newProducts,
        deliveries: removeProductFromDeliveries(wizardData.deliveries || [], index)
      });
      return;
    }

    const productsAfterRemoval = restoreRemainingStoneAfterChildRemoval(wizardData.products, index);
    const deliveriesAfterRemoval = removeProductFromDeliveries(wizardData.deliveries || [], index);
    updateWizardData({ products: productsAfterRemoval, deliveries: deliveriesAfterRemoval });
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
    selectProduct: handleProductSelection,
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

  const persistPrintableContractSnapshot = async (contractId: string) => {
    const contractStatus = wizardData.signature?.contractStatus;
    if (contractStatus && contractStatus !== 'DRAFT') {
      return;
    }

    const totalAmount = wizardData.payment.totalContractAmount ||
      sumNumericValues(wizardData.products, (product) => product.totalPrice) +
      sumNumericValues(wizardData.serviceRows || [], (row) => row.totalPrice);

    await salesAPI.updateContract(contractId, {
      content: generateContractHTML(wizardData),
      totalAmount,
      currency: wizardData.payment.currency || 'تومان',
      contractData: wizardData
    });
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
    try {
      await persistPrintableContractSnapshot(signatureContractId);
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
    try {
      await persistPrintableContractSnapshot(signatureContractId);
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
      await persistPrintableContractSnapshot(signatureContractId);
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
    console.log('🚀 handleAddProductToContract called!');
    console.log('🔍 Main Product Validation Debug:', {
      selectedProduct: selectedProduct,
      productConfig: productConfig,
      productType: productConfig.productType || wizardData.selectedProductTypeForAddition,
      hasLength: !!productConfig.length,
      hasWidth: !!productConfig.width,
      hasSquareMeters: !!productConfig.squareMeters,
      hasQuantity: !!productConfig.quantity,
      hasPricePerSquareMeter: !!productConfig.pricePerSquareMeter
    });
    
    if (!selectedProduct || !productConfig) {
      console.log('❌ Missing selectedProduct or productConfig');
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
    if (productType === 'stair') {
      // STAIR SYSTEM (دستگاه پله) VALIDATION AND CREATION
      if (!stairSystemConfig) {
        setErrors({ products: 'خطا در پیکربندی سیستم پله' });
        return;
      }
      
      // Validate that at least one part is selected
      const hasSelectedPart = stairSystemConfig.tread.isSelected || 
                              stairSystemConfig.riser.isSelected || 
                              stairSystemConfig.landing.isSelected;
      
      if (!hasSelectedPart) {
        setErrors({ products: 'لطفاً حداقل یکی از بخش‌های پله (کف پله، خیز پله، یا پاگرد) را انتخاب کنید' });
        return;
      }
      
      // Validate common configuration
      if (!stairSystemConfig.numberOfSteps || stairSystemConfig.numberOfSteps <= 0) {
        setErrors({ products: 'لطفاً تعداد پله را وارد کنید' });
        return;
      }
      
      if (stairSystemConfig.quantityType === 'staircases' && 
          (!stairSystemConfig.numberOfStaircases || stairSystemConfig.numberOfStaircases <= 0)) {
        setErrors({ products: 'لطفاً تعداد پله‌کان کامل را وارد کنید' });
        return;
      }
      
      // Generate unique stair system ID (only for new systems, preserve for edits)
      let stairSystemId: string;
      if (isEditMode && editingProductIndex !== null) {
        // Preserve existing stairSystemId when editing
        const editingProduct = wizardData.products[editingProductIndex];
        stairSystemId = editingProduct?.stairSystemId || `stair_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      } else {
        stairSystemId = `stair_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }
      
      const productsToAdd: ContractProduct[] = [];
      
      // Process Tread (کف پله)
      if (stairSystemConfig.tread.isSelected) {
        const tread = stairSystemConfig.tread;
        
        if (!tread.product || !tread.productId) {
          setErrors({ products: 'لطفاً محصول برای کف پله را انتخاب کنید' });
          return;
        }
        
        if (!tread.treadWidth || tread.treadWidth <= 0) {
          setErrors({ products: 'لطفاً طول پله را برای کف پله وارد کنید' });
          return;
        }
        
        if (!tread.treadDepth || tread.treadDepth <= 0) {
          setErrors({ products: 'لطفاً عرض پله را برای کف پله وارد کنید' });
          return;
        }
        
        if (!tread.quantity || tread.quantity <= 0) {
          setErrors({ products: 'لطفاً تعداد را برای کف پله وارد کنید' });
          return;
        }
        
        if (!tread.pricePerSquareMeter || tread.pricePerSquareMeter <= 0) {
          setErrors({ products: 'لطفاً فی هر متر مربع را برای کف پله وارد کنید' });
          return;
        }
        
        // Calculate tread metrics
        const treadMetrics = calculateTreadMetrics({
          treadWidth: tread.treadWidth,
          treadWidthUnit: tread.lengthUnit || 'm',
          treadDepth: tread.treadDepth,
          quantity: tread.quantity,
          quantityType: stairSystemConfig.quantityType,
          numberOfStaircases: stairSystemConfig.numberOfStaircases || 1
        });
        
        // Calculate nosing cost (only for tread)
        const nosingCost = calculateNosingCuttingCost({
          nosingType: tread.nosingType || 'none',
          treadWidth: tread.treadWidth,
          treadWidthUnit: tread.lengthUnit || 'm',
          numberOfSteps: tread.quantity,
          numberOfStaircases: stairSystemConfig.quantityType === 'staircases' ? (stairSystemConfig.numberOfStaircases || 1) : 1,
          quantityType: stairSystemConfig.quantityType
        });
        
        // Calculate pricing
        const basePrice = treadMetrics.totalArea * tread.pricePerSquareMeter;
        const mandatoryPrice = tread.isMandatory && tread.mandatoryPercentage
          ? basePrice * (tread.mandatoryPercentage / 100)
          : 0;
        const totalPrice = basePrice + mandatoryPrice + nosingCost.cuttingCost;
        
        productsToAdd.push({
          productId: tread.productId,
          product: tread.product,
          productType: 'stair',
          stairSystemId: stairSystemId,
          stairPartType: 'tread',
          stoneCode: tread.product.code,
          stoneName: generateCompactProductName(tread.product) || tread.product.namePersian,
          diameterOrWidth: tread.product.widthValue,
          length: 0,
          width: 0,
          quantity: treadMetrics.totalQuantity,
          squareMeters: treadMetrics.totalArea,
          pricePerSquareMeter: tread.pricePerSquareMeter,
          totalPrice: totalPrice,
          description: tread.description || `کف پله - دستگاه پله`,
          currency: 'تومان',
          lengthUnit: 'm',
          widthUnit: 'cm',
          isMandatory: tread.isMandatory,
          mandatoryPercentage: tread.mandatoryPercentage,
          originalTotalPrice: basePrice,
          isCut: false,
          cutType: null,
          originalWidth: tread.product.widthValue,
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
          usedSquareMetersForSubServices: 0,
          // Stair-specific fields
          treadWidth: tread.treadWidth,
          treadDepth: tread.treadDepth,
          numberOfSteps: stairSystemConfig.numberOfSteps,
          quantityType: stairSystemConfig.quantityType,
          nosingType: tread.nosingType,
          nosingOverhang: tread.nosingOverhang,
          nosingCuttingCost: nosingCost.cuttingCost,
          nosingCuttingCostPerMeter: nosingCost.cuttingCostPerMeter
        });
      }
      
      // Process Riser (خیز پله)
      if (stairSystemConfig.riser.isSelected) {
        const riser = stairSystemConfig.riser;
        
        if (!riser.product || !riser.productId) {
          setErrors({ products: 'لطفاً محصول برای خیز پله را انتخاب کنید' });
          return;
        }
        
        if (!riser.riserHeight || riser.riserHeight <= 0) {
          setErrors({ products: 'لطفاً ارتفاع قائمه را برای خیز پله وارد کنید' });
          return;
        }
        
        if (!riser.quantity || riser.quantity <= 0) {
          setErrors({ products: 'لطفاً تعداد را برای خیز پله وارد کنید' });
          return;
        }
        
        if (!riser.pricePerSquareMeter || riser.pricePerSquareMeter <= 0) {
          setErrors({ products: 'لطفاً فی هر متر مربع را برای خیز پله وارد کنید' });
          return;
        }
        
        // Get tread width for riser calculation (from tread part if available, otherwise use default)
        // CRITICAL: Riser calculation depends on tread width, so we need to validate it
        const treadWidth = stairSystemConfig.tread.treadWidth;
        const treadWidthUnit = stairSystemConfig.tread.lengthUnit || 'm';
        
        // Validate that tread width is available if riser is selected
        // If tread is not selected, we can't calculate riser area accurately
        if (!treadWidth || treadWidth <= 0) {
          // If tread is not selected, we can't use its width
          if (!stairSystemConfig.tread.isSelected) {
            setErrors({ products: 'برای محاسبه خیز پله، ابتدا باید کف پله را انتخاب کرده و طول پله را وارد کنید' });
            return;
          }
          // If tread is selected but width is not set
          setErrors({ products: 'لطفاً طول پله را برای کف پله وارد کنید تا بتوان خیز پله را محاسبه کرد' });
          return;
        }
        
        // Calculate riser metrics
        const riserMetrics = calculateRiserMetrics({
          treadWidth: treadWidth,
          treadWidthUnit: treadWidthUnit,
          riserHeight: riser.riserHeight,
          quantity: riser.quantity,
          quantityType: stairSystemConfig.quantityType,
          numberOfStaircases: stairSystemConfig.numberOfStaircases || 1
        });
        
        // Calculate pricing
        const basePrice = riserMetrics.totalArea * riser.pricePerSquareMeter;
        const mandatoryPrice = riser.isMandatory && riser.mandatoryPercentage
          ? basePrice * (riser.mandatoryPercentage / 100)
          : 0;
        const totalPrice = basePrice + mandatoryPrice;
        
        productsToAdd.push({
          productId: riser.productId,
          product: riser.product,
          productType: 'stair',
          stairSystemId: stairSystemId,
          stairPartType: 'riser',
          stoneCode: riser.product.code,
          stoneName: generateCompactProductName(riser.product) || riser.product.namePersian,
          diameterOrWidth: riser.product.widthValue,
          length: 0,
          width: 0,
          quantity: riserMetrics.totalQuantity,
          squareMeters: riserMetrics.totalArea,
          pricePerSquareMeter: riser.pricePerSquareMeter,
          totalPrice: totalPrice,
          description: riser.description || `خیز پله - دستگاه پله`,
          currency: 'تومان',
          lengthUnit: 'm',
          widthUnit: 'cm',
          isMandatory: riser.isMandatory,
          mandatoryPercentage: riser.mandatoryPercentage,
          originalTotalPrice: basePrice,
          isCut: false,
          cutType: null,
          originalWidth: riser.product.widthValue,
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
          usedSquareMetersForSubServices: 0,
          // Stair-specific fields
          riserHeight: riser.riserHeight,
          numberOfSteps: stairSystemConfig.numberOfSteps,
          quantityType: stairSystemConfig.quantityType
        });
      }
      
      // Process Landing (پاگرد)
      if (stairSystemConfig.landing.isSelected) {
        const landing = stairSystemConfig.landing;
        
        if (!landing.product || !landing.productId) {
          setErrors({ products: 'لطفاً محصول برای پاگرد را انتخاب کنید' });
          return;
        }
        
        if (!landing.numberOfLandings || landing.numberOfLandings <= 0) {
          setErrors({ products: 'لطفاً تعداد پاگرد را وارد کنید' });
          return;
        }
        
        if (!landing.landingWidth || landing.landingWidth <= 0) {
          setErrors({ products: 'لطفاً عرض پاگرد را وارد کنید' });
          return;
        }
        
        if (!landing.landingDepth || landing.landingDepth <= 0) {
          setErrors({ products: 'لطفاً عمق پاگرد را وارد کنید' });
          return;
        }
        
        if (!landing.pricePerSquareMeter || landing.pricePerSquareMeter <= 0) {
          setErrors({ products: 'لطفاً فی هر متر مربع را برای پاگرد وارد کنید' });
          return;
        }
        
        // Calculate landing metrics
        const landingMetrics = calculateLandingMetrics({
          landingWidth: landing.landingWidth,
          landingDepth: landing.landingDepth,
          numberOfLandings: landing.numberOfLandings,
          quantityType: stairSystemConfig.quantityType,
          numberOfStaircases: stairSystemConfig.numberOfStaircases || 1
        });
        
        // Calculate pricing
        const basePrice = landingMetrics.totalArea * landing.pricePerSquareMeter;
        const mandatoryPrice = landing.isMandatory && landing.mandatoryPercentage
          ? basePrice * (landing.mandatoryPercentage / 100)
          : 0;
        const totalPrice = basePrice + mandatoryPrice;
        
        productsToAdd.push({
          productId: landing.productId,
          product: landing.product,
          productType: 'stair',
          stairSystemId: stairSystemId,
          stairPartType: 'landing',
          stoneCode: landing.product.code,
          stoneName: generateCompactProductName(landing.product) || landing.product.namePersian,
          diameterOrWidth: landing.product.widthValue,
          length: 0,
          width: 0,
          quantity: landingMetrics.totalQuantity,
          squareMeters: landingMetrics.totalArea,
          pricePerSquareMeter: landing.pricePerSquareMeter,
          totalPrice: totalPrice,
          description: landing.description || `پاگرد - دستگاه پله`,
          currency: 'تومان',
          lengthUnit: 'm',
          widthUnit: 'cm',
          isMandatory: landing.isMandatory,
          mandatoryPercentage: landing.mandatoryPercentage,
          originalTotalPrice: basePrice,
          isCut: false,
          cutType: null,
          originalWidth: landing.product.widthValue,
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
          usedSquareMetersForSubServices: 0,
          // Stair-specific fields
          landingWidth: landing.landingWidth,
          landingDepth: landing.landingDepth,
          numberOfLandings: landing.numberOfLandings,
          quantityType: stairSystemConfig.quantityType
        });
      }
      
      // Handle editing vs adding
      if (isEditMode && editingProductIndex !== null) {
        // Editing mode: Remove old stair system products and add new ones
        const editingProduct = wizardData.products[editingProductIndex];
        const oldStairSystemId = editingProduct?.stairSystemId;
        
        // Remove all products with the same stairSystemId
        const updatedProducts = wizardData.products.filter(p => 
          !(p.productType === 'stair' && p.stairSystemId === oldStairSystemId)
        );
        
        // Add updated products with the same stairSystemId (preserve ID for grouping)
        productsToAdd.forEach(p => {
          p.stairSystemId = oldStairSystemId; // Preserve the original stairSystemId
        });
        
        updateWizardData({
          products: [...updatedProducts, ...productsToAdd],
          selectedProductTypeForAddition: productType
        });
        
        console.log('✅ Successfully updated stair system in contract!', {
          stairSystemId: oldStairSystemId,
          partsUpdated: productsToAdd.length,
          parts: productsToAdd.map(p => p.stairPartType)
        });
      } else {
        // Adding new stair system
        updateWizardData({
          products: [...wizardData.products, ...productsToAdd],
          selectedProductTypeForAddition: productType
        });
        
        console.log('✅ Successfully added stair system to contract!', {
          stairSystemId,
          partsAdded: productsToAdd.length,
          parts: productsToAdd.map(p => p.stairPartType)
        });
      }
      
      // Close modal and reset state
      setShowProductModal(false);
      setSelectedProduct(null);
      setProductConfig({});
      setStairSystemConfig(null);
      setTreadWidthUnit('m');
      setQuantityType('steps');
      setIsMandatory(false);
      setMandatoryPercentage(20);
      setIsEditMode(false);
      setEditingProductIndex(null);
      setTouchedFields(new Set());
      clearProductAdditionSearches();
      setErrors({});
      
      return;
    }
    
    // SLAB STONE VALIDATION AND CALCULATION
    if (productType === 'slab') {
      // Validate required fields - at least one of length/width or squareMeters must be provided
      const hasDimensions = (productConfig.length && productConfig.width) || productConfig.squareMeters;
      const hasRequiredFields = productConfig.quantity && productConfig.pricePerSquareMeter;
      
      if (!hasDimensions) {
        setErrors({ products: 'لطفاً طول و عرض یا متر مربع را وارد کنید' });
        return;
      }
      
      if (!hasRequiredFields) {
        if (!productConfig.quantity) {
          setErrors({ products: 'لطفاً تعداد را وارد کنید' });
        } else if (!productConfig.pricePerSquareMeter) {
          setErrors({ products: 'لطفاً فی هر متر مربع را وارد کنید' });
        } else {
          setErrors({ products: 'لطفاً تعداد و فی هر متر مربع را وارد کنید' });
        }
        return;
      }
      
      // Validate standard dimensions
      const standardDimensions = productConfig.slabStandardDimensions || [];
      const wantedQuantity = productConfig.quantity || 0;
      const totalStandardQuantity = standardDimensions.reduce((sum, entry) => sum + (entry.quantity || 0), 0);
      
      if (standardDimensions.length === 0) {
        setErrors({ products: 'لطفاً حداقل یک ابعاد استاندارد را اضافه کنید' });
          return;
      }
      
      if (totalStandardQuantity !== wantedQuantity) {
          setErrors({ 
          products: `مجموع تعداد ابعاد استاندارد (${totalStandardQuantity}) باید برابر با تعداد درخواستی (${wantedQuantity}) باشد` 
          });
          return;
      }
      
      // Validate that standard dimensions are >= wanted dimensions
      const userWidthInCm = productConfig.width 
        ? (widthUnit === 'm' ? productConfig.width * 100 : productConfig.width)
        : 0;
      const userLengthInCm = productConfig.length 
        ? (lengthUnit === 'm' ? productConfig.length * 100 : productConfig.length)
        : 0;
      
      for (const entry of standardDimensions) {
        if (userLengthInCm > 0 && entry.standardLengthCm < userLengthInCm) {
          setErrors({ 
            products: `طول استاندارد (${entry.standardLengthCm}cm) نمی‌تواند کمتر از طول درخواستی (${userLengthInCm}cm) باشد` 
          });
          return;
        }
        if (userWidthInCm > 0 && entry.standardWidthCm < userWidthInCm) {
          setErrors({ 
            products: `عرض استاندارد (${entry.standardWidthCm}cm) نمی‌تواند کمتر از عرض درخواستی (${userWidthInCm}cm) باشد` 
          });
          return;
        }
        if (entry.quantity <= 0) {
          setErrors({ products: 'تعداد هر ابعاد استاندارد باید بیشتر از صفر باشد' });
          return;
        }
      }
      
      // For backward compatibility, use first entry as default if needed
      const { standardLengthCm, standardWidthCm } = getSlabStandardDimensions();
      const originalWidthCm = standardWidthCm || selectedProduct.widthValue || 0;
      const originalLengthCm = standardLengthCm || (selectedProduct as any)?.lengthValue || 300;
      const originalWidthInCurrentUnit = widthUnit === 'm' ? originalWidthCm / 100 : originalWidthCm;
      const originalLengthInCurrentUnit = lengthUnit === 'm' ? originalLengthCm / 100 : originalLengthCm;
      
      // Determine if cuts are needed (2D: longitudinal + cross)
      
      const needsLongitudinalCut = userWidthInCm > 0 && userWidthInCm < originalWidthCm && originalWidthCm > 0;
      const needsCrossCut = userLengthInCm > 0 && userLengthInCm < originalLengthCm && originalLengthCm > 0;
      const sawKerfEnabled = !!productConfig.sawKerfEnabled;
      const sawKerfCm = sawKerfEnabled ? (productConfig.sawKerfCm || SAW_KERF_CM) : null;
      const consumedWidthForPricingCm = sawKerfEnabled && needsLongitudinalCut
        ? userWidthInCm + (sawKerfCm || 0)
        : userWidthInCm;
      const consumedLengthForPricingCm = sawKerfEnabled && needsCrossCut
        ? userLengthInCm + (sawKerfCm || 0)
        : userLengthInCm;
      
      // Automatically fetch cutting costs if cuts should be applied
      let cuttingCostPerMeterLongitudinal = 0;
      let cuttingCostPerMeterCross = 0;
      
      if (needsLongitudinalCut) {
        cuttingCostPerMeterLongitudinal = getCuttingTypePricePerMeter('LONG') || 0;
      }
      if (needsCrossCut) {
        cuttingCostPerMeterCross = getCuttingTypePricePerMeter('CROSS') || getCuttingTypePricePerMeter('LONG') || 0;
      }
      
      const slabCuttingMode = productConfig.slabCuttingMode || 'lineBased';
      const slabCuttingPricePerSquareMeter = productConfig.slabCuttingPricePerSquareMeter || 0;
      
      // Calculate metrics - use effective quantity
      const effectiveQuantity = getEffectiveQuantity();
      
      // For line-based cutting, we need to calculate line plan for each standard dimension entry
      // For now, use the first entry for line plan calculation (can be enhanced later)
      const firstStandardEntry = standardDimensions[0];
      const linePlanStandardLengthCm = firstStandardEntry?.standardLengthCm || originalLengthCm;
      const linePlanStandardWidthCm = firstStandardEntry?.standardWidthCm || originalWidthCm;
      const linePlan = determineSlabLineCutPlan({
        requestedLengthCm: userLengthInCm,
        requestedWidthCm: userWidthInCm,
        standardLengthCm: linePlanStandardLengthCm,
        standardWidthCm: linePlanStandardWidthCm
      });
      
      const calculated = calculateSlabMetrics({
        length: productConfig.length,
        width: productConfig.width,
        quantity: effectiveQuantity,
        squareMeters: productConfig.squareMeters,
        pricePerSquareMeter: productConfig.pricePerSquareMeter,
        lengthUnit: lengthUnit,
        widthUnit: widthUnit,
        isMandatory: false, // Slab stones don't use mandatory pricing
        mandatoryPercentage: 0, // Slab stones don't use mandatory pricing
        originalLength: originalLengthInCurrentUnit,
        originalWidth: originalWidthInCurrentUnit,
        standardDimensions: standardDimensions,
        cuttingCostPerMeterLongitudinal: cuttingCostPerMeterLongitudinal,
        cuttingCostPerMeterCross: cuttingCostPerMeterCross,
        slabCuttingMode,
        slabCuttingPricePerSquareMeter,
        lineCutLongitudinalMeters: linePlan.longitudinalMeters,
        lineCutCrossMeters: linePlan.crossMeters
      });
      
      // Calculate برش قائم (vertical edge cuts) cost
      // IMPORTANT: برش قائم is calculated for each standard dimension entry using its own dimensions and quantity
      // This is because برش قائم happens on the standard stones BEFORE they are cut to desired dimensions
      const verticalCutSides = productConfig.slabVerticalCutSides || {
        top: true,
        bottom: true,
        left: true,
        right: true
      };
      const verticalCutCostPerMeter = getCuttingTypePricePerMeter('VERTICAL') || getCuttingTypePricePerMeter('LONG') || 0;
      
      const allCutDetails: StoneCut[] = buildSlabCutDetails({
        requestedLengthCm: userLengthInCm,
        requestedWidthCm: userWidthInCm,
        standardDimensions,
        slabCuttingMode,
        cuttingCostPerMeterLongitudinal,
        cuttingCostPerMeterCross,
        verticalCutSides,
        verticalCutCostPerMeter
      });
      const lineCuttingCost = slabCuttingMode === 'lineBased'
        ? allCutDetails
            .filter((cut) => cut.type !== 'vertical')
            .reduce((sum, cut) => sum + (cut.cost ?? cut.cuttingCost ?? 0), 0)
        : calculated.cuttingCost;
      const totalVerticalCutCost = allCutDetails
        .filter((cut) => cut.type === 'vertical')
        .reduce((sum, cut) => sum + (cut.cost ?? cut.cuttingCost ?? 0), 0);
      const finalTotalCuttingCost = lineCuttingCost + totalVerticalCutCost;
      
      // Create a combined slab cutting result
      const slabRemaining = calculateSlabRemainingStones({
        requestedWidthCm: userWidthInCm,
        requestedLengthCm: userLengthInCm,
        standardDimensions,
        sawKerfEnabled,
        sawKerfCm
      });

      const slabCutting = {
        needsLongitudinalCut,
        needsCrossCut,
        remainingPieces: slabRemaining.remainingStones,
        cutDetails: allCutDetails,
        cuttingCost: finalTotalCuttingCost // Include vertical cut cost
      };
      
      const lineBasedDescription = slabCutting.needsLongitudinalCut && slabCutting.needsCrossCut
        ? `برش طولی و عرضی (طول: ${originalLengthCm}cm → ${userLengthInCm}cm، عرض: ${originalWidthCm}cm → ${userWidthInCm}cm)`
        : (slabCutting.needsLongitudinalCut 
          ? `برش طولی (${originalWidthCm}cm → ${userWidthInCm}cm)`
          : (slabCutting.needsCrossCut 
            ? `برش کله بر (${originalLengthCm}cm → ${userLengthInCm}cm)`
            : ''));
      const perSquareMeterDescription = slabCuttingMode === 'perSquareMeter' && slabCuttingPricePerSquareMeter > 0
        ? `برش بر متر مربع (${formatSquareMeters(calculated.squareMeters || 0)} × ${formatPrice(slabCuttingPricePerSquareMeter, 'تومان')})`
        : 'بر اساس متر مربع';
      
      const finishingEnabled = !!(productConfig as any).finishingEnabled;
      const selectedFinishing = finishingEnabled && productConfig.finishingId
        ? stoneFinishings.find(option => option.id === productConfig.finishingId)
        : undefined;
      const finishingSnapshot = resolveFinishingSnapshot({
        enabled: finishingEnabled,
        selectedFinishing,
        config: productConfig,
        productType: 'slab',
        length: calculated.length,
        lengthUnit,
        quantity: effectiveQuantity,
        squareMeters: calculated.squareMeters
      });
      const finishingPricePerSquareMeter = finishingSnapshot.unitPrice;
      const finishingSquareMeters = finishingSnapshot.calculationBase === 'squareMeters' ? finishingSnapshot.quantity || 0 : 0;
      const finishingCost = finishingSnapshot.cost;

      const previousSlabProduct =
        isEditMode && editingProductIndex !== null ? wizardData.products[editingProductIndex] : null;
      const slabGeometryChanged = hasSlabGeometryChanged({
        previousProduct: previousSlabProduct
          ? {
              width: previousSlabProduct.width,
              widthUnit: previousSlabProduct.widthUnit as 'cm' | 'm',
              length: previousSlabProduct.length,
              lengthUnit: previousSlabProduct.lengthUnit as 'cm' | 'm',
              quantity: previousSlabProduct.quantity,
              slabStandardDimensions: previousSlabProduct.slabStandardDimensions || []
            }
          : null,
        nextWidthValueCm: userWidthInCm,
        nextLengthValueCm: userLengthInCm,
        nextQuantity: effectiveQuantity,
        nextStandardDimensions: standardDimensions
      });
      const computedSlabRemainingStones =
        isEditMode && !slabGeometryChanged
          ? (productConfig.remainingStones || previousSlabProduct?.remainingStones || [])
          : slabCutting.remainingPieces;
      const resetSlabRemainingUsage = isEditMode && slabGeometryChanged;
      const slabConsumedAreaSqm = sawKerfEnabled && (needsLongitudinalCut || needsCrossCut)
        ? (consumedWidthForPricingCm * consumedLengthForPricingCm * effectiveQuantity) / 10000
        : calculated.squareMeters;
      const slabMaterialTotalPrice = slabConsumedAreaSqm * (productConfig.pricePerSquareMeter || 0);
      const slabBaseMaterialPrice = sawKerfEnabled ? slabMaterialTotalPrice : calculated.originalTotalPrice;

      // Create final product configuration for slab stone
      const finalProduct: ContractProduct = {
        productId: selectedProduct.id,
        product: selectedProduct,
        productType: 'slab',
        stoneCode: productConfig.stoneCode || selectedProduct.code,
        stoneName: generateSlabContractProductName(selectedProduct),
        diameterOrWidth: productConfig.diameterOrWidth || selectedProduct.widthValue,
        length: calculated.length,
        width: calculated.width,
        quantity: effectiveQuantity,
        squareMeters: calculated.squareMeters,
        pricePerSquareMeter: productConfig.pricePerSquareMeter || 0,
        totalPrice: slabBaseMaterialPrice + finalTotalCuttingCost,
        description: productConfig.description || '',
        images: Array.isArray(productConfig.images) ? [...productConfig.images] : [...(selectedProduct.images || [])],
        sawKerfEnabled,
        sawKerfCm,
        finishingId: finishingEnabled ? (productConfig.finishingId || null) : null,
        finishingName: finishingEnabled
          ? (productConfig.finishingName || selectedFinishing?.namePersian || selectedFinishing?.name || null)
          : null,
        finishingPricePerSquareMeter: finishingEnabled ? finishingPricePerSquareMeter : null,
        finishingUnitPrice: finishingEnabled ? finishingSnapshot.unitPrice : null,
        finishingCalculationBase: finishingEnabled ? finishingSnapshot.calculationBase : null,
        finishingQuantity: finishingEnabled ? finishingSnapshot.quantity : null,
        finishingCost: finishingEnabled ? finishingCost : null,
        finishingSquareMeters: finishingEnabled && finishingCost > 0 ? finishingSquareMeters : null,
        currency: 'تومان',
        lengthUnit: lengthUnit,
        widthUnit: widthUnit,
        isMandatory: false, // Slab stones don't use mandatory pricing
        mandatoryPercentage: 0, // Slab stones don't use mandatory pricing
        originalTotalPrice: slabBaseMaterialPrice,
        // Slab cutting fields (2D)
        isCut: slabCutting.needsLongitudinalCut || slabCutting.needsCrossCut,
        cutType: slabCutting.needsLongitudinalCut && slabCutting.needsCrossCut ? 'cross' : (slabCutting.needsLongitudinalCut ? 'longitudinal' : null),
        originalWidth: originalWidthCm,
        originalLength: originalLengthInCurrentUnit,
        cuttingCost: slabCutting.cuttingCost || calculated.cuttingCost, // Use calculated cutting cost from all entries (includes برش قائم)
        cuttingCostPerMeter: slabCuttingMode === 'lineBased'
          ? (cuttingCostPerMeterLongitudinal || cuttingCostPerMeterCross || 0)
          : 0,
        cutDescription: slabCuttingMode === 'lineBased' ? lineBasedDescription : perSquareMeterDescription,
        // برش قائم fields
        slabVerticalCutSides: verticalCutSides,
        slabVerticalCutCost: totalVerticalCutCost,
        slabVerticalCutCostPerMeter: verticalCutCostPerMeter,
        remainingStones: computedSlabRemainingStones,
        cutDetails: (isEditMode && productConfig.cutDetails) ? productConfig.cutDetails : slabCutting.cutDetails,
        usedRemainingStones: resetSlabRemainingUsage ? [] : ((isEditMode && productConfig.usedRemainingStones) ? productConfig.usedRemainingStones : []),
        totalUsedRemainingWidth: resetSlabRemainingUsage ? 0 : ((isEditMode && productConfig.totalUsedRemainingWidth) ? productConfig.totalUsedRemainingWidth : 0),
        totalUsedRemainingLength: resetSlabRemainingUsage ? 0 : ((isEditMode && productConfig.totalUsedRemainingLength) ? productConfig.totalUsedRemainingLength : 0),
        appliedSubServices: (isEditMode && productConfig.appliedSubServices) ? productConfig.appliedSubServices : [],
        totalSubServiceCost: (isEditMode && productConfig.totalSubServiceCost !== undefined) ? productConfig.totalSubServiceCost : 0,
        usedLengthForSubServices: (isEditMode && productConfig.usedLengthForSubServices !== undefined) ? productConfig.usedLengthForSubServices : 0,
        usedSquareMetersForSubServices: (isEditMode && productConfig.usedSquareMetersForSubServices !== undefined) ? productConfig.usedSquareMetersForSubServices : 0,
        // Legacy single standard dimension fields (for backward compatibility)
        slabStandardLengthCm: originalLengthCm,
        slabStandardWidthCm: originalWidthCm,
        // New multiple standard dimensions support
        slabStandardDimensions: standardDimensions,
        slabCuttingMode,
        slabCuttingPricePerSquareMeter: slabCuttingMode === 'perSquareMeter' ? slabCuttingPricePerSquareMeter : null,
        slabLineCuttingStrategy: linePlan.axisUsingStandard,
        slabLineCuttingLongitudinalMeters: linePlan.longitudinalMeters,
        slabLineCuttingCrossMeters: linePlan.crossMeters,
        // CAD Design (if available)
        cadDesign: productConfig.cadDesign || null,
        meta: {
          sawKerf: sawKerfEnabled
            ? {
                enabled: true,
                cm: sawKerfCm,
                consumedWidthCm: consumedWidthForPricingCm,
                consumedLengthCm: consumedLengthForPricingCm,
                consumedAreaSqm: slabConsumedAreaSqm
              }
            : undefined,
          finishing: finishingEnabled && finishingCost > 0
            ? {
                id: productConfig.finishingId || null,
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
      
      // Add SubService costs to totalPrice if they exist
      const existingSubServiceCost = (isEditMode && productConfig.totalSubServiceCost) ? productConfig.totalSubServiceCost : 0;
      finalProduct.totalPrice = slabBaseMaterialPrice + finalTotalCuttingCost + existingSubServiceCost + finishingCost;
      
      // Add to contract or update existing product
      if (isEditMode && editingProductIndex !== null) {
        const updatedProducts = [...wizardData.products];
        updatedProducts[editingProductIndex] = finalProduct;
        updateWizardData({ products: updatedProducts, selectedProductTypeForAddition: productType });
      } else {
        updateWizardData({ products: [...wizardData.products, finalProduct], selectedProductTypeForAddition: productType });
      }
      
      console.log('✅ Successfully added slab product to contract!', { finalProduct });
      
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
      setTouchedFields(new Set());
      clearProductAdditionSearches();
      setErrors({});
      
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
    const hasDimensions = (productConfig.length && productConfig.width) || productConfig.squareMeters;
    const hasRequiredFields = productConfig.quantity && productConfig.pricePerSquareMeter;
    
    console.log('🔍 Main Product Validation Results:', {
      hasDimensions,
      hasRequiredFields,
      length: productConfig.length,
      width: productConfig.width,
      squareMeters: productConfig.squareMeters,
      quantity: productConfig.quantity,
      pricePerSquareMeter: productConfig.pricePerSquareMeter
    });
    
    if (!hasDimensions) {
      console.log('❌ Missing dimensions');
      setErrors({ products: 'لطفاً طول و عرض یا متر مربع را وارد کنید' });
      return;
    }
    
    if (!hasRequiredFields) {
      console.log('❌ Missing required fields - quantity:', productConfig.quantity, 'pricePerSquareMeter:', productConfig.pricePerSquareMeter);
      
      // Provide more specific error messages
      if (!productConfig.quantity) {
        setErrors({ products: 'لطفاً تعداد را وارد کنید' });
      } else if (!productConfig.pricePerSquareMeter) {
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
      console.log('🔧 Auto-fetched cutting cost per meter before calculation:', cuttingCostPerMeterForCalc);
    }
    
    // Calculate metrics - use effective quantity (default to 1 if not interacted)
    const effectiveQuantity = getEffectiveQuantity();
    const calculated = calculateStoneMetrics({
      length: productConfig.length,
      width: productConfig.width,
      quantity: effectiveQuantity,
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
    
    console.log('🔍 Auto Cut Selection Logic:', {
      userEnteredWidth,
      originalWidth,
      userEnteredWidthInCm,
      shouldAutoSelectLongitudinalCut,
      comparison: `${userEnteredWidthInCm} < ${originalWidth} = ${userEnteredWidthInCm < originalWidth}`,
      cuttingCostPerMeterForCalc,
      calculatedCuttingCost: calculated.cuttingCost
    });
    
    const finishingEnabled = !!(productConfig as any).finishingEnabled;
    const selectedFinishing = finishingEnabled && productConfig.finishingId
      ? stoneFinishings.find(option => option.id === productConfig.finishingId)
      : undefined;
    const finishingSnapshot = resolveFinishingSnapshot({
      enabled: finishingEnabled,
      selectedFinishing,
      config: productConfig,
      productType: 'longitudinal',
      length: calculated.length,
      lengthUnit,
      quantity: effectiveQuantity,
      squareMeters: calculated.squareMeters
    });
    const finishingPricePerSquareMeter = finishingSnapshot.unitPrice;
    const finishingSquareMeters = finishingSnapshot.calculationBase === 'squareMeters' ? finishingSnapshot.quantity || 0 : 0;
    const finishingCost = finishingSnapshot.cost;

    // Use cutting cost from calculated result (which already includes the auto-fetched price if applicable)
    const finalCuttingCost = calculated.cuttingCost || 0;
    const finalCuttingCostPerMeter = cuttingCostPerMeterForCalc;
    const sawKerfEnabled = !!productConfig.sawKerfEnabled && userEnteredWidthInCm > 0 && userEnteredWidthInCm < originalWidth;
    const sawKerfCm = sawKerfEnabled ? (productConfig.sawKerfCm || SAW_KERF_CM) : null;
    const smartCutPlan = calculateSmartLongitudinalCutPlan({
      originalWidthCm: originalWidth,
      enteredWidth: userEnteredWidth,
      enteredWidthUnit: widthUnit as 'cm' | 'm',
      enteredLength: calculated.length,
      enteredLengthUnit: lengthUnit as 'cm' | 'm',
      quantity: effectiveQuantity,
      longitudinalRatePerMeter: finalCuttingCostPerMeter,
      crossRatePerMeter: getCuttingTypePricePerMeter('CROSS') || 0,
      sawKerfEnabled,
      sawKerfCm
    });
    const shouldCutByGeometry = smartCutPlan.enabled;
    const previousLongitudinalProduct =
      isEditMode && editingProductIndex !== null ? wizardData.products[editingProductIndex] : null;
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
      nextQuantity: effectiveQuantity
    });
    const remainingStoneEditState = mergeEditedRemainingStoneState({
      geometryChanged: !!(isEditMode && longitudinalGeometryChanged),
      nextAvailableRemainingStones: smartCutPlan.remainingStones,
      previousProduct: previousLongitudinalProduct
    });
    const missingCuttingRateWarning = shouldCutByGeometry && finalCuttingCostPerMeter <= 0;
    
    // Create final product configuration for longitudinal stone
    const finalProduct: ContractProduct = {
      productId: selectedProduct.id,
      product: selectedProduct,
      productType: 'longitudinal',
      stoneCode: productConfig.stoneCode || selectedProduct.code,
      stoneName: productConfig.stoneName || selectedProduct.namePersian,
      diameterOrWidth: productConfig.diameterOrWidth || selectedProduct.widthValue,
      length: calculated.length,
      width: calculated.width,
      quantity: effectiveQuantity,
      squareMeters: smartCutPlan.enabled ? smartCutPlan.requestedAreaSqm : calculated.squareMeters,
      pricePerSquareMeter: productConfig.pricePerSquareMeter || 0,
      totalPrice: smartCutPlan.enabled
        ? smartCutPlan.consumedAreaSqm * (productConfig.pricePerSquareMeter || 0) * (isMandatory && mandatoryPercentage > 0 ? (1 + mandatoryPercentage / 100) : 1)
        : calculated.totalPrice,
      description: productConfig.description || '',
      images: Array.isArray(productConfig.images) ? [...productConfig.images] : [...(selectedProduct.images || [])],
      sawKerfEnabled,
      sawKerfCm,
      finishingId: finishingEnabled ? (productConfig.finishingId || null) : null,
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
      isMandatory: isMandatory,
      mandatoryPercentage: mandatoryPercentage,
      originalTotalPrice: smartCutPlan.enabled
        ? smartCutPlan.consumedAreaSqm * (productConfig.pricePerSquareMeter || 0)
        : calculated.originalTotalPrice,
      // Stone cutting is geometry-driven; pricing can be unavailable while cut still exists.
      isCut: shouldCutByGeometry,
      cutType: shouldCutByGeometry ? 'longitudinal' : null,
      // Preserve originalWidth if editing, otherwise use selectedProduct.widthValue
      originalWidth: (isEditMode && productConfig.originalWidth) ? productConfig.originalWidth : selectedProduct.widthValue,
      // Store originalLength when product is first created (when not from remaining stone)
      // For products created from remaining stone, originalLength is set in handleCreateFromRemainingStone
      originalLength: (isEditMode && productConfig.originalLength !== undefined) 
        ? productConfig.originalLength 
        : (lengthUnit === 'm' ? calculated.length : (calculated.length / 100)),
      cuttingCost: smartCutPlan.enabled ? smartCutPlan.totalCuttingCost : finalCuttingCost,
      cuttingCostPerMeter: finalCuttingCostPerMeter,
      cuttingBreakdown: smartCutPlan.enabled ? smartCutPlan.cuttingBreakdown : undefined,
      smartCutPlan: smartCutPlan.enabled ? smartCutPlan : null,
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
      // SubService tracking - preserve when editing
      appliedSubServices: (isEditMode && productConfig.appliedSubServices) ? productConfig.appliedSubServices : [],
      totalSubServiceCost: (isEditMode && productConfig.totalSubServiceCost !== undefined) ? productConfig.totalSubServiceCost : 0,
      usedLengthForSubServices: (isEditMode && productConfig.usedLengthForSubServices !== undefined) ? productConfig.usedLengthForSubServices : 0,
      usedSquareMetersForSubServices: (isEditMode && productConfig.usedSquareMetersForSubServices !== undefined) ? productConfig.usedSquareMetersForSubServices : 0,
      meta: {
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
    
    // Add SubService costs to totalPrice if they exist
    const existingSubServiceCost = (isEditMode && productConfig.totalSubServiceCost) ? productConfig.totalSubServiceCost : 0;
    finalProduct.totalPrice = finalProduct.totalPrice + (smartCutPlan.enabled ? smartCutPlan.totalCuttingCost : finalCuttingCost) + existingSubServiceCost + finishingCost;
    
    // Add to contract or update existing product
    if (isEditMode && editingProductIndex !== null) {
      // Update existing product
      const updatedProducts = [...wizardData.products];
      updatedProducts[editingProductIndex] = finalProduct;
      updateWizardData({
        products: updatedProducts,
        selectedProductTypeForAddition: productType
      });
    } else {
      // Add new product
      updateWizardData({
        products: [...wizardData.products, finalProduct],
        selectedProductTypeForAddition: productType
      });
    }
    
    console.log('✅ Successfully added main product to contract!', {
      finalProduct: finalProduct,
      isEditMode: isEditMode,
      editingProductIndex: editingProductIndex,
      totalProducts: isEditMode ? wizardData.products.length : wizardData.products.length + 1
    });
    
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
          wizardData.deliveries.forEach((delivery, index) => {
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
            const unit = getDeliveryUnit(product);
            if (isPreparedProductType(product.productType)) return getPreparedQuantity(product);
            if (unit === 'meter') {
              const lengthM = product.lengthUnit === 'm' ? product.length : (product.length || 0) / 100;
              return lengthM * (product.quantity || 0);
            }
            if (unit === 'squareMeter') return product.squareMeters || 0;
            return product.quantity || 0;
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

          wizardData.deliveries.forEach(delivery => {
            delivery.products.forEach(dp => {
              if (dp.rowType === 'service' || typeof dp.productIndex !== 'number') return;
              const current = remainingByProductIndex.get(dp.productIndex) || 0;
              remainingByProductIndex.set(dp.productIndex, current - (dp.amount ?? dp.quantity ?? 0));
            });
          });

          remainingByProductIndex.forEach((remaining, productIndex) => {
            if (remaining < -0.01) {
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

          if (undistributedProducts.length > 0) {
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

  const shouldShowLegacyStairModal =
    showProductModal &&
    !useStairFlowV2 &&
    ((productConfig.productType || wizardData.selectedProductTypeForAddition) === 'stair') &&
    (selectedProduct || (productConfig.productType === 'stair' && stairSystemConfig));

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
            totalPrice: toFiniteNumber(product.totalPrice),
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

          (product.cuttingBreakdown || []).forEach((cut, cutIndex) => {
            serviceDetails.push({
              id: `cut-${productIndex}-${cutIndex}`,
              productName,
              category: 'برش',
              name: cut.type === 'cross' ? 'برش عرضی' : 'برش طولی',
              amountLabel: `${toFiniteNumber(cut.meters)} متر`,
              rateLabel: cut.rate ? `${cut.rate}` : '—',
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
            const productIndex = deliveryProduct.productIndex ?? -1;
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

        const productsTotal = sumNumericValues(wizardData.products, (product) => product.totalPrice);
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
    contractId
  });
  const handleWizardSubmit = () => {
    if (isContractCreationComplete) {
      router.push('/dashboard/sales/contracts');
      return;
    }

    contractSubmission.handleCreateContract();
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 py-4 sm:py-8 relative z-0">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 relative z-0">
        {/* Header */}
        <div className="text-center mb-5 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white mb-2">
            ایجاد قرارداد جدید
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            مراحل ایجاد قرارداد را تکمیل کنید
          </p>
        </div>

        {draftRestoredNotice && (
          <div className="mb-4 rounded-xl border border-teal-400/40 bg-teal-50 px-4 py-3 text-sm text-teal-900 shadow-sm dark:bg-teal-900/20 dark:text-teal-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>پیش‌نویس ذخیره‌شده بازیابی شد.</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDraftRestoredNotice(false)}
                  className="rounded-lg border border-teal-500/50 px-3 py-2 font-semibold transition hover:bg-teal-100 dark:hover:bg-teal-900/40"
                >
                  ادامه
                </button>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem(CONTRACT_DRAFT_STORAGE_KEY);
                    localStorage.removeItem('contractWizardState');
                    setDraftRestoredNotice(false);
                    setCurrentStep(1);
                    setWizardData({
                      contractKind,
                      contractDate: getCurrentPersianDate(),
                      contractNumber: '',
                      creatorSequenceNumber: null,
                      customerId: '',
                      customer: null,
                      projectId: '',
                      project: null,
                      selectedProductTypeForAddition: null,
                      products: [],
                      serviceRows: [],
                      deliveries: [],
                      payment: { payments: [], currency: 'تومان', totalContractAmount: 0 },
                      signature: null
                    });
                  }}
                  className="rounded-lg bg-slate-800 px-3 py-2 font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  شروع مجدد
                </button>
              </div>
            </div>
          </div>
        )}

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
        <div className="glass-liquid-card step-content-card p-4 sm:p-6 lg:p-8 mb-6 sm:mb-8 relative z-0">
          {renderStepContent()}
        </div>

        {/* Navigation */}
        <WizardNavigation
          currentStep={visibleCurrentStep}
          totalSteps={visibleWizardSteps.length}
          onPrevious={goToPreviousStep}
          onNext={goToNextStep}
          onSubmit={handleWizardSubmit}
          loading={loading || wizardLoading || contractSubmission.isSubmitting}
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
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-600 dark:text-red-400">{errors.general}</p>
          </div>
        )}

        {/* Product Configuration Modal */}
        {showProductModal && useStairFlowV2 && productConfig.productType === 'stair' && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col z-[10000]">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-1 h-8 bg-gradient-to-b from-purple-500 to-purple-600 rounded-full"></div>
                  <h3 className="text-xl font-bold text-purple-900 dark:text-purple-200">{isEditMode ? 'ویرایش محصول' : 'افزودن محصول'}</h3>
                  {isEditMode && (
                    <span className="px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-semibold">
                      حالت ویرایش
                    </span>
                  )}
                </div>
                <button 
                  className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg p-2 transition-colors" 
                  onClick={() => setShowProductModal(false)}
                  title="بستن"
                >
                  <FaTimes className="w-5 h-5" />
                </button>
              </div>

              {/* Type Switcher (stair V2 modal) */}
              <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900/40 dark:to-slate-800/40 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">نوع محصول:</span>
                  <div className="flex flex-wrap gap-2">
                    {(['longitudinal', 'stair', 'slab'] as const).map((type) => {
                      const typeLabel = PRODUCT_TYPES.find((item) => item.id === type)?.name ?? type;
                      const isSelected = productConfig.productType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          disabled={isEditMode}
                          onClick={() => handleV2ModalProductTypeChange(type)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            isSelected
                              ? 'bg-gradient-to-r from-teal-500 to-teal-600 border-teal-400 text-white shadow-sm'
                              : 'bg-slate-900/60 border-slate-500/70 text-slate-200 hover:border-teal-400 hover:text-teal-200'
                          } ${isEditMode ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          {typeLabel}
                        </button>
                      );
                    })}
                  </div>
                  {isEditMode && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">در حالت ویرایش قابل تغییر نیست</span>
                  )}
                </div>
              </div>
              
              {/* Step Indicators */}
              {(() => {
                const [currentDraft] = getActiveDraft();
                const hasStone = !!currentDraft.stoneId;
                const hasThickness = !!currentDraft.thicknessCm;
                const hasLength = hasLengthMeasurement(currentDraft);
                const hasWidth = !!currentDraft.widthCm;
                const hasQuantity = !!currentDraft.quantity;
                const hasSqm = !!currentDraft.squareMeters;
                const hasPrice = !!currentDraft.pricePerSquareMeter;
                const hasTools = (currentDraft.tools || []).length > 0;
                const hasTotal = !!currentDraft.totalPrice;
                
                return (
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-900/50 dark:to-gray-800/50 flex-shrink-0">
                    <div className="flex items-center gap-2 overflow-x-auto">
                      <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                        <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${true ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>0. نوع</span>
                        <span className="text-gray-400 dark:text-gray-500">→</span>
                        <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasStone ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>1. انتخاب سنگ</span>
                        <span className="text-gray-400 dark:text-gray-500">→</span>
                        <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasThickness ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>2. ضخامت</span>
                        <span className="text-gray-400 dark:text-gray-500">→</span>
                        <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasLength ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>3. طول</span>
                        <span className="text-gray-400 dark:text-gray-500">→</span>
                        <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasWidth ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>4. عرض</span>
                        <span className="text-gray-400 dark:text-gray-500">→</span>
                        <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasQuantity ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>5. تعداد</span>
                        <span className="text-gray-400 dark:text-gray-500">→</span>
                        <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasSqm ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>6. متر مربع</span>
                        <span className="text-gray-400 dark:text-gray-500">→</span>
                        <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasPrice ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>7. قیمت</span>
                        <span className="text-gray-400 dark:text-gray-500">→</span>
                            <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasTools ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>8. ابزار</span>
                            <span className="text-gray-400 dark:text-gray-500">→</span>
                        {stairSystemV2.stairActivePart !== 'riser' && (
                          <>
                            <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                              (currentDraft.numberOfLayersPerStair &&
                                currentDraft.numberOfLayersPerStair > 0 &&
                                currentDraft.layerWidthCm &&
                                currentDraft.pricePerSquareMeter &&
                                (stairSystemV2.layerTypes.length === 0 || currentDraft.layerTypeId))
                                ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-md'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                            }`}>9. لایه‌ها</span>
                            <span className="text-gray-400 dark:text-gray-500">→</span>
                          </>
                        )}
                        <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasTotal ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{stairSystemV2.stairActivePart !== 'riser' ? '10. جمع کل' : '9. جمع کل'}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
              
              <div className="flex-1 overflow-y-auto">
                <div className="p-6 space-y-6">
                  {/* Part Selector - Enhanced */}
                  <div className="bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-lg border border-purple-200 dark:border-purple-700 p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-1 h-6 bg-gradient-to-b from-purple-500 to-purple-600 rounded-full"></div>
                      <label htmlFor="stair-part-select" className="text-sm font-semibold text-purple-900 dark:text-purple-200">بخش:</label>
                      <select
                        id="stair-part-select"
                        className="flex-1 rounded-lg bg-white dark:bg-gray-800 px-4 py-2 border border-purple-300 dark:border-purple-600 text-gray-800 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                        value={stairSystemV2.stairActivePart}
                        onChange={(e) => setActivePart(e.target.value as StairStepperPart)}
                        aria-label="انتخاب بخش پله"
                      >
                        <option value="tread">کف پله</option>
                        <option value="riser">خیز</option>
                        <option value="landing">پاگرد</option>
                      </select>
                    </div>
                  </div>
                {(() => {
                  const [draft, setDraft] = getActiveDraft();
                  const totals = computeTotalsV2(stairSystemV2.stairActivePart, draft);
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
                  return (
                    <div className="space-y-6">
                      {/* Input Fields Section - Enhanced */}
                      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-1 h-5 bg-gradient-to-b from-teal-500 to-teal-600 rounded-full"></div>
                          <h5 className="text-sm font-semibold text-gray-800 dark:text-white">اطلاعات محصول</h5>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                نوع سنگ
                              </span>
                            </label>
                            <div className="relative">
                              <input 
                                className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all" 
                                placeholder="جستجو در نوع برش، جنس سنگ، معدن، نوع پرداخت، رنگ/خصوصیات" 
                                value={stairSystemV2.stoneSearchTerm} 
                                onChange={(e) => stairSystemV2.setStoneSearchTerm(e.target.value)} 
                              />
                              {draft.stoneProduct && (
                                <div className="mt-2 p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg">
                                  <div className="text-sm font-medium text-teal-800 dark:text-teal-200">{draft.stoneLabel}</div>
                                  {draft.stoneProduct.basePrice && (
                                    <div className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                                      قیمت: {formatPrice(draft.stoneProduct.basePrice)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {stairSystemV2.stoneSearchTerm && (
                              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                                {stairSystemV2.isSearchingStones && (
                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">
                                    <span className="animate-pulse">در حال جستجو...</span>
                                  </div>
                                )}
                                {!stairSystemV2.isSearchingStones && stairSystemV2.stoneSearchResults.length === 0 && (
                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">نتیجه‌ای یافت نشد</div>
                                )}
                                {stairSystemV2.stoneSearchResults.map((p: Product) => (
                                  <button 
                                    key={p.id} 
                                    type="button" 
                                    className="w-full text-right px-4 py-2.5 hover:bg-teal-50 dark:hover:bg-teal-900/20 text-sm border-b border-gray-100 dark:border-gray-700 last:border-0 transition-colors" 
                                    onClick={() => {
                                      selectProductForStairPart(stairSystemV2.stairActivePart, p);
                                    }}
                                  >
                                    {/* 🎯 Show complete product name using generateFullProductName */}
                                    <div className="font-medium text-gray-800 dark:text-white">
                                      {p.fullName || generateFullProductName(p) || p.namePersian || p.name}
                                    </div>
                                    {p.basePrice && (
                                      <div className="text-xs text-teal-600 dark:text-teal-400 mt-0.5">{formatPrice(p.basePrice)}</div>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                قطر (سانتی‌متر)
                              </span>
                            </label>
                            <FormattedNumberInput
                              value={draft.stoneProduct?.thicknessValue ?? draft.thicknessCm ?? null}
                              onChange={(_value) => {}}
                              min={1}
                              step={1}
                              disabled
                              className="w-full rounded-lg bg-gray-100 dark:bg-gray-700/60 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-600 dark:text-gray-300 cursor-not-allowed"
                              placeholder="ابتدا محصول را انتخاب کنید"
                            />
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                              قطر به صورت خودکار از مشخصات محصول انتخاب شده تنظیم می‌شود و قابل تغییر نیست.
                            </p>
                          {draftErrors.thickness && (
                            <p className="mt-1 text-xs text-red-500">{draftErrors.thickness}</p>
                          )}
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                طول
                              </span>
                            </label>
                            <div className="flex gap-2">
                              <FormattedNumberInput
                                value={draft.lengthValue ?? null}
                            onChange={(value) => {
                              const normalizedValue = value && value > 0 ? value : null;
                              const updatedDraft: StairPartDraftV2 = { ...draft, lengthValue: normalizedValue };
                              const error = validateDraftNumericFields(stairSystemV2.stairActivePart, updatedDraft, 'length', value);
                              if (error) {
                                stairSystemV2.setStairDraftErrors(prev => ({
                                  ...prev,
                                  [stairSystemV2.stairActivePart]: { ...prev[stairSystemV2.stairActivePart], length: error }
                                }));
                              } else {
                                clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'length');
                              }
                              setDraft(updatedDraft);
                            }}
                                min={0}
                                step={0.01}
                                className="flex-1 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                                placeholder="مثال: 1.2"
                              />
                              <select
                                className="rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all font-medium"
                                value={draft.lengthUnit || 'm'}
                                onChange={(e) => setDraft({ ...draft, lengthUnit: (e.target.value as UnitType) })}
                                aria-label="واحد طول"
                              >
                                <option value="cm">cm</option>
                                <option value="m">m</option>
                              </select>
                            </div>
                            {stairSystemV2.stairActivePart !== 'riser' && (
                            <div className="mt-3">
                              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                                طول استاندارد (برای قیمت‌گذاری)
                              </label>
                              <div className="flex gap-2">
                                <FormattedNumberInput
                                  value={draft.standardLengthValue ?? null}
                                  onChange={(value) => {
                                    const normalized = value && value > 0 ? value : null;
                                    const updatedDraft: StairPartDraftV2 = { ...draft, standardLengthValue: normalized };
                                    if (normalized && normalized > 0) {
                                      clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'length');
                                    }
                                    setDraft(updatedDraft);
                                  }}
                                  min={0}
                                  step={0.01}
                                  className="flex-1 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                                  placeholder="مثال: 1.2"
                                />
                                <select
                                  className="rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all font-medium"
                                  value={draft.standardLengthUnit || draft.lengthUnit || 'm'}
                                  onChange={(e) => setDraft({ ...draft, standardLengthUnit: (e.target.value as UnitType) })}
                                  aria-label="واحد طول استاندارد"
                                >
                                  <option value="m">m</option>
                                  <option value="cm">cm</option>
                                </select>
                              </div>
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                اگر طول واقعی وارد نشود، از همین طول استاندارد برای محاسبه قیمت استفاده می‌شود.
                              </p>
                            </div>
                            )}
                          {draftErrors.length && (
                            <p className="mt-1 text-xs text-red-500">{draftErrors.length}</p>
                          )}
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                عرض (سانتی‌متر)
                              </span>
                            </label>
                            <FormattedNumberInput
                              value={draft.widthCm ?? null}
                            onChange={(value) => {
                              const updatedDraft = { ...draft, widthCm: value && value > 0 ? value : null };
                              // 🎯 Validate using comprehensive validation function
                              const error = validateDraftNumericFields(stairSystemV2.stairActivePart, updatedDraft, 'width', value);
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
                              className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                              placeholder="مثال: 40"
                            />
                          {draftErrors.width && (
                            <p className="mt-1 text-xs text-red-500">{draftErrors.width}</p>
                          )}
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                تعداد
                              </span>
                            </label>
                            <FormattedNumberInput
                              value={draft.quantity ?? null}
                            onChange={(value) => {
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
                              className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                              placeholder="مثال: 100"
                            />
                          {draftErrors.quantity && (
                            <p className="mt-1 text-xs text-red-500">{draftErrors.quantity}</p>
                          )}
                          </div>
                          {draft.stoneProduct && totals.piecesPerStone > 0 && totals.baseStoneQuantity > 0 && (
                            <div className="md:col-span-2">
                              <div className="mt-2 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-4 py-3 text-xs leading-5 text-teal-700 dark:text-teal-200">
                                <div>
                                  از هر سنگ {formatDisplayNumber(totals.piecesPerStone)} قطعه با عرض {formatDisplayNumber(draft.widthCm ?? 0)} سانتی‌متر به دست می‌آید.
                                </div>
                                <div>
                                  تعداد سنگ پایه مورد نیاز: {formatDisplayNumber(totals.baseStoneQuantity)} عدد
                                  {totals.leftoverWidthCm > 0 ? ` ⬢ باقی‌مانده هر سنگ: ${formatDisplayNumber(totals.leftoverWidthCm)}cm` : ''}
                                </div>
                              </div>
                            </div>
                          )}
                          
                          <div>
                            <label htmlFor="sqm-auto-calc" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                متر مربع (خودکار)
                              </span>
                            </label>
                            <input
                              id="sqm-auto-calc"
                              className="w-full rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-2.5 text-blue-700 dark:text-blue-300 font-semibold cursor-not-allowed"
                              value={formatDisplayNumber(totals.sqm)}
                              readOnly
                              aria-label="متر مربع محاسبه شده خودکار"
                            />
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                قیمت هر متر مربع
                              </span>
                            </label>
                            <FormattedNumberInput
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
                              className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                              placeholder="مثال: 1,500,000"
                            />
                          {draftErrors.pricePerSquareMeter && (
                            <p className="mt-1 text-xs text-red-500">{draftErrors.pricePerSquareMeter}</p>
                          )}
                          </div>
                          {supportsMandatory && (
                            <div className="md:col-span-2 rounded-lg border border-yellow-100 dark:border-yellow-800 bg-white dark:bg-gray-900/30 p-4">
                              <div className="flex items-center gap-2">
                                <input
                                  id="mandatory-pricing-checkbox"
                                  type="checkbox"
                                  className="rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
                                  checked={mandatoryEnabled}
                                  aria-label="فعال‌سازی قیمت‌گذاری حکمی"
                                  onChange={(e) => {
                                    const nextValue = e.target.checked;
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
                                <div>
                                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    حکمی (افزایش قیمت)
                                  </label>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                    در صورت فعال بودن، قیمت سنگ این بخش به صورت درصدی افزایش داده می‌شود.
                                  </p>
                                </div>
                              </div>
                              {mandatoryEnabled && (
                                <div className="mt-3 flex items-center gap-2">
                                  <FormattedNumberInput
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
                                    className="w-24 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-transparent text-sm"
                                  />
                                  <span className="text-xs text-gray-600 dark:text-gray-300">%</span>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                    قیمت پایه با {formatDisplayNumber(mandatoryPercentageValue)}% افزایش محاسبه می‌شود.
                                  </p>
                                </div>
                              )}
                              {draftErrors.mandatoryPercentage && (
                                <p className="mt-1 text-xs text-red-500">
                                  {draftErrors.mandatoryPercentage}
                                </p>
                              )}
                            </div>
                          )}
                          {totals.billableCuttingCost > 0 && (
                            <div className="md:col-span-2">
                              <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-xs leading-5 text-amber-700 dark:text-amber-200">
                                {totals.billableCuttingCostLongitudinal > 0 && (
                                  <div>
                                    هزینه برش طولی: {formatPrice(totals.billableCuttingCostLongitudinal)} ({formatDisplayNumber(lengthMInfo)} m × {formatDisplayNumber(totals.baseStoneQuantity)} سنگ × {formatPrice(totals.shouldChargeCuttingCost ? (totals.cuttingCostPerMeterLongitudinal || totals.cuttingCostPerMeter) : 0)})
                                  </div>
                                )}
                                {totals.billableCuttingCostCross > 0 && (
                                  <div className="mt-1">
                                    هزینه برش عرضی: {formatPrice(totals.billableCuttingCostCross)} ({formatDisplayNumber((draft.widthCm || 0) / 100)} m × {formatDisplayNumber(totals.baseStoneQuantity)} سنگ × {formatPrice(totals.shouldChargeCuttingCost ? (totals.cuttingCostPerMeterCross || totals.cuttingCostPerMeter) : 0)})
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          توضیحات
                        </label>
                        <textarea
                          value={draft.description || ''}
                          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                          rows={3}
                          className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                          placeholder="توضیحات این بخش از سنگ پله..."
                        />
                      </div>

                      {/* Tools Section - Enhanced */}
                      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-purple-500 to-purple-600 rounded-full"></div>
                            <h5 className="text-sm font-semibold text-gray-800 dark:text-white">ابزارها (بر متر)</h5>
                          </div>
                          {stairSystemV2.stairActivePart === 'landing' && (
                            <span className="text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-2 py-1 rounded">مدل لبه پاگرد: محیط/جهت‌ها</span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">افزودن ابزار</label>
                            <input 
                              className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all" 
                              placeholder="جستجو در ابزارها" 
                              value={stairSystemV2.toolsSearchTerm} 
                              onChange={(e) => stairSystemV2.setToolsSearchTerm(e.target.value)} 
                              onFocus={() => stairSystemV2.setToolsDropdownOpen(true)} 
                              onBlur={() => setTimeout(() => stairSystemV2.setToolsDropdownOpen(false), 150)} 
                            />
                            {(stairSystemV2.toolsDropdownOpen || stairSystemV2.toolsSearchTerm) && (
                              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                                {stairSystemV2.isSearchingTools && (
                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">
                                    <span className="animate-pulse">در حال جستجو...</span>
                                  </div>
                                )}
                                {!stairSystemV2.isSearchingTools && stairSystemV2.toolsResults.length === 0 && (
                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">نتیجه‌ای یافت نشد</div>
                                )}
                                {stairSystemV2.toolsResults.map((t: any) => (
                                  <button 
                                    key={t.id} 
                                    type="button" 
                                    className="w-full text-right px-4 py-2.5 hover:bg-purple-50 dark:hover:bg-purple-900/20 text-sm border-b border-gray-100 dark:border-gray-700 last:border-0 transition-colors" 
                                    onClick={() => {
                                      const exists = (draft.tools || []).some(x => x.toolId === t.id);
                                      if (exists) return;
                                      setDraft({ ...draft, tools: [ ...(draft.tools || []), { toolId: t.id, name: t.namePersian || t.name, pricePerMeter: t.pricePerMeter || t.price || t.costPerMeter || 0, front: false, left: false, right: false, back: false, perimeter: false } ] });
                                      stairSystemV2.setToolsSearchTerm('');
                                      stairSystemV2.setToolsDropdownOpen(false);
                                    }}
                                  >
                                    <div className="font-medium text-gray-800 dark:text-white">{t.namePersian || t.name}</div>
                                    {(t.pricePerMeter || t.price || t.costPerMeter) && (
                                      <div className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">
                                        {formatPrice(t.pricePerMeter || t.price || t.costPerMeter)}/m
                                      </div>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">ابزارهای انتخاب شده و لبه‌ها</label>
                            {(draft.tools || []).length === 0 ? (
                              <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                                <p className="text-xs text-gray-400 dark:text-gray-500">ابزاری انتخاب نشده است.</p>
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-64 overflow-y-auto">
                                {(draft.tools || []).map((tool, idx) => {
                                  const meters = computeToolMetersForTool(stairSystemV2.stairActivePart, draft, tool);
                                  const tp = meters * (tool.pricePerMeter || 0);
                                  return (
                                    <div key={tool.toolId} className="p-3 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 shadow-sm">
                                      <div className="flex items-center justify-between mb-3">
                                        <div className="font-medium text-purple-800 dark:text-purple-200 text-sm">{tool.name}</div>
                                        <div className="flex items-center gap-2 text-xs">
                                          <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded font-medium">
                                            {formatDisplayNumber(meters)} m
                                          </span>
                                          <span className="font-semibold text-purple-600 dark:text-purple-400">{formatPrice(tp)}</span>
                                          <button 
                                            type="button" 
                                            className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-1 rounded transition-colors" 
                                            onClick={() => {
                                              const tools = (draft.tools || []).filter((_, i) => i !== idx);
                                              setDraft({ ...draft, tools });
                                            }}
                                            title="حذف ابزار"
                                          >
                                            <FaTrash className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-2 text-xs">
                                        <label className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-gray-800 rounded border border-purple-200 dark:border-purple-700 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors">
                                            <input 
                                              type="checkbox" 
                                              checked={!!tool.perimeter} 
                                              onChange={(e) => {
                                                const tools = [...(draft.tools || [])];
                                                tools[idx] = { ...tool, perimeter: e.target.checked };
                                                setDraft({ ...draft, tools });
                                              }} 
                                              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                            /> 
                                            <span className="text-gray-700 dark:text-gray-300">محیط کامل</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-gray-800 rounded border border-purple-200 dark:border-purple-700 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors">
                                          <input 
                                            type="checkbox" 
                                            checked={!!tool.front} 
                                            onChange={(e) => {
                                              const tools = [...(draft.tools || [])]; 
                                              tools[idx] = { ...tool, front: e.target.checked }; 
                                              setDraft({ ...draft, tools });
                                            }} 
                                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                          /> 
                                          <span className="text-gray-700 dark:text-gray-300">جلو</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-gray-800 rounded border border-purple-200 dark:border-purple-700 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors">
                                            <input 
                                              type="checkbox" 
                                              checked={!!tool.back} 
                                              onChange={(e) => {
                                                const tools = [...(draft.tools || [])]; 
                                                tools[idx] = { ...tool, back: e.target.checked }; 
                                                setDraft({ ...draft, tools });
                                              }} 
                                              className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                            /> 
                                            <span className="text-gray-700 dark:text-gray-300">عقب</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-gray-800 rounded border border-purple-200 dark:border-purple-700 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors">
                                          <input 
                                            type="checkbox" 
                                            checked={!!tool.left} 
                                            onChange={(e) => {
                                              const tools = [...(draft.tools || [])]; 
                                              tools[idx] = { ...tool, left: e.target.checked }; 
                                              setDraft({ ...draft, tools });
                                            }} 
                                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                          /> 
                                          <span className="text-gray-700 dark:text-gray-300">چپ</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-gray-800 rounded border border-purple-200 dark:border-purple-700 cursor-pointer hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors">
                                          <input 
                                            type="checkbox" 
                                            checked={!!tool.right} 
                                            onChange={(e) => {
                                              const tools = [...(draft.tools || [])]; 
                                              tools[idx] = { ...tool, right: e.target.checked }; 
                                              setDraft({ ...draft, tools });
                                            }} 
                                            className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                          /> 
                                          <span className="text-gray-700 dark:text-gray-300">راست</span>
                                        </label>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Layers Section (لایه‌ها) - Enhanced */}
                      {/* 🎯 Hide layers section for riser */}
                      {stairSystemV2.stairActivePart !== 'riser' && (
                      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-orange-500 to-orange-600 rounded-full"></div>
                            <h5 className="text-sm font-semibold text-gray-800 dark:text-white">لایه‌ها</h5>
                          </div>
                          <span className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-2 py-1 rounded">لایه‌های اضافی برای هر پله</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                تعداد لایه برای هر پله
                              </span>
                            </label>
                            <FormattedNumberInput
                              value={draft.numberOfLayersPerStair ?? null}
                              onChange={(value) => {
                                // 🎯 Ensure integer value and validate
                                const intValue = value ? Math.floor(value) : null;
                                const requiresLayerType = stairSystemV2.layerTypes.length > 0;
                                if (intValue && intValue > 0 && intValue <= 10) { // Reasonable max: 10 layers per stair
                                  let updatedDraft: StairPartDraftV2 = { ...draft, numberOfLayersPerStair: intValue };
                                  if (!hasLayerEdgeSelection(updatedDraft.layerEdges)) {
                                    updatedDraft = deriveLayerEdgesFromTools(updatedDraft, stairSystemV2.stairActivePart);
                                  }
                                  setDraft(updatedDraft);
                                  if (requiresLayerType && !draft.layerTypeId) {
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
                                } else if (intValue > 10) {
                                  // Show error for too many layers
                                  stairSystemV2.setStairDraftErrors(prev => ({
                                    ...prev,
                                    [stairSystemV2.stairActivePart]: { 
                                      ...prev[stairSystemV2.stairActivePart], 
                                      quantity: 'تعداد لایه برای هر پله نمی‌تواند بیشتر از 10 باشد'
                                    }
                                  }));
                                }
                              }}
                              min={1}
                              step={1}
                              max={10}
                              className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                              placeholder="مثال: 1 (برای دوبل)"
                            />
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              تعداد لایه‌هایی که برای هر پله نیاز است (مثال: 1 برای دوبل)
                            </p>
                          </div>
                          
                          {draft.numberOfLayersPerStair && draft.numberOfLayersPerStair > 0 && (
                            <>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                    عرض لایه (سانتی‌متر)
                                  </span>
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
                                      } else if (value < 0.5) {
                                        stairSystemV2.setStairDraftErrors(prev => ({
                                          ...prev,
                                          [stairSystemV2.stairActivePart]: { 
                                            ...prev[stairSystemV2.stairActivePart], 
                                            width: 'عرض لایه باید حداقل 0.5 سانتی‌متر باشد'
                                          }
                                        }));
                                      } else {
                                        clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'width');
                                      }
                                    }
                                    setDraft(updatedDraft);
                                  }}
                                  min={0.5}
                                  step={0.1}
                                  className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                                  placeholder="مثال: 15"
                                />
                              </div>
                              
                              
                              {stairSystemV2.layerTypes.length > 0 && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    <span className="flex items-center gap-1">
                                      <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                      نوع لایه
                                    </span>
                                  </label>
                                  <select
                                    className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all font-medium"
                                    value={draft.layerTypeId || ''}
                                    disabled={stairSystemV2.isLoadingLayerTypes}
                                    aria-label="انتخاب نوع لایه"
                                    onChange={(e) => {
                                      const selectedId = e.target.value;
                                      if (!selectedId) {
                                        setDraft({
                                          ...draft,
                                          layerTypeId: null,
                                          layerTypeName: null,
                                          layerTypePrice: null
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
                                        clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerType');
                                        setDraft({
                                          ...draft,
                                          layerTypeId: selected.id,
                                          layerTypeName: selected.name,
                                          layerTypePrice: selected.pricePerLayer
                                        });
                                      }
                                    }}
                                  >
                                    <option value="">انتخاب نوع لایه...</option>
                                    {stairSystemV2.layerTypes.map((option: LayerTypeOption) => (
                                      <option key={option.id} value={option.id}>
                                        {option.name} - {option.pricePerLayer.toLocaleString('fa-IR')} تومان
                                      </option>
                                    ))}
                                  </select>
                                  {stairSystemV2.layerTypesError && (
                                    <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                                      {stairSystemV2.layerTypesError}
                                    </p>
                                  )}
                                  {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerType && (
                                    <p className="mt-1 text-xs text-red-500">
                                      {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerType}
                                    </p>
                                  )}
                                </div>
                              )}

                              <div className="md:col-span-2">
                                <div className="border border-dashed border-orange-200 dark:border-orange-800 rounded-lg p-4 bg-orange-50/30 dark:bg-orange-900/10">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <h6 className="text-xs font-semibold text-orange-700 dark:text-orange-300">
                                        استفاده از سنگ متفاوت برای لایه‌ها
                                      </h6>
                                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                                        می‌توانید سنگ دیگری را برای لایه‌ها انتخاب کرده و قیمت مستقل آن را ثبت کنید.
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (draft.layerUseDifferentStone) {
                                          setDraft({
                                            ...draft,
                                            layerUseDifferentStone: false,
                                            layerStoneProductId: null,
                                            layerStoneProduct: null,
                                            layerStoneLabel: null,
                                            layerPricePerSquareMeter: null,
                                            layerUseMandatory: undefined,
                                            layerMandatoryPercentage: null
                                          });
                                          clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerStone');
                                          clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerStonePrice');
                                          clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerMandatoryPercentage');
                                        } else {
                                          setDraft({
                                            ...draft,
                                            layerUseDifferentStone: true,
                                            layerStoneProductId: null,
                                            layerStoneProduct: null,
                                            layerStoneLabel: null,
                                            layerPricePerSquareMeter: draft.pricePerSquareMeter || null,
                                            layerUseMandatory: true,
                                            layerMandatoryPercentage: draft.layerMandatoryPercentage ?? 20
                                          });
                                        }
                                      }}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                        draft.layerUseDifferentStone
                                          ? 'bg-orange-500 text-white hover:bg-orange-600'
                                          : 'bg-white dark:bg-gray-900/40 text-orange-600 border border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/40'
                                      }`}
                                    >
                                      {draft.layerUseDifferentStone ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                                    </button>
                                  </div>

                                  {draft.layerUseDifferentStone && (
                                    <div className="mt-4 space-y-4">
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                          انتخاب سنگ برای لایه‌ها
                                        </label>
                                        {!draft.layerStoneProduct ? (
                                          <>
                                            <input
                                              className="w-full rounded-lg bg-white dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                                              placeholder="نام سنگ مورد نظر را جستجو کنید"
                                              value={stairSystemV2.layerStoneSearchTerm}
                                              onChange={(e) => stairSystemV2.setLayerStoneSearchTerm(e.target.value)}
                                              onFocus={() => stairSystemV2.setLayerStoneDropdownOpen(true)}
                                              onBlur={() => setTimeout(() => stairSystemV2.setLayerStoneDropdownOpen(false), 150)}
                                            />
                                            {stairSystemV2.layerStoneDropdownOpen && (
                                              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                                                {stairSystemV2.isSearchingLayerStones && (
                                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">
                                                    <span className="animate-pulse">در حال جستجو...</span>
                                                  </div>
                                                )}
                                                {!stairSystemV2.isSearchingLayerStones && stairSystemV2.layerStoneSearchResults.length === 0 && (
                                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">نتیجه‌ای یافت نشد</div>
                                                )}
                                                {stairSystemV2.layerStoneSearchResults.map((p) => (
                                                  <button
                                                    key={p.id}
                                                    type="button"
                                                    className="w-full text-right px-4 py-2.5 hover:bg-orange-50 dark:hover:bg-orange-900/20 text-sm border-b border-gray-100 dark:border-gray-700 last:border-0 transition-colors"
                                                    onClick={() => {
                                                      const altLabel = (p as any).fullName || generateFullProductName(p as Product) || p.namePersian || p.name;
                                                      setDraft({
                                                        ...draft,
                                                        layerUseDifferentStone: true,
                                                        layerStoneProductId: p.id,
                                                        layerStoneProduct: p,
                                                        layerStoneLabel: altLabel,
                                                        layerPricePerSquareMeter: p.basePrice || draft.layerPricePerSquareMeter || draft.pricePerSquareMeter || null,
                                                        layerUseMandatory: draft.layerUseMandatory ?? true,
                                                        layerMandatoryPercentage: draft.layerMandatoryPercentage ?? 20
                                                      });
                                                      stairSystemV2.setLayerStoneSearchTerm('');
                                                      stairSystemV2.setLayerStoneDropdownOpen(false);
                                                      clearDraftFieldErrorWrapper(stairSystemV2.stairActivePart, 'layerStone');
                                                    }}
                                                  >
                                                    <div className="font-medium text-gray-800 dark:text-white">
                                                      {(p as any).fullName || generateFullProductName(p as Product) || p.namePersian || p.name}
                                                    </div>
                                                    {p.basePrice && (
                                                      <div className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">{formatPrice(p.basePrice)}</div>
                                                    )}
                                                  </button>
                                                ))}
                                              </div>
                                            )}
                                          </>
                                        ) : (
                                          <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-900/40 border border-orange-200 dark:border-orange-700 rounded-lg">
                                            <div>
                                              <div className="text-sm font-semibold text-gray-800 dark:text-white">
                                                {draft.layerStoneLabel || draft.layerStoneProduct.namePersian || draft.layerStoneProduct.name}
                                              </div>
                                              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                                                کد: {draft.layerStoneProduct.code || '-'}
                                              </div>
                                            </div>
                                            <div className="flex gap-2">
                                              <button
                                                type="button"
                                                className="px-2 py-1 text-xs text-orange-600 hover:text-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30 rounded"
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
                                              </button>
                                              <button
                                                type="button"
                                                className="px-2 py-1 text-xs text-red-600 hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
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
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                        {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerStone && (
                                          <p className="mt-1 text-xs text-red-500">
                                            {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerStone}
                                          </p>
                                        )}
                                      </div>

                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                          قیمت هر متر مربع سنگ لایه (تومان)
                                        </label>
                                        <FormattedNumberInput
                                          value={draft.layerPricePerSquareMeter ?? null}
                                          onChange={(value) => {
                                            const updatedDraft = { ...draft, layerPricePerSquareMeter: value && value > 0 ? value : null };
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
                                          className="w-full rounded-lg bg-white dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                                          placeholder="مثال: 1,800,000"
                                        />
                                        {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerStonePrice && (
                                          <p className="mt-1 text-xs text-red-500">
                                            {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerStonePrice}
                                          </p>
                                        )}
                                      </div>

                                      <div className="rounded-lg border border-orange-100 dark:border-orange-800 bg-white dark:bg-gray-900/30 p-3">
                                        <div className="flex items-center gap-2">
                                          <input
                                            id="layer-mandatory-pricing-checkbox"
                                            type="checkbox"
                                            className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
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
                                            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                              حکمی (افزایش قیمت)
                                            </label>
                                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                              در صورت فعال بودن، قیمت سنگ لایه به صورت درصدی افزایش داده می‌شود.
                                            </p>
                                          </div>
                                        </div>
                                        {draft.layerUseMandatory !== false && (
                                          <div className="mt-3 flex items-center gap-2">
                                            <FormattedNumberInput
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
                                              className="w-24 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                                            />
                                            <span className="text-xs text-gray-600 dark:text-gray-300">%</span>
                                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                              قیمت نهایی با {formatDisplayNumber(draft.layerMandatoryPercentage ?? 20)}% افزایش محاسبه می‌شود.
                                            </p>
                                          </div>
                                        )}
                                        {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerMandatoryPercentage && (
                                          <p className="mt-1 text-xs text-red-500">
                                            {stairSystemV2.stairDraftErrors[stairSystemV2.stairActivePart]?.layerMandatoryPercentage}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* 🎯 Layer Edge Selection */}
                              <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                    انتخاب لبه‌های مورد نیاز برای لایه
                                  </span>
                                </label>
                                <div className="flex flex-wrap gap-2 p-3 bg-orange-50/50 dark:bg-orange-900/10 rounded-lg border border-orange-200 dark:border-orange-800">
                                  <label className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-800 rounded border border-orange-200 dark:border-orange-700 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors">
                                      <input 
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
                                        className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                      /> 
                                      <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">محیط کامل</span>
                                  </label>
                                  <label className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-800 rounded border border-orange-200 dark:border-orange-700 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors">
                                    <input 
                                      type="checkbox" 
                                      checked={!!(draft.layerEdges?.front)} 
                                      onChange={(e) => {
                                        const currentEdges = draft.layerEdges || {};
                                        setDraft({ 
                                          ...draft, 
                                          layerEdges: { 
                                            ...currentEdges, 
                                            front: e.target.checked,
                                            perimeter: e.target.checked ? false : currentEdges.perimeter
                                          } 
                                        });
                                      }} 
                                      className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                      disabled={!!(draft.layerEdges?.perimeter)}
                                    /> 
                                    <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">جلو</span>
                                  </label>
                                  <label className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-800 rounded border border-orange-200 dark:border-orange-700 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors">
                                      <input 
                                        type="checkbox" 
                                        checked={!!(draft.layerEdges?.back)} 
                                        onChange={(e) => {
                                          const currentEdges = draft.layerEdges || {};
                                          setDraft({ 
                                            ...draft, 
                                            layerEdges: { 
                                              ...currentEdges, 
                                              back: e.target.checked,
                                              perimeter: e.target.checked ? false : currentEdges.perimeter
                                            } 
                                          });
                                        }} 
                                        className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                        disabled={!!(draft.layerEdges?.perimeter)}
                                      /> 
                                      <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">عقب</span>
                                  </label>
                                  <label className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-800 rounded border border-orange-200 dark:border-orange-700 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors">
                                    <input 
                                      type="checkbox" 
                                      checked={!!(draft.layerEdges?.left)} 
                                      onChange={(e) => {
                                        const currentEdges = draft.layerEdges || {};
                                        setDraft({ 
                                          ...draft, 
                                          layerEdges: { 
                                            ...currentEdges, 
                                            left: e.target.checked,
                                            perimeter: e.target.checked ? false : currentEdges.perimeter
                                          } 
                                        });
                                      }} 
                                      className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                      disabled={!!(draft.layerEdges?.perimeter)}
                                    /> 
                                    <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">چپ</span>
                                  </label>
                                  <label className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-800 rounded border border-orange-200 dark:border-orange-700 cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors">
                                    <input 
                                      type="checkbox" 
                                      checked={!!(draft.layerEdges?.right)} 
                                      onChange={(e) => {
                                        const currentEdges = draft.layerEdges || {};
                                        setDraft({ 
                                          ...draft, 
                                          layerEdges: { 
                                            ...currentEdges, 
                                            right: e.target.checked,
                                            perimeter: e.target.checked ? false : currentEdges.perimeter
                                          } 
                                        });
                                      }} 
                                      className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                      disabled={!!(draft.layerEdges?.perimeter)}
                                    /> 
                                    <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">راست</span>
                                  </label>
                                </div>
                                {(!draft.layerEdges || (!draft.layerEdges.front && !draft.layerEdges.left && !draft.layerEdges.right && !draft.layerEdges.back && !draft.layerEdges.perimeter)) && (
                                  <p className="mt-2 text-xs text-orange-600 dark:text-orange-400">
                                    لطفاً حداقل یک لبه را انتخاب کنید
                                  </p>
                                )}
                              </div>
                              
                              {draft.numberOfLayersPerStair && draft.layerWidthCm && draft.pricePerSquareMeter && draft.quantity && 
                               (stairSystemV2.layerTypes.length === 0 || draft.layerTypeId) &&
                               draft.layerEdges && (draft.layerEdges.front || draft.layerEdges.left || draft.layerEdges.right || draft.layerEdges.back || draft.layerEdges.perimeter) && (() => {
                                // 🎯 Use computeLayerSqmV2 for consistent calculation (accounts for overlap)
                                const totalLayers = draft.quantity * draft.numberOfLayersPerStair;
                                const totalLayerSqm = layerManagement.computeLayerSqmV2(stairSystemV2.stairActivePart, draft);
                                
                                const layerWidthCm = draft.layerWidthCm || 0;
                                const stoneWidthCm = draft.layerUseDifferentStone 
                                  ? (draft.layerStoneProduct?.widthValue || draft.stoneProduct?.widthValue || 0)
                                  : (draft.stoneProduct?.widthValue || 0);
                                const stairLengthM = getActualLengthMeters(draft);
                                
                                    const stoneWidthM = stoneWidthCm / 100;
                                const columnsPerStone = stoneWidthCm > 0 && layerWidthCm > 0
                                  ? Math.max(1, Math.floor(stoneWidthCm / layerWidthCm))
                                  : 0;
                                
                                const edgeDemandsPreview = getLayerEdgeDemands(stairSystemV2.stairActivePart, draft);
                                const previewMainRemainingStones: RemainingStone[] = (() => {
                                  const usagePreview = computeTotalsV2(stairSystemV2.stairActivePart, draft);
                                  const leftoverWidthCm = usagePreview.leftoverWidthCm || 0;
                                  const quantity = usagePreview.baseStoneQuantity || 0;
                                  if (draft.layerUseDifferentStone || leftoverWidthCm <= 0 || stairLengthM <= 0 || quantity <= 0) {
                                    return [];
                                  }
                                  return [{
                                    id: `preview_layer_source_${draft.stoneId || 'main'}`,
                                    width: leftoverWidthCm,
                                    length: stairLengthM,
                                    squareMeters: (leftoverWidthCm / 100) * stairLengthM * quantity,
                                    isAvailable: true,
                                    sourceCutId: `preview_layer_source_${draft.stoneId || 'main'}`,
                                    quantity
                                  }];
                                })();
                                const previewAvailableRemainingStones = draft.layerUseDifferentStone
                                  ? []
                                  : collectAvailableRemainingStones(stairSystemV2.stairSessionItems, previewMainRemainingStones);
                                const layerMetricsPreview = draft.layerUseDifferentStone
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
                                      edgeDemands: edgeDemandsPreview
                                    });
                                
                                const stoneAreaUsedSqm = (() => {
                                  const unfulfilledDemands = (layerMetricsPreview.unfulfilledDemands && layerMetricsPreview.unfulfilledDemands.length)
                                    ? layerMetricsPreview.unfulfilledDemands
                                    : [];
                                  if (!unfulfilledDemands.length || !columnsPerStone || !stairLengthM || !stoneWidthM) {
                                    return 0;
                                  }
                                  let stonesNeeded = 0;
                                  unfulfilledDemands.forEach(edge => {
                                    if (edge.lengthM <= 0) return;
                                    const stripsPerColumn = Math.max(1, Math.floor(stairLengthM / edge.lengthM));
                                    const stripsPerStone = Math.max(1, stripsPerColumn * columnsPerStone);
                                    stonesNeeded += Math.ceil(edge.quantity / stripsPerStone);
                                  });
                                  if (!stonesNeeded) return 0;
                                  return stonesNeeded * stairLengthM * stoneWidthM;
                                })();
                                
                                // Use the same price as the main stair part
                                const pricePerSqm = draft.pricePerSquareMeter || 0;
                                const layerTypeUnitPrice = draft.layerTypePrice || 0;
                                
                                // 🎯 FIX: Calculate layer type cost based on total length per stair × number of stairs × layer type price per meter
                                // مجموع طوله های لایه برای یک پله (چپ + راست + جلو) × تعداد پله ها × هزینه هر نوع لایه
                                const totalLayerLengthPerStairM = layerManagement.getTotalLayerLengthPerStairM(stairSystemV2.stairActivePart, draft);
                                const totalLayerLengthM = totalLayerLengthPerStairM * draft.quantity;
                                const layerTypeCostPreview = totalLayerLengthM * layerTypeUnitPrice;
                                
                                // 🎯 FIX: Calculate layer stone price based on stone area used, NOT layer square meters
                                // Use stone area used for pricing (includes waste/remaining pieces)
                                const pricingStoneAreaSqm = stoneAreaUsedSqm > 0 ? stoneAreaUsedSqm : (layerMetricsPreview.squareMetersFromNew || 0);
                                const baseLayerCost = pricingStoneAreaSqm * pricePerSqm;
                                const layerTotalPrice = baseLayerCost + layerTypeCostPreview;
                                
                                return (
                                  <div className="md:col-span-2">
                                    <div className="mt-2 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 px-4 py-3 text-xs leading-5 text-orange-700 dark:text-orange-200">
                                      <div className="font-semibold mb-1">خلاصه لایه‌ها:</div>
                                      <div>تعداد کل لایه‌ها: {formatDisplayNumber(totalLayers)} عدد ({formatDisplayNumber(draft.quantity)} پله × {formatDisplayNumber(draft.numberOfLayersPerStair)} لایه)</div>
                                      <div className="mt-1">
                                        <span className="font-medium">لبه‌های انتخاب شده: </span>
                                        {draft.layerEdges?.perimeter && (
                                          <span className="text-orange-600 dark:text-orange-400">محیط کامل</span>
                                        )}
                                        {!draft.layerEdges?.perimeter && (
                                          <>
                                            {draft.layerEdges?.front && <span className="text-orange-600 dark:text-orange-400">جلو </span>}
                                            {draft.layerEdges?.back && <span className="text-orange-600 dark:text-orange-400">عقب </span>}
                                            {draft.layerEdges?.left && <span className="text-orange-600 dark:text-orange-400">چپ </span>}
                                            {draft.layerEdges?.right && <span className="text-orange-600 dark:text-orange-400">راست </span>}
                                          </>
                                        )}
                                      </div>
                                      <div>متر مربع استفاده شده: {formatSquareMeters(totalLayerSqm)}</div>
                                      {!draft.layerUseDifferentStone && (
                                        <div className="text-teal-700 dark:text-teal-300">
                                          از باقی‌مانده سنگ اصلی: {formatDisplayNumber(layerMetricsPreview.layersFromRemainingStones || 0)} لایه
                                          {` | نیاز به سنگ اصلی جدید: ${formatDisplayNumber(layerMetricsPreview.layersFromNewStones || 0)} لایه`}
                                        </div>
                                      )}
                                      {!draft.layerUseDifferentStone && (layerMetricsPreview.layersFromNewStones || 0) > 0 && (
                                        <div className="mt-3 rounded-lg border border-orange-300 bg-white/80 p-3 dark:border-orange-700 dark:bg-slate-900/50">
                                          <div className="mb-2 font-semibold text-orange-800 dark:text-orange-200">منبع تامین کمبود لایه</div>
                                          <div className="grid gap-2 md:grid-cols-3">
                                            {([
                                              ['fullOrigin', 'سنگ کامل هم‌مبدا'],
                                              ['manualWarehouse', 'ابعاد انبار'],
                                              ['autoSuggested', 'محاسبه خودکار']
                                            ] as const).map(([value, label]) => (
                                              <button
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
                                                    ? 'border-orange-500 bg-orange-500 text-white'
                                                    : 'border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-400 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-200'
                                                }`}
                                              >
                                                {label}
                                              </button>
                                            ))}
                                          </div>
                                          {draft.layerShortageSource === 'manualWarehouse' && (
                                            <div className="mt-3 grid gap-2 md:grid-cols-3">
                                              <FormattedNumberInput
                                                value={draft.layerManualSourceWidthCm ?? null}
                                                onChange={(value) => setDraft({ ...draft, layerManualSourceWidthCm: value || null })}
                                                className="rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm dark:border-orange-800 dark:bg-slate-900"
                                                placeholder="عرض cm"
                                                min={0}
                                                step={0.1}
                                              />
                                              <FormattedNumberInput
                                                value={draft.layerManualSourceLengthM ?? null}
                                                onChange={(value) => setDraft({ ...draft, layerManualSourceLengthM: value || null })}
                                                className="rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm dark:border-orange-800 dark:bg-slate-900"
                                                placeholder="طول m"
                                                min={0}
                                                step={0.1}
                                              />
                                              <FormattedNumberInput
                                                value={draft.layerManualSourceQuantity ?? null}
                                                onChange={(value) => setDraft({ ...draft, layerManualSourceQuantity: value ? Math.floor(value) : null })}
                                                className="rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm dark:border-orange-800 dark:bg-slate-900"
                                                placeholder="تعداد"
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
                                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                        قیمت هر متر مربع: {formatPrice(pricePerSqm)} (همان سنگ اصلی)
                                      </div>
                                      <div className="mt-1 pt-1 border-t border-orange-200 dark:border-orange-700">
                                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                                            قیمت سنگ لایه: {formatPrice(pricingStoneAreaSqm * pricePerSqm)}
                                            {stoneAreaUsedSqm > 0 && (
                                            <span className="text-xs text-gray-500 dark:text-gray-500 mr-1">
                                                (بر اساس متر مربع سنگ: {formatSquareMeters(stoneAreaUsedSqm)})
                                            </span>
                                          )}
                                        </div>
                                        {layerTypeUnitPrice > 0 && (
                                          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                                            هزینه نوع لایه ({draft.layerTypeName || '-'}): {formatPrice(layerTypeCostPreview)}
                                            <span className="text-xs text-gray-500 dark:text-gray-500 ml-1">
                                              ({formatDisplayNumber(totalLayerLengthPerStairM)} متر × {formatDisplayNumber(draft.quantity)} پله × {formatPrice(layerTypeUnitPrice)}/متر)
                                            </span>
                                          </div>
                                        )}
                                        <div className="mt-1 pt-1 border-t border-orange-200 dark:border-orange-700">
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

                      {stoneFinishings.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <div className="w-1 h-5 bg-gradient-to-b from-teal-500 to-teal-600 rounded-full"></div>
                              <h5 className="text-sm font-semibold text-gray-800 dark:text-white">پرداخت سنگ</h5>
                            </div>
                            <span className="text-xs text-teal-600 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/30 px-2 py-1 rounded">
                              هزینه به ازای {finishingUnitLabel}
                            </span>
                          </div>
                          <div className="space-y-4">
                            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                              <input
                                type="checkbox"
                                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                                checked={!!draft.finishingEnabled}
                                onChange={(e) => {
                                  const enabled = e.target.checked;
                                  if (!enabled) {
                                    setDraft({
                                      ...draft,
                                      finishingEnabled: false,
                                      finishingId: null,
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
                                    <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-3 py-2 text-xs text-teal-800 dark:text-teal-100">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <div className="font-semibold">
                                            {selectedFinishing?.namePersian || selectedFinishing?.name || draft.finishingLabel || 'پرداخت ذخیره‌شده'}
                                          </div>
                                          <div className="mt-1 text-teal-700 dark:text-teal-200">
                                            {formatPrice(finishingPricePerSquareMeter || 0)} / {finishingUnitLabel}
                                            {!selectedFinishing && draft.finishingLabel ? ' - خارج از کاتالوگ فعلی' : ''}
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => setDraft({
                                            ...draft,
                                            finishingId: null,
                                            finishingLabel: null,
                                            finishingPricePerSquareMeter: null,
                                            finishingUnitPrice: null,
                                            finishingCalculationBase: null,
                                            finishingQuantity: null
                                          })}
                                          className="rounded-md px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-100 dark:text-teal-100 dark:hover:bg-teal-800"
                                        >
                                          حذف
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                  <label htmlFor="stone-finishing-picker" className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                                    جستجو و انتخاب پرداخت سنگ
                                  </label>
                                  <input
                                    id="stone-finishing-picker"
                                    value={(draft as any).finishingSearchTerm || ''}
                                    onChange={(e) => setDraft({
                                      ...draft,
                                      finishingSearchTerm: e.target.value
                                    } as any)}
                                    className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                                    placeholder="نام پرداخت سنگ را جستجو کنید..."
                                  />
                                  <div className="max-h-44 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 divide-y divide-gray-200 dark:divide-gray-700">
                                    {visibleStoneFinishings.length > 0 ? visibleStoneFinishings.map(option => {
                                      const unitPrice = getFinishingUnitPrice(option);
                                      const calculationBase = getFinishingCalculationBase(option);
                                      const isSelected = draft.finishingId === option.id;
                                      return (
                                        <button
                                          key={option.id}
                                          type="button"
                                          onClick={() => setDraft({
                                            ...draft,
                                            finishingEnabled: true,
                                            finishingId: option.id,
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
                                          className={`w-full px-3 py-2.5 text-right transition-colors ${isSelected ? 'bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-100' : 'hover:bg-white dark:hover:bg-gray-800 text-gray-800 dark:text-gray-100'}`}
                                        >
                                          <div className="flex items-center justify-between gap-3">
                                            <span className="font-medium">{option.namePersian || option.name}</span>
                                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                              {formatPrice(unitPrice)} / {getFinishingUnitLabel(calculationBase)}
                                            </span>
                                          </div>
                                          {option.description && (
                                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                                              {option.description}
                                            </div>
                                          )}
                                        </button>
                                      );
                                    }) : (
                                      <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                                        پرداختی با این جستجو پیدا نشد.
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {draft.finishingEnabled && (
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
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
                                      className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                                      placeholder={finishingCalculationBase === 'squareMeters' ? 'مثال: 28.8' : 'مثال: 125'}
                                    />
                                    {maxFinishingQuantity !== null && maxFinishingQuantity > 0 && (
                                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                        حداکثر قابل استفاده: {formatDisplayNumber(maxFinishingQuantity)} {finishingUnitLabel}
                                      </p>
                                    )}
                                  </div>
                                )}

                                {selectedFinishing && finishingPricePerSquareMeter && (
                                  <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-4 py-3 text-xs leading-5 text-teal-700 dark:text-teal-200 space-y-1.5">
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
                      {stoneFinishings.length === 0 && (
                        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
                          {stoneFinishingLoadState === 'forbidden'
                            ? 'دسترسی شما برای مشاهده پرداخت‌ها کافی نیست.'
                            : 'هیچ پرداخت فعالی برای انتخاب یافت نشد.'}
                        </div>
                      )}

                      {/* Part Total - Enhanced */}
                      <div className="bg-gradient-to-r from-teal-50 to-teal-100 dark:from-teal-900/30 dark:to-teal-800/30 rounded-lg border-2 border-teal-300 dark:border-teal-700 p-4 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-6 bg-gradient-to-b from-teal-500 to-teal-600 rounded-full"></div>
                          <span className="text-sm font-semibold text-teal-900 dark:text-teal-200">جمع کل این بخش</span>
                        </div>
                        <div className="text-xl font-bold text-teal-700 dark:text-teal-300">{formatPrice(totals.partTotal || 0)}</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Session group summary (enhanced table) */}
                <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-1 h-6 bg-gradient-to-b from-purple-500 to-purple-600 rounded-full"></div>
                    <h4 className="text-base font-semibold text-gray-800 dark:text-white">خلاصه اقلام افزوده شده</h4>
                    <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">
                      {stairSystemV2.stairSessionItems.length} آیتم
                    </span>
                  </div>
                  {stairSystemV2.stairSessionItems.length === 0 ? (
                    <div className="text-center py-6 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                      <p className="text-sm text-gray-400 dark:text-gray-500">هنوز آیتمی افزوده نشده است.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 border-b border-purple-200 dark:border-purple-700">
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">بخش</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">ابعاد</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">تعداد</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">متر مربع</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">قیمت متر مربع</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">ابزارها</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">هزینه ابزار</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">جمع جز</th>
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
                              : (it.stairPartType === 'tread' ? 'purple' : it.stairPartType === 'riser' ? 'blue' : 'indigo');
                            const lengthDisplay = it.lengthUnit === 'm' ? `${formatDisplayNumber(it.length)} m` : `${formatDisplayNumber(it.length)} cm`;
                            const widthDisplay = `${formatDisplayNumber(it.width)} cm`;
                            const stairMeta = ((it as any).meta?.stair) || {};
                            const baseStoneQuantity = stairMeta.baseStoneQuantity || 0;
                            const piecesPerStoneMeta = stairMeta.piecesPerStone || 0;
                            const leftoverWidthMeta = stairMeta.leftoverWidthCmPerStone || 0;
                            const finishing = normalizeProductFinishing(it);
                            
                            return (
                              <tr key={idx} className={`border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${idx % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50/50 dark:bg-gray-800/30'}`}>
                                <td className="py-3 px-4">
                                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                                    partTypeColor === 'purple' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' :
                                    partTypeColor === 'blue' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                                    partTypeColor === 'orange' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' :
                                    'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                                  }`}>
                                    {partTypeLabel}
                                  </span>
                                  {isLayer && layerInfo && (
                                    <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                                      {layerInfo.numberOfLayersPerStair} لایه برای هر پله
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-medium">طول: {lengthDisplay}</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">عرض: {widthDisplay}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                                  <div className="flex flex-col gap-1">
                                    <span className="font-medium">{formatDisplayNumber(it.quantity || 0)} عدد</span>
                                    {(baseStoneQuantity > 0 || (isLayer && layerInfo)) && (
                                      <details className="text-xs text-slate-600 dark:text-slate-300">
                                        <summary className="cursor-pointer font-semibold text-purple-600 dark:text-purple-300">
                                          جزئیات
                                        </summary>
                                        <div className="mt-1 space-y-1">
                                          {baseStoneQuantity > 0 && (
                                            <div>
                                              سنگ پایه: {formatDisplayNumber(baseStoneQuantity)} عدد
                                              {piecesPerStoneMeta > 0 ? ` ⬢ ${formatDisplayNumber(piecesPerStoneMeta)} قطعه از هر سنگ` : ''}
                                              {leftoverWidthMeta > 0 ? ` ⬢ باقی‌مانده: ${formatDisplayNumber(leftoverWidthMeta)}cm` : ''}
                                            </div>
                                          )}
                                          {isLayer && layerInfo && (
                                            <div className="text-orange-600 dark:text-orange-400">
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
                                <td className="py-3 px-4 text-gray-700 dark:text-gray-300 font-medium">
                                  {formatSquareMeters(it.squareMeters || 0)}
                                </td>
                                <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                                  {formatPrice(it.pricePerSquareMeter || 0)}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex flex-col gap-1.5">
                                  {(((it as any).meta?.tools) || []).length === 0 && !(finishing && finishing.cost) ? (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">-</span>
                                  ) : (
                                    <details className="text-xs">
                                      <summary className="cursor-pointer font-semibold text-purple-600 dark:text-purple-300">
                                        جزئیات خدمات
                                      </summary>
                                      <div className="mt-2 flex flex-col gap-1.5">
                                        {((it as any).meta?.tools || []).map((t: any, i: number) => (
                                          <div key={i} className="bg-purple-50 dark:bg-purple-900/20 px-2 py-1 rounded border border-purple-200 dark:border-purple-800">
                                            <span className="font-medium text-purple-700 dark:text-purple-300">{t.name}</span>
                                            <span className="text-gray-600 dark:text-gray-400"> • {formatDisplayNumber(t.computedMeters || 0)} m</span>
                                            <span className="text-gray-500 dark:text-gray-500"> × {formatPrice(t.pricePerMeter || 0)}</span>
                                          </div>
                                        ))}
                                        {finishing && finishing.cost ? (
                                          <div className="bg-teal-50 dark:bg-teal-900/20 px-2 py-1 rounded border border-teal-200 dark:border-teal-800">
                                            <span className="font-medium text-teal-700 dark:text-teal-300">پرداخت:</span>
                                            <span className="text-gray-600 dark:text-gray-400 mr-1">
                                              {it.finishingName || 'پرداخت'} • {finishing.amountLabel}
                                            </span>
                                            <span className="text-teal-600 dark:text-teal-300 font-semibold">
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
                                    <span className="font-medium text-purple-600 dark:text-purple-400">{formatPrice(toolsTotal)}</span>
                                  ) : (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">-</span>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <span className="font-semibold text-teal-600 dark:text-teal-400">
                                    {formatPrice(
                                      typeof it.totalPrice === 'number' ? it.totalPrice : (typeof it.totalPrice === 'string' ? parseFloat(it.totalPrice) || 0 : 0)
                                    )}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="bg-gradient-to-r from-teal-50 to-teal-100 dark:from-teal-900/30 dark:to-teal-800/30 border-t-2 border-teal-300 dark:border-teal-700">
                            <td className="py-3 px-4 font-bold text-teal-900 dark:text-teal-200" colSpan={7}>جمع کل گروه</td>
                            <td className="py-3 px-4">
                              <span className="font-bold text-lg text-teal-700 dark:text-teal-300">
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
              <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2 flex-shrink-0">
                <button type="button" className="px-3 py-2 rounded-md bg-gray-200 dark:bg-gray-700" onClick={() => setShowProductModal(false)}>انصراف</button>
                <button type="button" className="min-h-11 rounded-lg border border-teal-400/60 bg-teal-500/10 px-4 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-500/20 dark:text-teal-200" onClick={() => {
                  const [draft] = getActiveDraft();
                  // Validate required fields
                  const fieldErrors = validateDraftRequiredFields(stairSystemV2.stairActivePart, draft, stairSystemV2.layerTypes);
                  const hasErrors = Object.values(fieldErrors).some(Boolean);
                  if (hasErrors) {
                    stairSystemV2.setStairDraftErrors(prev => ({
                      ...prev,
                      [stairSystemV2.stairActivePart]: {
                        ...prev[stairSystemV2.stairActivePart],
                        ...fieldErrors
                      }
                    }));
                    setErrors({ products: 'لطفاً خطاهای مشخص‌شده را برطرف کنید' });
                    return;
                  }
                  stairSystemV2.setStairDraftErrors(prev => ({ ...prev, [stairSystemV2.stairActivePart]: {} }));
                  setErrors({});
                  const sid = stairSystemV2.ensureStairSessionId();
                  const totals = computeTotalsV2(stairSystemV2.stairActivePart, draft);
                  const chargeableCuttingCost = totals.billableCuttingCost;
                  const chargeableCuttingCostLongitudinal = totals.billableCuttingCostLongitudinal;
                  const chargeableCuttingCostCross = totals.billableCuttingCostCross;
                  const actualLengthM = getActualLengthMeters(draft);
                  const pricingLengthM = getPricingLengthMeters(draft);
                  const widthM = (draft.widthCm || 0) / 100;
                  const toolsMeters = computeToolsMetersV2(stairSystemV2.stairActivePart, draft);
                  let metaTools = (draft.tools || []).map(t => {
                    const meters = computeToolMetersForTool(stairSystemV2.stairActivePart, draft, t);
                    return {
                      toolId: t.toolId,
                      name: t.name,
                      pricePerMeter: t.pricePerMeter,
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
                  if (totals.cuttingCostLongitudinal > 0 && totals.shouldChargeCuttingCost) {
                    const cutMeters = actualLengthM * totals.baseStoneQuantity;
                    metaTools = [
                      ...metaTools,
                      {
                        toolId: `cut-longitudinal-${draft.stoneId || 'new'}`,
                        name: 'برش طولی',
                        pricePerMeter: totals.cuttingCostPerMeterLongitudinal || totals.cuttingCostPerMeter,
                        edges: { front: false, left: false, right: false, back: false, perimeter: true },
                        computedMeters: cutMeters,
                        totalPrice: chargeableCuttingCostLongitudinal
                      }
                    ];
                  }
                  if (totals.cuttingCostCross > 0 && totals.shouldChargeCuttingCost) {
                    const widthMeters = ((draft.widthCm || 0) / 100) * totals.baseStoneQuantity;
                    // Use "برش کله بر" if there's only 1 cross cut (no longitudinal cut)
                    const hasOnlyCrossCut = totals.cuttingCostLongitudinal === 0 || !totals.cuttingCostLongitudinal;
                    const cutName = hasOnlyCrossCut ? 'برش کله بر' : 'برش عرضی';
                    metaTools = [
                      ...metaTools,
                      {
                        toolId: `cut-cross-${draft.stoneId || 'new'}`,
                        name: cutName,
                        pricePerMeter: totals.cuttingCostPerMeterCross || totals.cuttingCostPerMeter,
                        edges: { front: false, left: false, right: false, back: false, perimeter: true },
                        computedMeters: widthMeters,
                        totalPrice: chargeableCuttingCostCross
                      }
                    ];
                  }
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
                      id: `applied_${tool.toolId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                      subServiceId: tool.toolId,
                      subService: selectedSubService || fallbackSubService,
                      meter: meters,
                      cost: meters * (tool.pricePerMeter || 0),
                      calculationBase: selectedSubService?.calculationBase || 'length',
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
                  const totalPrice = basePrice + toolsTotal + finishingCost + chargeableCuttingCost;
                  
                  const hasWidthCut = totals.cuttingCostLongitudinal > 0;
                  const hasLengthCut = totals.cuttingCostCross > 0;
                  
                  // Calculate remaining stone if product was cut
                  let remainingStones: RemainingStone[] = [];
                  let isCut = false;
                  let cutType: 'longitudinal' | 'cross' | null = null;
                  let cuttingCost = chargeableCuttingCost;
                  let cuttingCostPerMeter = totals.shouldChargeCuttingCost ? totals.cuttingCostPerMeter : 0;
                  let cutDetails: StoneCut[] = [];
                  const cuttingBreakdown: CuttingBreakdownEntry[] = [];
                  
                  if (hasWidthCut) {
                    isCut = true;
                    cutType = 'longitudinal';
                    const remainingWidth = totals.leftoverWidthCm;
                    if (remainingWidth > 0 && actualLengthM > 0 && baseStoneQuantity > 0) {
                      const remainingStoneId = `remaining_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                      const remainingWidthInMeters = remainingWidth / 100;
                      const remainingStone: RemainingStone = {
                        id: remainingStoneId,
                        width: remainingWidth,
                        length: actualLengthM,
                        squareMeters: (remainingWidthInMeters * actualLengthM * baseStoneQuantity),
                        isAvailable: remainingWidth > 0,
                        sourceCutId: `cut_${draft.stoneId}_${Date.now()}`,
                        quantity: baseStoneQuantity
                      };
                      remainingStones = [remainingStone];
                    }
                    
                    const cutId = `cut_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    const cutDetail: StoneCut = {
                      id: cutId,
                      originalWidth: originalWidthCm,
                      cutWidth: userWidthCm,
                      remainingWidth: totals.leftoverWidthCm,
                      length: actualLengthM * 100 * baseStoneQuantity,
                      cuttingCost: chargeableCuttingCostLongitudinal,
                      cuttingCostPerMeter: totals.shouldChargeCuttingCost
                        ? (totals.cuttingCostPerMeterLongitudinal || totals.cuttingCostPerMeter)
                        : 0,
                      orientation: 'longitudinal'
                    };
                    cutDetails = [cutDetail];
                    cuttingBreakdown.push({
                      type: 'longitudinal',
                      meters: actualLengthM * baseStoneQuantity,
                      rate: totals.shouldChargeCuttingCost
                        ? (totals.cuttingCostPerMeterLongitudinal || totals.cuttingCostPerMeter)
                        : 0,
                      cost: chargeableCuttingCostLongitudinal
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
                      const widthMeters = userWidthCm / 100;
                      const crossRemaining: RemainingStone = {
                        id: crossStoneId,
                        width: userWidthCm,
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
                          length: userWidthCm * baseStoneQuantity,
                          cuttingCost: chargeableCuttingCostCross,
                          cuttingCostPerMeter: totals.shouldChargeCuttingCost
                            ? (totals.cuttingCostPerMeterCross || totals.cuttingCostPerMeter)
                            : 0,
                          orientation: 'cross'
                        }
                      ];
                    }
                    cuttingBreakdown.push({
                      type: 'cross',
                      meters: (userWidthCm / 100) * baseStoneQuantity,
                      rate: totals.shouldChargeCuttingCost
                        ? (totals.cuttingCostPerMeterCross || totals.cuttingCostPerMeter)
                        : 0,
                      cost: chargeableCuttingCostCross
                    });
                  }
                  
                  const storedLengthValue = convertMetersToUnit(actualLengthM, draft.lengthUnit || 'm');
                  const product: ContractProduct = {
                    productId: draft.stoneId!,
                    product: stoneProduct,
                    productType: 'stair',
                    stairSystemId: sid,
                    stairPartType: stairSystemV2.stairActivePart,
                    stoneCode: stoneProduct.code,
                    stoneName: generateCompactProductName(stoneProduct) || draft.stoneLabel || stoneProduct.namePersian || stoneProduct.name || '',
                    diameterOrWidth: draft.thicknessCm || stoneProduct.thicknessValue || 0, // قطر = ضخامت (thickness)
                    length: storedLengthValue,
                    lengthUnit: draft.lengthUnit || 'cm',
                    width: draft.widthCm!,
                    widthUnit: 'cm',
                    quantity: draft.quantity!,
                    squareMeters: totals.sqm,
                    pricePerSquareMeter: draft.pricePerSquareMeter!,
                    totalPrice: totalPrice,
                    description: draft.description || '',
                    images: [...(stoneProduct.images || [])],
                    currency: 'تومان',
                    isMandatory: isDraftMandatory && mandatoryPercentageValue > 0,
                    mandatoryPercentage: isDraftMandatory && mandatoryPercentageValue > 0 ? mandatoryPercentageValue : 0,
                    originalTotalPrice: totals.baseMaterialPrice,
                    isCut: isCut,
                    cutType: cutType,
                    originalWidth: originalWidthCm,
                    originalLength: actualLengthM, // Store original length in meters for canvas visualization
                    cuttingCost: cuttingCost,
                    cuttingCostPerMeter: cuttingCostPerMeter,
                    cutDescription: isCut
                      ? hasWidthCut && hasLengthCut
                        ? `برش طولی (${originalWidthCm}cm → ${userWidthCm}cm) و برش عرضی (${formatDisplayNumber(pricingLengthM)}m → ${formatDisplayNumber(actualLengthM)}m)`
                        : hasWidthCut
                          ? `برش طولی (${originalWidthCm}cm → ${userWidthCm}cm)`
                          : `برش کله بر (${formatDisplayNumber(pricingLengthM)}m → ${formatDisplayNumber(actualLengthM)}m)`
                      : '',
                    remainingStones: remainingStones,
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
                    standardLengthValue: stairSystemV2.stairActivePart === 'riser' ? null : (draft.standardLengthValue ?? null),
                    standardLengthUnit: stairSystemV2.stairActivePart === 'riser'
                      ? (draft.lengthUnit || 'm')
                      : (draft.standardLengthUnit || draft.lengthUnit || 'm'),
                    actualLengthMeters: actualLengthM || null,
                    finishingId: draft.finishingEnabled ? draft.finishingId || null : null,
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
                        baseStoneQuantity: totals.baseStoneQuantity,
                        piecesPerStone: totals.piecesPerStone,
                        leftoverWidthCmPerStone: totals.leftoverWidthCm,
                        pricingSquareMeters: totals.pricingSquareMeters,
                        standardLength: stairSystemV2.stairActivePart !== 'riser' && draft.standardLengthValue ? {
                          value: draft.standardLengthValue,
                          unit: draft.standardLengthUnit || draft.lengthUnit || 'm',
                          meters: pricingLengthM
                        } : undefined,
                      },
                      finishing: draft.finishingEnabled && finishingCost > 0 ? {
                        id: draft.finishingId,
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
                  
                  // Prepare all updates in a single transaction
                  stairSystemV2.setStairSessionItems(prev => {
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
                    
                    // Process layers if configured
                    if (draft.numberOfLayersPerStair && draft.numberOfLayersPerStair > 0 && 
                        draft.layerWidthCm && hasLayerEdges && layerManagement.getLayerEffectivePricePerSquareMeter(draft) && 
                        draft.quantity) {
                      
                      // 🎯 STEP 1: Find existing layer product inside this session only.
                      // Stair rows can repeat independently, so matching contract rows must not merge across rows.
                      const existingLayerInSession = findExistingLayerProduct(updatedItems, draft, stairSystemV2.stairActivePart);
                      const existingLayerProduct = existingLayerInSession;
                      
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
                      const usingAlternateLayerStone = !!(draft.layerUseDifferentStone && draft.layerStoneProduct);
                      const baseLayerPricePerSqm = layerManagement.getLayerBasePricePerSquareMeter(draft);
                      const effectiveLayerPricePerSqm = layerManagement.getLayerEffectivePricePerSquareMeter(draft);

                      // Get cutting cost per meter for layer calculations
                      const layerCuttingCostPerMeter =
                        (layerStoneProduct as any)?.cuttingCostPerMeter ??
                        getCuttingTypePricePerMeter('LONG') ??
                        0;
                      
                      // 🎯 STEP 3: Collect all available remaining stones
                      const allAvailableRemainingStones = usingAlternateLayerStone
                        ? []
                        : collectAvailableRemainingStones(updatedItems, []);
                      
                      // 🎯 STEP 4: Calculate layer metrics (remaining stone usage, cutting costs, etc.)
                      const totalLayerDemand = layerEdgeDemands.length
                        ? layerEdgeDemands.reduce((sum, demand) => sum + demand.layersNeeded, 0)
                        : totalLayers;
                      const layerMetrics = usingAlternateLayerStone
                        ? {
                            layersFromRemainingStones: 0,
                            layersFromNewStones: totalLayerDemand,
                            totalLayerCuttingCost: 0,
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
                            cuttingCostPerMeter: layerCuttingCostPerMeter,
                            edgeDemands: layerEdgeDemands
                          });

                      if (!usingAlternateLayerStone && layerMetrics.layersFromNewStones > 0 && !draft.layerShortageSource) {
                        setErrors({ products: 'برای کمبود سنگ لایه، منبع تامین را انتخاب کنید.' });
                        return baseItems;
                      }

                      if (draft.layerShortageSource === 'manualWarehouse') {
                        if (!draft.layerManualSourceWidthCm || !draft.layerManualSourceLengthM || !draft.layerManualSourceQuantity) {
                          setErrors({ products: 'برای تامین دستی لایه از انبار، عرض، طول و تعداد سنگ موجود را وارد کنید.' });
                          return baseItems;
                        }
                      }
                      
                      // 🎯 STEP 5: Calculate pricing
                      const layerSqmPerStair = totalLayerSqm / (draft.quantity * draft.numberOfLayersPerStair);
                      const layerTypeUnitPrice = draft.layerTypePrice || 0;
                      
                      // 🎯 FIX: Calculate layer type cost based on total length per stair × number of stairs × layer type price per meter
                      // مجموع طوله های لایه برای یک پله (چپ + راست + جلو) × تعداد پله ها × هزینه هر نوع لایه
                      const totalLayerLengthPerStairM = layerManagement.getTotalLayerLengthPerStairM(stairSystemV2.stairActivePart, draft);
                      const totalLayerLengthM = totalLayerLengthPerStairM * draft.quantity;
                      const layerTypeCost = totalLayerLengthM * layerTypeUnitPrice;
                      
                      const layerSqmFromNew = (() => {
                        if (layerMetrics.squareMetersFromNew !== undefined) {
                          return layerMetrics.squareMetersFromNew;
                        }
                        const totalDemand = layerMetrics.totalLayerDemand || totalLayerDemand || 0;
                        if (totalDemand <= 0) {
                          return 0;
                        }
                        return layerSqmPerStair * (layerMetrics.layersFromNewStones / totalDemand);
                      })();
                      
                      const calculateStoneAreaUsed = (): number => {
                        const manualWarehouse = draft.layerShortageSource === 'manualWarehouse';
                        const stoneWidthCm = manualWarehouse
                          ? (draft.layerManualSourceWidthCm || 0)
                          : (layerStoneProduct?.widthValue || originalWidthCm);
                        const stoneLengthM = manualWarehouse
                          ? (draft.layerManualSourceLengthM || mainStairLengthM)
                          : mainStairLengthM;
                        if (stoneWidthCm <= 0 || layerWidthCm <= 0 || stoneLengthM <= 0) {
                          return usingAlternateLayerStone ? totalLayerSqm : layerSqmFromNew;
                        }
                        
                        const stoneWidthM = stoneWidthCm / 100;
                        const columnsPerStone = Math.max(1, Math.floor(stoneWidthCm / layerWidthCm));
                        const baseLength = Math.max(layerLengthM, stoneLengthM);
                        
                        const unfulfilledDemands = (layerMetrics.unfulfilledDemands && layerMetrics.unfulfilledDemands.length)
                          ? layerMetrics.unfulfilledDemands
                          : [{
                              edge: 'front' as LayerEdgeDemand['edge'],
                              lengthM: layerLengthM > 0 ? layerLengthM : stoneLengthM,
                              quantity: layerMetrics.layersFromNewStones
                            }];
                        
                        let totalStonesNeeded = 0;
                        unfulfilledDemands.forEach(demand => {
                          if (!demand.lengthM || demand.lengthM <= 0 || !demand.quantity) {
                            return;
                          }
                          
                          const stripsPerColumn = Math.max(1, Math.floor(stoneLengthM / demand.lengthM));
                          const stripsPerStone = Math.max(1, stripsPerColumn * columnsPerStone);
                          totalStonesNeeded += Math.ceil(demand.quantity / stripsPerStone);
                        });
                        
                        if (totalStonesNeeded === 0) {
                          return usingAlternateLayerStone ? totalLayerSqm : layerSqmFromNew;
                        }
                        
                        return totalStonesNeeded * stoneLengthM * stoneWidthM;
                      };
                      
                      const stoneAreaUsedSqm = usingAlternateLayerStone
                        ? totalLayerSqm
                        : calculateStoneAreaUsed();
                      
                      const pricingStoneAreaSqm = stoneAreaUsedSqm > 0 ? stoneAreaUsedSqm : layerSqmFromNew;
                      
                      const shouldChargeLayerCutting =
                        !(usingAlternateLayerStone && (draft.layerUseMandatory ?? true) && (draft.layerMandatoryPercentage ?? 0) > 0);
                      const chargeableLayerCuttingCost = shouldChargeLayerCutting ? layerMetrics.totalLayerCuttingCost : 0;
                      // 🎯 FIX: Layer material price should be based on stone area used, NOT layer square meters
                      // 🎯 NOTE: effectiveLayerPricePerSqm already includes mandatory pricing if applicable
                      // Example: stoneAreaUsedSqm (0.976 m²) × pricePerSqm (700,000) = 683,200 تومان
                      const layerMaterialPrice = pricingStoneAreaSqm * effectiveLayerPricePerSqm;
                      // 🎯 FIX: Ensure layerTotalPrice is always a number (not string) and properly rounded
                      const layerTotalPrice = Number((layerMaterialPrice + layerTypeCost + chargeableLayerCuttingCost).toFixed(2));
                      
                      // 🎯 STEP 6: Handle existing session layer merge OR create a new layer product
                      if (existingLayerProduct) {
                        const existingLayerIndex = updatedItems.findIndex(item => item === existingLayerProduct);
                        
                        if (existingLayerIndex >= 0) {
                          // Merge existing layer product in session
                          const mergedLayerProduct = layerManagement.mergeLayerProduct(existingLayerProduct, {
                            draft,
                            parentPartType: stairSystemV2.stairActivePart,
                            newLayersNeeded: totalLayers,
                            newLayerSqm: totalLayerSqm,
                            layerMaterialPrice,
                            layerTypeCost,
                            totalLayerCuttingCost: chargeableLayerCuttingCost,
                            layerCutDetails: layerMetrics.layerCutDetails,
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
                          totalLayerSqm,
                          layerMaterialPrice,
                          layerTotalPrice,
                          layerTypeCost,
                          layersFromRemainingStones: layerMetrics.layersFromRemainingStones,
                          layersFromNewStones: layerMetrics.layersFromNewStones,
                          totalLayerCuttingCost: chargeableLayerCuttingCost,
                          layerCutDetails: layerMetrics.layerCutDetails,
                          layerRemainingPieces: layerMetrics.layerRemainingPieces,
                          usedRemainingStonesForLayers: layerMetrics.usedRemainingStonesForLayers,
                          originalWidthCm: layerStoneProduct?.widthValue || originalWidthCm,
                          lengthM: mainStairLengthM,
                          layerCuttingCostPerMeter,
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
                        updatedItems.push(newLayerProduct);
                      }
                      
                      // 🎯 STEP 7: Update remaining stone usage tracking
                      if (layerMetrics.usedRemainingStonesForLayers.length > 0) {
                        const remainingStoneUpdates = layerManagement.updateRemainingStoneUsage(
                          updatedItems,
                          layerMetrics.usedRemainingStonesForLayers,
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
                    
                    return updatedItems;
                  });
                  
                  // Reset fields for quick next entry (keep unit toggle)
                  const [, setDraft] = getActiveDraft();
                  const defaultMandatoryAfterReset = stairSystemV2.stairActivePart === 'riser' || stairSystemV2.stairActivePart === 'landing';
                  setDraft({
                    stoneId: null,
                    stoneLabel: '',
                    stoneProduct: null,
                    pricePerSquareMeter: null,
                    useMandatory: defaultMandatoryAfterReset,
                    mandatoryPercentage: defaultMandatoryAfterReset ? 20 : null,
                    thicknessCm: null,
                    lengthValue: null,
                    lengthUnit: draft.lengthUnit || 'm', // Default to meters for length
                    widthCm: null,
                    quantity: null,
                    squareMeters: null,
                    tools: [],
                    totalPrice: null,
                    // Reset layer fields
                    numberOfLayersPerStair: null,
                    layerWidthCm: null,
                    layerTypeId: null,
                    layerTypeName: null,
                    layerTypePrice: null,
                    layerEdges: undefined,
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
                    layerManualSourceQuantity: null,
                    standardLengthValue: null,
                    standardLengthUnit: draft.lengthUnit || 'm',
                    finishingEnabled: false,
                    finishingId: null,
                    finishingLabel: null,
                    finishingPricePerSquareMeter: null,
                    finishingUnitPrice: null,
                    finishingCalculationBase: null,
                    finishingQuantity: null
                  });
                  stairSystemV2.setStoneSearchTerm('');
                  stairSystemV2.setToolsSearchTerm('');
                  stairSystemV2.setToolsDropdownOpen(false);
                  setErrors({});
                }}>افزودن این بخش</button>
                <button type="button" className="min-h-11 rounded-lg bg-gradient-to-r from-teal-500 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-teal-600 hover:to-teal-700" onClick={() => {
                  if (!stairSystemV2.stairSessionItems.length) { setShowProductModal(false); return; }
                  
                  // Handle edit mode: replace existing products instead of adding new ones
                  if (isEditMode && editingProductIndex !== null) {
                    const oldProduct = wizardData.products[editingProductIndex];
                    const oldStairSystemId = oldProduct?.stairSystemId;
                    
                    if (oldStairSystemId) {
                      const productsToAdd = stairSystemV2.stairSessionItems.map((item) => {
                        const isLayer = ((item.meta as any)?.isLayer) || false;
                        return {
                          ...item,
                          stairSystemId: oldStairSystemId,
                          parentProductIndex: isLayer ? editingProductIndex : item.parentProductIndex
                        };
                      });
                      
                      updateWizardData({
                        products: replaceStairRowWithAttachedLayers(wizardData.products, editingProductIndex, productsToAdd),
                        selectedProductTypeForAddition: 'stair'
                      });
                      clearProductAdditionSearches();
                    } else {
                      // Fallback: just replace the single product
                      const updatedProducts = [...wizardData.products];
                      updatedProducts[editingProductIndex] = stairSystemV2.stairSessionItems[0];
                      updateWizardData({ products: updatedProducts, selectedProductTypeForAddition: 'stair' });
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
                    updateWizardData({ products: [...updatedProducts, ...productsToAdd], selectedProductTypeForAddition: 'stair' });
                    clearProductAdditionSearches();
                  }
                  
                  stairSystemV2.setStairSessionItems([]);
                  stairSystemV2.setStairSessionId(null);
                  setIsEditMode(false);
                  setEditingProductIndex(null);
                  setShowProductModal(false);
                }}>اتمام و افزودن به قرارداد</button>
              </div>
            </div>
          </div>
        )}
        {shouldShowLegacyStairModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto z-[10000]">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-semibold text-gray-800 dark:text-white">
                    {isEditMode ? 'ویرایش محصول پله' : 'محصول پله'}
                  </h3>
                  <button
                    onClick={() => {
                      // Validate before closing if it's a stair system
                      if (productConfig.productType === 'stair' && stairSystemConfig) {
                        const hasSelectedPart = stairSystemConfig.tread.isSelected ||
                                                stairSystemConfig.riser.isSelected ||
                                                stairSystemConfig.landing.isSelected;

                        if (!hasSelectedPart) {
                          setErrors({ products: 'لطفاً حداقل یکی از بخش‌های پله (کف پله، خیز پله، یا پاگرد) را انتخاب کنید' });
                          return;
                        }
                      }

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
                      setStairSystemConfig(null);
                      setErrors({});
                    }}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    aria-label="بستن پنجره"
                    title="بستن"
                  >
                    <FaTimes className="w-6 h-6" />
                  </button>
                </div>

                {/* Error Display */}
                {errors.products && (
                  <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-red-600 dark:text-red-400 text-sm">{errors.products}</p>
                  </div>
                )}

                {/* Product Info - Show for longitudinal and slab products */}
                {selectedProduct && (productConfig.productType === 'longitudinal' || productConfig.productType === 'slab') && (
                  <div className={`mb-6 p-4 rounded-lg ${
                    productConfig.productType === 'slab' 
                      ? 'bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-200 dark:border-indigo-800' 
                      : 'bg-gray-50 dark:bg-gray-700'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-gray-800 dark:text-white">
                          {selectedProduct.namePersian}
                        </h4>
                        {productConfig.productType === 'slab' && (
                          <span className="px-2 py-1 bg-indigo-500 text-white text-xs rounded-full font-medium">
                            سنگ اسلب
                          </span>
                        )}
                        {productConfig.productType === 'longitudinal' && (
                          <span className="px-2 py-1 bg-teal-500 text-white text-xs rounded-full font-medium">
                            سنگ طولی
                          </span>
                        )}
                      </div>
                      {isEditMode && (
                        <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-xs rounded-full">
                          حالت ویرایش
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {selectedProduct.stoneTypeNamePersian} • عرض {selectedProduct.widthValue}×ضخامت {selectedProduct.thicknessValue}cm
                      {productConfig.productType === 'slab' && (
                        <span className="ml-2 text-indigo-600 dark:text-indigo-400">• برش دو بعدی (طول و عرض)</span>
                      )}
                    </p>
                  </div>
                )}
                
                {/* Stair System Info - Show when editing stair system */}
                {productConfig.productType === 'stair' && stairSystemConfig && (
                  <div className="mb-6 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-purple-800 dark:text-purple-200">
                        ویرایش دستگاه پله
                      </h4>
                      {isEditMode && (
                        <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 text-xs rounded-full">
                          حالت ویرایش
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-purple-600 dark:text-purple-300">
                      {stairSystemConfig.numberOfSteps} پله ({stairSystemConfig.quantityType === 'steps' ? 'تعداد پله' : 'تعداد پله‌کان'})
                    </p>
                  </div>
                )}

                {/* Configuration Form */}
                <div className="space-y-4">
                  {/* Conditional rendering based on product type */}
                  {productConfig.productType === 'stair' ? (
                    /* STAIR SYSTEM (دستگاه پله) CONFIGURATION FORM - 3 Sections */
                    <>
                      {/* Common Configuration */}
                      <div className="space-y-4">
                        {/* Quantity Type Switcher */}
                        <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 bg-gray-50 dark:bg-gray-700/50">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                            نوع تعداد:
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setQuantityType('steps');
                                updateStairSystemConfig(prev => prev ? { ...prev, quantityType: 'steps' } : null);
                              }}
                              className={`flex-1 px-4 py-3 rounded-lg transition-all font-medium ${
                                stairSystemConfig?.quantityType === 'steps'
                                  ? 'bg-teal-500 text-white shadow-lg'
                                  : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                              }`}
                            >
                              تعداد پله
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setQuantityType('staircases');
                                updateStairSystemConfig(prev => prev ? { ...prev, quantityType: 'staircases' } : null);
                              }}
                              className={`flex-1 px-4 py-3 rounded-lg transition-all font-medium ${
                                stairSystemConfig?.quantityType === 'staircases'
                                  ? 'bg-teal-500 text-white shadow-lg'
                                  : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                              }`}
                            >
                              تعداد پله‌کان کامل
                            </button>
                          </div>
                        </div>

                        {/* Number of Steps (Common) */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {stairSystemConfig?.quantityType === 'steps' ? 'تعداد پله' : 'تعداد پله در هر پله‌کان'}
                          </label>
                          <FormattedNumberInput
                            value={stairSystemConfig?.numberOfSteps || 0}
                            onChange={(value) => {
                              updateStairSystemConfig(prev => {
                                if (!prev) return null;
                                const newNumberOfSteps = value || 0;
                                // Update default quantities for tread and riser if they haven't been manually changed
                                return {
                                  ...prev,
                                  numberOfSteps: newNumberOfSteps,
                                  tread: {
                                    ...prev.tread,
                                    quantity: prev.tread.quantity === 0 || prev.tread.quantity === prev.numberOfSteps 
                                      ? newNumberOfSteps 
                                      : prev.tread.quantity
                                  },
                                  riser: {
                                    ...prev.riser,
                                    quantity: prev.riser.quantity === 0 || prev.riser.quantity === prev.numberOfSteps 
                                      ? newNumberOfSteps 
                                      : prev.riser.quantity
                                  }
                                };
                              });
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            min={0}
                            step={1}
                            placeholder="تعداد پله"
                          />
                        </div>

                        {/* Number of Staircases (if quantityType === 'staircases') */}
                        {stairSystemConfig?.quantityType === 'staircases' && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              تعداد پله‌کان کامل
                            </label>
                            <FormattedNumberInput
                              value={stairSystemConfig?.numberOfStaircases || 1}
                              onChange={(value) => {
                                updateStairSystemConfig(prev => prev ? { ...prev, numberOfStaircases: value || 1 } : null);
                              }}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                              min={1}
                              step={1}
                              placeholder="1"
                            />
                          </div>
                        )}
                      </div>
                      {/* Three Collapsible Sections for Stair Parts */}
                      <div className="space-y-4">
                        {/* Section 1: کف پله (Tread) */}
                        <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setTreadExpanded(!treadExpanded)}
                            className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <input
                                id="tread-selection-checkbox"
                                type="checkbox"
                                checked={stairSystemConfig?.tread.isSelected || false}
                                onChange={(e) => {
                                  updateStairPart('tread', { isSelected: e.target.checked });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                aria-label="انتخاب کف پله"
                                className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                              />
                              <span className="font-semibold text-gray-800 dark:text-white">کف پله (Tread)</span>
                            </div>
                            {treadExpanded ? (
                              <FaChevronUp className="text-gray-500 dark:text-gray-400" />
                            ) : (
                              <FaChevronDown className="text-gray-500 dark:text-gray-400" />
                            )}
                          </button>
                          
                          {treadExpanded && stairSystemConfig && (
                            <div className="p-4 space-y-4 border-t border-gray-200 dark:border-gray-600">
                              {/* Product Selection for Tread */}
                              <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                  انتخاب محصول:
                                </label>
                                {stairSystemConfig.tread.product ? (
                                  <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg mb-2">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="font-medium text-gray-800 dark:text-white">
                                          {generateFullProductName(stairSystemConfig.tread.product)}
                                        </p>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                          {stairSystemConfig.tread.product.stoneTypeNamePersian} • عرض {stairSystemConfig.tread.product.widthValue}×ضخامت {stairSystemConfig.tread.product.thicknessValue}cm
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          updateStairPart('tread', {
                                            productId: null,
                                            product: null,
                                            pricePerSquareMeter: 0
                                          });
                                          syncDraftWithProduct('tread', null);
                                          if (stairSystemV2.stairActivePart === 'tread') {
                                            stairSystemV2.setStoneSearchTerm('');
                                          }
                                          setTreadProductSearchTerm('');
                                        }}
                                        className="text-sm text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teال-300"
                                      >
                                        تغییر
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mb-2">
                                    <div className="relative">
                                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <FaSearch className="h-5 w-5 text-gray-400" />
                                      </div>
                                      <input
                                        type="text"
                                        placeholder="جستجو محصول..."
                                        value={treadProductSearchTerm}
                                        onChange={(e) => setTreadProductSearchTerm(e.target.value)}
                                        className="w-full pr-10 pl-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                      />
                                    </div>
                                    {treadProductSearchTerm && (
                                      <div className="mt-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800">
                                        {filteredTreadProducts.map((product) => (
                                          <div
                                            key={product.id}
                                            onClick={() => {
                                              selectProductForStairPart('tread', product);
                                              setTreadProductSearchTerm('');
                                            }}
                                            className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                                          >
                                            <p className="font-medium text-gray-800 dark:text-white text-sm">
                                              {generateFullProductName(product)}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                              {product.basePrice ? formatPrice(product.basePrice, product.currency) : 'قیمت نامشخص'}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Tread Dimensions */}
                              {stairSystemConfig.tread.product && (
                                <>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Tread Width */}
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        طول پله (عرض پله‌کان)
                                      </label>
                                      <div className="space-y-2">
                                        <FormattedNumberInput
                                          value={stairSystemConfig.tread.treadWidth || 0}
                                          onChange={(value) => {
                                            updateStairPart('tread', { treadWidth: value || 0 });
                                          }}
                                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                          min={0}
                                          step={0.1}
                          decimalScale={4}
                          placeholder="طول پله"
                                        />
                                        <div className="flex gap-1">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              updateStairPart('tread', { lengthUnit: 'cm' });
                                              if (stairSystemConfig.tread.treadWidth) {
                                                const converted = stairSystemConfig.tread.lengthUnit === 'm' ? stairSystemConfig.tread.treadWidth * 100 : stairSystemConfig.tread.treadWidth;
                                                updateStairPart('tread', { treadWidth: converted });
                                              }
                                            }}
                                            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                                              stairSystemConfig.tread.lengthUnit === 'cm'
                                                ? 'bg-teal-500 text-white shadow-lg'
                                                : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                                            }`}
                                          >
                                            سانتی‌متر (cm)
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              updateStairPart('tread', { lengthUnit: 'm' });
                                              if (stairSystemConfig.tread.treadWidth) {
                                                const converted = stairSystemConfig.tread.lengthUnit === 'cm' ? stairSystemConfig.tread.treadWidth / 100 : stairSystemConfig.tread.treadWidth;
                                                updateStairPart('tread', { treadWidth: converted });
                                              }
                                            }}
                                            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                                              stairSystemConfig.tread.lengthUnit === 'm'
                                                ? 'bg-teal-500 text-white shadow-lg'
                                                : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                                            }`}
                                          >
                                            متر (m)
                                          </button>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Tread Depth */}
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        عرض پله (عمق پله) (cm)
                                      </label>
                                      <FormattedNumberInput
                                        value={stairSystemConfig.tread.treadDepth || 30}
                                        onChange={(value) => {
                                          updateStairPart('tread', { treadDepth: value || 30 });
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                        min={0}
                                        step={0.1}
                          decimalScale={4}
                          placeholder="30"
                                      />
                                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                        معمولاً 28-32 سانتی‌متر
                                      </p>
                                    </div>
                                  </div>

                                  {/* Quantity for Tread */}
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                      تعداد (پیش‌فرض: {stairSystemConfig.numberOfSteps || 0})
                                    </label>
                                    <FormattedNumberInput
                                      value={stairSystemConfig.tread.quantity || stairSystemConfig.numberOfSteps || 0}
                                      onChange={(value) => {
                                        updateStairPart('tread', { quantity: value || 0 });
                                      }}
                                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                      min={0}
                                      step={1}
                                      placeholder={`${stairSystemConfig.numberOfSteps || 0}`}
                                    />
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      به طور پیش‌فرض با تعداد پله همگام است، اما می‌توانید تغییر دهید
                                    </p>
                                  </div>

                                  {/* Tread Calculations */}
                                  {(() => {
                                    const treadMetrics = calculateTreadMetrics({
                                      treadWidth: stairSystemConfig.tread.treadWidth || 0,
                                      treadWidthUnit: stairSystemConfig.tread.lengthUnit || 'm',
                                      treadDepth: stairSystemConfig.tread.treadDepth || 30,
                                      quantity: stairSystemConfig.tread.quantity || stairSystemConfig.numberOfSteps || 0,
                                      quantityType: stairSystemConfig.quantityType,
                                      numberOfStaircases: stairSystemConfig.numberOfStaircases || 1
                                    });
                                    
                                    const nosingCost = calculateNosingCuttingCost({
                                      nosingType: stairSystemConfig.tread.nosingType || 'none',
                                      treadWidth: stairSystemConfig.tread.treadWidth || 0,
                                      treadWidthUnit: stairSystemConfig.tread.lengthUnit || 'm',
                                      numberOfSteps: stairSystemConfig.tread.quantity || stairSystemConfig.numberOfSteps || 0,
                                      numberOfStaircases: stairSystemConfig.quantityType === 'staircases' ? (stairSystemConfig.numberOfStaircases || 1) : 1,
                                      quantityType: stairSystemConfig.quantityType
                                    });
                                    
                                    const basePrice = treadMetrics.totalArea * (stairSystemConfig.tread.pricePerSquareMeter || 0);
                                    const mandatoryPrice = stairSystemConfig.tread.isMandatory && stairSystemConfig.tread.mandatoryPercentage
                                      ? basePrice * (stairSystemConfig.tread.mandatoryPercentage / 100)
                                      : 0;
                                    const totalPrice = basePrice + mandatoryPrice + nosingCost.cuttingCost;
                                    
                                    // Update stair part with calculated values
                                    // Always update if squareMeters or totalPrice changed (to handle price/mandatory/nosing changes)
                                    // Use Math.abs to handle floating point comparison issues
                                    const squareMetersChanged = Math.abs((stairSystemConfig.tread.squareMeters || 0) - treadMetrics.totalArea) > 0.001;
                                    const totalPriceChanged = Math.abs((stairSystemConfig.tread.totalPrice || 0) - totalPrice) > 0.01;
                                    
                                    if (squareMetersChanged || totalPriceChanged) {
                                      // Use requestAnimationFrame for better state update timing
                                      requestAnimationFrame(() => {
                                        updateStairPart('tread', {
                                          squareMeters: treadMetrics.totalArea,
                                          totalPrice: totalPrice,
                                          originalTotalPrice: basePrice,
                                          nosingCuttingCost: nosingCost.cuttingCost,
                                          nosingCuttingCostPerMeter: nosingCost.cuttingCostPerMeter
                                        });
                                      });
                                    }
                                    
                                    return (
                                      <div className="space-y-3">
                                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                          <div className="grid grid-cols-2 gap-3 text-sm">
                                            <div>
                                              <span className="text-gray-600 dark:text-gray-400">متر مربع:</span>
                                              <span className="font-semibold text-gray-800 dark:text-white mr-2">
                                                {formatSquareMeters(treadMetrics.totalArea)}
                                              </span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600 dark:text-gray-400">تعداد:</span>
                                              <span className="font-semibold text-gray-800 dark:text-white mr-2">
                                                {formatDisplayNumber(treadMetrics.totalQuantity)}
                                              </span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Nosing Configuration (only for tread) */}
                                        <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3">
                                          <label htmlFor="tread-nosing-type-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            نوع پیشانی:
                                          </label>
                                          <select
                                            id="tread-nosing-type-select"
                                            value={stairSystemConfig.tread.nosingType || 'none'}
                                            aria-label="انتخاب نوع پیشانی کف پله"
                                            onChange={(e) => {
                                              updateStairPart('tread', { nosingType: e.target.value });
                                            }}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                                          >
                                            {NOSING_TYPES.filter(n => n.available).map(nosing => (
                                              <option key={nosing.id} value={nosing.id}>
                                                {nosing.name} {nosing.cuttingCostPerMeter > 0 ? `(${formatPrice(nosing.cuttingCostPerMeter, 'تومان')}/متر)` : ''}
                                              </option>
                                            ))}
                                          </select>
                                          {nosingCost.cuttingCost > 0 && (
                                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
                                              هزینه برش پیشانی: {formatPrice(nosingCost.cuttingCost, 'تومان')}
                                            </p>
                                          )}
                                        </div>

                                        {/* Price per Square Meter */}
                                        <div>
                                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            فی هر متر مربع (تومان):
                                          </label>
                                          <FormattedNumberInput
                                            value={stairSystemConfig.tread.pricePerSquareMeter || 0}
                                            onChange={(value) => {
                                              updateStairPart('tread', { pricePerSquareMeter: value || 0 });
                                            }}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                            min={0}
                                            step={1000}
                                            placeholder="قیمت هر متر مربع"
                                          />
                                        </div>

                                        {/* Mandatory Pricing for Tread */}
                                        <div className="border-t border-gray-200 dark:border-gray-600 pt-3">
                                          <div className="flex items-center space-x-3 space-x-reverse mb-2">
                                            <input
                                              id="tread-mandatory-v1-checkbox"
                                              type="checkbox"
                                              checked={stairSystemConfig.tread.isMandatory || false}
                                              aria-label="قیمت‌گذاری حکمی برای کف پله"
                                              onChange={(e) => {
                                                updateStairPart('tread', { isMandatory: e.target.checked });
                                              }}
                                              className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                            />
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                              حکمی (افزایش قیمت)
                                            </label>
                                          </div>
                                          {stairSystemConfig.tread.isMandatory && (
                                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                                              <div className="flex items-center space-x-3 space-x-reverse">
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                  درصد افزایش:
                                                </label>
                                                <FormattedNumberInput
                                                  value={stairSystemConfig.tread.mandatoryPercentage || 20}
                                                  onChange={(value) => {
                                                    updateStairPart('tread', { mandatoryPercentage: value || 20 });
                                                  }}
                                                  className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                                                  min={0}
                                                  max={100}
                                                />
                                                <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                        {/* Total Price for Tread */}
                                        {totalPrice > 0 && (
                                          <div className="bg-gradient-to-r from-teal-50 to-teal-100 dark:from-teal-900/30 dark:to-teal-800/30 border border-teal-200 dark:border-teal-800 rounded-lg p-3">
                                            <div className="flex justify-between items-center">
                                              <span className="text-sm font-medium text-teal-800 dark:text-teal-200">
                                                قیمت کل کف پله:
                                              </span>
                                              <span className="text-lg font-bold text-teal-900 dark:text-teal-100">
                                                {formatPrice(totalPrice, 'تومان')}
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Section 2: خیز پله (Riser) */}
                        <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setRiserExpanded(!riserExpanded)}
                            className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <input
                                id="riser-selection-checkbox"
                                type="checkbox"
                                checked={stairSystemConfig?.riser.isSelected || false}
                                onChange={(e) => {
                                  updateStairPart('riser', { isSelected: e.target.checked });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                aria-label="انتخاب خیز پله"
                                className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                              />
                              <span className="font-semibold text-gray-800 dark:text-white">خیز پله (Riser)</span>
                            </div>
                            {riserExpanded ? (
                              <FaChevronUp className="text-gray-500 dark:text-gray-400" />
                            ) : (
                              <FaChevronDown className="text-gray-500 dark:text-gray-400" />
                            )}
                          </button>
                          
                          {riserExpanded && stairSystemConfig && (
                            <div className="p-4 space-y-4 border-t border-gray-200 dark:border-gray-600">
                              {/* Product Selection for Riser */}
                              <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                  انتخاب محصول:
                                </label>
                                {stairSystemConfig.riser.product ? (
                                  <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg mb-2">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="font-medium text-gray-800 dark:text-white">
                                          {generateFullProductName(stairSystemConfig.riser.product)}
                                        </p>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                          {stairSystemConfig.riser.product.stoneTypeNamePersian} • عرض {stairSystemConfig.riser.product.widthValue}×ضخامت {stairSystemConfig.riser.product.thicknessValue}cm
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          updateStairPart('riser', {
                                            productId: null,
                                            product: null,
                                            pricePerSquareMeter: 0
                                          });
                                          syncDraftWithProduct('riser', null);
                                          if (stairSystemV2.stairActivePart === 'riser') {
                                            stairSystemV2.setStoneSearchTerm('');
                                          }
                                          setRiserProductSearchTerm('');
                                        }}
                                        className="text-sm text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teال-300"
                                      >
                                        تغییر
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mb-2">
                                    <div className="relative">
                                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <FaSearch className="h-5 w-5 text-gray-400" />
                                      </div>
                                      <input
                                        type="text"
                                        placeholder="جستجو محصول..."
                                        value={riserProductSearchTerm}
                                        onChange={(e) => setRiserProductSearchTerm(e.target.value)}
                                        className="w-full pr-10 pl-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                      />
                                    </div>
                                    {riserProductSearchTerm && (
                                      <div className="mt-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800">
                                        {filteredRiserProducts.map((product) => (
                                          <div
                                            key={product.id}
                                            onClick={() => {
                                              selectProductForStairPart('riser', product);
                                              setRiserProductSearchTerm('');
                                            }}
                                            className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                                          >
                                            <p className="font-medium text-gray-800 dark:text-white text-sm">
                                              {generateFullProductName(product)}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                              {product.basePrice ? formatPrice(product.basePrice, product.currency) : 'قیمت نامشخص'}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Riser Dimensions */}
                              {stairSystemConfig.riser.product && (
                                <>
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                      ارتفاع قائمه (cm)
                                    </label>
                                    <FormattedNumberInput
                                      value={stairSystemConfig.riser.riserHeight || 17}
                                      onChange={(value) => {
                                        updateStairPart('riser', { riserHeight: value || 17 });
                                      }}
                                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                      min={0}
                                      step={0.1}
                          decimalScale={4}
                          placeholder="17"
                                    />
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      معمولاً 15-19 سانتی‌متر
                                    </p>
                                  </div>

                                  {/* Quantity for Riser */}
                                  <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                      تعداد (پیش‌فرض: {stairSystemConfig.numberOfSteps || 0})
                                    </label>
                                    <FormattedNumberInput
                                      value={stairSystemConfig.riser.quantity || stairSystemConfig.numberOfSteps || 0}
                                      onChange={(value) => {
                                        updateStairPart('riser', { quantity: value || 0 });
                                      }}
                                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                      min={0}
                                      step={1}
                                      placeholder={`${stairSystemConfig.numberOfSteps || 0}`}
                                    />
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      به طور پیش‌فرض با تعداد پله همگام است، اما می‌توانید تغییر دهید
                                    </p>
                                  </div>

                                  {/* Riser Calculations */}
                                  {(() => {
                                    const treadWidth = stairSystemConfig.tread.treadWidth || 100;
                                    const treadWidthUnit = stairSystemConfig.tread.lengthUnit || 'm';
                                    
                                    const riserMetrics = calculateRiserMetrics({
                                      treadWidth: treadWidth,
                                      treadWidthUnit: treadWidthUnit,
                                      riserHeight: stairSystemConfig.riser.riserHeight || 17,
                                      quantity: stairSystemConfig.riser.quantity || stairSystemConfig.numberOfSteps || 0,
                                      quantityType: stairSystemConfig.quantityType,
                                      numberOfStaircases: stairSystemConfig.numberOfStaircases || 1
                                    });
                                    
                                    const basePrice = riserMetrics.totalArea * (stairSystemConfig.riser.pricePerSquareMeter || 0);
                                    const mandatoryPrice = stairSystemConfig.riser.isMandatory && stairSystemConfig.riser.mandatoryPercentage
                                      ? basePrice * (stairSystemConfig.riser.mandatoryPercentage / 100)
                                      : 0;
                                    const totalPrice = basePrice + mandatoryPrice;
                                    
                                    // Update riser part with calculated values
                                    // Always update if squareMeters or totalPrice changed (to handle price/mandatory changes)
                                    // Use Math.abs to handle floating point comparison issues
                                    const squareMetersChanged = Math.abs((stairSystemConfig.riser.squareMeters || 0) - riserMetrics.totalArea) > 0.001;
                                    const totalPriceChanged = Math.abs((stairSystemConfig.riser.totalPrice || 0) - totalPrice) > 0.01;
                                    
                                    if (squareMetersChanged || totalPriceChanged) {
                                      // Use requestAnimationFrame for better state update timing
                                      requestAnimationFrame(() => {
                                        updateStairPart('riser', {
                                          squareMeters: riserMetrics.totalArea,
                                          totalPrice: totalPrice,
                                          originalTotalPrice: basePrice
                                        });
                                      });
                                    }
                                    
                                    return (
                                      <div className="space-y-3">
                                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                          <div className="grid grid-cols-2 gap-3 text-sm">
                                            <div>
                                              <span className="text-gray-600 dark:text-gray-400">متر مربع:</span>
                                              <span className="font-semibold text-gray-800 dark:text-white mr-2">
                                                {formatSquareMeters(riserMetrics.totalArea)}
                                              </span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600 dark:text-gray-400">تعداد:</span>
                                              <span className="font-semibold text-gray-800 dark:text-white mr-2">
                                                {formatDisplayNumber(riserMetrics.totalQuantity)}
                                              </span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Price per Square Meter */}
                                        <div>
                                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            فی هر متر مربع (تومان):
                                          </label>
                                          <FormattedNumberInput
                                            value={stairSystemConfig.riser.pricePerSquareMeter || 0}
                                            onChange={(value) => {
                                              updateStairPart('riser', { pricePerSquareMeter: value || 0 });
                                            }}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                            min={0}
                                            step={1000}
                                            placeholder="قیمت هر متر مربع"
                                          />
                                        </div>

                                        {/* Mandatory Pricing for Riser */}
                                        <div className="border-t border-gray-200 dark:border-gray-600 pt-3">
                                          <div className="flex items-center space-x-3 space-x-reverse mb-2">
                                            <input
                                              id="riser-mandatory-v1-checkbox"
                                              type="checkbox"
                                              checked={stairSystemConfig.riser.isMandatory || false}
                                              aria-label="قیمت‌گذاری حکمی برای خیز پله"
                                              onChange={(e) => {
                                                updateStairPart('riser', { isMandatory: e.target.checked });
                                              }}
                                              className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                            />
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                              حکمی (افزایش قیمت)
                                            </label>
                                          </div>
                                          {stairSystemConfig.riser.isMandatory && (
                                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                                              <div className="flex items-center space-x-3 space-x-reverse">
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                  درصد افزایش:
                                                </label>
                                                <FormattedNumberInput
                                                  value={stairSystemConfig.riser.mandatoryPercentage || 20}
                                                  onChange={(value) => {
                                                    updateStairPart('riser', { mandatoryPercentage: value || 20 });
                                                  }}
                                                  className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                                                  min={0}
                                                  max={100}
                                                />
                                                <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                        {/* Total Price for Riser */}
                                        {totalPrice > 0 && (
                                          <div className="bg-gradient-to-r from-teal-50 to-teal-100 dark:from-teal-900/30 dark:to-teal-800/30 border border-teal-200 dark:border-teal-800 rounded-lg p-3">
                                            <div className="flex justify-between items-center">
                                              <span className="text-sm font-medium text-teal-800 dark:text-teal-200">
                                                قیمت کل خیز پله:
                                              </span>
                                              <span className="text-lg font-bold text-teal-900 dark:text-teal-100">
                                                {formatPrice(totalPrice, 'تومان')}
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Section 3: پاگرد (Landing) */}
                        <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setLandingExpanded(!landingExpanded)}
                            className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <input
                                id="landing-selection-checkbox"
                                type="checkbox"
                                checked={stairSystemConfig?.landing.isSelected || false}
                                onChange={(e) => {
                                  updateStairPart('landing', { isSelected: e.target.checked });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                aria-label="انتخاب پاگرد"
                                className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                              />
                              <span className="font-semibold text-gray-800 dark:text-white">پاگرد (Landing)</span>
                            </div>
                            {landingExpanded ? (
                              <FaChevronUp className="text-gray-500 dark:text-gray-400" />
                            ) : (
                              <FaChevronDown className="text-gray-500 dark:text-gray-400" />
                            )}
                          </button>
                          
                          {landingExpanded && stairSystemConfig && (
                            <div className="p-4 space-y-4 border-t border-gray-200 dark:border-gray-600">
                              {/* Product Selection for Landing */}
                              <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                  انتخاب محصول:
                                </label>
                                {stairSystemConfig.landing.product ? (
                                  <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg mb-2">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <p className="font-medium text-gray-800 dark:text-white">
                                          {generateFullProductName(stairSystemConfig.landing.product)}
                                        </p>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                          {stairSystemConfig.landing.product.stoneTypeNamePersian} • عرض {stairSystemConfig.landing.product.widthValue}×ضخامت {stairSystemConfig.landing.product.thicknessValue}cm
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          updateStairPart('landing', {
                                            productId: null,
                                            product: null,
                                            pricePerSquareMeter: 0
                                          });
                                          syncDraftWithProduct('landing', null);
                                          if (stairSystemV2.stairActivePart === 'landing') {
                                            stairSystemV2.setStoneSearchTerm('');
                                          }
                                          setLandingProductSearchTerm('');
                                        }}
                                        className="text-sm text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teال-300"
                                      >
                                        تغییر
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="mb-2">
                                    <div className="relative">
                                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                                        <FaSearch className="h-5 w-5 text-gray-400" />
                                      </div>
                                      <input
                                        type="text"
                                        placeholder="جستجو محصول..."
                                        value={landingProductSearchTerm}
                                        onChange={(e) => setLandingProductSearchTerm(e.target.value)}
                                        className="w-full pr-10 pl-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                      />
                                    </div>
                                    {landingProductSearchTerm && (
                                      <div className="mt-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800">
                                        {filteredLandingProducts.map((product) => (
                                          <div
                                            key={product.id}
                                            onClick={() => {
                                              selectProductForStairPart('landing', product);
                                              setLandingProductSearchTerm('');
                                            }}
                                            className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                                          >
                                            <p className="font-medium text-gray-800 dark:text-white text-sm">
                                              {generateFullProductName(product)}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                              {product.basePrice ? formatPrice(product.basePrice, product.currency) : 'قیمت نامشخص'}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Landing Dimensions */}
                              {stairSystemConfig.landing.product && (
                                <>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        تعداد پاگرد
                                      </label>
                                      <FormattedNumberInput
                                        value={stairSystemConfig.landing.numberOfLandings || 0}
                                        onChange={(value) => {
                                          updateStairPart('landing', { numberOfLandings: value || 0 });
                                        }}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                        min={0}
                                        step={1}
                                        placeholder="0"
                                      />
                                    </div>
                                    {stairSystemConfig.landing.numberOfLandings && stairSystemConfig.landing.numberOfLandings > 0 && (
                                      <>
                                        <div>
                                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            عرض پاگرد (cm)
                                          </label>
                                          <FormattedNumberInput
                                            value={stairSystemConfig.landing.landingWidth || 0}
                                            onChange={(value) => {
                                              updateStairPart('landing', { landingWidth: value || 0 });
                                            }}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                            min={0}
                                            step={0.1}
                          decimalScale={4}
                          placeholder="عرض"
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            عمق پاگرد (cm)
                                          </label>
                                          <FormattedNumberInput
                                            value={stairSystemConfig.landing.landingDepth || 0}
                                            onChange={(value) => {
                                              updateStairPart('landing', { landingDepth: value || 0 });
                                            }}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                            min={0}
                                            step={0.1}
                          decimalScale={4}
                          placeholder="عمق"
                                          />
                                        </div>
                                      </>
                                    )}
                                  </div>

                                  {/* Landing Calculations */}
                                  {(() => {
                                    const landingMetrics = calculateLandingMetrics({
                                      landingWidth: stairSystemConfig.landing.landingWidth || 0,
                                      landingDepth: stairSystemConfig.landing.landingDepth || 0,
                                      numberOfLandings: stairSystemConfig.landing.numberOfLandings || 0,
                                      quantityType: stairSystemConfig.quantityType,
                                      numberOfStaircases: stairSystemConfig.numberOfStaircases || 1
                                    });
                                    
                                    const basePrice = landingMetrics.totalArea * (stairSystemConfig.landing.pricePerSquareMeter || 0);
                                    const mandatoryPrice = stairSystemConfig.landing.isMandatory && stairSystemConfig.landing.mandatoryPercentage
                                      ? basePrice * (stairSystemConfig.landing.mandatoryPercentage / 100)
                                      : 0;
                                    const totalPrice = basePrice + mandatoryPrice;
                                    
                                    // Update landing part with calculated values
                                    // Always update if squareMeters or totalPrice changed (to handle price/mandatory changes)
                                    // Use Math.abs to handle floating point comparison issues
                                    const squareMetersChanged = Math.abs((stairSystemConfig.landing.squareMeters || 0) - landingMetrics.totalArea) > 0.001;
                                    const totalPriceChanged = Math.abs((stairSystemConfig.landing.totalPrice || 0) - totalPrice) > 0.01;
                                    
                                    if (squareMetersChanged || totalPriceChanged) {
                                      // Use requestAnimationFrame for better state update timing
                                      requestAnimationFrame(() => {
                                        updateStairPart('landing', {
                                          squareMeters: landingMetrics.totalArea,
                                          quantity: landingMetrics.totalQuantity,
                                          totalPrice: totalPrice,
                                          originalTotalPrice: basePrice
                                        });
                                      });
                                    }
                                    
                                    return (
                                      <div className="space-y-3">
                                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                                          <div className="grid grid-cols-2 gap-3 text-sm">
                                            <div>
                                              <span className="text-gray-600 dark:text-gray-400">متر مربع:</span>
                                              <span className="font-semibold text-gray-800 dark:text-white mr-2">
                                                {formatSquareMeters(landingMetrics.totalArea)}
                                              </span>
                                            </div>
                                            <div>
                                              <span className="text-gray-600 dark:text-gray-400">تعداد:</span>
                                              <span className="font-semibold text-gray-800 dark:text-white mr-2">
                                                {formatDisplayNumber(landingMetrics.totalQuantity)}
                                              </span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Price per Square Meter */}
                                        <div>
                                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            فی هر متر مربع (تومان):
                                          </label>
                                          <FormattedNumberInput
                                            value={stairSystemConfig.landing.pricePerSquareMeter || 0}
                                            onChange={(value) => {
                                              updateStairPart('landing', { pricePerSquareMeter: value || 0 });
                                            }}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                                            min={0}
                                            step={1000}
                                            placeholder="قیمت هر متر مربع"
                                          />
                                        </div>

                                        {/* Mandatory Pricing for Landing */}
                                        <div className="border-t border-gray-200 dark:border-gray-600 pt-3">
                                          <div className="flex items-center space-x-3 space-x-reverse mb-2">
                                            <input
                                              id="landing-mandatory-v1-checkbox"
                                              type="checkbox"
                                              checked={stairSystemConfig.landing.isMandatory || false}
                                              aria-label="قیمت‌گذاری حکمی برای پاگرد"
                                              onChange={(e) => {
                                                updateStairPart('landing', { isMandatory: e.target.checked });
                                              }}
                                              className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                            />
                                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                              حکمی (افزایش قیمت)
                                            </label>
                                          </div>
                                          {stairSystemConfig.landing.isMandatory && (
                                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                                              <div className="flex items-center space-x-3 space-x-reverse">
                                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                  درصد افزایش:
                                                </label>
                                                <FormattedNumberInput
                                                  value={stairSystemConfig.landing.mandatoryPercentage || 20}
                                                  onChange={(value) => {
                                                    updateStairPart('landing', { mandatoryPercentage: value || 20 });
                                                  }}
                                                  className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                                                  min={0}
                                                  max={100}
                                                />
                                                <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                        {/* Total Price for Landing */}
                                        {totalPrice > 0 && (
                                          <div className="bg-gradient-to-r from-teal-50 to-teal-100 dark:from-teal-900/30 dark:to-teal-800/30 border border-teal-200 dark:border-teal-800 rounded-lg p-3">
                                            <div className="flex justify-between items-center">
                                              <span className="text-sm font-medium text-teal-800 dark:text-teal-200">
                                                قیمت کل پاگرد:
                                              </span>
                                              <span className="text-lg font-bold text-teal-900 dark:text-teal-100">
                                                {formatPrice(totalPrice, 'تومان')}
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        {/* Total Summary */}
                        {stairSystemConfig && (() => {
                          // Calculate totals directly from current values to ensure accuracy
                          // This avoids relying on state that might not be updated yet
                          
                          // Calculate Tread Total
                          let treadTotal = 0;
                          if (stairSystemConfig.tread.isSelected && stairSystemConfig.tread.product) {
                            const treadMetrics = calculateTreadMetrics({
                              treadWidth: stairSystemConfig.tread.treadWidth || 0,
                              treadWidthUnit: stairSystemConfig.tread.lengthUnit || 'm',
                              treadDepth: stairSystemConfig.tread.treadDepth || 30,
                              quantity: stairSystemConfig.tread.quantity || stairSystemConfig.numberOfSteps || 0,
                              quantityType: stairSystemConfig.quantityType,
                              numberOfStaircases: stairSystemConfig.numberOfStaircases || 1
                            });
                            
                            const nosingCost = calculateNosingCuttingCost({
                              nosingType: stairSystemConfig.tread.nosingType || 'none',
                              treadWidth: stairSystemConfig.tread.treadWidth || 0,
                              treadWidthUnit: stairSystemConfig.tread.lengthUnit || 'm',
                              numberOfSteps: stairSystemConfig.tread.quantity || stairSystemConfig.numberOfSteps || 0,
                              numberOfStaircases: stairSystemConfig.quantityType === 'staircases' ? (stairSystemConfig.numberOfStaircases || 1) : 1,
                              quantityType: stairSystemConfig.quantityType
                            });
                            
                            const basePrice = treadMetrics.totalArea * (stairSystemConfig.tread.pricePerSquareMeter || 0);
                            const mandatoryPrice = stairSystemConfig.tread.isMandatory && stairSystemConfig.tread.mandatoryPercentage
                              ? basePrice * (stairSystemConfig.tread.mandatoryPercentage / 100)
                              : 0;
                            treadTotal = basePrice + mandatoryPrice + nosingCost.cuttingCost;
                          }
                          
                          // Calculate Riser Total
                          let riserTotal = 0;
                          if (stairSystemConfig.riser.isSelected && stairSystemConfig.riser.product) {
                            const treadWidth = stairSystemConfig.tread.treadWidth || 100;
                            const treadWidthUnit = stairSystemConfig.tread.lengthUnit || 'm';
                            
                            const riserMetrics = calculateRiserMetrics({
                              treadWidth: treadWidth,
                              treadWidthUnit: treadWidthUnit,
                              riserHeight: stairSystemConfig.riser.riserHeight || 17,
                              quantity: stairSystemConfig.riser.quantity || stairSystemConfig.numberOfSteps || 0,
                              quantityType: stairSystemConfig.quantityType,
                              numberOfStaircases: stairSystemConfig.numberOfStaircases || 1
                            });
                            
                            const basePrice = riserMetrics.totalArea * (stairSystemConfig.riser.pricePerSquareMeter || 0);
                            const mandatoryPrice = stairSystemConfig.riser.isMandatory && stairSystemConfig.riser.mandatoryPercentage
                              ? basePrice * (stairSystemConfig.riser.mandatoryPercentage / 100)
                              : 0;
                            riserTotal = basePrice + mandatoryPrice;
                          }
                          
                          // Calculate Landing Total
                          let landingTotal = 0;
                          if (stairSystemConfig.landing.isSelected && stairSystemConfig.landing.product) {
                            const landingMetrics = calculateLandingMetrics({
                              landingWidth: stairSystemConfig.landing.landingWidth || 0,
                              landingDepth: stairSystemConfig.landing.landingDepth || 0,
                              numberOfLandings: stairSystemConfig.landing.numberOfLandings || 0,
                              quantityType: stairSystemConfig.quantityType,
                              numberOfStaircases: stairSystemConfig.numberOfStaircases || 1
                            });
                            
                            const basePrice = landingMetrics.totalArea * (stairSystemConfig.landing.pricePerSquareMeter || 0);
                            const mandatoryPrice = stairSystemConfig.landing.isMandatory && stairSystemConfig.landing.mandatoryPercentage
                              ? basePrice * (stairSystemConfig.landing.mandatoryPercentage / 100)
                              : 0;
                            landingTotal = basePrice + mandatoryPrice;
                          }
                          
                          const grandTotal = treadTotal + riserTotal + landingTotal;
                          
                          return (
                            <div className="bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                              <h4 className="text-sm font-semibold text-purple-800 dark:text-purple-200 mb-3">
                                خلاصه دستگاه پله:
                              </h4>
                              <div className="space-y-2 text-sm">
                                {stairSystemConfig.tread.isSelected && treadTotal > 0 && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-700 dark:text-gray-300">کف پله:</span>
                                    <span className="font-semibold text-gray-800 dark:text-white">
                                      {formatPrice(treadTotal, 'تومان')}
                                    </span>
                                  </div>
                                )}
                                {stairSystemConfig.riser.isSelected && riserTotal > 0 && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-700 dark:text-gray-300">خیز پله:</span>
                                    <span className="font-semibold text-gray-800 dark:text-white">
                                      {formatPrice(riserTotal, 'تومان')}
                                    </span>
                                  </div>
                                )}
                                {stairSystemConfig.landing.isSelected && landingTotal > 0 && (
                                  <div className="flex justify-between">
                                    <span className="text-gray-700 dark:text-gray-300">پاگرد:</span>
                                    <span className="font-semibold text-gray-800 dark:text-white">
                                      {formatPrice(landingTotal, 'تومان')}
                                    </span>
                                  </div>
                                )}
                                <div className="border-t border-purple-200 dark:border-purple-700 pt-2 mt-2">
                                  <div className="flex justify-between">
                                    <span className="font-bold text-purple-800 dark:text-purple-200">جمع کل:</span>
                                    <span className="font-bold text-lg text-purple-900 dark:text-purple-100">
                                      {formatPrice(grandTotal, 'تومان')}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </>
                  ) : null}
                  
                  {/* Conditional for longitudinal and slab stones (only shown if not stair) */}
                  {(productConfig.productType === 'longitudinal' || productConfig.productType === 'slab') && (
                    <>
                      {/* LONGITUDINAL STONE CONFIGURATION FORM (existing) */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            نام کامل سنگ
                          </label>
                          <div className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-600 text-gray-800 dark:text-white">
                            {selectedProduct ? generateFullProductName(selectedProduct) : 'لطفاً محصول را انتخاب کنید'}
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            نام یا نوع سنگ
                          </label>
                          <input
                            type="text"
                            value={productConfig.stoneName || ''}
                            onFocus={() => handleFieldFocus('stoneName', productConfig.stoneName, '')}
                            onChange={(e) => setProductConfig(prev => ({ ...prev, stoneName: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          />
                        </div>
                      </div>
                  {/* For Slab: Enhanced Requested Dimensions Section */}
                  {productConfig.productType === 'slab' ? (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-xl p-6 shadow-lg">
                      <div className="flex items-center gap-3 mb-5">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 dark:from-blue-600 dark:to-indigo-700 flex items-center justify-center shadow-md">
                          <FaRuler className="text-white text-xl" />
                        </div>
                    <div>
                          <h4 className="text-lg font-bold text-blue-900 dark:text-blue-100">ابعاد درخواستی</h4>
                          <p className="text-xs text-blue-700 dark:text-blue-300">مشخصات مورد نیاز برای محصول نهایی</p>
                        </div>
                      </div>
                      
                      {/* Length and Width Inputs in Row */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        {/* Length Input */}
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border-2 border-blue-200 dark:border-blue-700 shadow-sm">
                          <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                            <FaRuler className="text-blue-600 dark:text-blue-400" />
                            طول درخواستی
                      </label>
                        <FormattedNumberInput
                          value={productConfig.length || 0}
                          onFocus={() => handleFieldFocus('length', productConfig.length, 0)}
                          onChange={(value) => {
                            // Update the length first
                              setProductConfig(prev => {
                                const updatedConfig = resolveLongitudinalWidth(
                                  { ...prev, length: value },
                                  selectedProduct,
                                  widthUnit,
                                  isEditMode
                                );
                                // Trigger smart calculation with updated config
                                const smartResult = handleSmartCalculation('length', value, updatedConfig, lengthUnit, widthUnit, getEffectiveQuantity());
                                const finalConfig = {
                                  ...updatedConfig,
                                width: smartResult.width,
                                squareMeters: smartResult.squareMeters
                              };
                              
                              // For slab products, validate length against original length
                              if (prev.productType === 'slab' && value > 0) {
                                const userLengthInCm = lengthUnit === 'm' ? value * 100 : value;
                                const originalLength = (isEditMode && prev.originalLength !== undefined) 
                                  ? prev.originalLength 
                                  : ((selectedProduct as any).lengthValue || 300);
                                const originalLengthCm = lengthUnit === 'm' ? originalLength * 100 : originalLength;
                                
                                if (originalLengthCm > 0 && userLengthInCm > originalLengthCm) {
                                  setErrors({ 
                                    products: `طول وارد شده (${value}${lengthUnit === 'm' ? 'm' : 'cm'}) بیشتر از طول اصلی اسلب (${originalLengthCm / (lengthUnit === 'm' ? 100 : 1)}${lengthUnit === 'm' ? 'm' : 'cm'}) است. لطفاً طولی کمتر یا مساوی وارد کنید.` 
                                  });
                                } else if (errors.products && errors.products.includes('طول وارد شده')) {
                                  setErrors({});
                                }
                              }
                              
                              // Check if we need to auto-select longitudinal cut after smart calculation
                              const userWidthInCm = widthUnit === 'm' ? finalConfig.width * 100 : finalConfig.width;
                              // Use productConfig.originalWidth when editing, otherwise use selectedProduct.widthValue
                              const originalWidth = (isEditMode && prev.originalWidth) ? prev.originalWidth : (selectedProduct?.widthValue || 0);
                              const shouldAutoSelectLongitudinalCut = userWidthInCm < originalWidth && userWidthInCm > 0;
                              
                              console.log('📏 Length Changed - Auto Cut Selection:', {
                                userLength: value,
                                userLengthUnit: lengthUnit,
                                calculatedWidth: finalConfig.width,
                                userWidthInCm,
                                originalWidth,
                                shouldAutoSelectLongitudinalCut,
                                comparison: `${userWidthInCm} < ${originalWidth} = ${userWidthInCm < originalWidth}`
                              });
                              
                              // Automatically get cutting type price if cut should be applied
                              let cuttingCostPerMeter: number | null | undefined = prev.cuttingCostPerMeter || null;
                              if (shouldAutoSelectLongitudinalCut && !cuttingCostPerMeter) {
                                // Fetch price from cutting types for "LONG" (برش طولی)
                                cuttingCostPerMeter = getCuttingTypePricePerMeter('LONG');
                                console.log('🔧 Auto-fetched cutting cost per meter from services:', cuttingCostPerMeter);
                              } else if (!shouldAutoSelectLongitudinalCut) {
                                // Clear cutting cost if cut is not needed
                                cuttingCostPerMeter = undefined;
                              }
                              
                              // Calculate cutting cost automatically
                              const effectiveQuantity = getEffectiveQuantity();
                              const updatedCuttingCost = calculateAutoCuttingCost(
                                value,
                                lengthUnit,
                                cuttingCostPerMeter,
                                effectiveQuantity
                              );
                              
                              // Auto-select cut type based on calculated width
                              if (shouldAutoSelectLongitudinalCut && cuttingCostPerMeter) {
                                return {
                                  ...finalConfig,
                                  isCut: true,
                                  cutType: 'longitudinal',
                                  cuttingCostPerMeter: cuttingCostPerMeter,
                                  cuttingCost: updatedCuttingCost
                                };
                              } else {
                                return {
                                  ...finalConfig,
                                  isCut: false,
                                  cutType: null,
                                  cuttingCostPerMeter: undefined,
                                  cuttingCost: 0
                                };
                              }
                            });
                          }}
                          className="w-full px-4 py-3 text-base border-2 border-blue-300 dark:border-blue-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                          min={0}
                          step={0.1}
                          decimalScale={4}
                          placeholder="مقدار طول"
                        />
                          <div className="flex gap-2 mt-3">
                          <button
                            type="button"
                            onClick={() => handleLengthUnitChange('cm')}
                              className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                              lengthUnit === 'cm'
                                  ? 'bg-blue-600 text-white shadow-md'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            سانتی‌متر (cm)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLengthUnitChange('m')}
                              className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                              lengthUnit === 'm'
                                  ? 'bg-blue-600 text-white shadow-md'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            متر (m)
                          </button>
                        </div>
                      </div>
                        
                        {/* Width Input */}
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border-2 border-blue-200 dark:border-blue-700 shadow-sm">
                          <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                            <FaRuler className="text-blue-600 dark:text-blue-400" />
                            عرض درخواستی
                      </label>
                        <FormattedNumberInput
                          value={productConfig.width || 0}
                          onFocus={() => {
                            handleFieldFocus('width', productConfig.width, 0);
                            // Clear width error on focus to allow user to fix it
                            if (errors.products && errors.products.includes('عرض وارد شده')) {
                              setErrors({});
                            }
                          }}
                          onChange={(value) => {
                            // Update the width first
                            setProductConfig(prev => {
                              const updatedConfig = { ...prev, width: value };
                              // Trigger smart calculation with updated config
                              const smartResult = handleSmartCalculation('width', value, updatedConfig, lengthUnit, widthUnit, getEffectiveQuantity());
                              return {
                                ...updatedConfig,
                                length: smartResult.length,
                                squareMeters: smartResult.squareMeters
                              };
                            });
                            
                            // Calculate width in cm for comparison
                            const userWidthInCm = widthUnit === 'm' ? value * 100 : value;
                            
                            // Get original width for validation
                            const originalWidth = (isEditMode && productConfig.originalWidth) 
                              ? productConfig.originalWidth 
                              : (selectedProduct?.widthValue || 0);
                            
                            // Validate: width cannot exceed original width
                            if (value > 0 && originalWidth > 0 && userWidthInCm > originalWidth) {
                              // Show error message
                              setErrors({ 
                                products: `عرض وارد شده (${value}${widthUnit === 'm' ? 'm' : 'cm'}) بیشتر از عرض اصلی سنگ (${originalWidth}cm) است. لطفاً عرضی کمتر یا مساوی با ${originalWidth}cm وارد کنید.` 
                              });
                            } else {
                              // Clear error if width is valid
                              if (errors.products && errors.products.includes('عرض وارد شده')) {
                                setErrors({});
                              }
                            }
                            
                            // Use productConfig.originalWidth when editing, otherwise use selectedProduct.widthValue
                            setProductConfig(prev => {
                              const originalWidth = (isEditMode && prev.originalWidth) ? prev.originalWidth : (selectedProduct?.widthValue || 0);
                              const shouldAutoSelectLongitudinalCut = userWidthInCm < originalWidth && userWidthInCm > 0;
                              
                              // Log width change and auto-selection logic
                              console.log('📏 Width Changed - Auto Cut Selection:', {
                                userWidth: value,
                                userWidthUnit: widthUnit,
                                userWidthInCm,
                                originalWidth,
                                shouldAutoSelectLongitudinalCut,
                                comparison: `${userWidthInCm} < ${originalWidth} = ${userWidthInCm < originalWidth}`
                              });
                              
                              // Automatically get cutting type price if cut should be applied
                              let cuttingCostPerMeter: number | null | undefined = prev.cuttingCostPerMeter || null;
                              if (shouldAutoSelectLongitudinalCut && !cuttingCostPerMeter) {
                                // Fetch price from cutting types for "LONG" (برش طولی)
                                cuttingCostPerMeter = getCuttingTypePricePerMeter('LONG');
                                console.log('🔧 Auto-fetched cutting cost per meter from services:', cuttingCostPerMeter);
                              } else if (!shouldAutoSelectLongitudinalCut) {
                                // Clear cutting cost if cut is not needed
                                cuttingCostPerMeter = undefined;
                              }
                              
                              // Calculate cutting cost automatically
                              const effectiveQuantity = getEffectiveQuantity();
                              const updatedCuttingCost = calculateAutoCuttingCost(
                                prev.length,
                                lengthUnit,
                                cuttingCostPerMeter,
                                effectiveQuantity
                              );
                              
                              // Update cut type based on width comparison
                              if (shouldAutoSelectLongitudinalCut && cuttingCostPerMeter) {
                                return {
                                  ...prev,
                                  isCut: true,
                                  cutType: 'longitudinal',
                                  cuttingCostPerMeter: cuttingCostPerMeter,
                                  cuttingCost: updatedCuttingCost
                                };
                              } else {
                                return {
                                  ...prev,
                                  isCut: false,
                                  cutType: null,
                                  cuttingCostPerMeter: undefined,
                                  cuttingCost: 0
                                };
                              }
                            });
                          }}
                          className={`w-full px-4 py-3 text-base border-2 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 transition-all ${
                            errors.products && errors.products.includes('عرض وارد شده')
                              ? 'border-red-500 dark:border-red-500 focus:ring-red-500 focus:border-red-500'
                              : 'border-blue-300 dark:border-blue-600 focus:ring-blue-500 focus:border-blue-500'
                          }`}
                          min={0}
                          step={0.1}
                          decimalScale={4}
                          placeholder="مقدار عرض"
                        />
                          <div className="flex gap-2 mt-3">
                            <button
                              type="button"
                              onClick={() => handleWidthUnitChange('cm')}
                              className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                                widthUnit === 'cm'
                                  ? 'bg-blue-600 text-white shadow-md'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                              }`}
                            >
                              سانتی‌متر (cm)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleWidthUnitChange('m')}
                              className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg transition-all ${
                                widthUnit === 'm'
                                  ? 'bg-blue-600 text-white shadow-md'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                              }`}
                            >
                              متر (m)
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      {/* Quantity and Summary Row */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border-2 border-blue-200 dark:border-blue-700">
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                            تعداد
                          </label>
                          <FormattedNumberInput
                            value={getQuantityDisplayValue()}
                            onFocus={() => handleFieldFocus('quantity', getQuantityDisplayValue(), 0)}
                            onChange={(value) => {
                              // Check if quantity is being cleared/deleted (empty or 0)
                              const isQuantityCleared = !value || value === 0;
                              
                              // Mark quantity as interacted
                              if (!hasQuantityBeenInteracted) {
                                setHasQuantityBeenInteracted(true);
                                console.log('🎯 Quantity First Interaction');
                              }
                              
                              // Handle mandatory pricing based on quantity state
                              if (isQuantityCleared) {
                                // If quantity is cleared, uncheck mandatory pricing and reset interaction state
                                setIsMandatory(false);
                                setHasQuantityBeenInteracted(false);
                                console.log('🔄 Quantity Cleared - Deactivating mandatory pricing and resetting interaction state');
                              } else {
                                // If quantity has a value, activate mandatory pricing
                                setIsMandatory(true);
                                console.log('✅ Quantity Has Value - Activating mandatory pricing');
                              }
                              
                              // Update the quantity
                              setProductConfig(prev => {
                                const updatedConfig = { ...prev, quantity: value };
                                // Use effective quantity for calculations
                                const effectiveQuantity = value || 1;
                                // Trigger smart calculation with effective quantity
                                const smartResult = handleSmartCalculation('quantity', effectiveQuantity, updatedConfig, lengthUnit, widthUnit, effectiveQuantity);
                                
                                // Recalculate cutting cost automatically using helper function
                                const updatedCuttingCost = calculateAutoCuttingCost(
                                  updatedConfig.length,
                                  lengthUnit,
                                  prev.cuttingCostPerMeter || null,
                                  effectiveQuantity
                                );
                                
                                return {
                                  ...updatedConfig,
                                  squareMeters: smartResult.squareMeters,
                                  cuttingCost: updatedCuttingCost
                                };
                              });
                              
                              console.log('📊 Quantity Changed:', {
                                displayValue: value,
                                effectiveQuantity: value || 1,
                                isQuantityCleared,
                                hasBeenInteracted: !isQuantityCleared,
                                mandatoryActivated: !isQuantityCleared
                              });
                            }}
                            className="w-full px-4 py-3 text-base border-2 border-blue-300 dark:border-blue-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                            min={1}
                            placeholder="تعداد"
                          />
                        </div>
                        
                        {/* Summary Card */}
                        <div className="bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-lg p-4 border-2 border-blue-300 dark:border-blue-600">
                          <p className="text-xs font-semibold text-blue-800 dark:text-blue-200 mb-2">خلاصه ابعاد</p>
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600 dark:text-gray-400">طول:</span>
                              <span className="text-sm font-bold text-gray-900 dark:text-white">
                                {productConfig.length ? `${formatDisplayNumber(productConfig.length)} ${lengthUnit === 'm' ? 'm' : 'cm'}` : 'ثبت نشده'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600 dark:text-gray-400">عرض:</span>
                              <span className="text-sm font-bold text-gray-900 dark:text-white">
                                {productConfig.width ? `${formatDisplayNumber(productConfig.width)} ${widthUnit === 'm' ? 'm' : 'cm'}` : 'ثبت نشده'}
                              </span>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-blue-300 dark:border-blue-700">
                              <span className="text-sm text-gray-600 dark:text-gray-400">تعداد:</span>
                              <span className="text-sm font-bold text-blue-900 dark:text-blue-100">
                                {productConfig.quantity || 0} عدد
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* For Non-Slab: Original Layout */
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          طول
                        </label>
                        <div className="space-y-2">
                          <FormattedNumberInput
                            value={productConfig.length || 0}
                            onFocus={() => handleFieldFocus('length', productConfig.length, 0)}
                            onChange={(value) => {
                              setProductConfig(prev => {
                                const updatedConfig = resolveLongitudinalWidth(
                                  { ...prev, length: value },
                                  selectedProduct,
                                  widthUnit,
                                  isEditMode
                                );
                                const smartResult = handleSmartCalculation('length', value, updatedConfig, lengthUnit, widthUnit, getEffectiveQuantity());
                                return {
                                  ...updatedConfig,
                                  width: smartResult.width,
                                  squareMeters: smartResult.squareMeters
                                };
                              });
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            min={0}
                            step={0.1}
                          decimalScale={4}
                          placeholder="مقدار طول"
                          />
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => handleLengthUnitChange('cm')}
                              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                                lengthUnit === 'cm'
                                  ? 'bg-teal-500 text-white shadow-lg'
                                  : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                              }`}
                            >
                              سانتی‌متر (cm)
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLengthUnitChange('m')}
                              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                                lengthUnit === 'm'
                                  ? 'bg-teal-500 text-white shadow-lg'
                                  : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                              }`}
                            >
                              متر (m)
                            </button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          عرض
                        </label>
                        <div className="space-y-2">
                          <FormattedNumberInput
                            value={productConfig.width || 0}
                            onFocus={() => handleFieldFocus('width', productConfig.width, 0)}
                            onChange={(value) => {
                              setProductConfig(prev => {
                                const updatedConfig = { ...prev, width: value };
                                const smartResult = handleSmartCalculation('width', value, updatedConfig, lengthUnit, widthUnit, getEffectiveQuantity());
                                return {
                                  ...updatedConfig,
                                  length: smartResult.length,
                                  squareMeters: smartResult.squareMeters
                                };
                              });
                            }}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          min={0}
                          step={0.1}
                          decimalScale={4}
                          placeholder="مقدار عرض"
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleWidthUnitChange('cm')}
                            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                              widthUnit === 'cm'
                                ? 'bg-teal-500 text-white shadow-lg'
                                : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                            }`}
                          >
                            سانتی‌متر (cm)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleWidthUnitChange('m')}
                            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                              widthUnit === 'm'
                                ? 'bg-teal-500 text-white shadow-lg'
                                : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
                            }`}
                          >
                            متر (m)
                          </button>
                      </div>
                    </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          تعداد
                        </label>
                        <FormattedNumberInput
                          value={getQuantityDisplayValue()}
                          onFocus={() => handleFieldFocus('quantity', getQuantityDisplayValue(), 0)}
                          onChange={(value) => {
                            const isQuantityCleared = !value || value === 0;
                            if (!hasQuantityBeenInteracted) {
                              setHasQuantityBeenInteracted(true);
                            }
                            if (isQuantityCleared) {
                              setIsMandatory(false);
                              setHasQuantityBeenInteracted(false);
                            } else {
                              setIsMandatory(true);
                            }
                            setProductConfig(prev => {
                              const updatedConfig = { ...prev, quantity: value };
                              const effectiveQuantity = value || 1;
                              const smartResult = handleSmartCalculation('quantity', effectiveQuantity, updatedConfig, lengthUnit, widthUnit, effectiveQuantity);
                              const updatedCuttingCost = calculateAutoCuttingCost(
                                updatedConfig.length,
                                lengthUnit,
                                prev.cuttingCostPerMeter || null,
                                effectiveQuantity
                              );
                              return {
                                ...updatedConfig,
                                squareMeters: smartResult.squareMeters,
                                cuttingCost: updatedCuttingCost
                              };
                            });
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                          min={1}
                          placeholder="تعداد"
                        />
                      </div>
                        </div>
                      )
                    </div>
                  )}
                  
                  {/* Slab-specific sections */}
                  {productConfig.productType === 'slab' && (() => {
                      const slabCuttingMode = productConfig.slabCuttingMode || 'lineBased';
                      const requestedLengthCm = productConfig.length ? (lengthUnit === 'm' ? productConfig.length * 100 : productConfig.length) : 0;
                      const requestedWidthCm = productConfig.width ? (widthUnit === 'm' ? productConfig.width * 100 : productConfig.width) : 0;
                      const wantedQuantity = productConfig.quantity || 0;
                      
                      // Get standard dimensions array or initialize empty
                      const standardDimensions = productConfig.slabStandardDimensions || [];
                      
                      // Calculate total quantity from standard dimensions
                      const totalStandardQuantity = standardDimensions.reduce((sum, entry) => sum + (entry.quantity || 0), 0);
                      
                      // Calculate total area for pricing
                      const totalStandardAreaSqm = standardDimensions.reduce((sum, entry) => {
                        return sum + ((entry.standardLengthCm * entry.standardWidthCm * entry.quantity) / 10000);
                      }, 0);
                      
                      // Validation: check if standard dimensions are >= wanted dimensions
                      const validateStandardDimensions = (entry: SlabStandardDimensionEntry): string | null => {
                        if (entry.standardLengthCm < requestedLengthCm) {
                          return `طول استاندارد (${entry.standardLengthCm}cm) نمی‌تواند کمتر از طول درخواستی (${requestedLengthCm}cm) باشد`;
                        }
                        if (entry.standardWidthCm < requestedWidthCm) {
                          return `عرض استاندارد (${entry.standardWidthCm}cm) نمی‌تواند کمتر از عرض درخواستی (${requestedWidthCm}cm) باشد`;
                        }
                        if (entry.quantity <= 0) {
                          return 'تعداد باید بیشتر از صفر باشد';
                        }
                        return null;
                      };
                      
                      // Add new standard dimension entry
                      const handleAddStandardDimension = () => {
                        const newEntry: SlabStandardDimensionEntry = {
                          id: `std_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                          standardLengthCm: requestedLengthCm || 300,
                          standardWidthCm: requestedWidthCm || 200,
                          quantity: 1
                        };
                        setProductConfig(prev => ({
                          ...prev,
                          slabStandardDimensions: [...(prev.slabStandardDimensions || []), newEntry]
                        }));
                      };
                      
                      // Update standard dimension entry
                      const handleUpdateStandardDimension = (id: string, field: keyof SlabStandardDimensionEntry, value: number) => {
                        setProductConfig(prev => {
                          const updated = (prev.slabStandardDimensions || []).map(entry => 
                            entry.id === id ? { ...entry, [field]: value } : entry
                          );
                          return { ...prev, slabStandardDimensions: updated };
                        });
                      };
                      
                      // Remove standard dimension entry
                      const handleRemoveStandardDimension = (id: string) => {
                        setProductConfig(prev => ({
                          ...prev,
                          slabStandardDimensions: (prev.slabStandardDimensions || []).filter(entry => entry.id !== id)
                        }));
                      };
                      
                      return (
                        <div className="space-y-6">
                          {/* ابعاد استاندارد Section */}
                          <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 shadow-lg overflow-hidden">
                            <div className="bg-gradient-to-r from-indigo-500 to-indigo-600 dark:from-indigo-600 dark:to-indigo-700 px-6 py-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                    <FaWarehouse className="text-white text-lg" />
                                  </div>
                                  <div>
                                    <h4 className="text-lg font-bold text-white">ابعاد استاندارد موجود در انبار</h4>
                                    <p className="text-xs text-indigo-100">ابعاد سنگ‌های موجود در انبار را اضافه کنید</p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={handleAddStandardDimension}
                                  className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-indigo-700 bg-white rounded-lg hover:bg-indigo-50 transition-all shadow-md hover:shadow-lg transform hover:scale-105"
                                >
                                  <FaPlus className="text-base" />
                                  افزودن ابعاد
                                </button>
                              </div>
                            </div>
                            
                            <div className="p-6">
                              {standardDimensions.length > 0 ? (
                                <div className="space-y-4">
                                  <div className="overflow-x-auto -mx-6 px-6">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="bg-indigo-50 dark:bg-indigo-900/30 border-b-2 border-indigo-200 dark:border-indigo-700">
                                          <th className="text-right py-3 px-4 font-semibold text-indigo-900 dark:text-indigo-100">طول استاندارد (cm)</th>
                                          <th className="text-right py-3 px-4 font-semibold text-indigo-900 dark:text-indigo-100">عرض استاندارد (cm)</th>
                                          <th className="text-right py-3 px-4 font-semibold text-indigo-900 dark:text-indigo-100">تعداد</th>
                                          <th className="text-right py-3 px-4 font-semibold text-indigo-900 dark:text-indigo-100">مساحت (m²)</th>
                                          <th className="text-right py-3 px-4 font-semibold text-indigo-900 dark:text-indigo-100">عملیات</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                        {standardDimensions.map((entry, index) => {
                                          const validationError = validateStandardDimensions(entry);
                                          const entryAreaSqm = (entry.standardLengthCm * entry.standardWidthCm * entry.quantity) / 10000;
                                          const isValid = !validationError && entry.standardLengthCm >= requestedLengthCm && entry.standardWidthCm >= requestedWidthCm;
                                          
                                          return (
                                            <tr 
                                              key={entry.id} 
                                              className={`transition-colors hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 ${
                                                validationError 
                                                  ? 'bg-red-50 dark:bg-red-900/20' 
                                                  : isValid 
                                                    ? 'bg-green-50/30 dark:bg-green-900/10' 
                                                    : ''
                                              }`}
                                            >
                                              <td className="py-3 px-4">
                                                <div className="space-y-1">
                                                  <FormattedNumberInput
                                                    value={entry.standardLengthCm}
                                                    onChange={(value) => handleUpdateStandardDimension(entry.id, 'standardLengthCm', value || 0)}
                                                    min={requestedLengthCm}
                                                    className={`w-full px-3 py-2 text-sm border rounded-lg transition-all ${
                                                      validationError && entry.standardLengthCm < requestedLengthCm 
                                                        ? 'border-red-500 bg-red-50 dark:bg-red-900/20' 
                                                        : isValid
                                                          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                                                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                                                    } focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500`}
                                                  />
                                                  {validationError && entry.standardLengthCm < requestedLengthCm && (
                                                    <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                                                      <FaTimes className="text-xs" />
                                                      {validationError}
                                                    </p>
                                                  )}
                                                  {isValid && entry.standardLengthCm >= requestedLengthCm && (
                                                    <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                                      <FaCheck className="text-xs" />
                                                      مناسب
                                                    </p>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="py-3 px-4">
                                                <div className="space-y-1">
                                                  <FormattedNumberInput
                                                    value={entry.standardWidthCm}
                                                    onChange={(value) => handleUpdateStandardDimension(entry.id, 'standardWidthCm', value || 0)}
                                                    min={requestedWidthCm}
                                                    className={`w-full px-3 py-2 text-sm border rounded-lg transition-all ${
                                                      validationError && entry.standardWidthCm < requestedWidthCm 
                                                        ? 'border-red-500 bg-red-50 dark:bg-red-900/20' 
                                                        : isValid
                                                          ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                                                          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                                                    } focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500`}
                                                  />
                                                  {validationError && entry.standardWidthCm < requestedWidthCm && (
                                                    <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                                                      <FaTimes className="text-xs" />
                                                      {validationError}
                                                    </p>
                                                  )}
                                                  {isValid && entry.standardWidthCm >= requestedWidthCm && (
                                                    <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                                                      <FaCheck className="text-xs" />
                                                      مناسب
                                                    </p>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="py-3 px-4">
                                                <FormattedNumberInput
                                                  value={entry.quantity}
                                                  onChange={(value) => handleUpdateStandardDimension(entry.id, 'quantity', value || 0)}
                                                  min={1}
                                                  className={`w-full px-3 py-2 text-sm border rounded-lg ${
                                                    validationError && entry.quantity <= 0 
                                                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20' 
                                                      : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                                                  } focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500`}
                                                />
                                              </td>
                                              <td className="py-3 px-4">
                                                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                                  {formatSquareMeters(entryAreaSqm)}
                                                </div>
                                              </td>
                                              <td className="py-3 px-4">
                                                <button
                                                  type="button"
                                                  onClick={() => handleRemoveStandardDimension(entry.id)}
                                                  className="p-2 text-red-600 dark:text-red-400 hover:text-white hover:bg-red-600 dark:hover:bg-red-700 rounded-lg transition-all"
                                                  title="حذف"
                                                >
                                                  <FaTrash className="text-base" />
                                                </button>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                  
                                  {/* Summary Footer */}
                                  <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/30 dark:to-blue-900/30 rounded-lg p-4 border border-indigo-200 dark:border-indigo-700">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                                      <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-indigo-200 dark:border-indigo-700">
                                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">مجموع تعداد</p>
                                        <p className={`text-xl font-bold ${totalStandardQuantity === wantedQuantity ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                          {totalStandardQuantity}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">از {wantedQuantity} مورد نیاز</p>
                                      </div>
                                      <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-indigo-200 dark:border-indigo-700">
                                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">مجموع مساحت</p>
                                        <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                                          {formatSquareMeters(totalStandardAreaSqm)}
                                        </p>
                                      </div>
                                      <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-indigo-200 dark:border-indigo-700">
                                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">وضعیت</p>
                                        {totalStandardQuantity === wantedQuantity ? (
                                          <div className="flex items-center gap-2">
                                            <FaCheck className="text-green-600 dark:text-green-400" />
                                            <span className="text-sm font-semibold text-green-600 dark:text-green-400">تعداد کافی است</span>
                                          </div>
                                        ) : totalStandardQuantity < wantedQuantity ? (
                                          <div className="flex items-center gap-2">
                                            <FaTimes className="text-red-600 dark:text-red-400" />
                                            <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                                              {wantedQuantity - totalStandardQuantity} عدد کم است
                                            </span>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-2">
                                            <FaTimes className="text-orange-600 dark:text-orange-400" />
                                            <span className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                                              {totalStandardQuantity - wantedQuantity} عدد اضافه
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center py-12">
                                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                                    <FaWarehouse className="text-2xl text-indigo-500 dark:text-indigo-400" />
                                  </div>
                                  <p className="text-gray-600 dark:text-gray-400 mb-2">هنوز ابعاد استانداردی اضافه نشده است</p>
                                  <p className="text-sm text-gray-500 dark:text-gray-500">برای شروع، دکمه "افزودن ابعاد" را کلیک کنید</p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* نوع محاسبه برش Section */}
                          <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 shadow-lg overflow-hidden">
                            <div className="bg-gradient-to-r from-purple-500 to-purple-600 dark:from-purple-600 dark:to-purple-700 px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                  <FaTools className="text-white text-lg" />
                                </div>
                                <div>
                                  <h4 className="text-lg font-bold text-white">نوع محاسبه برش</h4>
                                  <p className="text-xs text-purple-100">روش محاسبه هزینه برش را انتخاب کنید</p>
                                </div>
                              </div>
                            </div>
                            
                            <div className="p-6">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                <button
                                  type="button"
                                  onClick={() => setProductConfig(prev => ({ ...prev, slabCuttingMode: 'perSquareMeter' }))}
                                  className={`relative p-5 rounded-xl border-2 transition-all transform hover:scale-105 ${
                                    slabCuttingMode === 'perSquareMeter'
                                      ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-indigo-600 shadow-xl'
                                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500'
                                  }`}
                                >
                                  {slabCuttingMode === 'perSquareMeter' && (
                                    <div className="absolute top-3 right-3">
                                      <div className="w-6 h-6 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                        <FaCheck className="text-white text-sm" />
                                      </div>
                                    </div>
                                  )}
                                  <div className="text-center">
                                    <div className={`w-12 h-12 mx-auto mb-3 rounded-lg flex items-center justify-center ${
                                      slabCuttingMode === 'perSquareMeter' ? 'bg-white/20' : 'bg-indigo-100 dark:bg-indigo-900/30'
                                    }`}>
                                      <FaSquare className={`text-2xl ${slabCuttingMode === 'perSquareMeter' ? 'text-white' : 'text-indigo-600 dark:text-indigo-400'}`} />
                                    </div>
                                    <h5 className="font-bold text-lg mb-1">بر اساس متر مربع</h5>
                                    <p className="text-xs opacity-90">محاسبه بر اساس مساحت قطعه نهایی</p>
                                  </div>
                                </button>
                                
                                <button
                                  type="button"
                                  onClick={() => setProductConfig(prev => ({ ...prev, slabCuttingMode: 'lineBased' }))}
                                  className={`relative p-5 rounded-xl border-2 transition-all transform hover:scale-105 ${
                                    slabCuttingMode === 'lineBased'
                                      ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-indigo-600 shadow-xl'
                                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500'
                                  }`}
                                >
                                  {slabCuttingMode === 'lineBased' && (
                                    <div className="absolute top-3 right-3">
                                      <div className="w-6 h-6 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                        <FaCheck className="text-white text-sm" />
                                      </div>
                                    </div>
                                  )}
                                  <div className="text-center">
                                    <div className={`w-12 h-12 mx-auto mb-3 rounded-lg flex items-center justify-center ${
                                      slabCuttingMode === 'lineBased' ? 'bg-white/20' : 'bg-indigo-100 dark:bg-indigo-900/30'
                                    }`}>
                                      <FaRuler className={`text-2xl ${slabCuttingMode === 'lineBased' ? 'text-white' : 'text-indigo-600 dark:text-indigo-400'}`} />
                                    </div>
                                    <h5 className="font-bold text-lg mb-1">بر اساس خطوط</h5>
                                    <p className="text-xs opacity-90">محاسبه بر اساس طول خطوط برش</p>
                                  </div>
                                </button>
                              </div>
                              
                              {slabCuttingMode === 'perSquareMeter' ? (
                                <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4 border border-indigo-200 dark:border-indigo-700">
                                  <label className="block text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-2">
                                    هزینه برش هر متر مربع (تومان)
                                  </label>
                                  <FormattedNumberInput
                                    value={productConfig.slabCuttingPricePerSquareMeter || 0}
                                    onChange={(value) => setProductConfig(prev => ({ ...prev, slabCuttingPricePerSquareMeter: value || 0 }))}
                                    min={0}
                                    placeholder="مثلاً 150,000"
                                    className="w-full px-4 py-3 text-base border-2 border-indigo-300 dark:border-indigo-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                  />
                                  <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-2 flex items-center gap-1">
                                    <FaSquare className="text-xs" />
                                    هزینه برش بر اساس متر مربع قطعه نهایی محاسبه می‌شود.
                                  </p>
                                </div>
                              ) : (
                                <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4 border border-indigo-200 dark:border-indigo-700">
                                  <p className="text-sm text-indigo-800 dark:text-indigo-200 mb-3 leading-relaxed">
                                    در این حالت هزینه برش بر اساس طول خطوط طولی و عرضی محاسبه می‌شود. طول برش اصلی برابر بعدی است که به ابعاد استاندارد نزدیک‌تر باشد و برش دیگر بر اساس بعد درخواستی محاسبه می‌گردد.
                                  </p>
                                  {(() => {
                                    if (standardDimensions.length > 0 && requestedLengthCm > 0 && requestedWidthCm > 0) {
                                      const firstEntry = standardDimensions[0];
                                      const linePlanPreview = determineSlabLineCutPlan({
                                        requestedLengthCm,
                                        requestedWidthCm,
                                        standardLengthCm: firstEntry.standardLengthCm,
                                        standardWidthCm: firstEntry.standardWidthCm
                                      });
                                      return (
                                        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border-2 border-indigo-300 dark:border-indigo-600">
                                          <p className="font-semibold mb-3 text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
                                            <FaRuler className="text-indigo-600 dark:text-indigo-400" />
                                            خلاصه محاسبه خطوط (نمونه برای اولین ابعاد استاندارد)
                                          </p>
                                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-lg p-3">
                                              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">برش اصلی</p>
                                              <p className="font-bold text-indigo-700 dark:text-indigo-300">
                                                {linePlanPreview.axisUsingStandard === 'length' ? 'طول' : 'عرض'}
                                              </p>
                                            </div>
                                            <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-lg p-3">
                                              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">خطوط طولی</p>
                                              <p className="font-bold text-indigo-700 dark:text-indigo-300">
                                                {formatDisplayNumber(linePlanPreview.longitudinalMeters)} m
                                              </p>
                                            </div>
                                            <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-lg p-3">
                                              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">خطوط عرضی</p>
                                              <p className="font-bold text-indigo-700 dark:text-indigo-300">
                                                {formatDisplayNumber(linePlanPreview.crossMeters)} m
                                              </p>
                                            </div>
                                          </div>
                                          {standardDimensions.length > 1 && (
                                            <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-700">
                                              <p className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                                                <FaTimes className="text-xs" />
                                                توجه: محاسبه برای هر ابعاد استاندارد به صورت جداگانه انجام می‌شود.
                                              </p>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* برش قائم Section - 4 Side Edge Cuts */}
                          <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-teal-200 dark:border-teal-800 shadow-lg overflow-hidden">
                            <div className="bg-gradient-to-r from-teal-500 to-teal-600 dark:from-teal-600 dark:to-teal-700 px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                  <FaRuler className="text-white text-lg" />
                                </div>
                                <div>
                                  <h4 className="text-lg font-bold text-white">برش قائم (پرداخت لبه‌ها)</h4>
                                  <p className="text-xs text-teal-100">انتخاب لبه‌هایی که نیاز به برش قائم دارند</p>
                                </div>
                              </div>
                            </div>
                            
                            <div className="p-6">
                              <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                                هر سنگ استاندارد اسلب نیاز به برش قائم روی لبه‌ها دارد تا تمام لبه‌ها صاف و دقیق شوند و آماده برای برش‌های اصلی باشند.
                              </p>
                              
                              {/* Visual representation of slab with 4 sides */}
                              <div className="bg-gradient-to-br from-teal-50 to-cyan-50 dark:from-teal-900/20 dark:to-cyan-900/20 rounded-xl p-6 border-2 border-teal-200 dark:border-teal-700 mb-4">
                                <div className="relative mx-auto" style={{ width: '200px', height: '150px' }}>
                                  {/* Slab representation */}
                                  <div className="absolute inset-0 bg-white dark:bg-gray-700 rounded-lg border-2 border-teal-300 dark:border-teal-600 shadow-md"></div>
                                  
                                  {/* Top side checkbox */}
                                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                                    <label className="flex items-center gap-2 cursor-pointer bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg border-2 border-teal-300 dark:border-teal-600 shadow-sm hover:shadow-md transition-all">
                                      <input
                                        type="checkbox"
                                        checked={productConfig.slabVerticalCutSides?.top !== false}
                                        onChange={(e) => setProductConfig(prev => ({
                                          ...prev,
                                          slabVerticalCutSides: {
                                            top: e.target.checked,
                                            bottom: prev.slabVerticalCutSides?.bottom !== false,
                                            left: prev.slabVerticalCutSides?.left !== false,
                                            right: prev.slabVerticalCutSides?.right !== false
                                          }
                                        }))}
                                        className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                                      />
                                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">بالا</span>
                                    </label>
                                  </div>
                                  
                                  {/* Bottom side checkbox */}
                                  <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2">
                                    <label className="flex items-center gap-2 cursor-pointer bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg border-2 border-teal-300 dark:border-teal-600 shadow-sm hover:shadow-md transition-all">
                                      <input
                                        type="checkbox"
                                        checked={productConfig.slabVerticalCutSides?.bottom !== false}
                                        onChange={(e) => setProductConfig(prev => ({
                                          ...prev,
                                          slabVerticalCutSides: {
                                            top: prev.slabVerticalCutSides?.top !== false,
                                            bottom: e.target.checked,
                                            left: prev.slabVerticalCutSides?.left !== false,
                                            right: prev.slabVerticalCutSides?.right !== false
                                          }
                                        }))}
                                        className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                                      />
                                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">پایین</span>
                                    </label>
                                  </div>
                                  
                                  {/* Left side checkbox */}
                                  <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1/2">
                                    <label className="flex items-center gap-2 cursor-pointer bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg border-2 border-teal-300 dark:border-teal-600 shadow-sm hover:shadow-md transition-all">
                                      <input
                                        type="checkbox"
                                        checked={productConfig.slabVerticalCutSides?.left !== false}
                                        onChange={(e) => setProductConfig(prev => ({
                                          ...prev,
                                          slabVerticalCutSides: {
                                            top: prev.slabVerticalCutSides?.top !== false,
                                            bottom: prev.slabVerticalCutSides?.bottom !== false,
                                            left: e.target.checked,
                                            right: prev.slabVerticalCutSides?.right !== false
                                          }
                                        }))}
                                        className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                                      />
                                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">چپ</span>
                                    </label>
                                  </div>
                                  
                                  {/* Right side checkbox */}
                                  <div className="absolute right-0 top-1/2 transform -translate-y-1/2 translate-x-1/2">
                                    <label className="flex items-center gap-2 cursor-pointer bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg border-2 border-teal-300 dark:border-teal-600 shadow-sm hover:shadow-md transition-all">
                                      <input
                                        type="checkbox"
                                        checked={productConfig.slabVerticalCutSides?.right !== false}
                                        onChange={(e) => setProductConfig(prev => ({
                                          ...prev,
                                          slabVerticalCutSides: {
                                            top: prev.slabVerticalCutSides?.top !== false,
                                            bottom: prev.slabVerticalCutSides?.bottom !== false,
                                            left: prev.slabVerticalCutSides?.left !== false,
                                            right: e.target.checked
                                          }
                                        }))}
                                        className="w-4 h-4 text-teal-600 rounded focus:ring-teal-500"
                                      />
                                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">راست</span>
                                    </label>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Cost preview */}
                              {(() => {
                                const verticalCutSides = productConfig.slabVerticalCutSides || { top: true, bottom: true, left: true, right: true };
                                const activeSides = Object.values(verticalCutSides).filter(Boolean).length;
                                const hasActiveSides = activeSides > 0;
                                const verticalCutCostPerMeter = getCuttingTypePricePerMeter('VERTICAL') || getCuttingTypePricePerMeter('LONG') || 0;
                                
                                // Calculate برش قائم for each standard dimension entry
                                let totalMeters = 0;
                                let totalEstimatedCost = 0;
                                
                                if (hasActiveSides && verticalCutCostPerMeter > 0 && standardDimensions.length > 0) {
                                  // Loop through each standard dimension entry
                                  for (const entry of standardDimensions) {
                                    // Calculate perimeter for this entry based on standard dimensions
                                    let entryMeters = 0;
                                    if (verticalCutSides.top) entryMeters += entry.standardWidthCm / 100; // width in meters
                                    if (verticalCutSides.bottom) entryMeters += entry.standardWidthCm / 100;
                                    if (verticalCutSides.left) entryMeters += entry.standardLengthCm / 100; // length in meters
                                    if (verticalCutSides.right) entryMeters += entry.standardLengthCm / 100;
                                    
                                    // Multiply by quantity for this entry
                                    const entryTotalMeters = entryMeters * entry.quantity;
                                    totalMeters += entryTotalMeters;
                                    
                                    // Calculate cost for this entry
                                    const entryCost = entryTotalMeters * verticalCutCostPerMeter;
                                    totalEstimatedCost += entryCost;
                                  }
                                }
                                
                                if (hasActiveSides && totalMeters > 0 && verticalCutCostPerMeter > 0) {
                                  return (
                                    <div className="bg-teal-50 dark:bg-teal-900/20 rounded-lg p-4 border border-teal-200 dark:border-teal-700">
                                      <div className="flex items-center justify-between mb-2">
                                        <p className="text-sm font-semibold text-teal-900 dark:text-teal-100">
                                          هزینه برش قائم (پیش‌نمایش)
                                        </p>
                                        <span className="text-xs text-teal-700 dark:text-teal-300">
                                          {activeSides} لبه فعال
                                        </span>
                                      </div>
                                      <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div>
                                          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">مجموع طول لبه‌ها</p>
                                          <p className="font-bold text-teal-700 dark:text-teal-300">
                                            {formatDisplayNumber(totalMeters)} متر
                                          </p>
                                        </div>
                                        <div>
                                          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">هزینه کل</p>
                                          <p className="font-bold text-teal-700 dark:text-teal-300">
                                            {formatPrice(totalEstimatedCost, 'تومان')}
                                          </p>
                                        </div>
                                      </div>
                                      {standardDimensions.length > 1 && (
                                        <div className="mt-3 pt-3 border-t border-teal-200 dark:border-teal-700">
                                          <p className="text-xs text-teal-600 dark:text-teal-400 flex items-center gap-1">
                                            <FaTimes className="text-xs" />
                                            محاسبه برای هر ابعاد استاندارد به صورت جداگانه انجام می‌شود.
                                          </p>
                                        </div>
                                      )}
                        </div>
                      );
                                }
                                return null;
                              })()}
                            </div>
                          </div>

                          {/* CAD Designer Section */}
                          <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 shadow-lg overflow-hidden mt-6">
                            <div className="bg-gradient-to-r from-indigo-500 to-indigo-600 dark:from-indigo-600 dark:to-indigo-700 px-6 py-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                    <FaRuler className="text-white text-lg" />
                                  </div>
                                  <div>
                                    <h4 className="text-lg font-bold text-white">ابزار طراحی CAD</h4>
                                    <p className="text-xs text-indigo-100">طراحی و برنامه‌ریزی برش‌ها به صورت بصری</p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setShowCADDesigner(!showCADDesigner)}
                                  className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors text-sm font-medium"
                                >
                                  {showCADDesigner ? 'مخفی کردن' : 'نمایش'}
                                </button>
                              </div>
                            </div>
                            
                            {showCADDesigner && (
                              <div className="p-6">
                                <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                                  از این ابزار برای طراحی و برنامه‌ریزی برش‌ها روی سنگ‌های استاندارد استفاده کنید. می‌توانید ابعاد مورد نظر را رسم کنید و هزینه‌ها به صورت خودکار محاسبه می‌شوند.
                                </p>
                                
                                {standardDimensions && standardDimensions.length > 0 ? (
                                  <StoneCADDesigner
                                    originalLength={productConfig.length || 0}
                                    originalWidth={productConfig.width || 0}
                                    lengthUnit={lengthUnit}
                                    widthUnit={widthUnit}
                                    standardDimensions={standardDimensions}
                                    productType="slab"
                                    mode="design"
                                    enableCostCalculation={true}
                                    enableAutoSync={true}
                                    onDimensionsCalculated={(dims) => {
                                      // Sync CAD dimensions with product config
                                      if (dims.length && dims.width) {
                                        setProductConfig(prev => ({
                                          ...prev,
                                          length: dims.length,
                                          width: dims.width,
                                          squareMeters: dims.squareMeters
                                        }));
                                      }
                                    }}
                                    onCostCalculated={(cost) => {
                                      // Update cutting cost in product config
                                      setProductConfig(prev => ({
                                        ...prev,
                                        cuttingCost: cost
                                      }));
                                    }}
                                    onDesignChange={(design) => {
                                      // Store CAD design for later use
                                      setProductConfig(prev => ({
                                        ...prev,
                                        cadDesign: design
                                      }));
                                    }}
                                    initialDesign={productConfig.cadDesign || null}
                                  />
                                ) : (
                                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                                      لطفاً ابتدا ابعاد استاندارد را اضافه کنید تا بتوانید از ابزار طراحی استفاده کنید.
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        تعداد
                      </label>
                      <FormattedNumberInput
                        value={getQuantityDisplayValue()}
                        onFocus={() => handleFieldFocus('quantity', getQuantityDisplayValue(), 0)}
                        onChange={(value) => {
                          // Check if quantity is being cleared/deleted (empty or 0)
                          const isQuantityCleared = !value || value === 0;
                          
                          // Mark quantity as interacted
                          if (!hasQuantityBeenInteracted) {
                            setHasQuantityBeenInteracted(true);
                            console.log('🎯 Quantity First Interaction');
                          }
                          
                          // Handle mandatory pricing based on quantity state
                          if (isQuantityCleared) {
                            // If quantity is cleared, uncheck mandatory pricing and reset interaction state
                            setIsMandatory(false);
                            setHasQuantityBeenInteracted(false);
                            console.log('🔄 Quantity Cleared - Deactivating mandatory pricing and resetting interaction state');
                          } else {
                            // If quantity has a value, activate mandatory pricing
                            setIsMandatory(true);
                            console.log('✅ Quantity Has Value - Activating mandatory pricing');
                          }
                          
                          // Update the quantity
                          setProductConfig(prev => {
                            const updatedConfig = { ...prev, quantity: value };
                            // Use effective quantity for calculations
                            const effectiveQuantity = value || 1;
                            // Trigger smart calculation with effective quantity
                            const smartResult = handleSmartCalculation('quantity', effectiveQuantity, updatedConfig, lengthUnit, widthUnit, effectiveQuantity);
                            
                            // Recalculate cutting cost automatically using helper function
                            const updatedCuttingCost = calculateAutoCuttingCost(
                              updatedConfig.length,
                              lengthUnit,
                              prev.cuttingCostPerMeter || null,
                              effectiveQuantity
                            );
                            
                            return {
                              ...updatedConfig,
                              squareMeters: smartResult.squareMeters,
                              cuttingCost: updatedCuttingCost
                            };
                          });
                          
                          console.log('📊 Quantity Changed:', {
                            displayValue: value,
                            effectiveQuantity: value || 1,
                            isQuantityCleared,
                            hasBeenInteracted: !isQuantityCleared,
                            mandatoryActivated: !isQuantityCleared
                          });
                        }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        min={1}
                        placeholder="تعداد"
                      />
                    </div>
                  </>)}

                  {/* Unit Selection Help Text - Only for slab/longitudinal */}
                  {(productConfig.productType === 'longitudinal' || productConfig.productType === 'slab') && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        <strong>راهنمای انتخاب واحد:</strong> برای هر فیلد طول و عرض، روی دکمه‌های "سانتی‌متر" یا "متر" کلیک کنید تا واحد مورد نظر را انتخاب کنید. 
                        دکمه انتخاب شده با رنگ آبی نمایش داده می‌شود. سیستم به طور خودکار محاسبات را انجام می‌دهد.
                      </p>
                    </div>
                  )}

                  {/* Slab 2D Cutting Info Cards */}
                  {productConfig.productType === 'slab' && selectedProduct && (() => {
                    const { standardLengthCm, standardWidthCm } = getSlabStandardDimensions();
                    const originalWidth = standardWidthCm || selectedProduct.widthValue || 0;
                    const originalLengthCm = standardLengthCm || (selectedProduct as any)?.lengthValue || 300;
                    
                    const userWidthInCm = productConfig.width 
                      ? (widthUnit === 'm' ? productConfig.width * 100 : productConfig.width)
                      : 0;
                    const userLengthInCm = productConfig.length 
                      ? (lengthUnit === 'm' ? productConfig.length * 100 : productConfig.length)
                      : 0;
                    const needsLongitudinalCut = userWidthInCm > 0 && userWidthInCm < originalWidth && originalWidth > 0;
                    const needsCrossCut = userLengthInCm > 0 && userLengthInCm < originalLengthCm && originalLengthCm > 0;
                    const hasCuts = needsLongitudinalCut || needsCrossCut;
                    const slabCuttingMode = productConfig.slabCuttingMode || 'lineBased';
                    const effectiveQuantity = getEffectiveQuantity();
                    const linePlan = determineSlabLineCutPlan({
                      requestedLengthCm: userLengthInCm,
                      requestedWidthCm: userWidthInCm,
                      standardLengthCm,
                      standardWidthCm
                    });
                    
                    const requestedAreaSqm = productConfig.squareMeters && productConfig.squareMeters > 0
                      ? productConfig.squareMeters
                      : (userLengthInCm > 0 && userWidthInCm > 0
                          ? (userLengthInCm * userWidthInCm * effectiveQuantity) / 10000
                          : 0);
                    
                    const cuttingCostPerMeterLongitudinal = needsLongitudinalCut ? (getCuttingTypePricePerMeter('LONG') || 0) : 0;
                    const cuttingCostPerMeterCross = needsCrossCut ? (getCuttingTypePricePerMeter('CROSS') || getCuttingTypePricePerMeter('LONG') || 0) : 0;
                    
                    const longitudinalCuttingCost = needsLongitudinalCut && slabCuttingMode === 'lineBased' && cuttingCostPerMeterLongitudinal > 0
                      ? linePlan.longitudinalMeters * cuttingCostPerMeterLongitudinal * effectiveQuantity
                      : 0;
                    const crossCuttingCost = needsCrossCut && slabCuttingMode === 'lineBased' && cuttingCostPerMeterCross > 0
                      ? linePlan.crossMeters * cuttingCostPerMeterCross * effectiveQuantity
                      : 0;
                    const totalCuttingCost = slabCuttingMode === 'lineBased' ? (longitudinalCuttingCost + crossCuttingCost) : 0;
                    
                    const remainingWidth = originalWidth - userWidthInCm;
                    const remainingLength = originalLengthCm - userLengthInCm;
                    const remainingPiecesCount = (remainingWidth > 0 ? 1 : 0) + (remainingLength > 0 ? 1 : 0) + (remainingWidth > 0 && remainingLength > 0 ? 1 : 0);
                    const showLineCard = slabCuttingMode === 'lineBased' && hasCuts && productConfig.length && productConfig.width;
                    
                    if (!showLineCard && slabCuttingMode === 'lineBased' && !requestedAreaSqm) {
                      return null;
                    }
                    
                    return (
                      <div className="space-y-3">
                        {slabCuttingMode === 'perSquareMeter' ? (
                          <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                              <h5 className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
                                برش بر اساس متر مربع
                              </h5>
                            </div>
                            <p className="text-xs text-indigo-700 dark:text-indigo-300">
                              {requestedAreaSqm > 0
                                ? `مساحت هدف: ${formatSquareMeters(requestedAreaSqm)}`
                                : 'برای محاسبه دقیق، طول و عرض درخواستی را وارد کنید.'}
                            </p>
                            {productConfig.slabCuttingPricePerSquareMeter ? (
                              <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-1">
                                هزینه برش: {formatPrice(productConfig.slabCuttingPricePerSquareMeter)} × {formatSquareMeters(requestedAreaSqm || 0)}
                              </p>
                            ) : (
                              <p className="text-xs text-indigo-500 dark:text-indigo-200 mt-1">
                                لطفاً هزینه برش هر متر مربع را وارد کنید.
                              </p>
                            )}
                          </div>
                        ) : showLineCard ? (
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                            <h5 className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">
                              اطلاعات برش دو بعدی
                            </h5>
                          </div>
                          <div className="space-y-2 text-xs text-indigo-700 dark:text-indigo-300">
                            {needsLongitudinalCut && (
                              <div>
                                <span className="font-medium">برش طولی:</span> عرض {formatDisplayNumber(originalWidth)}cm → {formatDisplayNumber(userWidthInCm)}cm
                                {cuttingCostPerMeterLongitudinal > 0 && (
                                  <span className="ml-2">
                                      ({formatDisplayNumber(linePlan.longitudinalMeters)} m × {formatPrice(cuttingCostPerMeterLongitudinal)} = {formatPrice(longitudinalCuttingCost)})
                                  </span>
                                )}
                              </div>
                            )}
                            {needsCrossCut && (
                              <div>
                                <span className="font-medium">{needsLongitudinalCut ? 'برش عرضی' : 'برش کله بر'}:</span> طول {formatDisplayNumber(originalLengthCm)}cm → {formatDisplayNumber(userLengthInCm)}cm
                                {cuttingCostPerMeterCross > 0 && (
                                  <span className="ml-2">
                                      ({formatDisplayNumber(linePlan.crossMeters)} m × {formatPrice(cuttingCostPerMeterCross)} = {formatPrice(crossCuttingCost)})
                                  </span>
                                )}
                              </div>
                            )}
                            {totalCuttingCost > 0 && (
                              <div className="mt-2 pt-2 border-t border-indigo-200 dark:border-indigo-700">
                                <span className="font-semibold">هزینه کل برش: {formatPrice(totalCuttingCost)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        ) : null}
                        
                        {hasCuts && productConfig.length && productConfig.width && remainingPiecesCount > 0 && (
                          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                              <h5 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                                باقیمانده‌های اسلب ({remainingPiecesCount} قطعه)
                              </h5>
                            </div>
                            <div className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
                              {remainingWidth > 0 && userLengthInCm > 0 && (
                                <div>
                                  • قطعه عرضی: {formatDisplayNumber(remainingWidth)}cm × {formatDisplayNumber(userLengthInCm)}cm
                                  <span className="text-amber-600 dark:text-amber-400 ml-1">
                                    ({formatSquareMeters((remainingWidth * userLengthInCm * effectiveQuantity) / 10000)})
                                  </span>
                                </div>
                              )}
                              {remainingLength > 0 && userWidthInCm > 0 && (
                                <div>
                                  • قطعه طولی: {formatDisplayNumber(userWidthInCm)}cm × {formatDisplayNumber(remainingLength)}cm
                                  <span className="text-amber-600 dark:text-amber-400 ml-1">
                                    ({formatSquareMeters((userWidthInCm * remainingLength * effectiveQuantity) / 10000)})
                                  </span>
                                </div>
                              )}
                              {remainingWidth > 0 && remainingLength > 0 && (
                                <div>
                                  • قطعه گوشه: {formatDisplayNumber(remainingWidth)}cm × {formatDisplayNumber(remainingLength)}cm
                                  <span className="text-amber-600 dark:text-amber-400 ml-1">
                                    ({formatSquareMeters((remainingWidth * remainingLength * effectiveQuantity) / 10000)})
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {productConfig.productType === 'longitudinal' && selectedProduct && (
                    (() => {
                      const sourceWidthCm = Number(selectedProduct.widthValue || 0);
                      const requestedWidthCm = widthUnit === 'm'
                        ? Number(productConfig.width || 0) * 100
                        : Number(productConfig.width || 0);
                      const requestedLengthM = lengthUnit === 'cm'
                        ? Number(productConfig.length || 0) / 100
                        : Number(productConfig.length || 0);
                      const plan = calculateSmartLongitudinalCutPlan({
                        originalWidthCm: sourceWidthCm,
                        enteredWidth: requestedWidthCm,
                        enteredWidthUnit: 'cm',
                        enteredLength: requestedLengthM,
                        enteredLengthUnit: 'm',
                        quantity: getEffectiveQuantity(),
                        longitudinalRatePerMeter: getCuttingTypePricePerMeter('LONG') || 0,
                        crossRatePerMeter: getCuttingTypePricePerMeter('CROSS') || 0,
                        optimizationEnabled: true,
                        sawKerfEnabled: !!productConfig.sawKerfEnabled,
                        sawKerfCm: productConfig.sawKerfEnabled ? (productConfig.sawKerfCm || SAW_KERF_CM) : null
                      });

                      if (!plan.enabled) return null;

                      return (
                        <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg p-4">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <h5 className="text-sm font-semibold text-teal-800 dark:text-teal-200">
                              پیشنهاد برش هوشمند
                            </h5>
                            {currentUser && ['ADMIN', 'MANAGER'].includes(currentUser.role || '') ? (
                              <button
                                type="button"
                                onClick={() => router.push('/dashboard/inventory/services')}
                                className="text-xs text-teal-700 dark:text-teal-300 hover:underline"
                              >
                                ویرایش نرخ‌های برش در تنظیمات خدمات
                              </button>
                            ) : (
                              <span className="text-xs text-teal-700 dark:text-teal-300">
                                خودکار و قابل بازبینی
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-teal-900 dark:text-teal-100">
                            <div className="space-y-1">
                              <p className="font-medium">قطعات تولیدی</p>
                              {plan.productionPieces.map((piece, pieceIndex) => (
                                <p key={pieceIndex}>
                                  {formatDisplayNumber(piece.quantity)} × عرض {formatDisplayNumber(piece.widthCm)}cm × طول {formatDisplayNumber(piece.lengthM)}m
                                </p>
                              ))}
                            </div>
                            <div className="space-y-1">
                              <p>سطح مصرفی: {formatSquareMeters(plan.consumedAreaSqm)}</p>
                              <p>سطح درخواستی: {formatSquareMeters(plan.requestedAreaSqm)}</p>
                              {plan.sawKerfEnabled && (
                                <p>خوراک اره: عرض مصرفی هر قطعه {formatDisplayNumber(plan.consumedWidthCm)}cm</p>
                              )}
                              {plan.remainingStones.map((stone, stoneIndex) => (
                                <p key={stoneIndex}>
                                  باقی‌مانده: عرض {formatDisplayNumber(stone.width)}cm × طول {formatDisplayNumber(stone.length)}m
                                </p>
                              ))}
                            </div>
                            {plan.warnings.filter((warning) => warning.includes('خوراک اره')).map((warning, warningIndex) => (
                              <p key={`kerf-warning-${warningIndex}`} className="md:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                                {warning}
                              </p>
                            ))}
                            {plan.cuttingBreakdown.length > 0 && (
                              <div className="md:col-span-2 pt-2 border-t border-teal-200 dark:border-teal-700 space-y-1">
                                {plan.cuttingBreakdown.map((cut, cutIndex) => (
                                  <p key={cutIndex}>
                                    {cut.type === 'longitudinal' ? 'برش طولی' : 'برش عرضی'}: {formatDisplayNumber(cut.meters)}m × {formatPrice(cut.rate)} = {formatPrice(cut.cost)}
                                  </p>
                                ))}
                                <p className="font-semibold">
                                  جمع هزینه برش: {formatPrice(plan.totalCuttingCost)}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()
                  )}

                  {productConfig.productType !== 'prepared' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        فی هر متر مربع (تومان)
                      </label>
                      <FormattedNumberInput
                        value={productConfig.pricePerSquareMeter || 0}
                        onFocus={() => handleFieldFocus('pricePerSquareMeter', productConfig.pricePerSquareMeter, 0)}
                        onChange={(value) => setProductConfig(prev => ({ ...prev, pricePerSquareMeter: value }))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        min={0}
                        step={1000}
                        placeholder="فی هر متر مربع (تومان)"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        متر مربع
                      </label>
                      <FormattedNumberInput
                        key={`square-meters-${lengthUnit}-${widthUnit}`}
                        value={(() => {
                          console.log('🎯 متر مربع Field Value:', {
                            productConfigSquareMeters: productConfig.squareMeters,
                            lengthUnit,
                            widthUnit,
                            finalValue: productConfig.squareMeters || 0
                          });
                          return productConfig.squareMeters || 0;
                        })()}
                        onFocus={() => handleFieldFocus('squareMeters', productConfig.squareMeters, 0)}
                        onChange={(value) => {
                          // Update the square meters first
                          setProductConfig(prev => {
                            // Get original width for calculations
                            const originalWidth = (isEditMode && prev.originalWidth) ? prev.originalWidth : (selectedProduct?.widthValue || 0);
                            
                            // Check if user entered ONLY squareMeters (no length, no width)
                            const hasNoLength = !prev.length || prev.length === 0;
                            const hasNoWidth = !prev.width || prev.width === 0;
                            const onlySquareMetersEntered = hasNoLength && hasNoWidth && value > 0;
                            
                            let updatedConfig = { ...prev, squareMeters: value };
                            
                            // If only squareMeters is entered, automatically set width to original width
                            if (onlySquareMetersEntered && originalWidth > 0) {
                              // Convert original width to the selected width unit
                              const originalWidthInSelectedUnit = widthUnit === 'cm' 
                                ? originalWidth 
                                : (originalWidth / 100);
                              
                              // Set width to original width
                              updatedConfig = {
                                ...updatedConfig,
                                width: originalWidthInSelectedUnit
                              };
                              
                              console.log('🎯 Auto-setting width to original width:', {
                                originalWidth,
                                widthUnit,
                                originalWidthInSelectedUnit,
                                squareMeters: value
                              });
                            }
                            
                            // Trigger smart calculation with updated config
                            const smartResult = handleSmartCalculation('squareMeters', value, updatedConfig, lengthUnit, widthUnit, getEffectiveQuantity());
                            const finalConfig = {
                              ...updatedConfig,
                              length: smartResult.length,
                              width: smartResult.width || updatedConfig.width // Preserve auto-set width if smart calculation doesn't return width
                            };
                            
                            // Check if we need to auto-select longitudinal cut after smart calculation
                            const userWidthInCm = widthUnit === 'm' ? (finalConfig.width || 0) * 100 : (finalConfig.width || 0);
                            
                            // Validate: calculated width cannot exceed original width
                            if (finalConfig.width && finalConfig.width > 0 && originalWidth > 0 && userWidthInCm > originalWidth) {
                              // Show error message
                              setErrors({ 
                                products: `عرض نهایی شده (${finalConfig.width.toFixed(2)}${widthUnit === 'm' ? 'm' : 'cm'}) بیشتر از عرض اصلی سنگ (${originalWidth}cm) است. لطفاً عرض را کاهش دهید تا از ${originalWidth}cm بیشتر نشود.` 
                              });
                            } else {
                              // Clear error if calculated width is valid
                              if (errors.products && errors.products.includes('عرض محاسبه شده')) {
                                setErrors({});
                              }
                            }
                            
                            const shouldAutoSelectLongitudinalCut = userWidthInCm < originalWidth;
                            
                            console.log('📏 Square Meters Changed - Auto Cut Selection:', {
                              userSquareMeters: value,
                              calculatedWidth: finalConfig.width,
                              userWidthInCm,
                              originalWidth,
                              shouldAutoSelectLongitudinalCut,
                              comparison: `${userWidthInCm} < ${originalWidth} = ${userWidthInCm < originalWidth}`
                            });
                            
                            // Auto-select cut type based on calculated width
                            if (shouldAutoSelectLongitudinalCut) {
                              return {
                                ...finalConfig,
                                isCut: true,
                                cutType: 'longitudinal'
                              };
                            } else {
                              return {
                                ...finalConfig,
                                isCut: false,
                                cutType: null
                              };
                            }
                          });
                        }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        min={0}
                        step={0.01}
                        decimalScale={4}
                        placeholder="محاسبه شده یا وارد کنید"
                      />
                    </div>
                  </div>
                  )}

                  {productConfig.productType !== 'prepared' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      توضیحات
                    </label>
                    <textarea
                      value={productConfig.description || ''}
                      onFocus={() => handleFieldFocus('description', productConfig.description, '')}
                      onChange={(e) => setProductConfig(prev => ({ ...prev, description: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                      placeholder="توضیحات اضافی..."
                    />
                  </div>
                  )}
                  {/* Mandatory Pricing Section - Only for longitudinal stones */}
                  {productConfig.productType === 'longitudinal' && (
                  <div className="border-t border-gray-200 dark:border-gray-600 pt-4">
                    <div className="flex items-center space-x-3 space-x-reverse mb-4">
                      <input
                        type="checkbox"
                        id="isMandatory"
                        checked={isMandatory}
                        onChange={(e) => setIsMandatory(e.target.checked)}
                        className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <div className="flex flex-col">
                        <label htmlFor="isMandatory" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          حکمی (افزایش قیمت)
                        </label>
                        {hasQuantityBeenInteracted && (
                          <span className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                            {isMandatory ? 'با قیمت حکمی محاسبه می‌شود' : 'بدون قیمت حکمی محاسبه می‌شود'}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    {isMandatory && (
                      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                        <div className="flex items-center space-x-3 space-x-reverse">
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            درصد افزایش:
                          </label>
                          <FormattedNumberInput
                            value={mandatoryPercentage}
                            onChange={(value) => setMandatoryPercentage(value)}
                            className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent text-sm"
                            min={0}
                            max={100}
                          />
                          <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
                        </div>
                        <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-2">
                          قیمت نهایی با {mandatoryPercentage}% افزایش محاسبه خواهد شد
                        </p>
                        
                        {/* Price Preview */}
                        {(() => {
                          console.log('🔍 Price Preview Calculation:', {
                            productConfigWidth: productConfig.width,
                            length: productConfig.length,
                            quantity: productConfig.quantity,
                            pricePerSquareMeter: productConfig.pricePerSquareMeter
                          });
                          
                          // Use productConfig.originalWidth when editing, otherwise use selectedProduct.widthValue
                          const originalWidthForCalculation = (isEditMode && productConfig.originalWidth) 
                            ? productConfig.originalWidth 
                            : (selectedProduct?.widthValue || 0);
                          
                          const calculated = calculateStoneMetrics({
                            length: productConfig.length,
                            width: productConfig.width,
                            quantity: productConfig.quantity,
                            squareMeters: productConfig.squareMeters,
                            pricePerSquareMeter: productConfig.pricePerSquareMeter,
                            lengthUnit: lengthUnit,
                            widthUnit: widthUnit,
                            isMandatory: isMandatory,
                            mandatoryPercentage: mandatoryPercentage,
                            isCut: productConfig.isCut || false,
                            originalWidth: originalWidthForCalculation,
                            cuttingCostPerMeter: productConfig.cuttingCostPerMeter || 0
                          });
                          
                          console.log('🔍 Price Preview Result:', {
                            originalTotalPrice: calculated.originalTotalPrice,
                            totalPrice: calculated.totalPrice,
                            squareMeters: calculated.squareMeters
                          });
                          
                          if (calculated.originalTotalPrice > 0) {
                            return (
                              <div className="mt-3 p-2 bg-white dark:bg-gray-800 rounded border border-yellow-300 dark:border-yellow-600">
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  قیمت اصلی: {formatPrice(calculated.originalTotalPrice, 'تومان')}
                                </div>
                                <div className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                                  قیمت نهایی: {formatPrice(calculated.totalPrice, 'تومان')}
                                </div>
                              </div>
                            );
                          }
                          return null;
                        })()}
                  </div>
                )}
            </div>
              )}
            </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    onClick={() => {
                      // Validate before closing if it's a stair system
                      if (productConfig.productType === 'stair' && stairSystemConfig) {
                        const hasSelectedPart = stairSystemConfig.tread.isSelected || 
                                                stairSystemConfig.riser.isSelected || 
                                                stairSystemConfig.landing.isSelected;
                        
                        if (!hasSelectedPart) {
                          setErrors({ products: 'لطفاً حداقل یکی از بخش‌های پله (کف پله، خیز پله، یا پاگرد) را انتخاب کنید' });
                          return;
                        }
                      }
                      
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
                      setStairSystemConfig(null);
                      setErrors({});
                    }}
                    className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                  >
                    انصراف
                  </button>
                  <button
                    onClick={() => {
                      console.log('🔘 Main Product Button clicked!');
                      handleAddProductToContract();
                    }}
                    className="px-6 py-2 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white rounded-lg transition-all duration-200 font-medium"
                  >
                    {isEditMode ? 'ویرایش بخش' : 'افزودن به لیست'}
                  </button>
                </div>
              </div>
            </div>
            </div>
        )}
        {/* SubService Selection Modal - Now using SubServiceModal component (see below) */}

        {/* New Modal Components */}
        <ProductConfigurationModal
          isOpen={productModal.showProductModal && !(productModal.productConfig.productType === 'stair' && useStairFlowV2) && (!!productModal.selectedProduct || productModal.productConfig.productType === 'stair')}
          onClose={() => {
            productModal.setShowProductModal(false);
            productModal.setSelectedProduct(null);
          }}
          selectedProduct={productModal.selectedProduct}
          productConfig={productModal.productConfig}
          setProductConfig={productModal.setProductConfig}
          lengthUnit={productModal.lengthUnit}
          setLengthUnit={productModal.setLengthUnit}
          widthUnit={productModal.widthUnit}
          setWidthUnit={productModal.setWidthUnit}
          isMandatory={productModal.isMandatory}
          setIsMandatory={productModal.setIsMandatory}
          mandatoryPercentage={productModal.mandatoryPercentage}
          setMandatoryPercentage={productModal.setMandatoryPercentage}
          isEditMode={productModal.isEditMode}
          setIsEditMode={productModal.setIsEditMode}
          editingProductIndex={productModal.editingProductIndex}
          setEditingProductIndex={productModal.setEditingProductIndex}
          touchedFields={productModal.touchedFields}
          setTouchedFields={productModal.setTouchedFields}
          stairSystemConfig={productModal.stairSystemConfig}
          setStairSystemConfig={productModal.setStairSystemConfig}
          quantityType={productModal.quantityType}
          setQuantityType={productModal.setQuantityType}
          treadExpanded={productModal.treadExpanded}
          setTreadExpanded={productModal.setTreadExpanded}
          riserExpanded={productModal.riserExpanded}
          setRiserExpanded={productModal.setRiserExpanded}
          landingExpanded={productModal.landingExpanded}
          setLandingExpanded={productModal.setLandingExpanded}
          showCADDesigner={productModal.showCADDesigner}
          setShowCADDesigner={productModal.setShowCADDesigner}
          errors={errors}
          setErrors={setErrors}
          hasQuantityBeenInteracted={productModal.hasQuantityBeenInteracted}
          setHasQuantityBeenInteracted={productModal.setHasQuantityBeenInteracted}
          onSave={handleAddProductToContract}
          onProductTypeChange={handleModalProductTypeChange}
          wizardData={wizardData}
          updateWizardData={updateWizardData}
          handleSmartCalculation={productCalculations.handleSmartCalculation}
          calculateStoneMetrics={productCalculations.calculateStoneMetrics}
          getCuttingTypePricePerMeter={productCalculations.getCuttingTypePricePerMeter}
          calculateAutoCuttingCost={productCalculations.calculateAutoCuttingCost}
          getEffectiveQuantity={productCalculations.getEffectiveQuantity}
          getQuantityDisplayValue={productCalculations.getQuantityDisplayValue}
          handleFieldFocus={productModal.handleFieldFocus}
          handleLengthUnitChange={handleLengthUnitChangeWithCalc}
          handleWidthUnitChange={handleWidthUnitChangeWithCalc}
          generateFullProductName={productCalculations.generateFullProductName}
          calculateTreadMetrics={productCalculations.calculateTreadMetrics}
          calculateRiserMetrics={productCalculations.calculateRiserMetrics}
          calculateLandingMetrics={productCalculations.calculateLandingMetrics}
          calculateNosingCuttingCost={productCalculations.calculateNosingCuttingCost}
          getSlabStandardDimensions={productCalculations.getSlabStandardDimensions}
          determineSlabLineCutPlan={productCalculations.determineSlabLineCutPlan}
          NOSING_TYPES={[...NOSING_TYPES] as any[]}
          cuttingTypes={cuttingTypes}
          products={products}
          stoneFinishings={stoneFinishings}
          finishingLoadState={stoneFinishingLoadState}
          updateStairSystemConfig={updateStairSystemConfig}
          updateStairPart={updateStairPart}
          selectProductForStairPart={selectProductForStairPart}
          syncDraftWithProduct={syncDraftWithProduct}
          filteredTreadProducts={filteredTreadProducts}
          filteredRiserProducts={filteredRiserProducts}
          filteredLandingProducts={filteredLandingProducts}
          treadProductSearchTerm={treadProductSearchTerm}
          setTreadProductSearchTerm={setTreadProductSearchTerm}
          riserProductSearchTerm={riserProductSearchTerm}
          setRiserProductSearchTerm={setRiserProductSearchTerm}
          landingProductSearchTerm={landingProductSearchTerm}
          setLandingProductSearchTerm={setLandingProductSearchTerm}
          useStairFlowV2={useStairFlowV2}
          stairActivePart={stairSystemV2.stairActivePart}
          setStoneSearchTerm={stairSystemV2.setStoneSearchTerm}
          handleCreateFromRemainingStone={handleCreateFromRemainingStone}
          collectAvailableRemainingStones={collectAvailableRemainingStones}
        />

        <RemainingStoneModal
          isOpen={remainingStoneModal.showRemainingStoneModal}
          onClose={() => {
            remainingStoneModal.setShowRemainingStoneModal(false);
            remainingStoneModal.setSelectedRemainingStone(null);
          }}
          remainingStone={remainingStoneModal.selectedRemainingStone}
          onCreatePartitions={remainingStoneModal.handleAddRemainingStoneToContract}
          wizardData={wizardData}
          partitions={remainingStoneModal.partitions}
          setPartitions={remainingStoneModal.setPartitions}
          partitionWidthUnit={remainingStoneModal.partitionWidthUnit}
          setPartitionWidthUnit={remainingStoneModal.setPartitionWidthUnit}
          partitionLengthUnit={remainingStoneModal.partitionLengthUnit}
          setPartitionLengthUnit={remainingStoneModal.setPartitionLengthUnit}
          showRemainingStoneCAD={remainingStoneModal.showRemainingStoneCAD}
          setShowRemainingStoneCAD={remainingStoneModal.setShowRemainingStoneCAD}
          handleAddPartition={remainingStoneModal.handleAddPartition}
          handleUpdatePartition={remainingStoneModal.handleUpdatePartition}
          handleRemovePartition={remainingStoneModal.handleRemovePartition}
          partitionValidationErrors={remainingStoneModal.partitionValidationErrors}
          errors={errors}
          remainingStoneIsMandatory={remainingStoneModal.remainingStoneIsMandatory}
          setRemainingStoneIsMandatory={remainingStoneModal.setRemainingStoneIsMandatory}
          remainingStoneMandatoryPercentage={remainingStoneModal.remainingStoneMandatoryPercentage}
          setRemainingStoneMandatoryPercentage={remainingStoneModal.setRemainingStoneMandatoryPercentage}
          remainingStoneSawKerfEnabled={remainingStoneModal.remainingStoneSawKerfEnabled}
          setRemainingStoneSawKerfEnabled={remainingStoneModal.setRemainingStoneSawKerfEnabled}
        />

        <SubServiceModal
          isOpen={subServiceModal.showSubServiceModal}
          onClose={subServiceModal.closeModal}
          productIndex={subServiceModal.selectedSubServiceProductIndex || 0}
          onSave={() => {
            // Handle sub-service save - the modal will use its internal state
            subServiceModal.closeModal();
          }}
          wizardData={wizardData}
          updateWizardData={updateWizardData}
          subServices={subServices}
          selectedSubServices={subServiceModal.selectedSubServices}
          setSelectedSubServices={subServiceModal.setSelectedSubServices}
          subServiceMeterValues={subServiceModal.subServiceMeterValues}
          setSubServiceMeterValues={subServiceModal.setSubServiceMeterValues}
          subServiceCalculationBases={subServiceModal.subServiceCalculationBases}
          setSubServiceCalculationBases={subServiceModal.setSubServiceCalculationBases}
          errors={errors}
          setErrors={setErrors}
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
  );
}
