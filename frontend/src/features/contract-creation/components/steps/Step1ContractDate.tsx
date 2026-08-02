// Step 1: Contract Date Component
// Contract date selection and contract number display

import React from 'react';
import { ErpInput, ErpNeumorphicCard, erpFieldLabelClassName } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import type { ContractWizardData } from '../../types/contract.types';

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
  return (
    <div className="mx-auto max-w-md space-y-6">
      {/* Display current user's full English name */}
      {currentUser && (
        <div>
          <label className={erpFieldLabelClassName}>
            کاربر ایجادکننده
          </label>
          <ErpNeumorphicCard as="div" className="w-full px-4 py-3 font-medium text-[var(--sds-text-primary)]">
            {currentUser.firstName} {currentUser.lastName}
          </ErpNeumorphicCard>
        </div>
      )}
      
      <div>
        <label className={erpFieldLabelClassName}>
          تاریخ قرارداد
        </label>
        <PersianCalendarComponent
          value={wizardData.contractDate}
          onChange={(date: string) => updateWizardData({ contractDate: date })}
          className="w-full"
          disablePastDates
        />
        {errors.contractDate && (
          <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.contractDate}</p>
        )}
      </div>
      
      <div>
        <label className={erpFieldLabelClassName}>
          پیش‌نمایش شماره احتمالی قرارداد
        </label>
        <ErpInput
          type="text"
          value={wizardData.contractNumber}
          readOnly
          className="w-full"
        />
        <p className="mt-2 text-xs text-[var(--sds-text-muted)]">
          شماره نهایی هنگام ثبت قرارداد در سرور قطعی می‌شود.
        </p>
      </div>
    </div>
  );
};
