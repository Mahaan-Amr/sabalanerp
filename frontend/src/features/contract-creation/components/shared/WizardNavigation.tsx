import React from 'react';
import { FaArrowLeft, FaArrowRight, FaFileContract } from 'react-icons/fa';
import { ErpPressable } from '@/components/erp';

interface WizardNavigationProps {
  currentStep: number;
  totalSteps: number;
  onPrevious: () => void;
  onNext: () => void;
  onSubmit?: () => void;
  loading?: boolean;
  canGoNext?: boolean;
  canGoPrevious?: boolean;
  showSubmitOnEveryStep?: boolean;
  labels?: {
    previous?: string;
    next?: string;
    submit?: string;
    submitting?: string;
  };
}

export const WizardNavigation: React.FC<WizardNavigationProps> = ({
  currentStep,
  totalSteps,
  onPrevious,
  onNext,
  onSubmit,
  loading = false,
  canGoNext = true,
  canGoPrevious = true,
  labels,
  showSubmitOnEveryStep = false
}) => {
  const first = currentStep === 1;
  const submit = currentStep === totalSteps || showSubmitOnEveryStep;
  const previousLabel = labels?.previous ?? 'قبلی';
  const nextLabel = labels?.next ?? 'بعدی';
  const submitLabel = labels?.submit ?? 'ثبت قرارداد';

  return (
    <div className="sds-workspace-surface relative z-0 flex flex-wrap items-center justify-between gap-3 p-3">
      <ErpPressable
        type="button"
        onClick={submit ? onSubmit : onNext}
        disabled={loading || !canGoNext}
        aria-busy={loading}
        tone="primary"
        variant="solid"
        className="min-w-32 gap-2 px-5"
      >
        {loading ? (
          <span className="h-5 w-5 animate-spin rounded-full border-b-2 border-[var(--sds-text-inverse)] motion-reduce:animate-none" />
        ) : submit ? (
          <FaFileContract className="h-4 w-4" />
        ) : (
          <FaArrowLeft className="h-4 w-4" />
        )}
        <span>{loading ? labels?.submitting ?? submitLabel : submit ? submitLabel : nextLabel}</span>
      </ErpPressable>

      <span className="sds-text-muted order-3 w-full text-center text-xs sm:order-none sm:w-auto">
        مرحله {currentStep.toLocaleString('fa-IR')} از {totalSteps.toLocaleString('fa-IR')}
      </span>

      <ErpPressable
        type="button"
        onClick={onPrevious}
        disabled={first || !canGoPrevious}
        variant="ghost"
        className="min-w-28 gap-2 px-4"
      >
        <FaArrowRight className="h-4 w-4" />
        <span>{previousLabel}</span>
      </ErpPressable>
    </div>
  );
};
