// Main contract wizard hook
// Manages wizard state, navigation, and validation

import { useState, useCallback, useMemo, useRef } from 'react';
import type { ContractWizardData } from '../types/contract.types';
import { validateWizardStep } from '../services/validationService';
import PersianCalendar from '@/lib/persian-calendar';

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

export const WIZARD_STEPS = [
  {
    id: 1,
    title: 'تاریخ قرارداد',
    titleEn: 'Contract Date',
    description: 'تاریخ قرارداد را تعیین کنید'
  },
  {
    id: 2,
    title: 'انتخاب مشتری',
    titleEn: 'Customer Selection',
    description: 'مشتری را از CRM انتخاب کنید'
  },
  {
    id: 3,
    title: 'مدیریت پروژه',
    titleEn: 'Project Management',
    description: 'پروژه را انتخاب یا ایجاد کنید'
  },
  {
    id: 4,
    title: 'انتخاب نوع محصول',
    titleEn: 'Product Type Selection',
    description: 'نوع محصول را مشخص کنید'
  },
  {
    id: 5,
    title: 'انتخاب محصولات',
    titleEn: 'Product Selection',
    description: 'محصولات را به قرارداد اضافه کنید'
  },
  {
    id: 6,
    title: 'برنامه تحویل',
    titleEn: 'Delivery Schedule',
    description: 'زمان‌بندی تحویل را ثبت کنید'
  },
  {
    id: 7,
    title: 'روش پرداخت',
    titleEn: 'Payment Method',
    description: 'اقلام پرداخت را تعریف کنید'
  },
  {
    id: 8,
    title: 'تایید دیجیتال',
    titleEn: 'Digital Confirmation',
    description: 'تایید نهایی قرارداد'
  }
] as const;

const getInitialWizardData = (): ContractWizardData => ({
  contractDate: getCurrentPersianDate(),
  contractNumber: '',
  customerId: '',
  customer: null,
  projectId: '',
  project: null,
  selectedProductTypeForAddition: null,
  products: [],
  deliveries: [],
  payment: {
    payments: [],
    currency: 'تومان',
    totalContractAmount: 0
  },
  signature: null
});

export const useContractWizard = () => {
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState<ContractWizardData>(getInitialWizardData());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  
  // Search terms
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [productSearchTerm, setProductSearchTerm] = useState('');
  
  // State restoration tracking
  const [stateRestored, setStateRestored] = useState(false);
  const restorationAttempted = useRef(false);

  // Get current step info
  const currentStepInfo = useMemo(() => {
    return WIZARD_STEPS.find(step => step.id === currentStep) || WIZARD_STEPS[0];
  }, [currentStep]);

  // Check if can go to next step
  const canGoNext = useCallback(() => {
    const validation = validateWizardStep(currentStep, wizardData);
    return validation.isValid;
  }, [currentStep, wizardData]);

  // Check if can go to previous step
  const canGoPrevious = useCallback(() => {
    return currentStep > 1;
  }, [currentStep]);

  // Go to next step
  const goToNextStep = useCallback(() => {
    if (!canGoNext()) {
      const validation = validateWizardStep(currentStep, wizardData);
      setErrors(validation.errors);
      return false;
    }
    
    if (currentStep < WIZARD_STEPS.length) {
      setCurrentStep(currentStep + 1);
      setErrors({});
      return true;
    }
    return false;
  }, [currentStep, wizardData, canGoNext]);

  // Go to previous step
  const goToPreviousStep = useCallback(() => {
    if (canGoPrevious()) {
      setCurrentStep(currentStep - 1);
      setErrors({});
      return true;
    }
    return false;
  }, [currentStep, canGoPrevious]);

  // Go to specific step
  const goToStep = useCallback((step: number) => {
    if (step >= 1 && step <= WIZARD_STEPS.length) {
      setCurrentStep(step);
      setErrors({});
      return true;
    }
    return false;
  }, []);

  // Update wizard data
  const updateWizardData = useCallback((updates: Partial<ContractWizardData>) => {
    setWizardData(prev => ({ ...prev, ...updates }));
  }, []);

  // Validate current step
  const validateCurrentStep = useCallback(() => {
    const validation = validateWizardStep(currentStep, wizardData);
    setErrors(validation.errors);
    return validation.isValid;
  }, [currentStep, wizardData]);

  // Reset wizard
  const resetWizard = useCallback(() => {
    setCurrentStep(1);
    setWizardData(getInitialWizardData());
    setErrors({});
    setLoading(false);
    setCustomerSearchTerm('');
    setProductSearchTerm('');
    setStateRestored(false);
    restorationAttempted.current = false;
  }, []);

  // Calculate contract total
  const contractTotal = useMemo(() => {
    return wizardData.products.reduce((sum, product) => sum + (product.totalPrice || 0), 0);
  }, [wizardData.products]);

  // Update payment total
  const updatePaymentTotal = useCallback(() => {
    setWizardData(prev => ({
      ...prev,
      payment: {
        ...prev.payment,
        totalContractAmount: contractTotal
      }
    }));
  }, [contractTotal]);

  return {
    // State
    currentStep,
    wizardData,
    errors,
    loading,
    currentStepInfo,
    contractTotal,
    customerSearchTerm,
    productSearchTerm,
    stateRestored,
    restorationAttempted,
    
    // Actions
    setCurrentStep,
    setWizardData,
    updateWizardData,
    setErrors,
    setLoading,
    setCustomerSearchTerm,
    setProductSearchTerm,
    setStateRestored,
    goToNextStep,
    goToPreviousStep,
    goToStep,
    validateCurrentStep,
    resetWizard,
    updatePaymentTotal,
    
    // Computed
    canGoNext,
    canGoPrevious,
    isFirstStep: currentStep === 1,
    isLastStep: currentStep === WIZARD_STEPS.length,
    totalSteps: WIZARD_STEPS.length
  };
};


