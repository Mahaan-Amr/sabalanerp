// Stair System Modal Component
// Stair system configuration

import React from 'react';
import { FaTimes } from 'react-icons/fa';
import type { ContractWizardData } from '../../types/contract.types';

interface StairSystemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  draftTread?: any;
  draftRiser?: any;
  draftLanding?: any;
  stairActivePart?: 'tread' | 'riser' | 'landing';
  setStairActivePart?: (part: 'tread' | 'riser' | 'landing') => void;
}

export const StairSystemModal: React.FC<StairSystemModalProps> = ({
  isOpen,
  onClose,
  onSave,
  wizardData,
  updateWizardData,
  draftTread,
  draftRiser,
  draftLanding,
  stairActivePart,
  setStairActivePart
}) => {
  if (!isOpen) return null;

  // This is a placeholder modal - the full implementation would include:
  // - Part selection (tread/riser/landing)
  // - Stone selection for each part
  // - Dimension configuration
  // - Tools/sub-services
  // - Layer management
  // - Complex stair calculation logic

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto m-4">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
            پیکربندی سیستم پله
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <FaTimes className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6">
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            این یک نسخه ساده از مودال پیکربندی سیستم پله است. پیاده‌سازی کامل شامل تمام منطق محاسباتی پله خواهد بود.
          </p>
          
          {/* Placeholder for stair system configuration */}
          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => setStairActivePart?.('tread')}
                className={`px-4 py-2 rounded-lg ${
                  stairActivePart === 'tread' 
                    ? 'bg-teal-500 text-white' 
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                پاگرد
              </button>
              <button
                onClick={() => setStairActivePart?.('riser')}
                className={`px-4 py-2 rounded-lg ${
                  stairActivePart === 'riser' 
                    ? 'bg-teal-500 text-white' 
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                پله
              </button>
              <button
                onClick={() => setStairActivePart?.('landing')}
                className={`px-4 py-2 rounded-lg ${
                  stairActivePart === 'landing' 
                    ? 'bg-teal-500 text-white' 
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                فرود
              </button>
            </div>
          </div>
        </div>
        
        <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            انصراف
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600"
          >
            ذخیره
          </button>
        </div>
      </div>
    </div>
  );
};

