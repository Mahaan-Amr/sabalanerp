// useStairSystemV2 Hook
// Manages all stair system v2 state and logic

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction
} from 'react';
import type {
  StairStepperPart,
  StairPartDraftV2,
  StairDraftFieldErrors,
  Product,
  ContractProduct,
  LayerTypeOption
} from '../types/contract.types';
import { validateDraftNumericFields, validateDraftRequiredFields, clearDraftFieldError as clearDraftFieldErrorUtil } from '../services/stairValidationService';
import { generateFullProductName } from '../utils/productUtils';
import { createFreshStairPartDraft } from '../utils/productConfigurationController';
import { servicesAPI } from '@/lib/api';

export type LayerTypesStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

interface UseStairSystemV2Options {
  onError?: (error: string) => void;
  generateFullProductNameFn?: (product: Product) => string;
}

export const useStairSystemV2 = (options: UseStairSystemV2Options = {}) => {
  const { onError, generateFullProductNameFn = generateFullProductName } = options;

  // Use ref to store onError callback to avoid dependency issues
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Draft states for each part
  const [draftTread, setDraftTread] = useState<StairPartDraftV2>(() => createFreshStairPartDraft('tread'));
  
  const [draftRiser, setDraftRiser] = useState<StairPartDraftV2>(() => createFreshStairPartDraft('riser'));
  
  const [draftLanding, setDraftLanding] = useState<StairPartDraftV2>(() => createFreshStairPartDraft('landing'));

  // Active part selector
  const [stairActivePart, setStairActivePart] = useState<StairStepperPart>('tread');

  // Search states
  const [stoneSearchTerm, setStoneSearchTerm] = useState('');
  const [stoneSearchResults, setStoneSearchResults] = useState<Product[]>([]);
  const [isSearchingStones, setIsSearchingStones] = useState(false);
  
  const [toolsSearchTerm, setToolsSearchTerm] = useState('');
  const [toolsResults, setToolsResults] = useState<any[]>([]);
  const [isSearchingTools, setIsSearchingTools] = useState(false);
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);
  
  const [layerStoneSearchTerm, setLayerStoneSearchTerm] = useState('');
  const [layerStoneSearchResults, setLayerStoneSearchResults] = useState<Product[]>([]);
  const [isSearchingLayerStones, setIsSearchingLayerStones] = useState(false);
  const [layerStoneDropdownOpen, setLayerStoneDropdownOpen] = useState(false);

  // Session management
  const [stairSessionId, setStairSessionId] = useState<string | null>(null);
  const [stairSessionItems, setStairSessionItems] = useState<ContractProduct[]>([]);
  const [lastSelectedStoneLabel, setLastSelectedStoneLabel] = useState('');
  const [lastSelectedStoneProduct, setLastSelectedStoneProduct] = useState<Product | null>(null);
  
  // Auto-fill opt-out
  const [autoFillOptOut, setAutoFillOptOut] = useState<Record<StairStepperPart, boolean>>({
    tread: false,
    riser: false,
    landing: false
  });

  // Validation errors
  const [stairDraftErrors, setStairDraftErrors] = useState<Record<StairStepperPart, StairDraftFieldErrors>>({
    tread: {},
    riser: {},
    landing: {}
  });

  // Layer types
  const [layerTypes, setLayerTypes] = useState<LayerTypeOption[]>([]);
  const [isLoadingLayerTypes, setIsLoadingLayerTypes] = useState(false);
  const [layerTypesError, setLayerTypesError] = useState<string | null>(null);
  const [layerTypesStatus, setLayerTypesStatus] = useState<LayerTypesStatus>('idle');

  // Use refs to store drafts for stable callback references
  const draftTreadRef = useRef(draftTread);
  const draftRiserRef = useRef(draftRiser);
  const draftLandingRef = useRef(draftLanding);
  
  // Keep refs in sync with state
  useEffect(() => {
    draftTreadRef.current = draftTread;
  }, [draftTread]);
  
  useEffect(() => {
    draftRiserRef.current = draftRiser;
  }, [draftRiser]);
  
  useEffect(() => {
    draftLandingRef.current = draftLanding;
  }, [draftLanding]);

  // Helper: Get draft by part - stable reference using refs
  const getDraftByPart = useCallback((part: StairStepperPart): StairPartDraftV2 | null => {
    switch (part) {
      case 'tread':
        return draftTreadRef.current;
      case 'riser':
        return draftRiserRef.current;
      case 'landing':
        return draftLandingRef.current;
      default:
        return null;
    }
  }, []);

  // Helper: Get active draft and setter
  const getActiveDraft = useCallback((): [
    StairPartDraftV2,
    Dispatch<SetStateAction<StairPartDraftV2>>
  ] => {
    if (stairActivePart === 'tread') return [draftTread, setDraftTread];
    if (stairActivePart === 'riser') return [draftRiser, setDraftRiser];
    return [draftLanding, setDraftLanding];
  }, [stairActivePart, draftTread, draftRiser, draftLanding]);

  // Helper: Get part display label
  const getPartDisplayLabel = useCallback((part: StairStepperPart): string => {
    if (part === 'tread') return 'کف پله';
    if (part === 'riser') return 'خیز پله';
    return 'پاگرد';
  }, []);

  // Ensure stair session ID exists
  const ensureStairSessionId = useCallback(() => {
    if (stairSessionId) return stairSessionId;
    const id = `stair_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setStairSessionId(id);
    return id;
  }, [stairSessionId]);

  // Sync draft with product
  const syncDraftWithProduct = useCallback((partType: StairStepperPart, product: Product | null) => {
    const updater =
      partType === 'tread' ? setDraftTread :
      partType === 'riser' ? setDraftRiser :
      setDraftLanding;

    const productLabel = product ? generateFullProductNameFn(product) : '';
    updater(prev => ({
      ...prev,
      stoneId: product ? product.id : null,
      stoneLabel: productLabel,
      contractualTitle: productLabel,
      stoneProduct: product,
      pricePerSquareMeter: null,
      thicknessCm: product ? (product.thicknessValue ?? null) : null
    }));

    if (product) {
      setLastSelectedStoneProduct(product);
      setAutoFillOptOut(prev => ({ ...prev, [partType]: false }));
      setStairDraftErrors(prev => ({
        ...prev,
        [partType]: {
          ...prev[partType],
          thickness: undefined,
          pricePerSquareMeter: undefined
        }
      }));
    } else {
      setAutoFillOptOut(prev => ({ ...prev, [partType]: true }));
    }

    if (productLabel) {
      setLastSelectedStoneLabel(productLabel);
    }

    if (stairActivePart === partType) {
      setStoneSearchTerm(productLabel || lastSelectedStoneLabel);
    }
  }, [stairActivePart, lastSelectedStoneLabel, generateFullProductNameFn]);

  // Clear draft field error
  const clearDraftFieldError = useCallback((part: StairStepperPart, field: keyof StairDraftFieldErrors) => {
    setStairDraftErrors(prev => ({
      ...prev,
      [part]: clearDraftFieldErrorUtil(prev[part], field)
    }));
  }, []);

  // Validate draft numeric fields
  const validateDraftNumericFieldsLocal = useCallback((
    part: StairStepperPart,
    draft: StairPartDraftV2,
    field: keyof StairDraftFieldErrors,
    value: number | null
  ): string | null => {
    return validateDraftNumericFields(part, draft, field, value, layerTypes);
  }, [layerTypes]);

  // Validate draft required fields
  const validateDraftRequiredFieldsLocal = useCallback((
    part: StairStepperPart,
    draft: StairPartDraftV2
  ): StairDraftFieldErrors => {
    return validateDraftRequiredFields(part, draft, layerTypes);
  }, [layerTypes]);

  const loadLayerTypes = useCallback(async () => {
    setIsLoadingLayerTypes(true);
    setLayerTypesStatus('loading');
    setLayerTypesError(null);
    try {
      const response = await servicesAPI.getContractLayerTypes();
      if (!response?.data?.success) {
        throw new Error('Contract layer type catalog returned an unsuccessful response');
      }
      const options: LayerTypeOption[] = (response.data.data || [])
        .map((item: any): LayerTypeOption => ({
          id: item.id,
          name: item.name,
          pricePerLayer: Number(item.pricePerLayer) || 0,
          calculationUnit: item.calculationUnit || 'set',
          isActive: item.isActive !== false
        }))
        .filter((option: LayerTypeOption) => option.isActive !== false);
      setLayerTypes(options);
      setLayerTypesStatus(options.length > 0 ? 'ready' : 'empty');
    } catch (error) {
      console.error('Error loading contract layer types:', error);
      setLayerTypesError('دریافت انواع لایه ناموفق بود');
      setLayerTypesStatus('error');
    } finally {
      setIsLoadingLayerTypes(false);
    }
  }, []);

  useEffect(() => {
    void loadLayerTypes();
  }, [loadLayerTypes]);

  // Sync thickness from product
  useEffect(() => {
    const productThickness = draftTread.stoneProduct?.thicknessValue ?? null;
    const currentThickness = draftTread.thicknessCm ?? null;
    if (productThickness !== null && productThickness !== currentThickness) {
      setDraftTread(prev => ({ ...prev, thicknessCm: productThickness }));
    }
  }, [draftTread.stoneProduct?.id, draftTread.stoneProduct?.thicknessValue, draftTread.thicknessCm]);

  useEffect(() => {
    const productThickness = draftRiser.stoneProduct?.thicknessValue ?? null;
    const currentThickness = draftRiser.thicknessCm ?? null;
    if (productThickness !== null && productThickness !== currentThickness) {
      setDraftRiser(prev => ({ ...prev, thicknessCm: productThickness }));
    }
  }, [draftRiser.stoneProduct?.id, draftRiser.stoneProduct?.thicknessValue, draftRiser.thicknessCm]);

  useEffect(() => {
    const productThickness = draftLanding.stoneProduct?.thicknessValue ?? null;
    const currentThickness = draftLanding.thicknessCm ?? null;
    if (productThickness !== null && productThickness !== currentThickness) {
      setDraftLanding(prev => ({ ...prev, thicknessCm: productThickness }));
    }
  }, [draftLanding.stoneProduct?.id, draftLanding.stoneProduct?.thicknessValue, draftLanding.thicknessCm]);

  // Saved session rows are immutable snapshots. Draft changes must never rewrite a
  // previously added sibling layer merely because it has the same stair part type.
  const syncLayerSessionItems = useCallback((items: ContractProduct[]): ContractProduct[] => items, []);

  // Reset all state
  const reset = useCallback(() => {
    setDraftTread(createFreshStairPartDraft('tread'));
    setDraftRiser(createFreshStairPartDraft('riser'));
    setDraftLanding(createFreshStairPartDraft('landing'));
    setStairActivePart('tread');
    setStoneSearchTerm('');
    setStoneSearchResults([]);
    setIsSearchingStones(false);
    setToolsSearchTerm('');
    setToolsResults([]);
    setIsSearchingTools(false);
    setToolsDropdownOpen(false);
    setLayerStoneSearchTerm('');
    setLayerStoneSearchResults([]);
    setIsSearchingLayerStones(false);
    setLayerStoneDropdownOpen(false);
    setStairSessionId(null);
    setStairSessionItems([]);
    setLastSelectedStoneLabel('');
    setLastSelectedStoneProduct(null);
    setAutoFillOptOut({ tread: false, riser: false, landing: false });
    setStairDraftErrors({ tread: {}, riser: {}, landing: {} });
  }, []);

  return {
    // Draft states
    draftTread,
    setDraftTread,
    draftRiser,
    setDraftRiser,
    draftLanding,
    setDraftLanding,
    
    // Active part
    stairActivePart,
    setStairActivePart,
    
    // Search states
    stoneSearchTerm,
    setStoneSearchTerm,
    stoneSearchResults,
    setStoneSearchResults,
    isSearchingStones,
    setIsSearchingStones,
    toolsSearchTerm,
    setToolsSearchTerm,
    toolsResults,
    setToolsResults,
    isSearchingTools,
    setIsSearchingTools,
    toolsDropdownOpen,
    setToolsDropdownOpen,
    layerStoneSearchTerm,
    setLayerStoneSearchTerm,
    layerStoneSearchResults,
    setLayerStoneSearchResults,
    isSearchingLayerStones,
    setIsSearchingLayerStones,
    layerStoneDropdownOpen,
    setLayerStoneDropdownOpen,
    
    // Session management
    stairSessionId,
    setStairSessionId,
    stairSessionItems,
    setStairSessionItems,
    lastSelectedStoneLabel,
    setLastSelectedStoneLabel,
    lastSelectedStoneProduct,
    setLastSelectedStoneProduct,
    autoFillOptOut,
    setAutoFillOptOut,
    
    // Validation
    stairDraftErrors,
    setStairDraftErrors,
    
    // Layer types
    layerTypes,
    isLoadingLayerTypes,
    layerTypesError,
    layerTypesStatus,
    reloadLayerTypes: loadLayerTypes,
    
    // Helpers
    getDraftByPart,
    getActiveDraft,
    getPartDisplayLabel,
    ensureStairSessionId,
    syncDraftWithProduct,
    clearDraftFieldError,
    validateDraftNumericFields: validateDraftNumericFieldsLocal,
    validateDraftRequiredFields: validateDraftRequiredFieldsLocal,
    syncLayerSessionItems,
    reset
  };
};
