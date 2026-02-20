// Product configuration hook
// Manages product selection, dimensions, cutting, and pricing

import { useState, useCallback, useMemo } from 'react';
import type { ContractProduct, Product, RemainingStone, StoneCut } from '../types/contract.types';
import { handleSmartCalculation } from '../utils/productCalculations';
import { calculateStoneMetrics, calculateSlabMetrics } from '../utils/productCalculations';
import { calculateLongitudinalCut, calculateSlabCut } from '../services/stoneCuttingService';

export const useProductConfiguration = () => {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productType, setProductType] = useState<'longitudinal' | 'stair' | 'slab' | null>(null);
  const [dimensions, setDimensions] = useState({
    length: 0,
    width: 0,
    quantity: 1,
    squareMeters: 0,
    lengthUnit: 'cm' as 'cm' | 'm',
    widthUnit: 'cm' as 'cm' | 'm'
  });
  const [cuttingConfig, setCuttingConfig] = useState({
    isCut: false,
    originalWidth: 0,
    originalLength: 0,
    cuttingCostPerMeter: 0
  });
  const [mandatoryPricing, setMandatoryPricing] = useState({
    isMandatory: false,
    percentage: 20
  });
  const [pricePerSquareMeter, setPricePerSquareMeter] = useState(0);

  // Calculate product metrics
  const metrics = useMemo(() => {
    if (!selectedProduct || !productType) return null;

    if (productType === 'longitudinal') {
      return calculateStoneMetrics({
        length: dimensions.length,
        width: dimensions.width,
        quantity: dimensions.quantity,
        squareMeters: dimensions.squareMeters,
        pricePerSquareMeter,
        lengthUnit: dimensions.lengthUnit,
        widthUnit: dimensions.widthUnit,
        isMandatory: mandatoryPricing.isMandatory,
        mandatoryPercentage: mandatoryPricing.percentage,
        isCut: cuttingConfig.isCut,
        originalWidth: cuttingConfig.originalWidth,
        cuttingCostPerMeter: cuttingConfig.cuttingCostPerMeter
      });
    } else if (productType === 'slab') {
      return calculateSlabMetrics({
        length: dimensions.length,
        width: dimensions.width,
        quantity: dimensions.quantity,
        squareMeters: dimensions.squareMeters,
        pricePerSquareMeter,
        lengthUnit: dimensions.lengthUnit,
        widthUnit: dimensions.widthUnit,
        isMandatory: mandatoryPricing.isMandatory,
        mandatoryPercentage: mandatoryPricing.percentage,
        originalLength: cuttingConfig.originalLength,
        originalWidth: cuttingConfig.originalWidth
      });
    }

    return null;
  }, [selectedProduct, productType, dimensions, pricePerSquareMeter, mandatoryPricing, cuttingConfig]);

  // Handle smart calculation
  const handleDimensionChange = useCallback((
    field: 'length' | 'width' | 'squareMeters' | 'quantity',
    value: number
  ) => {
    const result = handleSmartCalculation(
      field,
      value,
      dimensions,
      dimensions.lengthUnit,
      dimensions.widthUnit
    );
    setDimensions(prev => ({ ...prev, ...result }));
  }, [dimensions]);

  // Calculate cutting
  const calculateCutting = useCallback(() => {
    if (!cuttingConfig.isCut || !selectedProduct) return null;

    if (productType === 'longitudinal') {
      return calculateLongitudinalCut({
        originalWidth: cuttingConfig.originalWidth,
        desiredWidth: dimensions.width,
        length: dimensions.length,
        cuttingCostPerMeter: cuttingConfig.cuttingCostPerMeter,
        quantity: dimensions.quantity,
        lengthUnit: dimensions.lengthUnit
      });
    } else if (productType === 'slab') {
      return calculateSlabCut({
        originalLength: cuttingConfig.originalLength,
        originalWidth: cuttingConfig.originalWidth,
        desiredLength: dimensions.length,
        desiredWidth: dimensions.width,
        lengthUnit: dimensions.lengthUnit,
        widthUnit: dimensions.widthUnit,
        quantity: dimensions.quantity
      });
    }

    return null;
  }, [cuttingConfig, dimensions, selectedProduct, productType]);

  // Create contract product
  const createContractProduct = useCallback((): ContractProduct | null => {
    if (!selectedProduct || !productType || !metrics) return null;

    const cutting = calculateCutting();

    // Handle different return types from cutting calculations
    let cuttingCost = 0;
    let remainingStones: RemainingStone[] = [];
    let cutDetails: StoneCut[] = [];

    if (cutting) {
      // Type guard: check if it's the longitudinal cut result (has 'remainingStone' property)
      if ('remainingStone' in cutting) {
        // calculateLongitudinalCut returns { cutDetails: StoneCut, remainingStone: RemainingStone, cuttingCost, remainingWidth }
        cuttingCost = cutting.cuttingCost;
        remainingStones = cutting.remainingStone ? [cutting.remainingStone] : [];
        cutDetails = Array.isArray(cutting.cutDetails) ? cutting.cutDetails : (cutting.cutDetails ? [cutting.cutDetails] : []);
      } else if ('remainingPieces' in cutting) {
        // calculateSlabCut returns { cutDetails: StoneCut[], remainingPieces: RemainingStone[], totalCuttingCost, ... }
        cuttingCost = cutting.totalCuttingCost;
        remainingStones = cutting.remainingPieces || [];
        cutDetails = Array.isArray(cutting.cutDetails) ? cutting.cutDetails : [];
      }
    }

    return {
      productId: selectedProduct.id,
      product: selectedProduct,
      productType,
      stoneCode: selectedProduct.code,
      stoneName: selectedProduct.namePersian,
      diameterOrWidth: dimensions.width,
      length: dimensions.length,
      width: dimensions.width,
      quantity: dimensions.quantity,
      squareMeters: metrics.squareMeters,
      pricePerSquareMeter,
      totalPrice: metrics.totalPrice,
      originalTotalPrice: metrics.originalTotalPrice,
      description: '',
      currency: selectedProduct.currency || '???',
      lengthUnit: dimensions.lengthUnit,
      widthUnit: dimensions.widthUnit,
      isMandatory: mandatoryPricing.isMandatory,
      mandatoryPercentage: mandatoryPricing.percentage,
      isCut: cuttingConfig.isCut,
      cutType: cuttingConfig.isCut ? (productType === 'slab' ? null : 'longitudinal') : null,
      originalWidth: cuttingConfig.originalWidth,
      originalLength: cuttingConfig.originalLength,
      cuttingCost,
      cuttingCostPerMeter: cuttingConfig.cuttingCostPerMeter,
      cutDescription: '',
      remainingStones,
      cutDetails,
      usedRemainingStones: [],
      totalUsedRemainingWidth: 0,
      totalUsedRemainingLength: 0,
      appliedSubServices: [],
      totalSubServiceCost: 0,
      usedLengthForSubServices: 0,
      usedSquareMetersForSubServices: 0
    };
  }, [selectedProduct, productType, dimensions, metrics, pricePerSquareMeter, mandatoryPricing, cuttingConfig, calculateCutting]);

  // Reset configuration
  const resetConfiguration = useCallback(() => {
    setSelectedProduct(null);
    setProductType(null);
    setDimensions({
      length: 0,
      width: 0,
      quantity: 1,
      squareMeters: 0,
      lengthUnit: 'cm',
      widthUnit: 'cm'
    });
    setCuttingConfig({
      isCut: false,
      originalWidth: 0,
      originalLength: 0,
      cuttingCostPerMeter: 0
    });
    setMandatoryPricing({
      isMandatory: false,
      percentage: 20
    });
    setPricePerSquareMeter(0);
  }, []);

  return {
    // State
    selectedProduct,
    productType,
    dimensions,
    cuttingConfig,
    mandatoryPricing,
    pricePerSquareMeter,
    metrics,
    
    // Actions
    setSelectedProduct,
    setProductType,
    setDimensions,
    handleDimensionChange,
    setCuttingConfig,
    setMandatoryPricing,
    setPricePerSquareMeter,
    calculateCutting,
    createContractProduct,
    resetConfiguration
  };
};


