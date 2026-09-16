// Step 1: Contract Date Component
// Contract date selection and contract number display

import React from 'react';
import PersianCalendarComponent from '@/components/PersianCalendar';
import type { ContractWizardData } from '../../types/contract.types';
import { ContractDateStepView } from '../shared/ContractWizardStepViews';

interface Step1ContractDateProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
  currentUser?: {
    firstName: string;
    lastName: string;
  };
}

export const Step1ContractDate: React.FC<Step1ContractDateProps> = ({
  wizardData,
  updateWizardData,
  errors,
  currentUser
}) => {
  return <ContractDateStepView
    creatorName={currentUser ? `${currentUser.firstName} ${currentUser.lastName}` : undefined}
    dateControl={
        <PersianCalendarComponent
          value={wizardData.contractDate}
          onChange={(date: string) => updateWizardData({ contractDate: date })}
          className="w-full"
          disablePastDates
        />
    }
    error={errors.contractDate}
    numberPreview={wizardData.contractNumber}
    numberNotice="شماره نهایی هنگام ثبت قرارداد در سرور قطعی می‌شود."
  />;
};
