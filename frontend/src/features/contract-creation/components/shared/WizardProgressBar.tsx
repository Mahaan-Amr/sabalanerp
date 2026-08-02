import React from 'react';
import { ErpNeumorphicWorkflowProgress } from '@/components/erp';

export interface WizardStep {
  id: number;
  title: string;
  titleEn: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

interface WizardProgressBarProps {
  currentStep: number;
  steps: WizardStep[];
  onStepClick?: (step: number) => void;
  clickable?: boolean;
}

export const WizardProgressBar: React.FC<WizardProgressBarProps> = ({
  currentStep,
  steps,
  onStepClick,
  clickable = false
}) => {
  return (
    <ErpNeumorphicWorkflowProgress
      currentStep={currentStep}
      steps={steps.map((step) => ({ id: step.id, label: step.title, icon: step.icon }))}
      ariaLabel="مراحل ایجاد قرارداد"
      clickable={clickable}
      onStepClick={onStepClick}
    />
  );
};
