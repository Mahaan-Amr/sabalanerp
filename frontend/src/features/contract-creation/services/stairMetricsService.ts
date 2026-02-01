// Stair Metrics Service
// Calculation functions for stair system old flow (tread, riser, landing metrics and nosing costs)

import { NOSING_TYPES } from '../constants/contract.constants';

/**
 * Calculate nosing cutting cost for stair tread
 */
export const calculateNosingCuttingCost = (data: {
  nosingType: string;
  treadWidth: number; // طول پله (cm or m)
  treadWidthUnit: 'cm' | 'm';
  numberOfSteps: number;
  numberOfStaircases?: number;
  quantityType?: 'steps' | 'staircases';
}) => {
  const {
    nosingType,
    treadWidth,
    treadWidthUnit,
    numberOfSteps,
    numberOfStaircases = 1,
    quantityType = 'steps'
  } = data;
  
  // Find nosing type
  const nosing = NOSING_TYPES.find(n => n.id === nosingType);
  if (!nosing || nosingType === 'none' || !nosing.cuttingCostPerMeter) {
    return { cuttingCost: 0, cuttingCostPerMeter: 0 };
  }
  
  // Convert tread width to meters
  const treadWidthInMeters = treadWidthUnit === 'm' ? treadWidth : treadWidth / 100;
  
  // Calculate total steps
  const totalSteps = quantityType === 'staircases' 
    ? numberOfSteps * numberOfStaircases 
    : numberOfSteps;
  
  // Calculate total length for nosing (tread width × number of steps)
  const totalLength = treadWidthInMeters * totalSteps;
  
  // Calculate cutting cost
  const cuttingCost = totalLength * nosing.cuttingCostPerMeter;
  
  return {
    cuttingCost,
    cuttingCostPerMeter: nosing.cuttingCostPerMeter
  };
};

/**
 * Calculate metrics for Tread (کف پله)
 */
export const calculateTreadMetrics = (data: {
  treadWidth: number; // طول پله
  treadWidthUnit: 'cm' | 'm';
  treadDepth: number; // عرض پله (cm)
  quantity: number; // تعداد پله
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
  treadWidth: number; // طول پله (for calculating riser area)
  treadWidthUnit: 'cm' | 'm';
  riserHeight: number; // ارتفاع قائمه (cm)
  quantity: number; // تعداد قائمه
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
  landingWidth: number; // عرض پاگرد (cm)
  landingDepth: number; // عمق پاگرد (cm)
  numberOfLandings: number; // تعداد پاگرد
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

