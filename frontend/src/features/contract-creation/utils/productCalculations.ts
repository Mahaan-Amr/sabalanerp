// Product calculation utilities
// Smart calculations and metrics for different product types

import type { SlabStandardDimensionEntry, SlabLineCutPlan, Product, ContractProduct } from '../types/contract.types';

/**
 * Smart calculation function to handle bidirectional calculations
 * Automatically calculates missing dimensions based on what's provided
 */
export const handleSmartCalculation = (
  changedField: 'length' | 'width' | 'squareMeters' | 'quantity',
  value: number,
  currentConfig: {
    length?: number;
    width?: number;
    squareMeters?: number;
    quantity?: number;
  },
  lengthUnit: 'cm' | 'm',
  widthUnit: 'cm' | 'm',
  effectiveQuantity?: number
): { length: number; width: number; squareMeters: number } => {
  const { length, width, squareMeters, quantity } = currentConfig;
  
  // Use effective quantity if provided, otherwise use quantity from config
  const actualQuantity = effectiveQuantity !== undefined ? effectiveQuantity : (quantity || 1);
  
  // Convert dimensions to cm for calculations
  const lengthInCm = length ? (lengthUnit === 'm' ? length * 100 : length) : 0;
  const widthInCm = width ? (widthUnit === 'm' ? width * 100 : width) : 0;
  
  let newLength = length || 0;
  let newWidth = width || 0;
  let newSquareMeters = squareMeters || 0;
  
  // Update the changed field
  if (changedField === 'length') {
    newLength = value;
  } else if (changedField === 'width') {
    newWidth = value;
  } else if (changedField === 'squareMeters') {
    newSquareMeters = value;
  } else if (changedField === 'quantity') {
    // Quantity change affects square meters calculation
    if (lengthInCm && widthInCm) {
      newSquareMeters = (lengthInCm * widthInCm * actualQuantity) / 10000;
    }
  }
  
  // Smart calculation logic
  if (changedField === 'length' || changedField === 'width' || changedField === 'quantity') {
    // If we have both length and width, calculate square meters
    const updatedLengthInCm = changedField === 'length' ? (lengthUnit === 'm' ? value * 100 : value) : lengthInCm;
    const updatedWidthInCm = changedField === 'width' ? (widthUnit === 'm' ? value * 100 : value) : widthInCm;
    const updatedQuantity = changedField === 'quantity' ? actualQuantity : actualQuantity;
    
    if (updatedLengthInCm && updatedWidthInCm) {
      newSquareMeters = (updatedLengthInCm * updatedWidthInCm * updatedQuantity) / 10000;
    }
  } else if (changedField === 'squareMeters') {
    // If square meters is manually changed, recalculate length based on current width
    const updatedQuantity = actualQuantity;
    
    if (widthInCm) {
      // Calculate length from width and square meters (width takes priority)
      const calculatedLengthInCm = (value * 10000) / (widthInCm * updatedQuantity);
      newLength = lengthUnit === 'm' ? calculatedLengthInCm / 100 : calculatedLengthInCm;
    } else if (lengthInCm) {
      // Calculate width from length and square meters (if no width available)
      const calculatedWidthInCm = (value * 10000) / (lengthInCm * updatedQuantity);
      newWidth = widthUnit === 'm' ? calculatedWidthInCm / 100 : calculatedWidthInCm;
    }
  }
  
  return {
    length: newLength,
    width: newWidth,
    squareMeters: newSquareMeters
  };
};

/**
 * Calculate stone metrics for longitudinal stones
 */
export const calculateStoneMetrics = (data: {
  length?: number;
  width?: number;
  quantity?: number;
  squareMeters?: number;
  pricePerSquareMeter?: number;
  lengthUnit?: 'cm' | 'm';
  widthUnit?: 'cm' | 'm';
  isMandatory?: boolean;
  mandatoryPercentage?: number;
  isCut?: boolean;
  originalWidth?: number;
  cuttingCostPerMeter?: number;
}) => {
  const { 
    length, 
    width, 
    quantity = 1, 
    squareMeters, 
    pricePerSquareMeter, 
    lengthUnit = 'cm', 
    widthUnit = 'cm', 
    isMandatory = false, 
    mandatoryPercentage = 20, 
    isCut = false, 
    originalWidth = 0, 
    cuttingCostPerMeter = 0 
  } = data;
  
  let calculatedSquareMeters = 0;
  let calculatedLength = 0;
  let calculatedWidth = 0;
  let calculatedTotalPrice = 0;
  let originalTotalPrice = 0;
  
  // Convert dimensions to cm for calculations
  const lengthInCm = length ? (lengthUnit === 'm' ? length * 100 : length) : 0;
  const widthInCm = width ? (widthUnit === 'm' ? width * 100 : width) : 0;
  
  // Scenario 1: We have length and width, calculate square meters
  if (lengthInCm && widthInCm && !squareMeters) {
    calculatedSquareMeters = (lengthInCm * widthInCm * quantity) / 10000; // Convert cm² to m²
  }
  // Scenario 2: We have square meters and width, calculate length
  else if (squareMeters && widthInCm && !length) {
    calculatedLength = (squareMeters * 10000) / (widthInCm * quantity); // Convert m² to cm²
    // Convert back to original unit
    calculatedLength = lengthUnit === 'm' ? calculatedLength / 100 : calculatedLength;
  }
  // Scenario 3: We have square meters and length, calculate width
  else if (squareMeters && lengthInCm && !width) {
    calculatedWidth = (squareMeters * 10000) / (lengthInCm * quantity); // Convert m² to cm²
    // Convert back to original unit
    calculatedWidth = widthUnit === 'm' ? calculatedWidth / 100 : calculatedWidth;
  }
  // Scenario 4: We have all dimensions, use provided square meters
  else if (squareMeters) {
    calculatedSquareMeters = squareMeters;
  }
  
  // Calculate total price if we have price per square meter
  if (pricePerSquareMeter && calculatedSquareMeters) {
    // Always use original width for pricing when available
    let pricingSquareMeters = calculatedSquareMeters;
    
    if (originalWidth > 0 && widthInCm > 0) {
      // Always calculate pricing based on ORIGINAL width when available
      const originalWidthInCm = typeof originalWidth === 'string' ? parseFloat(originalWidth) : originalWidth;
      const lengthInCmForPricing = lengthInCm;
      
      // Calculate square meters for pricing using ORIGINAL width
      pricingSquareMeters = (lengthInCmForPricing * originalWidthInCm * quantity) / 10000;
    }
    
    originalTotalPrice = pricingSquareMeters * pricePerSquareMeter;
    
    // Calculate cutting cost if stone is cut (but DON'T add it to totalPrice)
    // Cutting cost will be shown separately
    let cuttingCost = 0;
    if (isCut && originalWidth > 0 && cuttingCostPerMeter > 0) {
      const lengthInCmForCut = lengthUnit === 'm' ? (length || 0) * 100 : (length || 0);
      cuttingCost = (lengthInCmForCut / 100) * cuttingCostPerMeter * quantity;
    }
    
    // Apply mandatory percentage increase if enabled
    // IMPORTANT: cuttingCost is NOT added to calculatedTotalPrice - it's shown separately
    if (isMandatory && mandatoryPercentage > 0) {
      calculatedTotalPrice = originalTotalPrice * (1 + mandatoryPercentage / 100);
    } else {
      calculatedTotalPrice = originalTotalPrice;
    }
  }
  
  return {
    squareMeters: calculatedSquareMeters,
    length: calculatedLength || length || 0,
    width: calculatedWidth || width || 0,
    totalPrice: calculatedTotalPrice,
    originalTotalPrice: originalTotalPrice,
    cuttingCost: isCut && originalWidth > 0 && cuttingCostPerMeter > 0 ? 
      ((lengthUnit === 'm' ? (length || 0) * 100 : (length || 0)) / 100) * cuttingCostPerMeter * quantity : 0
  };
};

/**
 * Calculate slab cutting cost for a single standard dimension entry
 */
const calculateSlabCuttingCostForEntry = (data: {
  standardLengthCm: number;
  standardWidthCm: number;
  requestedLengthCm: number;
  requestedWidthCm: number;
  quantity: number;
  cuttingCostPerMeterLongitudinal: number;
  cuttingCostPerMeterCross: number;
  lineCutLongitudinalMeters?: number;
  lineCutCrossMeters?: number;
}): number => {
  const {
    standardLengthCm,
    standardWidthCm,
    requestedLengthCm,
    requestedWidthCm,
    quantity,
    cuttingCostPerMeterLongitudinal,
    cuttingCostPerMeterCross,
    lineCutLongitudinalMeters,
    lineCutCrossMeters
  } = data;
  
  let entryCuttingCost = 0;
  
  const needsLongitudinalCut = requestedWidthCm < standardWidthCm && requestedWidthCm > 0;
  const needsCrossCut = requestedLengthCm < standardLengthCm && requestedLengthCm > 0;
  
  if (needsLongitudinalCut && cuttingCostPerMeterLongitudinal > 0) {
    const longitudinalMeters = lineCutLongitudinalMeters ?? (requestedLengthCm / 100);
    entryCuttingCost += longitudinalMeters * cuttingCostPerMeterLongitudinal * quantity;
  }
  
  if (needsCrossCut && cuttingCostPerMeterCross > 0) {
    const crossMeters = lineCutCrossMeters ?? (requestedWidthCm / 100);
    entryCuttingCost += crossMeters * cuttingCostPerMeterCross * quantity;
  }
  
  return entryCuttingCost;
};

/**
 * Calculate slab metrics for slab stones (2D cutting)
 */
export const calculateSlabMetrics = (data: {
  length?: number;
  width?: number;
  quantity?: number;
  squareMeters?: number;
  pricePerSquareMeter?: number;
  lengthUnit?: 'cm' | 'm';
  widthUnit?: 'cm' | 'm';
  isMandatory?: boolean;
  mandatoryPercentage?: number;
  originalLength?: number;
  originalWidth?: number;
  standardDimensions?: SlabStandardDimensionEntry[];
  cuttingCostPerMeterLongitudinal?: number;
  cuttingCostPerMeterCross?: number;
  slabCuttingMode?: 'perSquareMeter' | 'lineBased';
  slabCuttingPricePerSquareMeter?: number;
  lineCutLongitudinalMeters?: number;
  lineCutCrossMeters?: number;
}) => {
  const {
    length,
    width,
    quantity = 1,
    squareMeters,
    pricePerSquareMeter,
    lengthUnit = 'm',
    widthUnit = 'cm',
    isMandatory = false,
    mandatoryPercentage = 20,
    originalLength = 0,
    originalWidth = 0,
    standardDimensions = [],
    cuttingCostPerMeterLongitudinal = 0,
    cuttingCostPerMeterCross = 0,
    slabCuttingMode = 'lineBased',
    slabCuttingPricePerSquareMeter = 0,
    lineCutLongitudinalMeters,
    lineCutCrossMeters
  } = data;
  
  let calculatedSquareMeters = 0;
  let calculatedLength = 0;
  let calculatedWidth = 0;
  let calculatedTotalPrice = 0;
  let originalTotalPrice = 0;
  
  // Convert dimensions to cm for calculations
  const lengthInCm = length ? (lengthUnit === 'm' ? length * 100 : length) : 0;
  const widthInCm = width ? (widthUnit === 'm' ? width * 100 : width) : 0;
  
  // Scenario 1: We have length and width, calculate square meters
  if (lengthInCm && widthInCm && !squareMeters) {
    calculatedSquareMeters = (lengthInCm * widthInCm * quantity) / 10000; // Convert cm² to m²
  }
  // Scenario 2: We have square meters and width, calculate length
  else if (squareMeters && widthInCm && !length) {
    calculatedLength = (squareMeters * 10000) / (widthInCm * quantity);
    calculatedLength = lengthUnit === 'm' ? calculatedLength / 100 : calculatedLength;
  }
  // Scenario 3: We have square meters and length, calculate width
  else if (squareMeters && lengthInCm && !width) {
    calculatedWidth = (squareMeters * 10000) / (lengthInCm * quantity);
    calculatedWidth = widthUnit === 'm' ? calculatedWidth / 100 : calculatedWidth;
  }
  // Scenario 4: We have all dimensions, use provided square meters
  else if (squareMeters) {
    calculatedSquareMeters = squareMeters;
  }
  
  // Calculate total price if we have price per square meter
  if (pricePerSquareMeter && calculatedSquareMeters) {
    // For slabs, pricing is based on original dimensions
    let pricingSquareMeters = calculatedSquareMeters;
    
    // If we have multiple standard dimensions, calculate pricing for each entry
    if (standardDimensions.length > 0) {
      pricingSquareMeters = standardDimensions.reduce((total, entry) => {
        const entrySqm = (entry.standardLengthCm * entry.standardWidthCm * entry.quantity) / 10000;
        return total + entrySqm;
      }, 0);
    } else if (originalLength > 0 && originalWidth > 0 && lengthInCm > 0 && widthInCm > 0) {
      // Fallback to legacy single dimension calculation
      const originalLengthCm = lengthUnit === 'm' ? originalLength * 100 : originalLength;
      const originalWidthCm = widthUnit === 'm' ? originalWidth * 100 : originalWidth;
      pricingSquareMeters = (originalLengthCm * originalWidthCm * quantity) / 10000;
    }
    
    originalTotalPrice = pricingSquareMeters * pricePerSquareMeter;
    
    // Apply mandatory percentage increase if enabled
    if (isMandatory && mandatoryPercentage > 0) {
      calculatedTotalPrice = originalTotalPrice * (1 + mandatoryPercentage / 100);
    } else {
      calculatedTotalPrice = originalTotalPrice;
    }
  }
  
  // Calculate cutting costs (2D: longitudinal + cross)
  let totalCuttingCost = 0;
  if (slabCuttingMode === 'perSquareMeter' && slabCuttingPricePerSquareMeter > 0) {
    const targetSqm = calculatedSquareMeters || ((lengthInCm && widthInCm)
      ? (lengthInCm * widthInCm * quantity) / 10000
      : 0);
    totalCuttingCost = targetSqm * slabCuttingPricePerSquareMeter;
  } else if (lengthInCm > 0 && widthInCm > 0) {
    // If we have multiple standard dimensions, calculate cutting cost for each entry
    if (standardDimensions.length > 0) {
      totalCuttingCost = standardDimensions.reduce((total, entry) => {
        const entryCuttingCost = calculateSlabCuttingCostForEntry({
          standardLengthCm: entry.standardLengthCm,
          standardWidthCm: entry.standardWidthCm,
          requestedLengthCm: lengthInCm,
          requestedWidthCm: widthInCm,
          quantity: entry.quantity,
          cuttingCostPerMeterLongitudinal,
          cuttingCostPerMeterCross,
          lineCutLongitudinalMeters,
          lineCutCrossMeters
        });
        return total + entryCuttingCost;
      }, 0);
    } else if (originalLength > 0 && originalWidth > 0) {
      // Fallback to legacy single dimension calculation
      const originalLengthCm = lengthUnit === 'm' ? originalLength * 100 : originalLength;
      const originalWidthCm = widthUnit === 'm' ? originalWidth * 100 : originalWidth;
      
      const longitudinalMeters = lineCutLongitudinalMeters ?? (lengthInCm / 100);
      const crossMeters = lineCutCrossMeters ?? (widthInCm / 100);
      
      if (widthInCm < originalWidthCm && cuttingCostPerMeterLongitudinal > 0) {
        const longitudinalCost = longitudinalMeters * cuttingCostPerMeterLongitudinal * quantity;
        totalCuttingCost += longitudinalCost;
      }
      
      if (lengthInCm < originalLengthCm && cuttingCostPerMeterCross > 0) {
        const crossCost = crossMeters * cuttingCostPerMeterCross * quantity;
        totalCuttingCost += crossCost;
      }
    }
  }
  
  return {
    squareMeters: calculatedSquareMeters,
    length: calculatedLength || length || 0,
    width: calculatedWidth || width || 0,
    totalPrice: calculatedTotalPrice,
    originalTotalPrice: originalTotalPrice,
    cuttingCost: totalCuttingCost
  };
};

/**
 * Calculate stair stone metrics
 */
export const calculateStairStoneMetrics = (data: {
  treadWidth: number; // طول پله (cm or m)
  treadWidthUnit: 'cm' | 'm';
  treadDepth: number; // عرض پله (cm)
  numberOfSteps: number; // تعداد پله
  numberOfLandings?: number; // تعداد پاگرد
  landingWidth?: number; // عرض پاگرد (cm)
  landingDepth?: number; // عمق پاگرد (cm)
  numberOfStaircases?: number; // تعداد پله‌کان کامل
  quantityType?: 'steps' | 'staircases';
}) => {
  const {
    treadWidth,
    treadWidthUnit,
    treadDepth,
    numberOfSteps,
    numberOfLandings = 0,
    landingWidth = 0,
    landingDepth = 0,
    numberOfStaircases = 1,
    quantityType = 'steps'
  } = data;
  
  // Convert tread width to cm
  const treadWidthInCm = treadWidthUnit === 'm' ? treadWidth * 100 : treadWidth;
  
  // Calculate area per step (tread width × tread depth)
  const areaPerStep = (treadWidthInCm * treadDepth) / 10000; // Convert cm² to m²
  
  // Calculate total steps based on quantity type
  const totalSteps = quantityType === 'staircases' 
    ? numberOfSteps * numberOfStaircases 
    : numberOfSteps;
  
  // Calculate total area for steps
  const totalStepsArea = areaPerStep * totalSteps;
  
  // Calculate landing area if applicable
  const landingArea = numberOfLandings > 0 && landingWidth > 0 && landingDepth > 0
    ? ((landingWidth * landingDepth) / 10000) * numberOfLandings * (quantityType === 'staircases' ? numberOfStaircases : 1)
    : 0;
  
  // Total area (steps + landings)
  const totalArea = totalStepsArea + landingArea;
  
  // Calculate total linear length (tread width × number of steps)
  const totalLinearLength = (treadWidthInCm / 100) * totalSteps; // Convert cm to meters
  
  return {
    areaPerStep,
    totalStepsArea,
    landingArea,
    totalArea,
    totalLinearLength,
    totalSteps
  };
};

/**
 * Calculate metrics for Tread (کف پله)
 */
export const calculateTreadMetrics = (data: {
  treadWidth: number;
  treadWidthUnit: 'cm' | 'm';
  treadDepth: number;
  quantity: number;
  quantityType: 'steps' | 'staircases';
  numberOfStaircases?: number;
}) => {
  const { treadWidth, treadWidthUnit, treadDepth, quantity, quantityType, numberOfStaircases = 1 } = data;
  
  // Convert tread width to cm
  const treadWidthInCm = treadWidthUnit === 'm' ? treadWidth * 100 : treadWidth;
  
  // Calculate area per step (tread width × tread depth) in m²
  const areaPerStep = (treadWidthInCm * treadDepth) / 10000;
  
  // Calculate total quantity
  const totalQuantity = quantityType === 'staircases' ? quantity * numberOfStaircases : quantity;
  
  // Calculate total area
  const totalArea = areaPerStep * totalQuantity;
  
  // Calculate total linear length in meters
  const totalLinearLength = (treadWidthInCm / 100) * totalQuantity;
  
  return {
    areaPerStep,
    totalArea,
    totalLinearLength,
    totalQuantity
  };
};

/**
 * Calculate metrics for Riser (خیز پله)
 */
export const calculateRiserMetrics = (data: {
  treadWidth: number;
  treadWidthUnit: 'cm' | 'm';
  riserHeight: number;
  quantity: number;
  quantityType: 'steps' | 'staircases';
  numberOfStaircases?: number;
}) => {
  const { treadWidth, treadWidthUnit, riserHeight, quantity, quantityType, numberOfStaircases = 1 } = data;
  
  // Convert tread width to cm
  const treadWidthInCm = treadWidthUnit === 'm' ? treadWidth * 100 : treadWidth;
  
  // Calculate area per riser (tread width × riser height) in m²
  const areaPerRiser = (treadWidthInCm * riserHeight) / 10000;
  
  // Calculate total quantity
  const totalQuantity = quantityType === 'staircases' ? quantity * numberOfStaircases : quantity;
  
  // Calculate total area
  const totalArea = areaPerRiser * totalQuantity;
  
  return {
    areaPerRiser,
    totalArea,
    totalQuantity
  };
};

/**
 * Calculate metrics for Landing (پاگرد)
 */
export const calculateLandingMetrics = (data: {
  landingWidth: number;
  landingDepth: number;
  numberOfLandings: number;
  quantityType: 'steps' | 'staircases';
  numberOfStaircases?: number;
}) => {
  const { landingWidth, landingDepth, numberOfLandings, quantityType, numberOfStaircases = 1 } = data;
  
  // Calculate area per landing in m²
  const areaPerLanding = (landingWidth * landingDepth) / 10000;
  
  // Calculate total quantity
  const totalQuantity = quantityType === 'staircases' 
    ? numberOfLandings * numberOfStaircases 
    : numberOfLandings;
  
  // Calculate total area
  const totalArea = areaPerLanding * totalQuantity;
  
  return {
    areaPerLanding,
    totalArea,
    totalQuantity
  };
};

/**
 * Determine slab line cut plan based on requested and standard dimensions
 */
export const determineSlabLineCutPlan = ({
  requestedLengthCm,
  requestedWidthCm,
  standardLengthCm,
  standardWidthCm
}: {
  requestedLengthCm: number;
  requestedWidthCm: number;
  standardLengthCm: number;
  standardWidthCm: number;
}): SlabLineCutPlan => {
  const axes = [
    { key: 'length' as const, requested: requestedLengthCm, standard: standardLengthCm },
    { key: 'width' as const, requested: requestedWidthCm, standard: standardWidthCm }
  ];
  
  const positiveAxes = axes.filter(ax => ax.requested > 0 && ax.standard > 0);
  const longestRequestedValue = positiveAxes.length > 0
    ? Math.max(...positiveAxes.map(ax => ax.requested))
    : Math.max(requestedLengthCm, requestedWidthCm);
  
  let candidates = positiveAxes.filter(ax => ax.requested === longestRequestedValue && ax.requested > 0);
  if (candidates.length === 0) {
    candidates = axes.filter(ax => ax.requested > 0 && ax.standard > 0);
  }
  if (candidates.length === 0) {
    candidates = axes;
  }
  
  const selectedAxis = candidates.reduce((best, current) => {
    if (!best) return current;
    const bestDiff = Math.abs(best.requested - best.standard);
    const currentDiff = Math.abs(current.requested - current.standard);
    return currentDiff <= bestDiff ? current : best;
  }, candidates[0] || { key: 'length' as const, requested: 0, standard: 0 });
  
  const axisUsingStandard = selectedAxis.key;
  const longitudinalMeters = axisUsingStandard === 'length'
    ? (standardLengthCm > 0 ? standardLengthCm / 100 : requestedLengthCm / 100)
    : (requestedLengthCm > 0 ? requestedLengthCm / 100 : standardLengthCm / 100);
  const crossMeters = axisUsingStandard === 'width'
    ? (standardWidthCm > 0 ? standardWidthCm / 100 : requestedWidthCm / 100)
    : (requestedWidthCm > 0 ? requestedWidthCm / 100 : standardWidthCm / 100);
  
  return {
    axisUsingStandard,
    longitudinalMeters: Number.isFinite(longitudinalMeters) ? longitudinalMeters : 0,
    crossMeters: Number.isFinite(crossMeters) ? crossMeters : 0
  };
};

/**
 * Get slab standard dimensions from product config or selected product
 */
export const getSlabStandardDimensions = (
  selectedProduct: Product | null,
  productConfig: Partial<ContractProduct>,
  lengthUnit: 'cm' | 'm'
): { standardLengthCm: number; standardWidthCm: number } => {
  const fallbackWidthCm = selectedProduct?.widthValue || productConfig.diameterOrWidth || 0;
  let standardWidthCm = productConfig.slabStandardWidthCm ?? productConfig.originalWidth ?? fallbackWidthCm;
  if (!standardWidthCm && fallbackWidthCm) {
    standardWidthCm = fallbackWidthCm;
  }
  
  const fallbackLengthCm = (selectedProduct as any)?.lengthValue || 300;
  let standardLengthCm: number;
  if (productConfig.slabStandardLengthCm != null) {
    standardLengthCm = productConfig.slabStandardLengthCm;
  } else if (productConfig.originalLength != null) {
    const storedUnit = productConfig.lengthUnit || lengthUnit;
    standardLengthCm = storedUnit === 'm'
      ? productConfig.originalLength * 100
      : productConfig.originalLength;
  } else {
    standardLengthCm = fallbackLengthCm;
  }
  
  return {
    standardLengthCm: standardLengthCm || 0,
    standardWidthCm: standardWidthCm || 0
  };
};

