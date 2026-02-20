// Wizard Navigation Component
// Previous/Next buttons and step counter

import React from 'react';
import { FaArrowRight, FaArrowLeft, FaFileContract } from 'react-icons/fa';

interface WizardNavigationProps {
  currentStep: number;
  totalSteps: number;
  onPrevious: () => void;
  onNext: () => void;
  onSubmit?: () => void;
  loading?: boolean;
  canGoNext?: boolean;
  canGoPrevious?: boolean;
}

export const WizardNavigation: React.FC<WizardNavigationProps> = ({
  currentStep,
  totalSteps,
  onPrevious,
  onNext,
  onSubmit,
  loading = false,
  canGoNext = true,
  canGoPrevious = true
}) => {
  const isFirstStep = currentStep === 1;
  const isLastStep = currentStep === totalSteps;

  return (
    <div className="flex justify-between items-center relative z-0">
      <button
        onClick={onPrevious}
        disabled={isFirstStep || !canGoPrevious}
        className={`flex items-center gap-3 px-8 py-4 rounded-xl transition-all duration-300 transform ${
          isFirstStep || !canGoPrevious
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed border border-gray-200 dark:border-gray-700'
            : 'glass-liquid-btn hover:bg-white/80 dark:hover:bg-gray-800/80 hover:scale-105 hover:shadow-lg border border-gray-200/50 dark:border-gray-600/50'
        }`}
      >
        <FaArrowLeft className="w-4 h-4" />
        <span className="font-medium">قبلی</span>
      </button>

      <div className="text-center">
        <div className="bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm rounded-full px-6 py-3 border border-gray-200/50 dark:border-gray-600/50">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
            مرحله {currentStep} از {totalSteps}
          </span>
        </div>
      </div>

      {!isLastStep ? (
        <button
          onClick={onNext}
          disabled={!canGoNext}
          className="glass-liquid-btn-primary flex items-center gap-3 px-8 py-4 rounded-xl hover:scale-105 hover:shadow-lg transition-all duration-300 transform disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="font-medium">بعدی</span>
          <FaArrowRight className="w-4 h-4" />
        </button>
      ) : (
        <button
          onClick={onSubmit}
          disabled={loading || !canGoNext}
          className="glass-liquid-btn-primary flex items-center gap-3 px-8 py-4 rounded-xl hover:scale-105 hover:shadow-lg transition-all duration-300 transform disabled:hover:scale-100 disabled:hover:shadow-none disabled:opacity-50"
        >
          {loading ? (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
          ) : (
            <FaFileContract className="w-5 h-5" />
          )}
          <span className="font-medium">ثبت قرارداد</span>
        </button>
      )}
    </div>
  );
};


