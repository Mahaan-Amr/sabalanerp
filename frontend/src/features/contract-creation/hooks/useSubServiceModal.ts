// useSubServiceModal Hook
// Manages sub-service modal state and handlers

import { useState, useCallback } from 'react';
import type { SubService } from '../types/contract.types';

interface UseSubServiceModalOptions {
  setErrors: (errors: Record<string, string>) => void;
}

export const useSubServiceModal = (options: UseSubServiceModalOptions) => {
  const { setErrors } = options;

  // Modal visibility
  const [showSubServiceModal, setShowSubServiceModal] = useState(false);
  const [selectedSubServiceProductIndex, setSelectedSubServiceProductIndex] = useState<number | null>(null);

  // Selected sub-services and their configuration
  const [selectedSubServices, setSelectedSubServices] = useState<SubService[]>([]);
  const [subServiceMeterValues, setSubServiceMeterValues] = useState<Record<string, number>>({});
  const [subServiceCalculationBases, setSubServiceCalculationBases] = useState<Record<string, 'length' | 'squareMeters'>>({});

  // Handler to open modal for a specific product
  const openModal = useCallback((productIndex: number) => {
    setSelectedSubServiceProductIndex(productIndex);
    setShowSubServiceModal(true);
    // Reset state when opening
    setSelectedSubServices([]);
    setSubServiceMeterValues({});
    setSubServiceCalculationBases({});
    setErrors({});
  }, [setErrors]);

  // Handler to close modal and reset state
  const closeModal = useCallback(() => {
    setShowSubServiceModal(false);
    setSelectedSubServiceProductIndex(null);
    setSelectedSubServices([]);
    setSubServiceMeterValues({});
    setSubServiceCalculationBases({});
    setErrors({});
  }, [setErrors]);

  return {
    // Modal state
    showSubServiceModal,
    setShowSubServiceModal,
    selectedSubServiceProductIndex,
    setSelectedSubServiceProductIndex,
    
    // Selected sub-services
    selectedSubServices,
    setSelectedSubServices,
    subServiceMeterValues,
    setSubServiceMeterValues,
    subServiceCalculationBases,
    setSubServiceCalculationBases,
    
    // Handlers
    openModal,
    closeModal
  };
};

