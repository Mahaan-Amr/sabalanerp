// useProductModal Hook
// Manages product modal state and logic for longitudinal, slab, and stair (old flow) products

import { useState, useCallback } from 'react';
import type { Product, ContractProduct, StairSystemConfig } from '../types/contract.types';

interface UseProductModalOptions {
  useStairFlowV2?: boolean;
  onProductSelected?: (product: Product) => void;
  onProductAdded?: (product: ContractProduct) => void;
  // Optional calculation handlers for enhanced unit conversion
  handleSmartCalculation?: (changedField: 'length' | 'width' | 'squareMeters' | 'quantity', value: number, currentConfig: any, lengthUnit: 'cm' | 'm', widthUnit: 'cm' | 'm', effectiveQuantity?: number) => any;
  getEffectiveQuantity?: () => number;
  // Optional error handling
  errors?: Record<string, string>;
  setErrors?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  selectedProductForValidation?: Product | null;
  isEditModeForValidation?: boolean;
}

export const useProductModal = (options: UseProductModalOptions = {}) => {
  const { 
    useStairFlowV2 = true, 
    onProductSelected, 
    onProductAdded,
    handleSmartCalculation,
    getEffectiveQuantity,
    errors,
    setErrors,
    selectedProductForValidation,
    isEditModeForValidation
  } = options;

  // Modal visibility
  const [showProductModal, setShowProductModal] = useState(false);
  const [showCADDesigner, setShowCADDesigner] = useState(false);

  // Product selection
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productConfig, setProductConfig] = useState<Partial<ContractProduct>>({});

  // Units
  const [lengthUnit, setLengthUnit] = useState<'cm' | 'm'>('m');
  const [widthUnit, setWidthUnit] = useState<'cm' | 'm'>('cm');

  // Mandatory pricing
  const [isMandatory, setIsMandatory] = useState(false);
  const [mandatoryPercentage, setMandatoryPercentage] = useState(20);

  // Edit mode
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingProductIndex, setEditingProductIndex] = useState<number | null>(null);

  // Interaction tracking
  const [hasQuantityBeenInteracted, setHasQuantityBeenInteracted] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  // Stair system (old flow) state
  const [stairSystemConfig, setStairSystemConfig] = useState<StairSystemConfig | null>(null);
  const [quantityType, setQuantityType] = useState<'steps' | 'staircases'>('steps');
  const [treadExpanded, setTreadExpanded] = useState(true);
  const [riserExpanded, setRiserExpanded] = useState(true);
  const [landingExpanded, setLandingExpanded] = useState(true);

  // Stair part search terms (old flow)
  const [treadProductSearchTerm, setTreadProductSearchTerm] = useState('');
  const [riserProductSearchTerm, setRiserProductSearchTerm] = useState('');
  const [landingProductSearchTerm, setLandingProductSearchTerm] = useState('');

  // Open modal with product
  const openModal = useCallback((product: Product, productType: 'longitudinal' | 'stair' | 'slab', editIndex?: number | null) => {
    setSelectedProduct(product);
    setProductConfig({
      productId: product.id,
      product: product,
      productType: productType
    });
    setLengthUnit('m');
    setWidthUnit('cm');
    setIsMandatory(false);
    setMandatoryPercentage(20);
    setIsEditMode(editIndex !== null && editIndex !== undefined);
    setEditingProductIndex(editIndex ?? null);
    setHasQuantityBeenInteracted(false);
    setTouchedFields(new Set());
    setShowProductModal(true);
    
    if (onProductSelected) {
      onProductSelected(product);
    }
  }, [onProductSelected]);

  // Close modal and reset state
  const closeModal = useCallback(() => {
    setShowProductModal(false);
    setSelectedProduct(null);
    setProductConfig({});
    setLengthUnit('m');
    setWidthUnit('cm');
    setIsMandatory(false);
    setMandatoryPercentage(20);
    setIsEditMode(false);
    setEditingProductIndex(null);
    setHasQuantityBeenInteracted(false);
    setTouchedFields(new Set());
    setStairSystemConfig(null);
    setShowCADDesigner(false);
    setTreadProductSearchTerm('');
    setRiserProductSearchTerm('');
    setLandingProductSearchTerm('');
  }, []);

  // Handle field focus with auto-clear default values
  const handleFieldFocus = useCallback((fieldName: string, currentValue: number | string | null | undefined, defaultValue: number | string) => {
    // Check if field has been touched before
    if (!touchedFields.has(fieldName)) {
      // Mark as touched
      setTouchedFields(prev => new Set(prev).add(fieldName));
      
      // If current value is still at default, clear it
      const isAtDefault = (currentValue === defaultValue || 
                          currentValue === null || 
                          currentValue === undefined ||
                          (typeof defaultValue === 'number' && typeof currentValue === 'number' && currentValue === defaultValue));
      
      if (isAtDefault) {
        if (typeof defaultValue === 'number') {
          // For number inputs, set to undefined to make it appear empty
          if (fieldName === 'length') {
            setProductConfig(prev => ({ ...prev, length: undefined }));
          } else if (fieldName === 'width') {
            setProductConfig(prev => ({ ...prev, width: undefined }));
          } else if (fieldName === 'quantity') {
            setProductConfig(prev => ({ ...prev, quantity: undefined }));
            setHasQuantityBeenInteracted(true); // Mark as interacted when cleared
          } else if (fieldName === 'pricePerSquareMeter') {
            setProductConfig(prev => ({ ...prev, pricePerSquareMeter: undefined }));
          } else if (fieldName === 'squareMeters') {
            setProductConfig(prev => ({ ...prev, squareMeters: undefined }));
          } else if (fieldName === 'cuttingCostPerMeter') {
            setProductConfig(prev => ({ ...prev, cuttingCostPerMeter: undefined }));
          }
        } else {
          // For string inputs, set to empty
          if (fieldName === 'stoneName') {
            setProductConfig(prev => ({ ...prev, stoneName: '' }));
          } else if (fieldName === 'description') {
            setProductConfig(prev => ({ ...prev, description: '' }));
          }
        }
      }
    }
  }, [touchedFields, setProductConfig, setHasQuantityBeenInteracted]);

  // Handle length unit change with smart calculation integration
  const handleLengthUnitChange = useCallback((newUnit: 'cm' | 'm') => {
    if (!productConfig.length) {
      setLengthUnit(newUnit);
      return;
    }
    
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
    
    // If smart calculation is available, use it
    if (handleSmartCalculation && getEffectiveQuantity) {
      setProductConfig(prev => {
        const updatedConfig = { ...prev, length: convertedLength };
        const smartResult = handleSmartCalculation('length', convertedLength, updatedConfig, newUnit, widthUnit, getEffectiveQuantity());
        return {
          ...updatedConfig,
          width: smartResult.width,
          squareMeters: smartResult.squareMeters
        };
      });
    } else {
      // Fallback: simple conversion
      setProductConfig(prev => ({ ...prev, length: convertedLength }));
    }
  }, [lengthUnit, widthUnit, productConfig.length, handleSmartCalculation, getEffectiveQuantity]);

  // Handle width unit change with smart calculation and validation
  const handleWidthUnitChange = useCallback((newUnit: 'cm' | 'm') => {
    if (!productConfig.width) {
      setWidthUnit(newUnit);
      return;
    }
    
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
    if (setErrors && selectedProductForValidation) {
      const originalWidth = (isEditModeForValidation && productConfig.originalWidth) 
        ? productConfig.originalWidth 
        : (selectedProductForValidation?.widthValue || 0);
      
      if (convertedWidth > 0 && originalWidth > 0) {
        const convertedWidthInCm = newUnit === 'm' ? convertedWidth * 100 : convertedWidth;
        if (convertedWidthInCm > originalWidth) {
          // Show error message
          setErrors({ 
            products: `عرض وارد شده (${convertedWidth}${newUnit === 'm' ? 'm' : 'cm'}) بیشتر از عرض اصلی سنگ (${originalWidth}cm) است. لطفاً عرضی کمتر یا مساوی با ${originalWidth}cm وارد کنید.` 
          });
        } else {
          // Clear error if width is valid after unit conversion
          if (errors?.products && errors.products.includes('عرض وارد شده')) {
            setErrors({});
          }
        }
      }
    }
    
    setWidthUnit(newUnit);
    
    // If smart calculation is available, use it
    if (handleSmartCalculation && getEffectiveQuantity) {
      setProductConfig(prev => {
        const updatedConfig = { ...prev, width: convertedWidth };
        const smartResult = handleSmartCalculation('width', convertedWidth, updatedConfig, lengthUnit, newUnit, getEffectiveQuantity());
        return {
          ...updatedConfig,
          length: smartResult.length,
          squareMeters: smartResult.squareMeters
        };
      });
    } else {
      // Fallback: simple conversion
      setProductConfig(prev => ({ ...prev, width: convertedWidth }));
    }
  }, [lengthUnit, widthUnit, productConfig.width, productConfig.originalWidth, handleSmartCalculation, getEffectiveQuantity, setErrors, errors, selectedProductForValidation, isEditModeForValidation]);

  // Reset all state
  const reset = useCallback(() => {
    closeModal();
  }, [closeModal]);

  return {
    // Modal visibility
    showProductModal,
    setShowProductModal,
    showCADDesigner,
    setShowCADDesigner,
    
    // Product selection
    selectedProduct,
    setSelectedProduct,
    productConfig,
    setProductConfig,
    
    // Units
    lengthUnit,
    setLengthUnit,
    widthUnit,
    setWidthUnit,
    
    // Mandatory pricing
    isMandatory,
    setIsMandatory,
    mandatoryPercentage,
    setMandatoryPercentage,
    
    // Edit mode
    isEditMode,
    setIsEditMode,
    editingProductIndex,
    setEditingProductIndex,
    
    // Interaction tracking
    hasQuantityBeenInteracted,
    setHasQuantityBeenInteracted,
    touchedFields,
    setTouchedFields,
    
    // Stair system (old flow)
    stairSystemConfig,
    setStairSystemConfig,
    quantityType,
    setQuantityType,
    treadExpanded,
    setTreadExpanded,
    riserExpanded,
    setRiserExpanded,
    landingExpanded,
    setLandingExpanded,
    
    // Stair part search terms
    treadProductSearchTerm,
    setTreadProductSearchTerm,
    riserProductSearchTerm,
    setRiserProductSearchTerm,
    landingProductSearchTerm,
    setLandingProductSearchTerm,
    
    // Handlers
    openModal,
    closeModal,
    handleFieldFocus,
    handleLengthUnitChange,
    handleWidthUnitChange,
    reset
  };
};

