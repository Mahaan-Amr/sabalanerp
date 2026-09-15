import React from 'react';
import { WizardNavigation } from '../components/shared/WizardNavigation';
import { partnerWizardSteps } from './PartnerContractWizard';

export function PartnerPreparationNavigation({
  step,
  pending,
  technicalReady,
  onPrevious,
  onNext,
}: {
  step: number;
  pending: boolean;
  technicalReady: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return <WizardNavigation currentStep={step} totalSteps={partnerWizardSteps.length}
    onPrevious={onPrevious} onNext={onNext} loading={pending}
    canGoPrevious={!pending && step > 1}
    canGoNext={!pending && (step !== 4 || technicalReady)}
    labels={{ next: step === 4 ? 'بررسی قیمت‌ها و ادامه' : 'بعدی' }} />;
}
