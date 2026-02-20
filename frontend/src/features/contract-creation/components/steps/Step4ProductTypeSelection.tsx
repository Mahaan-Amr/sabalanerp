// Step 4: Product Type Selection Component
// Product type selection (longitudinal, stair, slab)

import React from 'react';
import { FaCheck } from 'react-icons/fa';
import { FaRuler, FaSquare, FaThLarge } from 'react-icons/fa';
import type { ContractWizardData } from '../../types/contract.types';

const PRODUCT_TYPES = [
  {
    id: 'longitudinal',
    name: 'سنگ طولی',
    nameEn: 'Longitudinal Stone',
    icon: FaRuler,
    description: 'سنگ طولی با برش مستقیم',
    available: true
  },
  {
    id: 'stair',
    name: 'سنگ پله',
    nameEn: 'Stair Stone',
    icon: FaSquare,
    description: 'سنگ مخصوص پله',
    available: true
  },
  {
    id: 'slab',
    name: 'سنگ اسلب',
    nameEn: 'Slab Stone',
    icon: FaThLarge,
    description: 'سنگ اسلب با برش دو بعدی (طول و عرض)',
    available: true
  }
] as const;

interface Step4ProductTypeSelectionProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
}

export const Step4ProductTypeSelection: React.FC<Step4ProductTypeSelectionProps> = ({
  wizardData,
  updateWizardData,
  errors
}) => {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
          انتخاب نوع محصول
        </h3>
        <p className="text-gray-600 dark:text-gray-300">
          نوع محصولی که می‌خواهید اضافه کنید را انتخاب کنید
        </p>
      </div>
      
      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {PRODUCT_TYPES.map((type) => {
            const Icon = type.icon;
            const isSelected = wizardData.selectedProductTypeForAddition === type.id;
            const isComingSoon = !type.available;
            
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => {
                  if (isComingSoon) return;
                  updateWizardData({ selectedProductTypeForAddition: type.id as 'longitudinal' | 'stair' | 'slab' | null });
                }}
                disabled={isComingSoon}
                className={`relative p-6 rounded-xl border-2 transition-all duration-200 transform ${
                  isComingSoon ? 'cursor-not-allowed opacity-80 border-dashed' : 'hover:scale-105'
                } ${
                  isSelected
                      ? 'border-teal-500 bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-900/30 dark:to-teal-800/30 shadow-lg'
                      : 'border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm hover:border-teal-300 dark:hover:border-teal-600'
                }`}
              >
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                    isSelected
                      ? 'bg-teal-500 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}>
                    <Icon className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className={`text-lg font-semibold mb-1 ${
                      isSelected
                        ? 'text-teal-700 dark:text-teal-300'
                        : 'text-gray-800 dark:text-white'
                    }`}>
                      {type.name}
                    </h4>
                    <p className={`text-sm ${
                      isSelected
                        ? 'text-teal-600 dark:text-teal-400'
                        : 'text-gray-600 dark:text-gray-400'
                    }`}>
                      {type.description}
                    </p>
                  </div>
                  {isSelected && (
                    <div className="absolute top-4 left-4">
                      <div className="w-6 h-6 bg-teal-500 rounded-full flex items-center justify-center">
                        <FaCheck className="w-3 h-3 text-white" />
                      </div>
                    </div>
                  )}
                  {isComingSoon && (
                    <div className="absolute top-4 left-4">
                      <span className="px-3 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        به‌زودی
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        
        {errors.productType && (
          <p className="text-red-500 text-sm mt-4 text-center">{errors.productType}</p>
        )}
        
        {/* Show already added products grouped by type */}
        {wizardData.products.length > 0 && (
          <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-3">
              محصولات اضافه‌شده:
            </h4>
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set(wizardData.products.map(p => p.productType))).map(productType => {
                const typeInfo = PRODUCT_TYPES.find(t => t.id === productType);
                const count = wizardData.products.filter(p => p.productType === productType).length;
                return (
                  <span
                    key={productType}
                    className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 rounded-full text-sm"
                  >
                    {typeInfo?.name}: {count} عدد
                  </span>
                );
              })}
            </div>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
              برای افزودن محصول جدید، نوع محصول را انتخاب کنید
            </p>
          </div>
        )}
      </div>
    </div>
  );
};


