// Step 1: Contract Date Component
// Contract date selection and contract number display

import React from 'react';
import { ErpInput } from '@/components/erp';
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
    <div className="space-y-6">
      {/* Display current user's full English name */}
      {currentUser && (
        <div className="max-w-md mx-auto">
          <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
            کاربر ایجادکننده
          </label>
          <div className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-secondary)] font-medium">
            {currentUser.firstName} {currentUser.lastName}
          </div>
        </div>
      )}
      
      <div className="max-w-md mx-auto">
        <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
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
      
      <div className="max-w-md mx-auto">
        <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
          پیش‌نمایش شماره احتمالی قرارداد
        </label>
        <ErpInput
          type="text"
          value={wizardData.contractNumber}
          readOnly
          className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-lg bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]"
        />
        <p className="text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)] mt-1">
          شماره نهایی هنگام ثبت قرارداد در سرور قطعی می‌شود.
        </p>
      </div>
    </div>
  );
};


