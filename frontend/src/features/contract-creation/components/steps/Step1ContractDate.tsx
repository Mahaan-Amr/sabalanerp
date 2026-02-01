// Step 1: Contract Date Component
// Contract date selection and contract number display

import React from 'react';
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
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
          انتخاب تاریخ قرارداد
        </h3>
        <p className="text-gray-600 dark:text-gray-300">
          تاریخ قرارداد را انتخاب کنید
        </p>
      </div>
      
      {/* Display current user's full English name */}
      {currentUser && (
        <div className="max-w-md mx-auto">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            کاربر ایجاد کننده
          </label>
          <div className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium">
            {currentUser.firstName} {currentUser.lastName}
          </div>
        </div>
      )}
      
      <div className="max-w-md mx-auto">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          تاریخ قرارداد
        </label>
        <PersianCalendarComponent
          value={wizardData.contractDate}
          onChange={(date: string) => updateWizardData({ contractDate: date })}
          className="w-full"
        />
        {errors.contractDate && (
          <p className="text-red-500 text-sm mt-1">{errors.contractDate}</p>
        )}
      </div>
      
      <div className="max-w-md mx-auto">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          شماره قرارداد
        </label>
        <input
          type="text"
          value={wizardData.contractNumber}
          readOnly
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
        />
      </div>
    </div>
  );
};

