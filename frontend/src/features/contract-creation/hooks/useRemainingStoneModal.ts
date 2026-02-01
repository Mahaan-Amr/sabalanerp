// useRemainingStoneModal Hook
// Manages remaining stone modal state and handlers

import { useState, useCallback } from 'react';
import type {
  RemainingStone,
  ContractProduct,
  StonePartition,
  ContractWizardData
} from '../types/contract.types';
import { validatePartitions, calculateRemainingAreasAfterPartitions } from '../services/stoneCuttingService';
import { recalculateUsedRemainingDimensions } from '../utils/dimensionUtils';

interface UseRemainingStoneModalOptions {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  getCuttingTypePricePerMeter: (code: string) => number | null;
  calculatePartitionPositions: (
    partitions: StonePartition[],
    availableWidth: number,
    availableLength: number
  ) => StonePartition[];
  setErrors: (errors: Record<string, string>) => void;
  handleSmartCalculation?: (
    changedField: 'length' | 'width' | 'squareMeters' | 'quantity',
    value: number,
    currentConfig: any,
    lengthUnit: 'cm' | 'm',
    widthUnit: 'cm' | 'm',
    effectiveQuantity?: number
  ) => { length: number; width: number; squareMeters: number };
  getEffectiveQuantity?: () => number;
}

export const useRemainingStoneModal = (options: UseRemainingStoneModalOptions) => {
  const {
    wizardData,
    updateWizardData,
    getCuttingTypePricePerMeter,
    calculatePartitionPositions,
    setErrors,
    handleSmartCalculation,
    getEffectiveQuantity
  } = options;

  // Modal visibility
  const [showRemainingStoneModal, setShowRemainingStoneModal] = useState(false);
  const [showRemainingStoneCAD, setShowRemainingStoneCAD] = useState(false);

  // Selected remaining stone
  const [selectedRemainingStone, setSelectedRemainingStone] = useState<RemainingStone | null>(null);
  const [selectedRemainingStoneSourceProduct, setSelectedRemainingStoneSourceProduct] = useState<ContractProduct | null>(null);

  // Remaining stone config
  const [remainingStoneConfig, setRemainingStoneConfig] = useState<Partial<ContractProduct>>({});
  const [remainingStoneLengthUnit, setRemainingStoneLengthUnit] = useState<'cm' | 'm'>('m');
  const [remainingStoneWidthUnit, setRemainingStoneWidthUnit] = useState<'cm' | 'm'>('cm');
  const [remainingStoneIsMandatory, setRemainingStoneIsMandatory] = useState(false);
  const [remainingStoneMandatoryPercentage, setRemainingStoneMandatoryPercentage] = useState(20);

  // Partition state
  const [partitions, setPartitions] = useState<StonePartition[]>([]);
  const [partitionLengthUnit, setPartitionLengthUnit] = useState<'cm' | 'm'>('m');
  const [partitionWidthUnit, setPartitionWidthUnit] = useState<'cm' | 'm'>('cm');
  const [partitionValidationErrors, setPartitionValidationErrors] = useState<Map<string, string>>(new Map());

  // Handle unit conversion for remaining stone length
  const handleRemainingStoneLengthUnitChange = useCallback((newUnit: 'cm' | 'm') => {
    if (!remainingStoneConfig.length) return;
    
    const currentLength = remainingStoneConfig.length;
    let convertedLength = currentLength;
    
    if (remainingStoneLengthUnit === 'cm' && newUnit === 'm') {
      convertedLength = currentLength / 100;
    } else if (remainingStoneLengthUnit === 'm' && newUnit === 'cm') {
      convertedLength = currentLength * 100;
    }
    
    setRemainingStoneLengthUnit(newUnit);
    setRemainingStoneConfig(prev => {
      const updatedConfig = { ...prev, length: convertedLength, width: selectedRemainingStone?.width || 0 };
      if (handleSmartCalculation && getEffectiveQuantity) {
        const smartResult = handleSmartCalculation('length', convertedLength, updatedConfig, newUnit, 'cm', getEffectiveQuantity());
        return {
          ...updatedConfig,
          squareMeters: smartResult.squareMeters
        };
      }
      return updatedConfig;
    });
  }, [remainingStoneConfig.length, remainingStoneLengthUnit, selectedRemainingStone, handleSmartCalculation, getEffectiveQuantity]);

  // Handle unit conversion for remaining stone width
  const handleRemainingStoneWidthUnitChange = useCallback((newUnit: 'cm' | 'm') => {
    if (!remainingStoneConfig.width) return;
    
    const currentWidth = remainingStoneConfig.width;
    let convertedWidth = currentWidth;
    
    if (remainingStoneWidthUnit === 'cm' && newUnit === 'm') {
      convertedWidth = currentWidth / 100;
    } else if (remainingStoneWidthUnit === 'm' && newUnit === 'cm') {
      convertedWidth = currentWidth * 100;
    }
    
    setRemainingStoneWidthUnit(newUnit);
    setRemainingStoneConfig(prev => {
      const updatedConfig = { ...prev, width: convertedWidth, length: remainingStoneConfig.length || 0 };
      if (handleSmartCalculation && getEffectiveQuantity) {
        const smartResult = handleSmartCalculation('width', convertedWidth, updatedConfig, remainingStoneLengthUnit, newUnit, getEffectiveQuantity());
        return {
          ...updatedConfig,
          length: smartResult.length,
          squareMeters: smartResult.squareMeters
        };
      }
      return updatedConfig;
    });
  }, [remainingStoneConfig.width, remainingStoneWidthUnit, remainingStoneLengthUnit, handleSmartCalculation, getEffectiveQuantity]);

  // Partition management handlers
  const handleAddPartition = useCallback(() => {
    setPartitions(prev => [...prev, {
      id: `partition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      width: 0,
      length: 0,
      squareMeters: 0
    }]);
  }, []);

  const handleRemovePartition = useCallback((partitionId: string) => {
    setPartitions(prev => prev.filter(p => p.id !== partitionId));
  }, []);

  const handleUpdatePartition = useCallback((partitionId: string, field: 'width' | 'length', value: number) => {
    setPartitions(prev => {
      const updated = prev.map(p => {
        if (p.id === partitionId) {
          const updatedPartition = { ...p, [field]: value, validationError: undefined };
          // Auto-calculate square meters
          if (updatedPartition.width > 0 && updatedPartition.length > 0) {
            const widthInCm = partitionWidthUnit === 'm' ? updatedPartition.width * 100 : updatedPartition.width;
            const lengthInMeters = partitionLengthUnit === 'm' ? updatedPartition.length : (updatedPartition.length / 100);
            updatedPartition.squareMeters = (widthInCm * lengthInMeters * 100) / 10000;
          } else {
            updatedPartition.squareMeters = 0;
          }
          return updatedPartition;
        }
        return p;
      });
      
      // Real-time validation when selectedRemainingStone is available
      if (selectedRemainingStone) {
        const validPartitions = updated
          .filter(p => p.width > 0 && p.length > 0)
          .map(p => ({
            ...p,
            width: partitionWidthUnit === 'm' ? p.width * 100 : p.width,
            length: partitionLengthUnit === 'm' ? p.length : p.length / 100,
            squareMeters: (partitionWidthUnit === 'm' ? p.width * 100 : p.width) * 
                          (partitionLengthUnit === 'm' ? p.length : p.length / 100) * 100 / 10000
          }));
        
        if (validPartitions.length > 0) {
          const validation = validatePartitions(
            validPartitions,
            selectedRemainingStone.width,
            selectedRemainingStone.length,
            selectedRemainingStone.squareMeters
          );
          
          const updatedWithErrors = updated.map(p => {
            const convertedP = {
              ...p,
              width: partitionWidthUnit === 'm' ? p.width * 100 : p.width,
              length: partitionLengthUnit === 'm' ? p.length : p.length / 100
            };
            const error = validation.partitionErrors.get(convertedP.id);
            return error ? { ...p, validationError: error } : { ...p, validationError: undefined };
          });
          
          setPartitionValidationErrors(validation.partitionErrors);
          return updatedWithErrors;
        } else {
          setPartitionValidationErrors(new Map());
        }
      }
      
      return updated;
    });
  }, [selectedRemainingStone, partitionWidthUnit, partitionLengthUnit]);

  // Handle adding remaining stone product to contract (with partitions)
  const handleAddRemainingStoneToContract = useCallback(() => {
    if (!selectedRemainingStone) {
      setErrors({ products: 'سنگ باقی‌مانده انتخاب نشده است' });
      return;
    }
    
    // Convert partition units to consistent units (cm for width, meters for length)
    const validPartitions = partitions
      .filter(p => p.width > 0 && p.length > 0)
      .map(p => ({
        ...p,
        width: partitionWidthUnit === 'm' ? p.width * 100 : p.width,
        length: partitionLengthUnit === 'm' ? p.length : p.length / 100,
        squareMeters: (partitionWidthUnit === 'm' ? p.width * 100 : p.width) * 
                      (partitionLengthUnit === 'm' ? p.length : p.length / 100) * 100 / 10000
      }));
    
    // Validate partitions
    const validation = validatePartitions(
      validPartitions,
      selectedRemainingStone.width,
      selectedRemainingStone.length,
      selectedRemainingStone.squareMeters
    );
    
    if (!validation.isValid) {
      setPartitionValidationErrors(validation.partitionErrors);
      setPartitions(validation.validatedPartitions);
      setErrors({ products: validation.error || 'خطا در اعتبارسنجی پارتیشن‌ها' });
      return;
    }
    
    setPartitionValidationErrors(new Map());
    
    // Calculate positions for partitions
    const positionedPartitions = calculatePartitionPositions(
      validPartitions,
      selectedRemainingStone.width,
      selectedRemainingStone.length
    );
    
    // Get cutting cost per meter from source product
    const sourceProduct = selectedRemainingStoneSourceProduct || 
      wizardData.products.find(p => 
        (p.remainingStones || []).some(rs => rs.id === selectedRemainingStone.id) ||
        (p.usedRemainingStones || []).some(rs => rs.id === selectedRemainingStone.id)
      );
    
    const cuttingCostPerMeter = sourceProduct?.cuttingCostPerMeter || 
      getCuttingTypePricePerMeter('LONG') || 0;
    
    // Convert each partition to a RemainingStone entry
    const partitionRemainingStones: RemainingStone[] = positionedPartitions
      .filter(p => p.position && p.width > 0 && p.length > 0)
      .map((partition, index) => {
        const needsCut = partition.width < selectedRemainingStone.width;
        const cutType: 'longitudinal' | 'cross' | null = needsCut ? 'longitudinal' : null;
        const partitionQuantity = 1;
        const cuttingCost = needsCut && cuttingCostPerMeter > 0 
          ? partition.length * cuttingCostPerMeter * partitionQuantity 
          : 0;
        
        return {
          id: `partition_remaining_${Date.now()}_${index}`,
          width: partition.width,
          length: partition.length,
          squareMeters: partition.squareMeters,
          isAvailable: true,
          sourceCutId: selectedRemainingStone.sourceCutId,
          position: partition.position,
          cuttingCost: cuttingCost,
          cuttingCostPerMeter: cuttingCostPerMeter,
          cutType: cutType,
          quantity: partitionQuantity
        };
      });
    
    // Calculate remaining areas after partitions
    const remainingAreas = calculateRemainingAreasAfterPartitions(
      positionedPartitions,
      selectedRemainingStone.width,
      selectedRemainingStone.length
    );
    
    // Find source product and update it
    let sourceProductFound = false;
    let targetProduct: ContractProduct | null = null;
    
    if (selectedRemainingStone.id === 'primary-remaining' && selectedRemainingStoneSourceProduct) {
      targetProduct = wizardData.products.find(
        p => p.stoneCode === selectedRemainingStoneSourceProduct.stoneCode && p.isCut
      ) || null;
      
      if (targetProduct) {
        sourceProductFound = true;
      }
    } else {
      targetProduct = wizardData.products.find(product => {
        return (product.remainingStones || []).some(
          rs => rs.id === selectedRemainingStone.id
        );
      }) || null;
      
      if (targetProduct) {
        sourceProductFound = true;
      }
    }
    
    const updatedProducts = wizardData.products.map(product => {
      const isTargetProduct = targetProduct && (
        product.stoneCode === targetProduct.stoneCode ||
        (selectedRemainingStone.id === 'primary-remaining' 
          ? product.stoneCode === selectedRemainingStoneSourceProduct?.stoneCode && product.isCut
          : (product.remainingStones || []).some(rs => rs.id === selectedRemainingStone.id))
      );
      
      if (isTargetProduct) {
        sourceProductFound = true;
        
        const totalUsedWidth = validPartitions.reduce((sum, p) => sum + p.width, 0);
        const totalUsedLength = Math.max(...validPartitions.map(p => p.length), 0);
        
        let remainingStonesWithoutUsed: RemainingStone[] = [];
        
        if (selectedRemainingStone.id === 'primary-remaining') {
          remainingStonesWithoutUsed = product.remainingStones || [];
        } else {
          remainingStonesWithoutUsed = (product.remainingStones || []).filter(
            rs => rs.id !== selectedRemainingStone.id
          );
        }
        
        const updatedUsedStones = [
          ...(product.usedRemainingStones || []),
          ...(selectedRemainingStone.id !== 'primary-remaining' ? [selectedRemainingStone] : []),
          ...partitionRemainingStones
        ];
        const recalculated = recalculateUsedRemainingDimensions(updatedUsedStones);
        
        return {
          ...product,
          usedRemainingStones: updatedUsedStones,
          remainingStones: [
            ...remainingStonesWithoutUsed,
            ...remainingAreas.map(area => ({
              ...area,
              sourceCutId: selectedRemainingStone.sourceCutId
            }))
          ],
          totalUsedRemainingWidth: recalculated.totalUsedWidth,
          totalUsedRemainingLength: recalculated.totalUsedLength
        };
      }
      return product;
    });
    
    if (!sourceProductFound) {
      setErrors({ products: 'خطا در پیدا کردن محصول منبع' });
      return;
    }
    
    updateWizardData({
      products: updatedProducts
    });
    
    // Close modal and reset state
    setShowRemainingStoneModal(false);
    setSelectedRemainingStone(null);
    setSelectedRemainingStoneSourceProduct(null);
    setRemainingStoneConfig({});
    setPartitions([{
      id: `partition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      width: 0,
      length: 0,
      squareMeters: 0
    }]);
    setRemainingStoneLengthUnit('cm');
    setRemainingStoneWidthUnit('cm');
    setPartitionLengthUnit('m');
    setPartitionWidthUnit('cm');
    setRemainingStoneIsMandatory(false);
    setRemainingStoneMandatoryPercentage(20);
    setErrors({});
  }, [
    selectedRemainingStone,
    selectedRemainingStoneSourceProduct,
    partitions,
    partitionWidthUnit,
    partitionLengthUnit,
    wizardData.products,
    updateWizardData,
    getCuttingTypePricePerMeter,
    calculatePartitionPositions,
    setErrors
  ]);

  return {
    // Modal state
    showRemainingStoneModal,
    setShowRemainingStoneModal,
    showRemainingStoneCAD,
    setShowRemainingStoneCAD,
    
    // Selected remaining stone
    selectedRemainingStone,
    setSelectedRemainingStone,
    selectedRemainingStoneSourceProduct,
    setSelectedRemainingStoneSourceProduct,
    
    // Remaining stone config
    remainingStoneConfig,
    setRemainingStoneConfig,
    remainingStoneLengthUnit,
    setRemainingStoneLengthUnit,
    remainingStoneWidthUnit,
    setRemainingStoneWidthUnit,
    remainingStoneIsMandatory,
    setRemainingStoneIsMandatory,
    remainingStoneMandatoryPercentage,
    setRemainingStoneMandatoryPercentage,
    
    // Partition state
    partitions,
    setPartitions,
    partitionLengthUnit,
    setPartitionLengthUnit,
    partitionWidthUnit,
    setPartitionWidthUnit,
    partitionValidationErrors,
    setPartitionValidationErrors,
    
    // Handlers
    handleRemainingStoneLengthUnitChange,
    handleRemainingStoneWidthUnitChange,
    handleAddPartition,
    handleRemovePartition,
    handleUpdatePartition,
    handleAddRemainingStoneToContract
  };
};

