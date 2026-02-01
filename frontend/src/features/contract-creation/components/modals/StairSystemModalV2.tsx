// Stair System Modal V2 Component
// Full implementation of the stair system configuration modal (extracted from page.tsx lines 8187-10639)

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { FaTimes, FaTrash } from 'react-icons/fa';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { formatDisplayNumber, formatPrice, formatSquareMeters } from '@/lib/numberFormat';
import { servicesAPI } from '@/lib/api';
import type {
  StairStepperPart,
  StairPartDraftV2,
  Product,
  ContractProduct,
  ContractWizardData,
  LayerTypeOption,
  StairDraftFieldErrors,
  RemainingStone,
  StoneCut,
  UnitType,
  CuttingBreakdownEntry,
  LayerEdgeDemand
} from '../../types/contract.types';
import {
  computeTotalsV2,
  computeFinishingCost,
  calculateLayerMetrics,
  findExistingLayerProduct,
  collectAvailableRemainingStones,
  createLayerProduct,
  mergeLayerProduct,
  updateRemainingStoneUsage,
  getLayerStoneProductForDraft,
  getLayerBasePricePerSquareMeter,
  getLayerEffectivePricePerSquareMeter,
  normalizeLayerAltStoneSettings,
  computeToolMetersForTool,
  computeToolsMetersV2,
  getTotalLayerLengthPerStairM,
  getMaxLayerLengthM,
  computeLayerSqmV2,
  getLayerEdgeDemands
} from '../../services/stairCalculationService';
import {
  validateDraftNumericFields,
  validateDraftRequiredFields,
  clearDraftFieldError
} from '../../services/stairValidationService';
import {
  getActualLengthMeters,
  getPricingLengthMeters,
  getPartDisplayLabel,
  hasLengthMeasurement,
  hasLayerEdgeSelection,
  deriveLayerEdgesFromTools
} from '../../utils/stairUtils';
import { convertMetersToUnit } from '../../utils/dimensionUtils';
import { generateFullProductName, productSupportsContractType } from '../../utils/productUtils';

interface StairSystemModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  // State props
  isEditMode: boolean;
  editingProductIndex: number | null;
  stairActivePart: StairStepperPart;
  draftTread: StairPartDraftV2;
  draftRiser: StairPartDraftV2;
  draftLanding: StairPartDraftV2;
  stairDraftErrors: Record<StairStepperPart, StairDraftFieldErrors>;
  stoneSearchTerm: string;
  stoneSearchResults: Product[];
  isSearchingStones: boolean;
  layerTypes: LayerTypeOption[];
  stoneFinishings: any[];
  stairSessionItems: ContractProduct[];
  stairSessionId: string | null;
  toolsSearchTerm: string;
  toolsResults: any[];
  isSearchingTools: boolean;
  toolsDropdownOpen: boolean;
  layerStoneSearchTerm: string;
  layerStoneSearchResults: Product[];
  isSearchingLayerStones: boolean;
  layerStoneDropdownOpen: boolean;
  wizardData: ContractWizardData;
  cuttingTypes: any[];
  isLoadingLayerTypes: boolean;
  layerTypesError: string | null;
  errors: Record<string, string>;
  // Handler props
  setStairActivePart: (part: StairStepperPart) => void;
  setDraftTread: React.Dispatch<React.SetStateAction<StairPartDraftV2>>;
  setDraftRiser: React.Dispatch<React.SetStateAction<StairPartDraftV2>>;
  setDraftLanding: React.Dispatch<React.SetStateAction<StairPartDraftV2>>;
  setStairDraftErrors: React.Dispatch<React.SetStateAction<Record<StairStepperPart, StairDraftFieldErrors>>>;
  setStoneSearchTerm: (term: string) => void;
  setStoneSearchResults: (results: Product[]) => void;
  setIsSearchingStones: (isSearching: boolean) => void;
  setStairSessionItems: React.Dispatch<React.SetStateAction<ContractProduct[]>>;
  setStairSessionId: (id: string | null) => void;
  setToolsSearchTerm: (term: string) => void;
  setToolsResults: (results: any[]) => void;
  setIsSearchingTools: (isSearching: boolean) => void;
  setToolsDropdownOpen: (open: boolean) => void;
  setLayerStoneSearchTerm: (term: string) => void;
  setLayerStoneSearchResults: (results: Product[]) => void;
  setIsSearchingLayerStones: (isSearching: boolean) => void;
  setLayerStoneDropdownOpen: (open: boolean) => void;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  setIsEditMode: (isEdit: boolean) => void;
  setEditingProductIndex: (index: number | null) => void;
  setErrors: (errors: Record<string, string>) => void;
  setShowProductModal: (show: boolean) => void;
  // Utility functions
  getCuttingTypePricePerMeter: (code: string) => number | null;
  selectProductForStairPart: (part: StairStepperPart, product: Product) => void;
  generateFullProductName: (product: Product) => string;
}

export const StairSystemModalV2: React.FC<StairSystemModalV2Props> = (props) => {
  const {
    isOpen,
    onClose,
    isEditMode,
    editingProductIndex,
    stairActivePart,
    draftTread,
    draftRiser,
    draftLanding,
    stairDraftErrors,
    stoneSearchTerm,
    stoneSearchResults,
    isSearchingStones,
    layerTypes,
    stoneFinishings,
    stairSessionItems,
    stairSessionId,
    toolsSearchTerm,
    toolsResults,
    isSearchingTools,
    toolsDropdownOpen,
    layerStoneSearchTerm,
    layerStoneSearchResults,
    isSearchingLayerStones,
    layerStoneDropdownOpen,
    wizardData,
    cuttingTypes,
    isLoadingLayerTypes,
    layerTypesError,
    errors,
    setStairActivePart,
    setDraftTread,
    setDraftRiser,
    setDraftLanding,
    setStairDraftErrors,
    setStoneSearchTerm,
    setStoneSearchResults,
    setIsSearchingStones,
    setStairSessionItems,
    setStairSessionId,
    setToolsSearchTerm,
    setToolsResults,
    setIsSearchingTools,
    setToolsDropdownOpen,
    setLayerStoneSearchTerm,
    setLayerStoneSearchResults,
    setIsSearchingLayerStones,
    setLayerStoneDropdownOpen,
    updateWizardData,
    setIsEditMode,
    setEditingProductIndex,
    setErrors,
    setShowProductModal,
    getCuttingTypePricePerMeter,
    selectProductForStairPart,
    generateFullProductName
  } = props;

  if (!isOpen) return null;

  // Helper function to get active draft
  const getActiveDraft = (): [StairPartDraftV2, React.Dispatch<React.SetStateAction<StairPartDraftV2>>] => {
    if (stairActivePart === 'tread') return [draftTread, setDraftTread];
    if (stairActivePart === 'riser') return [draftRiser, setDraftRiser];
    return [draftLanding, setDraftLanding];
  };

  // Helper function to set active part
  const setActivePart = (part: StairStepperPart) => {
    setStairActivePart(part);
  };

  // Helper function to clear draft field error (wrapper to match usage pattern)
  const clearDraftFieldErrorLocal = (part: StairStepperPart, field: keyof StairDraftFieldErrors) => {
    setStairDraftErrors(prev => {
      const currentErrors = prev[part] || {};
      const cleared = clearDraftFieldError(currentErrors, field);
      return { ...prev, [part]: cleared };
    });
  };

  // Compute totals using the service (with getCuttingTypePricePerMeter)
  const computeTotalsV2Local = (part: StairStepperPart, draft: StairPartDraftV2) => {
    return computeTotalsV2(part, draft, getCuttingTypePricePerMeter);
  };

  // Ensure stair session ID exists
  const ensureStairSessionId = () => {
    if (stairSessionId) return stairSessionId;
    const id = `stair_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setStairSessionId(id);
    return id;
  };

  // Extract the modal JSX from page.tsx (lines 8187-10639)
  // This is a placeholder - the full modal JSX will be extracted in the next step
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col z-[10000]">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-1 h-8 bg-gradient-to-b from-purple-500 to-purple-600 rounded-full"></div>
            <h3 className="text-xl font-bold text-purple-900 dark:text-purple-200">
              {isEditMode ? 'ویرایش محصول پله' : 'انتخاب محصول پله'}
            </h3>
            {isEditMode && (
              <span className="px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-semibold">
                حالت ویرایش
              </span>
            )}
          </div>
          <button 
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg p-2 transition-colors" 
            onClick={onClose}
            title="بستن"
          >
            <FaTimes className="w-5 h-5" />
          </button>
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
                  <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${true ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>0. بخش</span>
                  <span className="text-gray-400 dark:text-gray-500">→</span>
                  <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasStone ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>1. نوع سنگ</span>
                  <span className="text-gray-400 dark:text-gray-500">→</span>
                  <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasThickness ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>2. قطر</span>
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
                  <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasTools ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>8. ابزارها</span>
                  <span className="text-gray-400 dark:text-gray-500">→</span>
                  {stairActivePart !== 'riser' && (
                    <>
                      <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                        (currentDraft.numberOfLayersPerStair &&
                          currentDraft.numberOfLayersPerStair > 0 &&
                          currentDraft.layerWidthCm &&
                          currentDraft.pricePerSquareMeter &&
                          (layerTypes.length === 0 || currentDraft.layerTypeId))
                          ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-md'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}>9. لایه‌ها</span>
                      <span className="text-gray-400 dark:text-gray-500">→</span>
                    </>
                  )}
                  <span className={`px-3 py-1.5 rounded-lg font-medium transition-all ${hasTotal ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{stairActivePart !== 'riser' ? '10. جمع کل' : '9. جمع کل'}</span>
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
                <label className="text-sm font-semibold text-purple-900 dark:text-purple-200">بخش:</label>
                <select 
                  className="flex-1 rounded-lg bg-white dark:bg-gray-800 px-4 py-2 border border-purple-300 dark:border-purple-600 text-gray-800 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all" 
                  value={stairActivePart} 
                  onChange={(e) => setActivePart(e.target.value as StairStepperPart)}
                >
                  <option value="tread">کف پله</option>
                  <option value="riser">خیز</option>
                  <option value="landing">پاگرد</option>
                </select>
              </div>
            </div>
                            {(() => {
                  const [draft, setDraft] = getActiveDraft();
                  const totals = computeTotalsV2Local(stairActivePart, draft);
                  const chargeableCuttingCost = totals.billableCuttingCost;
                  const chargeableCuttingCostLongitudinal = totals.billableCuttingCostLongitudinal;
                  const chargeableCuttingCostCross = totals.billableCuttingCostCross;
                  const draftErrors = stairDraftErrors[stairActivePart] || {};
                  const lengthMInfo = getActualLengthMeters(draft);
                  const selectedFinishing = stoneFinishings.find(option => option.id === draft.finishingId);
                  const finishingPricePerSquareMeter =
                    draft.finishingPricePerSquareMeter ??
                    selectedFinishing?.pricePerSquareMeter ??
                    null;
                  const finishingPreviewCost =
                    draft.finishingEnabled && finishingPricePerSquareMeter
                      ? totals.pricingSquareMeters * finishingPricePerSquareMeter
                      : 0;
                  const defaultMandatoryEnabled = stairActivePart === 'riser' || stairActivePart === 'landing';
                  const mandatoryEnabled = draft.useMandatory ?? defaultMandatoryEnabled;
                  const supportsMandatory = stairActivePart === 'tread' || stairActivePart === 'riser' || stairActivePart === 'landing';
                  const mandatoryPercentageValue = draft.mandatoryPercentage ?? 20;
                  return (
                    <div className="space-y-6">
                      {/* Input Fields Section - Enhanced */}
                      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-1 h-5 bg-gradient-to-b from-teal-500 to-teal-600 rounded-full"></div>
                          <h5 className="text-sm font-semibold text-gray-800 dark:text-white">Ø§Ø·Ù„Ø§Ø¹Ø§Øª Ù…Ø­ØµÙˆÙ„</h5>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                Ù†ÙˆØ¹ Ø³Ù†Ú¯
                              </span>
                            </label>
                            <div className="relative">
                              <input 
                                className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all" 
                                placeholder="Ø¬Ø³ØªØ¬Ùˆ Ø¯Ø± Ù†ÙˆØ¹ Ø¨Ø±Ø´ØŒ Ø¬Ù†Ø³ Ø³Ù†Ú¯ØŒ Ù…Ø¹Ø¯Ù†ØŒ Ù†ÙˆØ¹ Ù¾Ø±Ø¯Ø§Ø®ØªØŒ Ø±Ù†Ú¯/Ø®ØµÙˆØµÛŒØ§Øª" 
                                value={stoneSearchTerm} 
                                onChange={(e) => setStoneSearchTerm(e.target.value)} 
                              />
                              {draft.stoneProduct && (
                                <div className="mt-2 p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg">
                                  <div className="text-sm font-medium text-teal-800 dark:text-teal-200">{draft.stoneLabel}</div>
                                  {draft.stoneProduct.basePrice && (
                                    <div className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                                      Ù‚ÛŒÙ…Øª: {formatPrice(draft.stoneProduct.basePrice)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {stoneSearchTerm && (
                              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                                {isSearchingStones && (
                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">
                                    <span className="animate-pulse">Ø¯Ø± Ø­Ø§Ù„ Ø¬Ø³ØªØ¬Ùˆ...</span>
                                  </div>
                                )}
                                {!isSearchingStones && stoneSearchResults.length === 0 && (
                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">Ù†ØªÛŒØ¬Ù‡â€ŒØ§ÛŒ ÛŒØ§ÙØª Ù†Ø´Ø¯</div>
                                )}
                                {stoneSearchResults.map((p: Product) => (
                                  <button 
                                    key={p.id} 
                                    type="button" 
                                    className="w-full text-right px-4 py-2.5 hover:bg-teal-50 dark:hover:bg-teal-900/20 text-sm border-b border-gray-100 dark:border-gray-700 last:border-0 transition-colors" 
                                    onClick={() => {
                                      selectProductForStairPart(stairActivePart, p);
                                    }}
                                  >
                                    {/* ðŸŽ¯ Show complete product name using generateFullProductName */}
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
                                Ù‚Ø·Ø± (Ø³Ø§Ù†ØªÛŒâ€ŒÙ…ØªØ±)
                              </span>
                            </label>
                            <FormattedNumberInput
                              value={draft.stoneProduct?.thicknessValue ?? draft.thicknessCm ?? null}
                              onChange={(_value) => {}}
                              min={1}
                              step={1}
                              disabled
                              className="w-full rounded-lg bg-gray-100 dark:bg-gray-700/60 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-600 dark:text-gray-300 cursor-not-allowed"
                              placeholder="Ø§Ø¨ØªØ¯Ø§ Ù…Ø­ØµÙˆÙ„ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯"
                            />
                            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                              Ù‚Ø·Ø± Ø¨Ù‡ ØµÙˆØ±Øª Ø®ÙˆØ¯Ú©Ø§Ø± Ø§Ø² Ù…Ø´Ø®ØµØ§Øª Ù…Ø­ØµÙˆÙ„ Ø§Ù†ØªØ®Ø§Ø¨ Ø´Ø¯Ù‡ ØªÙ†Ø¸ÛŒÙ… Ù…ÛŒâ€ŒØ´ÙˆØ¯ Ùˆ Ù‚Ø§Ø¨Ù„ ØªØºÛŒÛŒØ± Ù†ÛŒØ³Øª.
                            </p>
                          {draftErrors.thickness && (
                            <p className="mt-1 text-xs text-red-500">{draftErrors.thickness}</p>
                          )}
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                Ø·ÙˆÙ„
                              </span>
                            </label>
                            <div className="flex gap-2">
                              <FormattedNumberInput
                                value={draft.lengthValue ?? null}
                            onChange={(value) => {
                              const normalizedValue = value && value > 0 ? value : null;
                              const updatedDraft: StairPartDraftV2 = { ...draft, lengthValue: normalizedValue };
                              const error = validateDraftNumericFields(stairActivePart, updatedDraft, 'length', value);
                              if (error) {
                                setStairDraftErrors(prev => ({
                                  ...prev,
                                  [stairActivePart]: { ...prev[stairActivePart], length: error }
                                }));
                              } else {
                                clearDraftFieldErrorLocal(stairActivePart, 'length');
                              }
                              setDraft(updatedDraft);
                            }}
                                min={0}
                                step={0.01}
                                className="flex-1 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                                placeholder="Ù…Ø«Ø§Ù„: 1.2"
                              />
                              <select 
                                className="rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all font-medium" 
                                value={draft.lengthUnit || 'm'} 
                                onChange={(e) => setDraft({ ...draft, lengthUnit: (e.target.value as UnitType) })}
                              >
                                <option value="cm">cm</option>
                                <option value="m">m</option>
                              </select>
                            </div>
                            {stairActivePart !== 'riser' && (
                            <div className="mt-3">
                              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                                Ø·ÙˆÙ„ Ø§Ø³ØªØ§Ù†Ø¯Ø§Ø±Ø¯ (Ø¨Ø±Ø§ÛŒ Ù‚ÛŒÙ…Øªâ€ŒÚ¯Ø°Ø§Ø±ÛŒ)
                              </label>
                              <div className="flex gap-2">
                                <FormattedNumberInput
                                  value={draft.standardLengthValue ?? null}
                                  onChange={(value) => {
                                    const normalized = value && value > 0 ? value : null;
                                    const updatedDraft: StairPartDraftV2 = { ...draft, standardLengthValue: normalized };
                                    if (normalized && normalized > 0) {
                                      clearDraftFieldErrorLocal(stairActivePart, 'length');
                                    }
                                    setDraft(updatedDraft);
                                  }}
                                  min={0}
                                  step={0.01}
                                  className="flex-1 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                                  placeholder="Ù…Ø«Ø§Ù„: 1.2"
                                />
                                <select 
                                  className="rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all font-medium" 
                                  value={draft.standardLengthUnit || draft.lengthUnit || 'm'} 
                                  onChange={(e) => setDraft({ ...draft, standardLengthUnit: (e.target.value as UnitType) })}
                                >
                                  <option value="m">m</option>
                                  <option value="cm">cm</option>
                                </select>
                              </div>
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                Ø§Ú¯Ø± Ø·ÙˆÙ„ ÙˆØ§Ù‚Ø¹ÛŒ ÙˆØ§Ø±Ø¯ Ù†Ø´ÙˆØ¯ØŒ Ø§Ø² Ù‡Ù…ÛŒÙ† Ø·ÙˆÙ„ Ø§Ø³ØªØ§Ù†Ø¯Ø§Ø±Ø¯ Ø¨Ø±Ø§ÛŒ Ù…Ø­Ø§Ø³Ø¨Ù‡ Ù‚ÛŒÙ…Øª Ø§Ø³ØªÙØ§Ø¯Ù‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯.
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
                                Ø¹Ø±Ø¶ (Ø³Ø§Ù†ØªÛŒâ€ŒÙ…ØªØ±)
                              </span>
                            </label>
                            <FormattedNumberInput
                              value={draft.widthCm ?? null}
                            onChange={(value) => {
                              const updatedDraft = { ...draft, widthCm: value && value > 0 ? value : null };
                              // ðŸŽ¯ Validate using comprehensive validation function
                              const error = validateDraftNumericFields(stairActivePart, updatedDraft, 'width', value);
                              if (error) {
                                setStairDraftErrors(prev => ({
                                  ...prev,
                                  [stairActivePart]: { ...prev[stairActivePart], width: error }
                                }));
                              } else {
                                clearDraftFieldErrorLocal(stairActivePart, 'width');
                              }
                              setDraft(updatedDraft);
                            }}
                              min={0}
                              step={0.1}
                              className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                              placeholder="Ù…Ø«Ø§Ù„: 40"
                            />
                          {draftErrors.width && (
                            <p className="mt-1 text-xs text-red-500">{draftErrors.width}</p>
                          )}
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                ØªØ¹Ø¯Ø§Ø¯
                              </span>
                            </label>
                            <FormattedNumberInput
                              value={draft.quantity ?? null}
                            onChange={(value) => {
                              // ðŸŽ¯ Ensure integer value for quantity
                              const intValue = value ? Math.floor(value) : null;
                              const updatedDraft = { ...draft, quantity: intValue && intValue > 0 ? intValue : null };
                              // ðŸŽ¯ Validate using comprehensive validation function
                              const error = validateDraftNumericFields(stairActivePart, updatedDraft, 'quantity', intValue);
                              if (error) {
                                setStairDraftErrors(prev => ({
                                  ...prev,
                                  [stairActivePart]: { ...prev[stairActivePart], quantity: error }
                                }));
                              } else {
                                clearDraftFieldErrorLocal(stairActivePart, 'quantity');
                              }
                              setDraft(updatedDraft);
                            }}
                              min={1}
                              step={1}
                              className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                              placeholder="Ù…Ø«Ø§Ù„: 100"
                            />
                          {draftErrors.quantity && (
                            <p className="mt-1 text-xs text-red-500">{draftErrors.quantity}</p>
                          )}
                          </div>
                          {draft.stoneProduct && totals.piecesPerStone > 0 && totals.baseStoneQuantity > 0 && (
                            <div className="md:col-span-2">
                              <div className="mt-2 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-4 py-3 text-xs leading-5 text-teal-700 dark:text-teal-200">
                                <div>
                                  Ø§Ø² Ù‡Ø± Ø³Ù†Ú¯ {formatDisplayNumber(totals.piecesPerStone)} Ù‚Ø·Ø¹Ù‡ Ø¨Ø§ Ø¹Ø±Ø¶ {formatDisplayNumber(draft.widthCm ?? 0)} Ø³Ø§Ù†ØªÛŒâ€ŒÙ…ØªØ± Ø¨Ù‡ Ø¯Ø³Øª Ù…ÛŒâ€ŒØ¢ÛŒØ¯.
                                </div>
                                <div>
                                  ØªØ¹Ø¯Ø§Ø¯ Ø³Ù†Ú¯ Ù¾Ø§ÛŒÙ‡ Ù…ÙˆØ±Ø¯ Ù†ÛŒØ§Ø²: {formatDisplayNumber(totals.baseStoneQuantity)} Ø¹Ø¯Ø¯
                                  {totals.leftoverWidthCm > 0 ? ` â€¢ Ø¨Ø§Ù‚ÛŒÙ…Ø§Ù†Ø¯Ù‡ Ù‡Ø± Ø³Ù†Ú¯: ${formatDisplayNumber(totals.leftoverWidthCm)}cm` : ''}
                                </div>
                              </div>
                            </div>
                          )}
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                Ù…ØªØ± Ù…Ø±Ø¨Ø¹ (Ø®ÙˆØ¯Ú©Ø§Ø±)
                              </span>
                            </label>
                            <input 
                              className="w-full rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-2.5 text-blue-700 dark:text-blue-300 font-semibold cursor-not-allowed" 
                              value={formatDisplayNumber(totals.sqm)} 
                              readOnly 
                            />
                          </div>
                          
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                                Ù‚ÛŒÙ…Øª Ù‡Ø± Ù…ØªØ± Ù…Ø±Ø¨Ø¹
                              </span>
                            </label>
                            <FormattedNumberInput
                              value={draft.pricePerSquareMeter ?? null}
                            onChange={(value) => {
                              const updatedDraft = { ...draft, pricePerSquareMeter: value && value > 0 ? value : null };
                              // ðŸŽ¯ Validate using comprehensive validation function
                              const error = validateDraftNumericFields(stairActivePart, updatedDraft, 'pricePerSquareMeter', value);
                              if (error) {
                                setStairDraftErrors(prev => ({
                                  ...prev,
                                  [stairActivePart]: { ...prev[stairActivePart], pricePerSquareMeter: error }
                                }));
                              } else {
                                clearDraftFieldErrorLocal(stairActivePart, 'pricePerSquareMeter');
                              }
                              setDraft(updatedDraft);
                            }}
                              min={0}
                              step={1000}
                              className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                              placeholder="Ù…Ø«Ø§Ù„: 1,500,000"
                            />
                          {draftErrors.pricePerSquareMeter && (
                            <p className="mt-1 text-xs text-red-500">{draftErrors.pricePerSquareMeter}</p>
                          )}
                          </div>
                          {supportsMandatory && (
                            <div className="md:col-span-2 rounded-lg border border-yellow-100 dark:border-yellow-800 bg-white dark:bg-gray-900/30 p-4">
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-300 text-yellow-600 focus:ring-yellow-500"
                                  checked={mandatoryEnabled}
                                  onChange={(e) => {
                                    const nextValue = e.target.checked;
                                    const updatedDraft = {
                                      ...draft,
                                      useMandatory: nextValue,
                                      mandatoryPercentage: nextValue ? (draft.mandatoryPercentage ?? 20) : null
                                    };
                                    if (!nextValue) {
                                      clearDraftFieldErrorLocal(stairActivePart, 'mandatoryPercentage');
                                    }
                                    setDraft(updatedDraft);
                                  }}
                                />
                                <div>
                                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Ø­Ú©Ù…ÛŒ (Ø§ÙØ²Ø§ÛŒØ´ Ù‚ÛŒÙ…Øª)
                                  </label>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                    Ø¯Ø± ØµÙˆØ±Øª ÙØ¹Ø§Ù„ Ø¨ÙˆØ¯Ù†ØŒ Ù‚ÛŒÙ…Øª Ø³Ù†Ú¯ Ø§ÛŒÙ† Ø¨Ø®Ø´ Ø¨Ù‡ ØµÙˆØ±Øª Ø¯Ø±ØµØ¯ÛŒ Ø§ÙØ²Ø§ÛŒØ´ Ø¯Ø§Ø¯Ù‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯.
                                  </p>
                                </div>
                              </div>
                              {mandatoryEnabled && (
                                <div className="mt-3 flex items-center gap-2">
                                  <FormattedNumberInput
                                    value={mandatoryPercentageValue}
                                    onChange={(value) => {
                                      const updatedDraft = { ...draft, mandatoryPercentage: value ?? 0 };
                                      const error = validateDraftNumericFields(stairActivePart, updatedDraft, 'mandatoryPercentage', value);
                                      if (error) {
                                        setStairDraftErrors(prev => ({
                                          ...prev,
                                          [stairActivePart]: { ...prev[stairActivePart], mandatoryPercentage: error }
                                        }));
                                      } else {
                                        clearDraftFieldErrorLocal(stairActivePart, 'mandatoryPercentage');
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
                                    Ù‚ÛŒÙ…Øª Ù¾Ø§ÛŒÙ‡ Ø¨Ø§ {formatDisplayNumber(mandatoryPercentageValue)}% Ø§ÙØ²Ø§ÛŒØ´ Ù…Ø­Ø§Ø³Ø¨Ù‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯.
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
                                    Ù‡Ø²ÛŒÙ†Ù‡ Ø¨Ø±Ø´ Ø·ÙˆÙ„ÛŒ: {formatPrice(totals.billableCuttingCostLongitudinal)} ({formatDisplayNumber(lengthMInfo)} m Ã— {formatDisplayNumber(totals.baseStoneQuantity)} Ø³Ù†Ú¯ Ã— {formatPrice(totals.shouldChargeCuttingCost ? (totals.cuttingCostPerMeterLongitudinal || totals.cuttingCostPerMeter) : 0)})
                                  </div>
                                )}
                                {totals.billableCuttingCostCross > 0 && (
                                  <div className="mt-1">
                                    Ù‡Ø²ÛŒÙ†Ù‡ Ø¨Ø±Ø´ Ø¹Ø±Ø¶ÛŒ: {formatPrice(totals.billableCuttingCostCross)} ({formatDisplayNumber((draft.widthCm || 0) / 100)} m Ã— {formatDisplayNumber(totals.baseStoneQuantity)} Ø³Ù†Ú¯ Ã— {formatPrice(totals.shouldChargeCuttingCost ? (totals.cuttingCostPerMeterCross || totals.cuttingCostPerMeter) : 0)})
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Tools Section - Enhanced */}
                      {stairActivePart !== 'riser' && (
                      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-purple-500 to-purple-600 rounded-full"></div>
                            <h5 className="text-sm font-semibold text-gray-800 dark:text-white">Ø§Ø¨Ø²Ø§Ø±Ù‡Ø§ (Ø¨Ø± Ù…ØªØ±)</h5>
                          </div>
                          {stairActivePart === 'landing' && (
                            <span className="text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-2 py-1 rounded">Ù…Ø¯Ù„ Ù„Ø¨Ù‡ Ù¾Ø§Ú¯Ø±Ø¯: Ù…Ø­ÛŒØ·/Ø¬Ù‡Øªâ€ŒÙ‡Ø§</span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Ø§ÙØ²ÙˆØ¯Ù† Ø§Ø¨Ø²Ø§Ø±</label>
                            <input 
                              className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all" 
                              placeholder="Ø¬Ø³ØªØ¬Ùˆ Ø¯Ø± Ø§Ø¨Ø²Ø§Ø±Ù‡Ø§" 
                              value={toolsSearchTerm} 
                              onChange={(e) => setToolsSearchTerm(e.target.value)} 
                              onFocus={() => setToolsDropdownOpen(true)} 
                              onBlur={() => setTimeout(() => setToolsDropdownOpen(false), 150)} 
                            />
                            {(toolsDropdownOpen || toolsSearchTerm) && (
                              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                                {isSearchingTools && (
                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">
                                    <span className="animate-pulse">Ø¯Ø± Ø­Ø§Ù„ Ø¬Ø³ØªØ¬Ùˆ...</span>
                                  </div>
                                )}
                                {!isSearchingTools && toolsResults.length === 0 && (
                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">Ù†ØªÛŒØ¬Ù‡â€ŒØ§ÛŒ ÛŒØ§ÙØª Ù†Ø´Ø¯</div>
                                )}
                                {toolsResults.map((t: any) => (
                                  <button 
                                    key={t.id} 
                                    type="button" 
                                    className="w-full text-right px-4 py-2.5 hover:bg-purple-50 dark:hover:bg-purple-900/20 text-sm border-b border-gray-100 dark:border-gray-700 last:border-0 transition-colors" 
                                    onClick={() => {
                                      const exists = (draft.tools || []).some(x => x.toolId === t.id);
                                      if (exists) return;
                                      setDraft({ ...draft, tools: [ ...(draft.tools || []), { toolId: t.id, name: t.namePersian || t.name, pricePerMeter: t.pricePerMeter || t.price || t.costPerMeter || 0, front: false, left: false, right: false, back: false, perimeter: false } ] });
                                      setToolsSearchTerm('');
                                      setToolsDropdownOpen(false);
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
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Ø§Ø¨Ø²Ø§Ø±Ù‡Ø§ÛŒ Ø§Ù†ØªØ®Ø§Ø¨ Ø´Ø¯Ù‡ Ùˆ Ù„Ø¨Ù‡â€ŒÙ‡Ø§</label>
                            {(draft.tools || []).length === 0 ? (
                              <div className="text-center py-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                                <p className="text-xs text-gray-400 dark:text-gray-500">Ø§Ø¨Ø²Ø§Ø±ÛŒ Ø§Ù†ØªØ®Ø§Ø¨ Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª.</p>
                              </div>
                            ) : (
                              <div className="space-y-2 max-h-64 overflow-y-auto">
                                {(draft.tools || []).map((tool, idx) => {
                                  const meters = computeToolMetersForTool(stairActivePart, draft, tool);
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
                                            title="Ø­Ø°Ù Ø§Ø¨Ø²Ø§Ø±"
                                          >
                                            <FaTrash className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-2 text-xs">
                                        {stairActivePart === 'landing' && (
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
                                            <span className="text-gray-700 dark:text-gray-300">Ù…Ø­ÛŒØ· Ú©Ø§Ù…Ù„</span>
                                          </label>
                                        )}
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
                                          <span className="text-gray-700 dark:text-gray-300">Ø¬Ù„Ùˆ</span>
                                        </label>
                                        {stairActivePart === 'landing' && (
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
                                            <span className="text-gray-700 dark:text-gray-300">Ø¹Ù‚Ø¨</span>
                                          </label>
                                        )}
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
                                          <span className="text-gray-700 dark:text-gray-300">Ú†Ù¾</span>
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
                                          <span className="text-gray-700 dark:text-gray-300">Ø±Ø§Ø³Øª</span>
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
                      )}

                      {/* Layers Section (Ù„Ø§ÛŒÙ‡â€ŒÙ‡Ø§) - Enhanced */}
                      {/* ðŸŽ¯ Hide layers section for riser */}
                      {stairActivePart !== 'riser' && (
                      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-1 h-5 bg-gradient-to-b from-orange-500 to-orange-600 rounded-full"></div>
                            <h5 className="text-sm font-semibold text-gray-800 dark:text-white">Ù„Ø§ÛŒÙ‡â€ŒÙ‡Ø§</h5>
                          </div>
                          <span className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-2 py-1 rounded">Ù„Ø§ÛŒÙ‡â€ŒÙ‡Ø§ÛŒ Ø§Ø¶Ø§ÙÛŒ Ø¨Ø±Ø§ÛŒ Ù‡Ø± Ù¾Ù„Ù‡</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                              <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                ØªØ¹Ø¯Ø§Ø¯ Ù„Ø§ÛŒÙ‡ Ø¨Ø±Ø§ÛŒ Ù‡Ø± Ù¾Ù„Ù‡
                              </span>
                            </label>
                            <FormattedNumberInput
                              value={draft.numberOfLayersPerStair ?? null}
                              onChange={(value) => {
                                // ðŸŽ¯ Ensure integer value and validate
                                const intValue = value ? Math.floor(value) : null;
                                const requiresLayerType = layerTypes.length > 0;
                                if (intValue && intValue > 0 && intValue <= 10) { // Reasonable max: 10 layers per stair
                                  let updatedDraft: StairPartDraftV2 = { ...draft, numberOfLayersPerStair: intValue };
                                  if (!hasLayerEdgeSelection(updatedDraft.layerEdges)) {
                                    updatedDraft = deriveLayerEdgesFromTools(updatedDraft, stairActivePart);
                                  }
                                  setDraft(updatedDraft);
                                  if (requiresLayerType && !draft.layerTypeId) {
                                    setStairDraftErrors(prev => ({
                                      ...prev,
                                      [stairActivePart]: { 
                                        ...prev[stairActivePart], 
                                        layerType: 'Ù„Ø·ÙØ§Ù‹ Ù†ÙˆØ¹ Ù„Ø§ÛŒÙ‡ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯'
                                      }
                                    }));
                                  } else {
                                    clearDraftFieldErrorLocal(stairActivePart, 'layerType');
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
                                  clearDraftFieldErrorLocal(stairActivePart, 'layerType');
                                  clearDraftFieldErrorLocal(stairActivePart, 'layerStone');
                                  clearDraftFieldErrorLocal(stairActivePart, 'layerStonePrice');
                                  clearDraftFieldErrorLocal(stairActivePart, 'layerMandatoryPercentage');
                                } else if (intValue > 10) {
                                  // Show error for too many layers
                                  setStairDraftErrors(prev => ({
                                    ...prev,
                                    [stairActivePart]: { 
                                      ...prev[stairActivePart], 
                                      quantity: 'ØªØ¹Ø¯Ø§Ø¯ Ù„Ø§ÛŒÙ‡ Ø¨Ø±Ø§ÛŒ Ù‡Ø± Ù¾Ù„Ù‡ Ù†Ù…ÛŒâ€ŒØªÙˆØ§Ù†Ø¯ Ø¨ÛŒØ´ØªØ± Ø§Ø² 10 Ø¨Ø§Ø´Ø¯'
                                    }
                                  }));
                                }
                              }}
                              min={1}
                              step={1}
                              max={10}
                              className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                              placeholder="Ù…Ø«Ø§Ù„: 2 (Ø¨Ø±Ø§ÛŒ Ø¯ÙˆØ¨Ù„)"
                            />
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              ØªØ¹Ø¯Ø§Ø¯ Ù„Ø§ÛŒÙ‡â€ŒÙ‡Ø§ÛŒÛŒ Ú©Ù‡ Ø¨Ø±Ø§ÛŒ Ù‡Ø± Ù¾Ù„Ù‡ Ù†ÛŒØ§Ø² Ø§Ø³Øª (Ù…Ø«Ø§Ù„: 2 Ø¨Ø±Ø§ÛŒ Ø¯ÙˆØ¨Ù„)
                            </p>
                          </div>
                          
                          {draft.numberOfLayersPerStair && draft.numberOfLayersPerStair > 0 && (
                            <>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                    Ø¹Ø±Ø¶ Ù„Ø§ÛŒÙ‡ (Ø³Ø§Ù†ØªÛŒâ€ŒÙ…ØªØ±)
                                  </span>
                                </label>
                                <FormattedNumberInput
                                  value={draft.layerWidthCm ?? null}
                                  onChange={(value) => {
                                    const updatedDraft = { ...draft, layerWidthCm: value && value > 0 ? value : null };
                                    // ðŸŽ¯ Validate layer width against available remaining width
                                    if (value && value > 0) {
                                      const originalWidthCm = draft.stoneProduct?.widthValue || 0;
                                      const mainWidthCm = draft.widthCm || 0;
                                      const availableWidthCm = originalWidthCm - mainWidthCm;
                                      
                                      if (originalWidthCm > 0 && value > availableWidthCm && availableWidthCm > 0) {
                                        setStairDraftErrors(prev => ({
                                          ...prev,
                                          [stairActivePart]: { 
                                            ...prev[stairActivePart], 
                                            width: `Ø¹Ø±Ø¶ Ù„Ø§ÛŒÙ‡ (${formatDisplayNumber(value)}cm) Ù†Ù…ÛŒâ€ŒØªÙˆØ§Ù†Ø¯ Ø¨ÛŒØ´ØªØ± Ø§Ø² Ø¹Ø±Ø¶ Ø¨Ø§Ù‚ÛŒâ€ŒÙ…Ø§Ù†Ø¯Ù‡ (${formatDisplayNumber(availableWidthCm)}cm) Ø¨Ø§Ø´Ø¯`
                                          }
                                        }));
                                      } else if (value < 0.5) {
                                        setStairDraftErrors(prev => ({
                                          ...prev,
                                          [stairActivePart]: { 
                                            ...prev[stairActivePart], 
                                            width: 'Ø¹Ø±Ø¶ Ù„Ø§ÛŒÙ‡ Ø¨Ø§ÛŒØ¯ Ø­Ø¯Ø§Ù‚Ù„ 0.5 Ø³Ø§Ù†ØªÛŒâ€ŒÙ…ØªØ± Ø¨Ø§Ø´Ø¯'
                                          }
                                        }));
                                      } else {
                                        clearDraftFieldErrorLocal(stairActivePart, 'width');
                                      }
                                    }
                                    setDraft(updatedDraft);
                                  }}
                                  min={0.5}
                                  step={0.1}
                                  className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                                  placeholder="Ù…Ø«Ø§Ù„: 15"
                                />
                              </div>
                              
                              
                              {layerTypes.length > 0 && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    <span className="flex items-center gap-1">
                                      <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                      Ù†ÙˆØ¹ Ù„Ø§ÛŒÙ‡
                                    </span>
                                  </label>
                                  <select
                                    className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all font-medium"
                                    value={draft.layerTypeId || ''}
                                    disabled={isLoadingLayerTypes}
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
                                          setStairDraftErrors(prev => ({
                                            ...prev,
                                            [stairActivePart]: { 
                                              ...prev[stairActivePart], 
                                              layerType: 'Ù„Ø·ÙØ§Ù‹ Ù†ÙˆØ¹ Ù„Ø§ÛŒÙ‡ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯'
                                            }
                                          }));
                                        }
                                        return;
                                      }
                                      const selected = layerTypes.find(option => option.id === selectedId);
                                      if (selected) {
                                        clearDraftFieldErrorLocal(stairActivePart, 'layerType');
                                        setDraft({
                                          ...draft,
                                          layerTypeId: selected.id,
                                          layerTypeName: selected.name,
                                          layerTypePrice: selected.pricePerLayer
                                        });
                                      }
                                    }}
                                  >
                                    <option value="">Ø§Ù†ØªØ®Ø§Ø¨ Ù†ÙˆØ¹ Ù„Ø§ÛŒÙ‡...</option>
                                    {layerTypes.map((option: LayerTypeOption) => (
                                      <option key={option.id} value={option.id}>
                                        {option.name} - {option.pricePerLayer.toLocaleString('fa-IR')} ØªÙˆÙ…Ø§Ù†
                                      </option>
                                    ))}
                                  </select>
                                  {layerTypesError && (
                                    <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                                      {layerTypesError}
                                    </p>
                                  )}
                                  {stairDraftErrors[stairActivePart]?.layerType && (
                                    <p className="mt-1 text-xs text-red-500">
                                      {stairDraftErrors[stairActivePart]?.layerType}
                                    </p>
                                  )}
                                </div>
                              )}

                              <div className="md:col-span-2">
                                <div className="border border-dashed border-orange-200 dark:border-orange-800 rounded-lg p-4 bg-orange-50/30 dark:bg-orange-900/10">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <h6 className="text-xs font-semibold text-orange-700 dark:text-orange-300">
                                        Ø§Ø³ØªÙØ§Ø¯Ù‡ Ø§Ø² Ø³Ù†Ú¯ Ù…ØªÙØ§ÙˆØª Ø¨Ø±Ø§ÛŒ Ù„Ø§ÛŒÙ‡â€ŒÙ‡Ø§
                                      </h6>
                                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                                        Ù…ÛŒâ€ŒØªÙˆØ§Ù†ÛŒØ¯ Ø³Ù†Ú¯ Ø¯ÛŒÚ¯Ø±ÛŒ Ø±Ø§ Ø¨Ø±Ø§ÛŒ Ù„Ø§ÛŒÙ‡â€ŒÙ‡Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ø±Ø¯Ù‡ Ùˆ Ù‚ÛŒÙ…Øª Ù…Ø³ØªÙ‚Ù„ Ø¢Ù† Ø±Ø§ Ø«Ø¨Øª Ú©Ù†ÛŒØ¯.
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
                                          clearDraftFieldErrorLocal(stairActivePart, 'layerStone');
                                          clearDraftFieldErrorLocal(stairActivePart, 'layerStonePrice');
                                          clearDraftFieldErrorLocal(stairActivePart, 'layerMandatoryPercentage');
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
                                      {draft.layerUseDifferentStone ? 'Ù„ØºÙˆ Ø§Ø³ØªÙØ§Ø¯Ù‡' : 'ÙØ¹Ø§Ù„â€ŒØ³Ø§Ø²ÛŒ'}
                                    </button>
                                  </div>

                                  {draft.layerUseDifferentStone && (
                                    <div className="mt-4 space-y-4">
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                          Ø§Ù†ØªØ®Ø§Ø¨ Ø³Ù†Ú¯ Ø¨Ø±Ø§ÛŒ Ù„Ø§ÛŒÙ‡â€ŒÙ‡Ø§
                                        </label>
                                        {!draft.layerStoneProduct ? (
                                          <>
                                            <input
                                              className="w-full rounded-lg bg-white dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                                              placeholder="Ù†Ø§Ù… Ø³Ù†Ú¯ Ù…ÙˆØ±Ø¯ Ù†Ø¸Ø± Ø±Ø§ Ø¬Ø³ØªØ¬Ùˆ Ú©Ù†ÛŒØ¯"
                                              value={layerStoneSearchTerm}
                                              onChange={(e) => setLayerStoneSearchTerm(e.target.value)}
                                              onFocus={() => setLayerStoneDropdownOpen(true)}
                                              onBlur={() => setTimeout(() => setLayerStoneDropdownOpen(false), 150)}
                                            />
                                            {layerStoneDropdownOpen && (
                                              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
                                                {isSearchingLayerStones && (
                                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">
                                                    <span className="animate-pulse">Ø¯Ø± Ø­Ø§Ù„ Ø¬Ø³ØªØ¬Ùˆ...</span>
                                                  </div>
                                                )}
                                                {!isSearchingLayerStones && layerStoneSearchResults.length === 0 && (
                                                  <div className="p-3 text-center text-sm text-gray-500 dark:text-gray-400">Ù†ØªÛŒØ¬Ù‡â€ŒØ§ÛŒ ÛŒØ§ÙØª Ù†Ø´Ø¯</div>
                                                )}
                                                {layerStoneSearchResults.map((p) => (
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
                                                      setLayerStoneSearchTerm('');
                                                      setLayerStoneDropdownOpen(false);
                                                      clearDraftFieldErrorLocal(stairActivePart, 'layerStone');
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
                                                Ú©Ø¯: {draft.layerStoneProduct.code || '-'}
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
                                                  setLayerStoneSearchTerm('');
                                                  clearDraftFieldErrorLocal(stairActivePart, 'layerStone');
                                                }}
                                              >
                                                ØªØºÛŒÛŒØ±
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
                                                  setLayerStoneSearchTerm('');
                                                  clearDraftFieldErrorLocal(stairActivePart, 'layerStone');
                                                  clearDraftFieldErrorLocal(stairActivePart, 'layerStonePrice');
                                                }}
                                              >
                                                Ø­Ø°Ù
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                        {stairDraftErrors[stairActivePart]?.layerStone && (
                                          <p className="mt-1 text-xs text-red-500">
                                            {stairDraftErrors[stairActivePart]?.layerStone}
                                          </p>
                                        )}
                                      </div>

                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                          Ù‚ÛŒÙ…Øª Ù‡Ø± Ù…ØªØ± Ù…Ø±Ø¨Ø¹ Ø³Ù†Ú¯ Ù„Ø§ÛŒÙ‡ (ØªÙˆÙ…Ø§Ù†)
                                        </label>
                                        <FormattedNumberInput
                                          value={draft.layerPricePerSquareMeter ?? null}
                                          onChange={(value) => {
                                            const updatedDraft = { ...draft, layerPricePerSquareMeter: value && value > 0 ? value : null };
                                            const error = validateDraftNumericFields(stairActivePart, updatedDraft, 'layerStonePrice', value);
                                            if (error) {
                                              setStairDraftErrors(prev => ({
                                                ...prev,
                                                [stairActivePart]: { ...prev[stairActivePart], layerStonePrice: error }
                                              }));
                                            } else {
                                              clearDraftFieldErrorLocal(stairActivePart, 'layerStonePrice');
                                            }
                                            setDraft(updatedDraft);
                                          }}
                                          min={0}
                                          step={1000}
                                          className="w-full rounded-lg bg-white dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                                          placeholder="Ù…Ø«Ø§Ù„: 1,800,000"
                                        />
                                        {stairDraftErrors[stairActivePart]?.layerStonePrice && (
                                          <p className="mt-1 text-xs text-red-500">
                                            {stairDraftErrors[stairActivePart]?.layerStonePrice}
                                          </p>
                                        )}
                                      </div>

                                      <div className="rounded-lg border border-orange-100 dark:border-orange-800 bg-white dark:bg-gray-900/30 p-3">
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                            checked={draft.layerUseMandatory ?? true}
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
                                                clearDraftFieldErrorLocal(stairActivePart, 'layerMandatoryPercentage');
                                              }
                                              setDraft(updatedDraft);
                                            }}
                                          />
                                          <div>
                                            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                              Ø­Ú©Ù…ÛŒ (Ø§ÙØ²Ø§ÛŒØ´ Ù‚ÛŒÙ…Øª)
                                            </label>
                                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                              Ø¯Ø± ØµÙˆØ±Øª ÙØ¹Ø§Ù„ Ø¨ÙˆØ¯Ù†ØŒ Ù‚ÛŒÙ…Øª Ø³Ù†Ú¯ Ù„Ø§ÛŒÙ‡ Ø¨Ù‡ ØµÙˆØ±Øª Ø¯Ø±ØµØ¯ÛŒ Ø§ÙØ²Ø§ÛŒØ´ Ø¯Ø§Ø¯Ù‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯.
                                            </p>
                                          </div>
                                        </div>
                                        {draft.layerUseMandatory !== false && (
                                          <div className="mt-3 flex items-center gap-2">
                                            <FormattedNumberInput
                                              value={draft.layerMandatoryPercentage ?? 20}
                                              onChange={(value) => {
                                                const updatedDraft = { ...draft, layerMandatoryPercentage: value ?? 0 };
                                                const error = validateDraftNumericFields(stairActivePart, updatedDraft, 'layerMandatoryPercentage', value);
                                                if (error) {
                                                  setStairDraftErrors(prev => ({
                                                    ...prev,
                                                    [stairActivePart]: { ...prev[stairActivePart], layerMandatoryPercentage: error }
                                                  }));
                                                } else {
                                                  clearDraftFieldErrorLocal(stairActivePart, 'layerMandatoryPercentage');
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
                                              Ù‚ÛŒÙ…Øª Ù†Ù‡Ø§ÛŒÛŒ Ø¨Ø§ {formatDisplayNumber(draft.layerMandatoryPercentage ?? 20)}% Ø§ÙØ²Ø§ÛŒØ´ Ù…Ø­Ø§Ø³Ø¨Ù‡ Ù…ÛŒâ€ŒØ´ÙˆØ¯.
                                            </p>
                                          </div>
                                        )}
                                        {stairDraftErrors[stairActivePart]?.layerMandatoryPercentage && (
                                          <p className="mt-1 text-xs text-red-500">
                                            {stairDraftErrors[stairActivePart]?.layerMandatoryPercentage}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* ðŸŽ¯ Layer Edge Selection */}
                              <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                                    Ø§Ù†ØªØ®Ø§Ø¨ Ù„Ø¨Ù‡â€ŒÙ‡Ø§ÛŒ Ù…ÙˆØ±Ø¯ Ù†ÛŒØ§Ø² Ø¨Ø±Ø§ÛŒ Ù„Ø§ÛŒÙ‡
                                  </span>
                                </label>
                                <div className="flex flex-wrap gap-2 p-3 bg-orange-50/50 dark:bg-orange-900/10 rounded-lg border border-orange-200 dark:border-orange-800">
                                  {stairActivePart === 'landing' && (
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
                                      <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">Ù…Ø­ÛŒØ· Ú©Ø§Ù…Ù„</span>
                                    </label>
                                  )}
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
                                    <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">Ø¬Ù„Ùˆ</span>
                                  </label>
                                  {stairActivePart === 'landing' && (
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
                                      <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">Ø¹Ù‚Ø¨</span>
                                    </label>
                                  )}
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
                                    <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">Ú†Ù¾</span>
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
                                    <span className="text-gray-700 dark:text-gray-300 text-xs font-medium">Ø±Ø§Ø³Øª</span>
                                  </label>
                                </div>
                                {(!draft.layerEdges || (!draft.layerEdges.front && !draft.layerEdges.left && !draft.layerEdges.right && !draft.layerEdges.back && !draft.layerEdges.perimeter)) && (
                                  <p className="mt-2 text-xs text-orange-600 dark:text-orange-400">
                                    Ù„Ø·ÙØ§Ù‹ Ø­Ø¯Ø§Ù‚Ù„ ÛŒÚ© Ù„Ø¨Ù‡ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯
                                  </p>
                                )}
                              </div>
                              
                              {draft.numberOfLayersPerStair && draft.layerWidthCm && draft.pricePerSquareMeter && draft.quantity && 
                               (layerTypes.length === 0 || draft.layerTypeId) &&
                               draft.layerEdges && (draft.layerEdges.front || draft.layerEdges.left || draft.layerEdges.right || draft.layerEdges.back || draft.layerEdges.perimeter) && (() => {
                                // ðŸŽ¯ Use computeLayerSqmV2 for consistent calculation (accounts for overlap)
                                const totalLayers = draft.quantity * draft.numberOfLayersPerStair;
                                const totalLayerSqm = computeLayerSqmV2(stairActivePart, draft);
                                
                                const layerWidthCm = draft.layerWidthCm || 0;
                                const stoneWidthCm = draft.layerUseDifferentStone 
                                  ? (draft.layerStoneProduct?.widthValue || draft.stoneProduct?.widthValue || 0)
                                  : (draft.stoneProduct?.widthValue || 0);
                                const stairLengthM = getActualLengthMeters(draft);
                                
                                    const stoneWidthM = stoneWidthCm / 100;
                                const columnsPerStone = stoneWidthCm > 0 && layerWidthCm > 0
                                  ? Math.max(1, Math.floor(stoneWidthCm / layerWidthCm))
                                  : 0;
                                
                                const edgeDemandsPreview = getLayerEdgeDemands(stairActivePart, draft);
                                const needsNewStone = edgeDemandsPreview.filter(edge =>
                                  !(edge.edge === 'front' || edge.edge === 'back' || edge.edge === 'perimeter')
                                );
                                
                                const stoneAreaUsedSqm = (() => {
                                  if (!needsNewStone.length || !columnsPerStone || !stairLengthM || !stoneWidthM) {
                                    return 0;
                                  }
                                  let stonesNeeded = 0;
                                  needsNewStone.forEach(edge => {
                                    if (edge.lengthM <= 0) return;
                                    const stripsPerColumn = Math.max(1, Math.floor(stairLengthM / edge.lengthM));
                                    const stripsPerStone = Math.max(1, stripsPerColumn * columnsPerStone);
                                    stonesNeeded += Math.ceil(edge.layersNeeded / stripsPerStone);
                                  });
                                  if (!stonesNeeded) return 0;
                                  return stonesNeeded * stairLengthM * stoneWidthM;
                                })();
                                
                                // Use the same price as the main stair part
                                const pricePerSqm = draft.pricePerSquareMeter || 0;
                                const layerTypeUnitPrice = draft.layerTypePrice || 0;
                                
                                // ðŸŽ¯ FIX: Calculate layer type cost based on total length per stair Ã— number of stairs Ã— layer type price per meter
                                // Ù…Ø¬Ù…ÙˆØ¹ Ø·ÙˆÙ„Ù‡ Ù‡Ø§ÛŒ Ù„Ø§ÛŒÙ‡ Ø¨Ø±Ø§ÛŒ ÛŒÚ© Ù¾Ù„Ù‡ (Ú†Ù¾ + Ø±Ø§Ø³Øª + Ø¬Ù„Ùˆ) Ã— ØªØ¹Ø¯Ø§Ø¯ Ù¾Ù„Ù‡ Ù‡Ø§ Ã— Ù‡Ø²ÛŒÙ†Ù‡ Ù‡Ø± Ù†ÙˆØ¹ Ù„Ø§ÛŒÙ‡
                                const totalLayerLengthPerStairM = getTotalLayerLengthPerStairM(stairActivePart, draft);
                                const totalLayerLengthM = totalLayerLengthPerStairM * draft.quantity;
                                const layerTypeCostPreview = totalLayerLengthM * layerTypeUnitPrice;
                                
                                // ðŸŽ¯ FIX: Calculate layer stone price based on stone area used, NOT layer square meters
                                // Use stone area used for pricing (includes waste/remaining pieces)
                                const pricingStoneAreaSqm = stoneAreaUsedSqm > 0 ? stoneAreaUsedSqm : totalLayerSqm;
                                const baseLayerCost = pricingStoneAreaSqm * pricePerSqm;
                                const layerTotalPrice = baseLayerCost + layerTypeCostPreview;
                                
                                return (
                                  <div className="md:col-span-2">
                                    <div className="mt-2 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 px-4 py-3 text-xs leading-5 text-orange-700 dark:text-orange-200">
                                      <div className="font-semibold mb-1">Ø®Ù„Ø§ØµÙ‡ Ù„Ø§ÛŒÙ‡â€ŒÙ‡Ø§:</div>
                                      <div>ØªØ¹Ø¯Ø§Ø¯ Ú©Ù„ Ù„Ø§ÛŒÙ‡â€ŒÙ‡Ø§: {formatDisplayNumber(totalLayers)} Ø¹Ø¯Ø¯ ({formatDisplayNumber(draft.quantity)} Ù¾Ù„Ù‡ Ã— {formatDisplayNumber(draft.numberOfLayersPerStair)} Ù„Ø§ÛŒÙ‡)</div>
                                      <div className="mt-1">
                                        <span className="font-medium">Ù„Ø¨Ù‡â€ŒÙ‡Ø§ÛŒ Ø§Ù†ØªØ®Ø§Ø¨ Ø´Ø¯Ù‡: </span>
                                        {stairActivePart === 'landing' && draft.layerEdges?.perimeter && (
                                          <span className="text-orange-600 dark:text-orange-400">Ù…Ø­ÛŒØ· Ú©Ø§Ù…Ù„</span>
                                        )}
                                        {!draft.layerEdges?.perimeter && (
                                          <>
                                            {draft.layerEdges?.front && <span className="text-orange-600 dark:text-orange-400">Ø¬Ù„Ùˆ </span>}
                                            {draft.layerEdges?.back && <span className="text-orange-600 dark:text-orange-400">Ø¹Ù‚Ø¨ </span>}
                                            {draft.layerEdges?.left && <span className="text-orange-600 dark:text-orange-400">Ú†Ù¾ </span>}
                                            {draft.layerEdges?.right && <span className="text-orange-600 dark:text-orange-400">Ø±Ø§Ø³Øª </span>}
                                          </>
                                        )}
                                      </div>
                                      <div>Ù…ØªØ± Ù…Ø±Ø¨Ø¹ Ø§Ø³ØªÙØ§Ø¯Ù‡ Ø´Ø¯Ù‡: {formatSquareMeters(totalLayerSqm)}</div>
                                      {stoneAreaUsedSqm > 0 && (
                                        <div>Ù…ØªØ± Ù…Ø±Ø¨Ø¹ Ø³Ù†Ú¯: {formatSquareMeters(stoneAreaUsedSqm)}</div>
                                      )}
                                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                        Ù‚ÛŒÙ…Øª Ù‡Ø± Ù…ØªØ± Ù…Ø±Ø¨Ø¹: {formatPrice(pricePerSqm)} (Ù‡Ù…Ø§Ù† Ø³Ù†Ú¯ Ø§ØµÙ„ÛŒ)
                                      </div>
                                      <div className="mt-1 pt-1 border-t border-orange-200 dark:border-orange-700">
                                        <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                                            Ù‚ÛŒÙ…Øª Ø³Ù†Ú¯ Ù„Ø§ÛŒÙ‡: {formatPrice((stoneAreaUsedSqm > 0 ? stoneAreaUsedSqm : totalLayerSqm) * pricePerSqm)}
                                            {stoneAreaUsedSqm > 0 && (
                                            <span className="text-xs text-gray-500 dark:text-gray-500 mr-1">
                                                (Ø¨Ø± Ø§Ø³Ø§Ø³ Ù…ØªØ± Ù…Ø±Ø¨Ø¹ Ø³Ù†Ú¯: {formatSquareMeters(stoneAreaUsedSqm)})
                                            </span>
                                          )}
                                        </div>
                                        {layerTypeUnitPrice > 0 && (
                                          <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                                            Ù‡Ø²ÛŒÙ†Ù‡ Ù†ÙˆØ¹ Ù„Ø§ÛŒÙ‡ ({draft.layerTypeName || '-'}): {formatPrice(layerTypeCostPreview)}
                                            <span className="text-xs text-gray-500 dark:text-gray-500 ml-1">
                                              ({formatDisplayNumber(totalLayerLengthPerStairM)} Ù…ØªØ± Ã— {formatDisplayNumber(draft.quantity)} Ù¾Ù„Ù‡ Ã— {formatPrice(layerTypeUnitPrice)}/Ù…ØªØ±)
                                            </span>
                                          </div>
                                        )}
                                        <div className="mt-1 pt-1 border-t border-orange-200 dark:border-orange-700">
                                          <span className="font-semibold">Ù‚ÛŒÙ…Øª Ú©Ù„ Ù„Ø§ÛŒÙ‡â€ŒÙ‡Ø§: {formatPrice(layerTotalPrice)}</span>
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
                              <h5 className="text-sm font-semibold text-gray-800 dark:text-white">Ù¾Ø±Ø¯Ø§Ø®Øª Ø³Ù†Ú¯</h5>
                            </div>
                            <span className="text-xs text-teal-600 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/30 px-2 py-1 rounded">
                              Ù‡Ø²ÛŒÙ†Ù‡ Ø¨Ù‡ Ø§Ø²Ø§ÛŒ Ù…ØªØ± Ù…Ø±Ø¨Ø¹
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
                                      finishingPricePerSquareMeter: null
                                    });
                                    return;
                                  }
                                  const defaultFinishing = draft.finishingId
                                    ? stoneFinishings.find(option => option.id === draft.finishingId)
                                    : stoneFinishings[0];
                                  setDraft({
                                    ...draft,
                                    finishingEnabled: true,
                                    finishingId: defaultFinishing?.id || draft.finishingId || null,
                                    finishingLabel: defaultFinishing
                                      ? (defaultFinishing.namePersian || defaultFinishing.name || '')
                                      : draft.finishingLabel || null,
                                    finishingPricePerSquareMeter: defaultFinishing
                                      ? defaultFinishing.pricePerSquareMeter
                                      : draft.finishingPricePerSquareMeter || null
                                  });
                                }}
                              />
                              ÙØ¹Ø§Ù„â€ŒØ³Ø§Ø²ÛŒ Ù¾Ø±Ø¯Ø§Ø®Øª Ø¨Ø±Ø§ÛŒ Ø§ÛŒÙ† Ø¨Ø®Ø´
                            </label>

                            {draft.finishingEnabled && (
                              <>
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    Ø§Ù†ØªØ®Ø§Ø¨ Ù†ÙˆØ¹ Ù¾Ø±Ø¯Ø§Ø®Øª
                                  </label>
                                  <select
                                    value={draft.finishingId || ''}
                                    onChange={(e) => {
                                      const selectedId = e.target.value;
                                      if (!selectedId) {
                                        setDraft({
                                          ...draft,
                                          finishingId: null,
                                          finishingLabel: null,
                                          finishingPricePerSquareMeter: null
                                        });
                                        return;
                                      }
                                      const selected = stoneFinishings.find(option => option.id === selectedId);
                                      if (selected) {
                                        setDraft({
                                          ...draft,
                                          finishingEnabled: true,
                                          finishingId: selected.id,
                                          finishingLabel: selected.namePersian || selected.name || '',
                                          finishingPricePerSquareMeter: selected.pricePerSquareMeter
                                        });
                                      }
                                    }}
                                    className="w-full rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 px-3 py-2.5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                                  >
                                    <option value="">Ø§Ù†ØªØ®Ø§Ø¨ Ù¾Ø±Ø¯Ø§Ø®Øª...</option>
                                    {stoneFinishings.map(option => (
                                      <option key={option.id} value={option.id}>
                                        {option.namePersian} - {formatPrice(option.pricePerSquareMeter)}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                {selectedFinishing && finishingPricePerSquareMeter && (
                                  <div className="rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-4 py-3 text-xs leading-5 text-teal-700 dark:text-teal-200 space-y-1.5">
                                    <div className="flex justify-between">
                                      <span>Ù‚ÛŒÙ…Øª Ù‡Ø± Ù…ØªØ± Ù…Ø±Ø¨Ø¹:</span>
                                      <span className="font-semibold">{formatPrice(finishingPricePerSquareMeter)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Ù…Ø³Ø§Ø­Øª Ù…Ø­Ø§Ø³Ø¨Ø§ØªÛŒ:</span>
                                      <span className="font-semibold">{formatSquareMeters(totals.pricingSquareMeters)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Ù‡Ø²ÛŒÙ†Ù‡ ØªÙ‚Ø±ÛŒØ¨ÛŒ Ù¾Ø±Ø¯Ø§Ø®Øª:</span>
                                      <span className="font-semibold">{formatPrice(finishingPreviewCost)}</span>
                                    </div>
                                  </div>
                                )}
                            </>
                          )}
                        </div>
                      </div>
                      )}

                      {/* Part Total - Enhanced */}
                      <div className="bg-gradient-to-r from-teal-50 to-teal-100 dark:from-teal-900/30 dark:to-teal-800/30 rounded-lg border-2 border-teal-300 dark:border-teal-700 p-4 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-6 bg-gradient-to-b from-teal-500 to-teal-600 rounded-full"></div>
                          <span className="text-sm font-semibold text-teal-900 dark:text-teal-200">Ø¬Ù…Ø¹ Ú©Ù„ Ø§ÛŒÙ† Ø¨Ø®Ø´</span>
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
                    <h4 className="text-base font-semibold text-gray-800 dark:text-white">Ø®Ù„Ø§ØµÙ‡ Ø§Ù‚Ù„Ø§Ù… Ø§ÙØ²ÙˆØ¯Ù‡ Ø´Ø¯Ù‡</h4>
                    <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-xs font-medium">
                      {stairSessionItems.length} Ø¢ÛŒØªÙ…
                    </span>
                  </div>
                  {stairSessionItems.length === 0 ? (
                    <div className="text-center py-6 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                      <p className="text-sm text-gray-400 dark:text-gray-500">Ù‡Ù†ÙˆØ² Ø¢ÛŒØªÙ…ÛŒ Ø§ÙØ²ÙˆØ¯Ù‡ Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 border-b border-purple-200 dark:border-purple-700">
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">Ø¨Ø®Ø´</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">Ø§Ø¨Ø¹Ø§Ø¯</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">ØªØ¹Ø¯Ø§Ø¯</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">Ù…ØªØ± Ù…Ø±Ø¨Ø¹</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">Ù‚ÛŒÙ…Øª Ù…ØªØ± Ù…Ø±Ø¨Ø¹</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">Ø§Ø¨Ø²Ø§Ø±Ù‡Ø§</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">Ù‡Ø²ÛŒÙ†Ù‡ Ø§Ø¨Ø²Ø§Ø±</th>
                            <th className="text-right py-3 px-4 font-semibold text-purple-900 dark:text-purple-200">Ø¬Ù…Ø¹ Ø¬Ø²</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stairSessionItems.map((it, idx) => {
                            const toolsTotal = ((it as any).meta?.tools || [])?.reduce((s: number, x: any) => s + (x.totalPrice || 0), 0) || 0;
                            const isLayer = ((it as any).meta?.isLayer) || false;
                            const layerInfo = ((it as any).meta?.layerInfo) || null;
                            const partTypeLabel = isLayer 
                              ? `Ù„Ø§ÛŒÙ‡ ${it.stairPartType === 'tread' ? 'Ú©Ù Ù¾Ù„Ù‡' : it.stairPartType === 'riser' ? 'Ø®ÛŒØ²' : 'Ù¾Ø§Ú¯Ø±Ø¯'}`
                              : (it.stairPartType === 'tread' ? 'Ú©Ù Ù¾Ù„Ù‡' : it.stairPartType === 'riser' ? 'Ø®ÛŒØ²' : 'Ù¾Ø§Ú¯Ø±Ø¯');
                            const partTypeColor = isLayer 
                              ? 'orange' 
                              : (it.stairPartType === 'tread' ? 'purple' : it.stairPartType === 'riser' ? 'blue' : 'indigo');
                            const lengthDisplay = it.lengthUnit === 'm' ? `${formatDisplayNumber(it.length)} m` : `${formatDisplayNumber(it.length)} cm`;
                            const widthDisplay = `${formatDisplayNumber(it.width)} cm`;
                            const stairMeta = ((it as any).meta?.stair) || {};
                            const baseStoneQuantity = stairMeta.baseStoneQuantity || 0;
                            const piecesPerStoneMeta = stairMeta.piecesPerStone || 0;
                            const leftoverWidthMeta = stairMeta.leftoverWidthCmPerStone || 0;
                            
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
                                      {layerInfo.numberOfLayersPerStair} Ù„Ø§ÛŒÙ‡ Ø¨Ø±Ø§ÛŒ Ù‡Ø± Ù¾Ù„Ù‡
                                    </div>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                                  <div className="flex flex-col gap-0.5">
                                    <span className="font-medium">Ø·ÙˆÙ„: {lengthDisplay}</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">Ø¹Ø±Ø¶: {widthDisplay}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-gray-700 dark:text-gray-300">
                                  <div className="flex flex-col gap-1">
                                    <span className="font-medium">{formatDisplayNumber(it.quantity || 0)} Ø¹Ø¯Ø¯</span>
                                    {baseStoneQuantity > 0 && (
                                      <span className="text-xs text-purple-600 dark:text-purple-300">
                                        Ø³Ù†Ú¯ Ù¾Ø§ÛŒÙ‡: {formatDisplayNumber(baseStoneQuantity)} Ø¹Ø¯Ø¯
                                        {piecesPerStoneMeta > 0 ? ` â€¢ ${formatDisplayNumber(piecesPerStoneMeta)} Ù‚Ø·Ø¹Ù‡ Ø§Ø² Ù‡Ø± Ø³Ù†Ú¯` : ''}
                                        {leftoverWidthMeta > 0 ? ` â€¢ Ø¨Ø§Ù‚ÛŒÙ…Ø§Ù†Ø¯Ù‡: ${formatDisplayNumber(leftoverWidthMeta)}cm` : ''}
                                      </span>
                                    )}
                                    {isLayer && layerInfo && (
                                      <span className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
                                        {layerInfo.layersFromRemainingStones > 0 || layerInfo.layersFromNewStones > 0
                                          ? `${layerInfo.layersFromRemainingStones || 0} Ø§Ø² Ø¨Ø§Ù‚ÛŒâ€ŒÙ…Ø§Ù†Ø¯Ù‡ØŒ ${layerInfo.layersFromNewStones || 0} Ø§Ø² Ø³Ù†Ú¯ Ø¬Ø¯ÛŒØ¯`
                                          : ''}
                                      </span>
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
                                  {(((it as any).meta?.tools) || []).length === 0 ? (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">-</span>
                                  ) : (
                                      ((it as any).meta?.tools || []).map((t: any, i: number) => (
                                        <div key={i} className="text-xs bg-purple-50 dark:bg-purple-900/20 px-2 py-1 rounded border border-purple-200 dark:border-purple-800">
                                          <span className="font-medium text-purple-700 dark:text-purple-300">{t.name}</span>
                                          <span className="text-gray-600 dark:text-gray-400"> â€¢ {formatDisplayNumber(t.computedMeters || 0)} m</span>
                                          <span className="text-gray-500 dark:text-gray-500"> Ã— {formatPrice(t.pricePerMeter || 0)}</span>
                                        </div>
                                      ))
                                    )}
                                    {it.finishingId && it.finishingCost ? (
                                      <div className="text-xs bg-teal-50 dark:bg-teal-900/20 px-2 py-1 rounded border border-teal-200 dark:border-teal-800">
                                        <span className="font-medium text-teal-700 dark:text-teal-300">Ù¾Ø±Ø¯Ø§Ø®Øª:</span>
                                        <span className="text-gray-600 dark:text-gray-400 mr-1">
                                          {it.finishingName || 'Ù¾Ø±Ø¯Ø§Ø®Øª'} â€¢ {formatSquareMeters(it.finishingSquareMeters || it.squareMeters || 0)}
                                        </span>
                                        <span className="text-teal-600 dark:text-teal-300 font-semibold">
                                          {formatPrice(it.finishingCost)}
                                        </span>
                                      </div>
                                    ) : null}
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
                            <td className="py-3 px-4 font-bold text-teal-900 dark:text-teal-200" colSpan={7}>Ø¬Ù…Ø¹ Ú©Ù„ Ú¯Ø±ÙˆÙ‡</td>
                            <td className="py-3 px-4">
                              <span className="font-bold text-lg text-teal-700 dark:text-teal-300">
                                {formatPrice(stairSessionItems.reduce((s, it) => s + (it.totalPrice || 0), 0))}
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
                <button type="button" className="px-3 py-2 rounded-md bg-gray-200 dark:bg-gray-700" onClick={() => onClose()}>Ø§Ù†ØµØ±Ø§Ù</button>
                <button type="button" className="px-3 py-2 rounded-md bg-purple-600 text-white" onClick={() => {
                  const [draft] = getActiveDraft();
                  // Validate required fields
                  const fieldErrors = validateDraftRequiredFields(stairActivePart, draft);
                  const hasErrors = Object.values(fieldErrors).some(Boolean);
                  if (hasErrors) {
                    setStairDraftErrors(prev => ({
                      ...prev,
                      [stairActivePart]: {
                        ...prev[stairActivePart],
                        ...fieldErrors
                      }
                    }));
                    setErrors({ products: 'Ù„Ø·ÙØ§Ù‹ Ø®Ø·Ø§Ù‡Ø§ÛŒ Ù…Ø´Ø®Øµâ€ŒØ´Ø¯Ù‡ Ø±Ø§ Ø¨Ø±Ø·Ø±Ù Ú©Ù†ÛŒØ¯' });
                    return;
                  }
                  setStairDraftErrors(prev => ({ ...prev, [stairActivePart]: {} }));
                  setErrors({});
                  const sid = ensureStairSessionId();
                  const totals = computeTotalsV2Local(stairActivePart, draft);
                  const chargeableCuttingCost = totals.billableCuttingCost;
                  const chargeableCuttingCostLongitudinal = totals.billableCuttingCostLongitudinal;
                  const chargeableCuttingCostCross = totals.billableCuttingCostCross;
                  const actualLengthM = getActualLengthMeters(draft);
                  const pricingLengthM = getPricingLengthMeters(draft);
                  const widthM = (draft.widthCm || 0) / 100;
                  const toolsMeters = computeToolsMetersV2(stairActivePart, draft);
                  let metaTools = (draft.tools || []).map(t => {
                    const meters = computeToolMetersForTool(stairActivePart, draft, t);
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
                  if (totals.cuttingCostLongitudinal > 0 && totals.shouldChargeCuttingCost) {
                    const cutMeters = actualLengthM * totals.baseStoneQuantity;
                    metaTools = [
                      ...metaTools,
                      {
                        toolId: `cut-longitudinal-${draft.stoneId || 'new'}`,
                        name: 'Ø¨Ø±Ø´ Ø·ÙˆÙ„ÛŒ',
                        pricePerMeter: totals.cuttingCostPerMeterLongitudinal || totals.cuttingCostPerMeter,
                        edges: { front: false, left: false, right: false, back: false, perimeter: true },
                        computedMeters: cutMeters,
                        totalPrice: chargeableCuttingCostLongitudinal
                      }
                    ];
                  }
                  if (totals.cuttingCostCross > 0 && totals.shouldChargeCuttingCost) {
                    const widthMeters = ((draft.widthCm || 0) / 100) * totals.baseStoneQuantity;
                    // Use "Ø¨Ø±Ø´ Ú©Ù„Ù‡ Ø¨Ø±" if there's only 1 cross cut (no longitudinal cut)
                    const hasOnlyCrossCut = totals.cuttingCostLongitudinal === 0 || !totals.cuttingCostLongitudinal;
                    const cutName = hasOnlyCrossCut ? 'Ø¨Ø±Ø´ Ú©Ù„Ù‡ Ø¨Ø±' : 'Ø¨Ø±Ø´ Ø¹Ø±Ø¶ÛŒ';
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
                  const toolsTotal = metaTools.reduce((sum, t) => sum + (t.totalPrice || 0), 0);
                  
                  // ðŸŽ¯ Use original width for pricing (like long stone products)
                  const originalWidthCm = stoneProduct.widthValue || 0;
                  const userWidthCm = draft.widthCm || 0;
                  const baseStoneQuantity = totals.baseStoneQuantity;
                  
                  const defaultMandatoryForPart = stairActivePart === 'riser' || stairActivePart === 'landing';
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
                    stairPartType: stairActivePart,
                    stoneCode: stoneProduct.code,
                    stoneName: draft.stoneLabel || stoneProduct.namePersian || stoneProduct.name || '',
                    diameterOrWidth: draft.thicknessCm || stoneProduct.thicknessValue || 0, // Ù‚Ø·Ø± = Ø¶Ø®Ø§Ù…Øª (thickness)
                    length: storedLengthValue,
                    lengthUnit: draft.lengthUnit || 'cm',
                    width: draft.widthCm!,
                    widthUnit: 'cm',
                    quantity: draft.quantity!,
                    squareMeters: totals.sqm,
                    pricePerSquareMeter: draft.pricePerSquareMeter!,
                    totalPrice: totalPrice,
                    description: '',
                    currency: 'ØªÙˆÙ…Ø§Ù†',
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
                        ? `Ø¨Ø±Ø´ Ø·ÙˆÙ„ÛŒ (${originalWidthCm}cm â†’ ${userWidthCm}cm) Ùˆ Ø¨Ø±Ø´ Ø¹Ø±Ø¶ÛŒ (${formatDisplayNumber(pricingLengthM)}m â†’ ${formatDisplayNumber(actualLengthM)}m)`
                        : hasWidthCut
                          ? `Ø¨Ø±Ø´ Ø·ÙˆÙ„ÛŒ (${originalWidthCm}cm â†’ ${userWidthCm}cm)`
                          : `Ø¨Ø±Ø´ Ú©Ù„Ù‡ Ø¨Ø± (${formatDisplayNumber(pricingLengthM)}m â†’ ${formatDisplayNumber(actualLengthM)}m)`
                      : '',
                    remainingStones: remainingStones,
                    cutDetails: cutDetails,
                    usedRemainingStones: [],
                    totalUsedRemainingWidth: 0,
                    totalUsedRemainingLength: 0,
                    appliedSubServices: [],
                    totalSubServiceCost: toolsTotal,
                    usedLengthForSubServices: 0,
                    usedSquareMetersForSubServices: 0,
                    cuttingBreakdown: cuttingBreakdown.length ? cuttingBreakdown : undefined,
                    standardLengthValue: stairActivePart === 'riser' ? null : (draft.standardLengthValue ?? null),
                    standardLengthUnit: stairActivePart === 'riser'
                      ? (draft.lengthUnit || 'm')
                      : (draft.standardLengthUnit || draft.lengthUnit || 'm'),
                    actualLengthMeters: actualLengthM || null,
                    finishingId: draft.finishingEnabled ? draft.finishingId || null : null,
                    finishingName: draft.finishingEnabled ? (draft.finishingLabel || selectedFinishing?.namePersian || selectedFinishing?.name || null) : null,
                    finishingPricePerSquareMeter: draft.finishingEnabled ? (draft.finishingPricePerSquareMeter ?? selectedFinishing?.pricePerSquareMeter ?? null) : null,
                    finishingCost: draft.finishingEnabled ? finishingCost : null,
                    finishingSquareMeters: draft.finishingEnabled && finishingCost > 0 ? totals.pricingSquareMeters : null,
                    meta: {
                      stairStepperV2: true,
                      meters: { lengthM: actualLengthM, widthM, toolsMeters },
                      tools: metaTools,
                      stair: {
                        baseStoneQuantity: totals.baseStoneQuantity,
                        piecesPerStone: totals.piecesPerStone,
                        leftoverWidthCmPerStone: totals.leftoverWidthCm,
                        pricingSquareMeters: totals.pricingSquareMeters,
                        standardLength: stairActivePart !== 'riser' && draft.standardLengthValue ? {
                          value: draft.standardLengthValue,
                          unit: draft.standardLengthUnit || draft.lengthUnit || 'm',
                          meters: pricingLengthM
                        } : undefined,
                      },
                      finishing: draft.finishingEnabled && finishingCost > 0 ? {
                        id: draft.finishingId,
                        name: draft.finishingLabel || selectedFinishing?.namePersian || selectedFinishing?.name,
                        pricePerSquareMeter: draft.finishingPricePerSquareMeter ?? selectedFinishing?.pricePerSquareMeter ?? null,
                        squareMeters: totals.pricingSquareMeters,
                        cost: finishingCost
                        } : undefined
                    } as any
                  };
                  // ============================================================================
                  // ðŸŽ¯ REFACTORED LAYER HANDLING - Single state update for all changes
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
                  setStairSessionItems(prev => {
                    // Remove previous entries for this part (and its layers) to keep session consistent during edits
                    const baseItems = prev.filter(item => {
                      const isLayerItem = ((item.meta as any)?.isLayer) || false;
                      if (isLayerItem) {
                        const parentPart = (item.meta as any)?.layerInfo?.parentPartType;
                        return parentPart !== stairActivePart;
                      }
                      return item.stairPartType !== stairActivePart;
                    });

                    // Start with adding the main stair part product
                    const updatedItems = [...baseItems, product];
                    const mainStairPartIndex = updatedItems.length - 1;
                    
                    // Process layers if configured
                    if (draft.numberOfLayersPerStair && draft.numberOfLayersPerStair > 0 && 
                        draft.layerWidthCm && hasLayerEdges && getLayerEffectivePricePerSquareMeter(draft) && 
                        draft.quantity) {
                      
                      // ðŸŽ¯ STEP 1: Find existing layer product (if any)
                      // Check both session items AND wizardData.products to prevent duplicates
                      const existingLayerInSession = findExistingLayerProduct(updatedItems, draft, stairActivePart);
                      const existingLayerInWizard = findExistingLayerProduct(wizardData.products, draft, stairActivePart);
                      const existingLayerProduct = existingLayerInSession || existingLayerInWizard;
                      
                      // ðŸŽ¯ STEP 2: Calculate layer metrics
                      const totalLayerSqm = computeLayerSqmV2(stairActivePart, draft);
                      const layerWidthCm = draft.layerWidthCm || 0;
                      const totalLayers = draft.quantity * draft.numberOfLayersPerStair;
                      const mainStairLengthM = getActualLengthMeters(draft);
                      // ðŸŽ¯ FIX: Use maximum layer length needed (accounts for different edge types with different lengths)
                      // This ensures we have enough stone for all layer types (front, left, right, etc.)
                      const layerLengthM = getMaxLayerLengthM(stairActivePart, draft) || mainStairLengthM;
                      const layerEdgeDemands = getLayerEdgeDemands(stairActivePart, draft);
                      const layerStoneProduct = getLayerStoneProductForDraft(draft, stoneProduct);
                      const usingAlternateLayerStone = !!(draft.layerUseDifferentStone && draft.layerStoneProduct);
                      const baseLayerPricePerSqm = getLayerBasePricePerSquareMeter(draft);
                      const effectiveLayerPricePerSqm = getLayerEffectivePricePerSquareMeter(draft);

                      // Get cutting cost per meter for layer calculations
                      const layerCuttingCostPerMeter = 
                        (layerStoneProduct as any)?.cuttingCostPerMeter ??
                        getCuttingTypePricePerMeter('LONG') ??
                        0;
                      
                      // ðŸŽ¯ STEP 3: Collect all available remaining stones
                      const allAvailableRemainingStones = usingAlternateLayerStone
                        ? []
                        : collectAvailableRemainingStones(updatedItems, remainingStones);
                      
                      // ðŸŽ¯ STEP 4: Calculate layer metrics (remaining stone usage, cutting costs, etc.)
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
                      
                      // ðŸŽ¯ STEP 5: Calculate pricing
                      const layerSqmPerStair = totalLayerSqm / (draft.quantity * draft.numberOfLayersPerStair);
                      const layerTypeUnitPrice = draft.layerTypePrice || 0;
                      
                      // ðŸŽ¯ FIX: Calculate layer type cost based on total length per stair Ã— number of stairs Ã— layer type price per meter
                      // Ù…Ø¬Ù…ÙˆØ¹ Ø·ÙˆÙ„Ù‡ Ù‡Ø§ÛŒ Ù„Ø§ÛŒÙ‡ Ø¨Ø±Ø§ÛŒ ÛŒÚ© Ù¾Ù„Ù‡ (Ú†Ù¾ + Ø±Ø§Ø³Øª + Ø¬Ù„Ùˆ) Ã— ØªØ¹Ø¯Ø§Ø¯ Ù¾Ù„Ù‡ Ù‡Ø§ Ã— Ù‡Ø²ÛŒÙ†Ù‡ Ù‡Ø± Ù†ÙˆØ¹ Ù„Ø§ÛŒÙ‡
                      const totalLayerLengthPerStairM = getTotalLayerLengthPerStairM(stairActivePart, draft);
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
                        const stoneWidthCm = layerStoneProduct?.widthValue || originalWidthCm;
                        const stoneLengthM = mainStairLengthM;
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
                      // ðŸŽ¯ FIX: Layer material price should be based on stone area used, NOT layer square meters
                      // ðŸŽ¯ NOTE: effectiveLayerPricePerSqm already includes mandatory pricing if applicable
                      // Example: stoneAreaUsedSqm (0.976 mÂ²) Ã— pricePerSqm (700,000) = 683,200 ØªÙˆÙ…Ø§Ù†
                      const layerMaterialPrice = pricingStoneAreaSqm * effectiveLayerPricePerSqm;
                      // ðŸŽ¯ FIX: Ensure layerTotalPrice is always a number (not string) and properly rounded
                      const layerTotalPrice = Number((layerMaterialPrice + layerTypeCost + chargeableLayerCuttingCost).toFixed(2));
                      
                      // ðŸŽ¯ STEP 6: Handle existing layer product merge OR create new layer product
                      if (existingLayerProduct) {
                        // Check if existing layer is in session or in wizardData
                        const existingLayerIndex = updatedItems.findIndex(item => item === existingLayerProduct);
                        
                        if (existingLayerIndex >= 0) {
                          // Merge existing layer product in session
                          const mergedLayerProduct = mergeLayerProduct(existingLayerProduct, {
                            draft,
                            parentPartType: stairActivePart,
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
                            stoneAreaUsedSqm: stoneAreaUsedSqm
                          });
                          updatedItems[existingLayerIndex] = mergedLayerProduct;
                        } else if (existingLayerInWizard) {
                          // Existing layer is in wizardData.products - skip creating new one in session
                          // It will be merged when adding to wizardData (handled in the "Add to Contract" button handler)
                          console.log('â„¹ï¸ Existing layer product found in wizardData.products, will be merged when adding to contract');
                          // Don't create a new layer product in session - prevents duplicates
                        }
                      } else {
                        // Create new layer product
                        const newLayerProduct = createLayerProduct({
                          draft,
                          stoneProduct: layerStoneProduct || stoneProduct,
                          stairSystemId: sid,
                          parentPartType: stairActivePart,
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
                          stoneAreaUsedSqm: stoneAreaUsedSqm
                        });
                        updatedItems.push(newLayerProduct);
                      }
                      
                      // ðŸŽ¯ STEP 7: Update remaining stone usage tracking
                      if (layerMetrics.usedRemainingStonesForLayers.length > 0) {
                        const remainingStoneUpdates = updateRemainingStoneUsage(
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
                  const defaultMandatoryAfterReset = stairActivePart === 'riser' || stairActivePart === 'landing';
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
                    standardLengthValue: null,
                    standardLengthUnit: draft.lengthUnit || 'm',
                    finishingEnabled: false,
                    finishingId: null,
                    finishingLabel: null,
                    finishingPricePerSquareMeter: null
                  });
                  setStoneSearchTerm('');
                  setToolsSearchTerm('');
                  setToolsDropdownOpen(false);
                  setErrors({});
                }}>Ø§ÙØ²ÙˆØ¯Ù† Ø§ÛŒÙ† Ø¨Ø®Ø´</button>
                <button type="button" className="px-3 py-2 rounded-md bg-green-600 text-white" onClick={() => {
                  if (!stairSessionItems.length) { onClose(); return; }
                  
                  // Handle edit mode: replace existing products instead of adding new ones
                  if (isEditMode && editingProductIndex !== null) {
                    // Find the old stairSystemId from the product being edited
                    const oldProduct = wizardData.products[editingProductIndex];
                    const oldStairSystemId = oldProduct?.stairSystemId;
                    
                    if (oldStairSystemId) {
                      // Remove all old products with the same stairSystemId
                      const updatedProducts = wizardData.products.filter(p => 
                        !(p.productType === 'stair' && p.stairSystemId === oldStairSystemId)
                      );
                      
                      // Preserve the stairSystemId for the updated products and recalculate parentProductIndex for layers
                      const currentProductsCount = updatedProducts.length;
                      
                      // Create a map of session items to their final indices
                      const sessionToFinalIndexMap = new Map<ContractProduct, number>();
                      let nonLayerCount = 0;
                      stairSessionItems.forEach((item) => {
                        const isLayer = ((item.meta as any)?.isLayer) || false;
                        if (!isLayer) {
                          sessionToFinalIndexMap.set(item, currentProductsCount + nonLayerCount);
                          nonLayerCount++;
                        }
                      });
                      
                      const productsToAdd = stairSessionItems.map((item, sessionIndex) => {
                        const isLayer = ((item.meta as any)?.isLayer) || false;
                        if (isLayer) {
                          const layerInfo = (item.meta as any)?.layerInfo;
                          const parentIndexInSession = layerInfo?.parentProductIndexInSession;
                          
                          if (parentIndexInSession !== undefined && parentIndexInSession >= 0) {
                            const parentInSession = stairSessionItems[parentIndexInSession];
                            if (parentInSession) {
                              const parentFinalIndex = sessionToFinalIndexMap.get(parentInSession);
                              if (parentFinalIndex !== undefined && parentFinalIndex >= 0) {
                                return {
                                  ...item,
                                  stairSystemId: oldStairSystemId,
                                  parentProductIndex: parentFinalIndex
                                };
                              }
                            }
                          }
                        }
                        return {
                          ...item,
                          stairSystemId: oldStairSystemId
                        };
                      });
                      
                      // Add updated products
                      updateWizardData({ products: [...updatedProducts, ...productsToAdd] });
                    } else {
                      // Fallback: just replace the single product
                      const updatedProducts = [...wizardData.products];
                      updatedProducts[editingProductIndex] = stairSessionItems[0];
                      updateWizardData({ products: updatedProducts });
                    }
                  } else {
                    // Add mode: append session items to wizardData
                    // ðŸŽ¯ Set parentProductIndex for layer products to link them to their parent stair part
                    const currentProductsCount = wizardData.products.length;
                    
                    // First, check for existing layer products in wizardData that should be merged
                    // Filter out layer products from session that already exist in wizardData
                    const sessionItemsToAdd: ContractProduct[] = [];
                    const layerProductsToMerge: Array<{ existing: ContractProduct; new: ContractProduct }> = [];
                    
                    stairSessionItems.forEach((item) => {
                      const isLayer = ((item.meta as any)?.isLayer) || false;
                      if (isLayer) {
                        // Check if this layer already exists in wizardData
                        const existingLayer = findExistingLayerProduct(wizardData.products, {
                          layerEdges: (item.meta as any)?.layerEdges,
                          layerWidthCm: item.width,
                          lengthValue: item.length,
                          lengthUnit: item.lengthUnit || 'm',
                          numberOfLayersPerStair: ((item.meta as any)?.layerInfo)?.numberOfLayersPerStair,
                          layerUseDifferentStone: item.layerUseDifferentStone,
                          layerStoneProductId: item.layerUseDifferentStone
                            ? (item.layerStoneProductId || item.productId)
                            : null
                        } as StairPartDraftV2, ((item.meta as any)?.layerInfo)?.parentPartType || 'tread');
                        
                        if (existingLayer) {
                          // Layer exists in wizardData - mark for merge instead of adding new
                          layerProductsToMerge.push({ existing: existingLayer, new: item });
                        } else {
                          // New layer - add to session items
                          sessionItemsToAdd.push(item);
                        }
                      } else {
                        // Non-layer item - always add
                        sessionItemsToAdd.push(item);
                      }
                    });
                    
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
                          const parentInSession = stairSessionItems[parentIndexInSession];
                          
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
                              console.warn('âš ï¸ Could not find parent final index for layer product, using fallback calculation');
                              // Find parent's index in original session
                              const parentSessionIndex = stairSessionItems.findIndex(p => p === parentInSession);
                              if (parentSessionIndex >= 0) {
                                // Count non-layer items before parent in session
                                let nonLayerBeforeParent = 0;
                                for (let i = 0; i < parentSessionIndex; i++) {
                                  if (!((stairSessionItems[i].meta as any)?.isLayer)) {
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
                    
                    // Merge existing layer products in wizardData
                    const updatedProducts = [...wizardData.products];
                    layerProductsToMerge.forEach(({ existing, new: newLayer }) => {
                      const existingIndex = updatedProducts.findIndex(p => p === existing);
                      if (existingIndex >= 0) {
                        const layerInfo = (newLayer.meta as any)?.layerInfo;
                        const existingLayerInfo = (existing.meta as any)?.layerInfo;
                        
                        // Merge the layer product
                        const metaLayerType = (newLayer.meta as any)?.layerType;
                        const mergedLayer = mergeLayerProduct(existing, {
                          draft: {
                            layerEdges: (newLayer.meta as any)?.layerEdges,
                            numberOfLayersPerStair: layerInfo?.numberOfLayersPerStair,
                            quantity: layerInfo?.parentQuantity || 0,
                            layerTypeId: newLayer.layerTypeId ?? metaLayerType?.id ?? null,
                            layerTypeName: newLayer.layerTypeName ?? metaLayerType?.name ?? null,
                            layerTypePrice: newLayer.layerTypePrice ?? metaLayerType?.pricePerLayer ?? null,
                            layerUseDifferentStone: newLayer.layerUseDifferentStone,
                            layerStoneProductId: newLayer.layerStoneProductId || newLayer.productId,
                            layerStoneProduct: newLayer.layerUseDifferentStone ? newLayer.product : null,
                            layerStoneLabel: newLayer.layerStoneName || newLayer.stoneName,
                            layerPricePerSquareMeter: newLayer.layerStonePricePerSquareMeter || newLayer.pricePerSquareMeter
                          } as StairPartDraftV2,
                          parentPartType: layerInfo?.parentPartType || 'tread',
                          newLayersNeeded: newLayer.quantity || 0,
                          newLayerSqm: newLayer.squareMeters || 0,
                          layerMaterialPrice: newLayer.originalTotalPrice || 0,
                          layerTypeCost: metaLayerType?.totalCost ?? ((newLayer.layerTypePrice || 0) * (newLayer.quantity || 0)),
                          totalLayerCuttingCost: newLayer.cuttingCost || 0,
                          layerCutDetails: newLayer.cutDetails || [],
                          usedRemainingStonesForLayers: newLayer.usedRemainingStones || [],
                          layersFromRemainingStones: layerInfo?.layersFromRemainingStones || 0,
                          layersFromNewStones: layerInfo?.layersFromNewStones || 0,
                          layerPricePerSquareMeter: newLayer.layerUseDifferentStone
                            ? (newLayer.layerStonePricePerSquareMeter || newLayer.pricePerSquareMeter || 0)
                            : (newLayer.pricePerSquareMeter || 0),
                          layerStoneLabel: newLayer.layerUseDifferentStone
                            ? (newLayer.layerStoneName || newLayer.stoneName)
                            : null,
                          layerUseDifferentStone: newLayer.layerUseDifferentStone,
                          layerStoneProductId: newLayer.layerUseDifferentStone
                            ? (newLayer.layerStoneProductId || newLayer.productId)
                            : null,
                          layerStoneBasePricePerSquareMeter: newLayer.layerUseDifferentStone
                            ? (newLayer.layerStoneBasePricePerSquareMeter || newLayer.layerStonePricePerSquareMeter || newLayer.pricePerSquareMeter || 0)
                            : null,
                          layerUseMandatory: newLayer.layerUseDifferentStone ? (newLayer.layerUseMandatory ?? true) : undefined,
                          layerMandatoryPercentage: newLayer.layerUseDifferentStone ? (newLayer.layerMandatoryPercentage ?? 0) : undefined,
                          stoneAreaUsedSqm: (newLayer.meta as any)?.stoneAreaUsedSqm
                        });
                        updatedProducts[existingIndex] = mergedLayer;
                      }
                    });
                    
                    updateWizardData({ products: [...updatedProducts, ...productsToAdd] });
                  }
                  
                  setStairSessionItems([]);
                  setStairSessionId(null);
                  setIsEditMode(false);
                  setEditingProductIndex(null);
                  onClose();
                }}>Ø§ØªÙ…Ø§Ù… Ùˆ Ø§ÙØ²ÙˆØ¯Ù† Ø¨Ù‡ Ù‚Ø±Ø§Ø±Ø¯Ø§Ø¯</button>
          </div>
        </div>
      </div>
  );
};

