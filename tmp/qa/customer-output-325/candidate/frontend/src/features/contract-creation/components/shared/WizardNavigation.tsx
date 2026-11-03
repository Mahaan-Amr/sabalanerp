import React from 'react';
import { FaArrowLeft, FaArrowRight, FaFileContract } from 'react-icons/fa';
import { ErpNeumorphicWorkflowNavigation } from '@/components/erp';

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
  const primaryLabel = loading
    ? labels?.submitting ?? submitLabel
    : submit
      ? submitLabel
      : nextLabel;
  const PrimaryIcon = submit ? FaFileContract : FaArrowLeft;

  return (
    <ErpNeumorphicWorkflowNavigation
      primaryLabel={primaryLabel}
      previousLabel={previousLabel}
      counterLabel={`مرحله ${currentStep.toLocaleString('fa-IR')} از ${totalSteps.toLocaleString('fa-IR')}`}
      primaryIcon={PrimaryIcon}
      previousIcon={FaArrowRight}
      onPrimary={submit ? () => onSubmit?.() : onNext}
      onPrevious={onPrevious}
      primaryDisabled={!canGoNext}
      previousDisabled={first || !canGoPrevious}
      pending={loading}
    />
  );
};
