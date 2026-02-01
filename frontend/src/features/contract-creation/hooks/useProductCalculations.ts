// useProductCalculations Hook
// Provides calculation handlers and utilities for product configuration

import { useCallback, useMemo } from 'react';
import type { ContractProduct, Product, ContractWizardData } from '../types/contract.types';
import {
  handleSmartCalculation as smartCalculation,
  calculateStoneMetrics,
  calculateSlabMetrics,
  calculateTreadMetrics,
  calculateRiserMetrics,
  calculateLandingMetrics,
  getSlabStandardDimensions,
  determineSlabLineCutPlan
} from '../utils/productCalculations';
import { calculateNosingCuttingCost } from '../services/stairMetricsService';
import { generateFullProductName } from '../utils/formatUtils';

interface UseProductCalculationsOptions {
  productConfig: Partial<ContractProduct>;
  setProductConfig: React.Dispatch<React.SetStateAction<Partial<ContractProduct>>>;
  lengthUnit: 'cm' | 'm';
  widthUnit: 'cm' | 'm';
  hasQuantityBeenInteracted: boolean;
  cuttingTypes: Array<{ code: string; pricePerMeter: number | null }>;
  wizardData: ContractWizardData;
  selectedProduct: Product | null;
  isEditMode: boolean;
  isMandatory: boolean;
  mandatoryPercentage: number;
  errors: Record<string, string>;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export const useProductCalculations = (options: UseProductCalculationsOptions) => {
  const {
    productConfig,
    setProductConfig,
    lengthUnit,
    widthUnit,
    hasQuantityBeenInteracted,
    cuttingTypes,
    wizardData,
    selectedProduct,
    isEditMode,
    isMandatory,
    mandatoryPercentage,
    errors,
    setErrors
  } = options;

  // Get effective quantity for calculations
  const getEffectiveQuantity = useCallback(() => {
    if (!hasQuantityBeenInteracted) {
      return 1; // Default value when not interacted
    }
    return productConfig.quantity || 1; // User value or fallback to 1
  }, [hasQuantityBeenInteracted, productConfig.quantity]);

  // Get quantity display value
  const getQuantityDisplayValue = useCallback(() => {
    if (!hasQuantityBeenInteracted) {
      return 0; // Show empty (0) when not interacted
    }
    // If quantity is 0 or empty, show 0 (empty field)
    if (!productConfig.quantity || productConfig.quantity === 0) {
      return 0;
    }
    return productConfig.quantity; // Show user value
  }, [hasQuantityBeenInteracted, productConfig.quantity]);

  // Get cutting type price per meter
  const getCuttingTypePricePerMeter = useCallback((cutTypeCode: string): number | null => {
    const cuttingType = cuttingTypes.find(ct => ct.code === cutTypeCode && ct.pricePerMeter !== null && ct.pricePerMeter !== undefined);
    return cuttingType?.pricePerMeter || null;
  }, [cuttingTypes]);

  // Calculate auto cutting cost
  const calculateAutoCuttingCost = useCallback((
    length: number | undefined,
    lengthUnit: 'cm' | 'm',
    cuttingCostPerMeter: number | null | undefined,
    quantity: number
  ): number => {
    if (!cuttingCostPerMeter || cuttingCostPerMeter <= 0 || !length || length <= 0) {
      return 0;
    }
    const lengthInMeters = lengthUnit === 'm' ? length : length / 100;
    const effectiveQuantity = hasQuantityBeenInteracted ? (quantity || 1) : 1;
    return lengthInMeters * cuttingCostPerMeter * effectiveQuantity;
  }, [hasQuantityBeenInteracted]);

  // Smart calculation wrapper
  const handleSmartCalculation = useCallback((
    changedField: 'length' | 'width' | 'squareMeters' | 'quantity',
    value: number,
    currentConfig: any,
    lengthUnit: 'cm' | 'm',
    widthUnit: 'cm' | 'm',
    effectiveQuantity?: number
  ) => {
    return smartCalculation(changedField, value, currentConfig, lengthUnit, widthUnit, effectiveQuantity);
  }, []);

  // Calculate stone metrics wrapper
  const calculateStoneMetricsWrapper = useCallback((data: any) => {
    return calculateStoneMetrics({
      ...data,
      isMandatory,
      mandatoryPercentage
    });
  }, [isMandatory, mandatoryPercentage]);

  // Get slab standard dimensions wrapper
  const getSlabStandardDimensionsWrapper = useCallback(() => {
    return getSlabStandardDimensions(selectedProduct, productConfig, lengthUnit);
  }, [selectedProduct, productConfig, lengthUnit]);

  // Generate full product name
  const generateFullProductNameWrapper = useCallback((product: Product) => {
    return generateFullProductName(product);
  }, []);

  return {
    getEffectiveQuantity,
    getQuantityDisplayValue,
    getCuttingTypePricePerMeter,
    calculateAutoCuttingCost,
    handleSmartCalculation,
    calculateStoneMetrics: calculateStoneMetricsWrapper,
    calculateSlabMetrics,
    calculateTreadMetrics,
    calculateRiserMetrics,
    calculateLandingMetrics,
    calculateNosingCuttingCost,
    getSlabStandardDimensions: getSlabStandardDimensionsWrapper,
    determineSlabLineCutPlan,
    generateFullProductName: generateFullProductNameWrapper
  };
};

