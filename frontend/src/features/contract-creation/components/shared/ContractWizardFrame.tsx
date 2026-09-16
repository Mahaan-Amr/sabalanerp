'use client';

import React from 'react';
import { ErpNeumorphicCard, ErpNeumorphicWorkflowLayout } from '@/components/erp';
import { WizardNavigation } from './WizardNavigation';
import { WizardProgressBar, type WizardStep } from './WizardProgressBar';

type NavigationProps = Omit<React.ComponentProps<typeof WizardNavigation>, 'currentStep' | 'totalSteps'>;

export interface ContractWizardFrameProps {
  title: React.ReactNode;
  currentStep: number;
  navigationStep?: number;
  steps: WizardStep[];
  navigation: NavigationProps;
  notices?: React.ReactNode;
  afterNavigation?: React.ReactNode;
  clickableSteps?: boolean;
  onStepClick?: (step: number) => void;
  children: React.ReactNode;
}

type ContractWizardStageProps = Omit<
  ContractWizardFrameProps,
  'title' | 'afterNavigation'
>;

export function ContractWizardStage({
  currentStep,
  navigationStep = currentStep,
  steps,
  navigation,
  notices,
  clickableSteps = false,
  onStepClick,
  children,
}: ContractWizardStageProps) {
  return (
    <>
      <WizardProgressBar
        currentStep={currentStep}
        steps={steps}
        clickable={clickableSteps}
        onStepClick={onStepClick}
      />
      {notices}
      <ErpNeumorphicCard className="step-content-card relative z-0 mb-6 p-4 sm:mb-8 sm:p-6 lg:p-8">
        {children}
      </ErpNeumorphicCard>
      <WizardNavigation
        {...navigation}
        currentStep={navigationStep}
        totalSteps={steps.length}
      />
    </>
  );
}

export function ContractWizardFrame({
  title,
  currentStep,
  navigationStep,
  steps,
  navigation,
  notices,
  afterNavigation,
  clickableSteps = false,
  onStepClick,
  children,
}: ContractWizardFrameProps) {
  return (
    <ErpNeumorphicWorkflowLayout title={title}>
      <ContractWizardStage
        currentStep={currentStep}
        navigationStep={navigationStep}
        steps={steps}
        navigation={navigation}
        notices={notices}
        clickableSteps={clickableSteps}
        onStepClick={onStepClick}
      >
        {children}
      </ContractWizardStage>
      {afterNavigation}
    </ErpNeumorphicWorkflowLayout>
  );
}
