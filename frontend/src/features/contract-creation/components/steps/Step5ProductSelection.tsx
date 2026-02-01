// Step 5: Product Selection Component
// Product search, selection, and configuration

import React from 'react';
import { FaSearch, FaPlus, FaCheck, FaEdit, FaTrash } from 'react-icons/fa';
import { useRouter } from 'next/navigation';
import { formatPrice, formatSquareMeters, formatQuantity } from '@/lib/numberFormat';
import { generateFullProductName } from '../../utils/productUtils';
import type { ContractWizardData, Product, ContractProduct } from '../../types/contract.types';

const PRODUCT_TYPES = [
  {
    id: 'longitudinal',
    name: 'سنگ طولی',
    nameEn: 'Longitudinal Stone',
  },
  {
    id: 'stair',
    name: 'سنگ پله',
    nameEn: 'Stair Stone',
  },
  {
    id: 'slab',
    name: 'سنگ اسلب',
    nameEn: 'Slab Stone',
  },
] as const;

interface Step5ProductSelectionProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
  productSearchTerm: string;
  setProductSearchTerm: (term: string) => void;
  products: Product[];
  filteredProducts: Product[];
  handleProductSelection: (product: Product) => void;
  setShowProductModal: (show: boolean) => void;
  setSelectedProductForConfiguration: (product: Product | null) => void;
  setSelectedProductIndexForEdit: (index: number | null) => void;
  handleRemoveProduct: (index: number) => void;
  currentStep: number;
  productsSummary: {
    totalPrice: number;
    totalSquareMeters: number;
    totalQuantity: number;
  };
}

export const Step5ProductSelection: React.FC<Step5ProductSelectionProps> = ({
  wizardData,
  updateWizardData,
  errors,
  productSearchTerm,
  setProductSearchTerm,
  products,
  filteredProducts,
  handleProductSelection,
  setShowProductModal,
  setSelectedProductForConfiguration,
  setSelectedProductIndexForEdit,
  handleRemoveProduct,
  currentStep,
  productsSummary
}) => {
  const router = useRouter();
  const selectedProductType = wizardData.selectedProductTypeForAddition;

  if (!selectedProductType) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <p className="text-red-500">لطفاً ابتدا نوع محصول را انتخاب کنید</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
          انتخاب محصولات ({PRODUCT_TYPES.find(t => t.id === selectedProductType)?.name})
        </h3>
        <p className="text-gray-600 dark:text-gray-300">
          محصولات را از کاتالوگ انتخاب کنید
        </p>
      </div>
      
      <div className="max-w-4xl mx-auto">
        {/* Search Input */}
        <div className="relative mb-6">
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <FaSearch className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="جستجو در تمام فیلدها: کد، نام، نوع برش، جنس سنگ، ابعاد، معدن، پرداخت، رنگ، کیفیت، قیمت..."
            value={productSearchTerm}
            onChange={(e) => setProductSearchTerm(e.target.value)}
            className="w-full pr-10 pl-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>

        {/* Quick Create Product Button */}
        <div className="mb-6">
          <button
            type="button"
            onClick={() => {
              localStorage.setItem('contractWizardState', JSON.stringify({
                currentStep: currentStep,
                wizardData: wizardData
              }));
              router.push(`/dashboard/sales/products/create?returnTo=contract&step=${currentStep}`);
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
          >
            <FaPlus className="h-4 w-4" />
            <span className="font-medium">ایجاد محصول جدید</span>
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
            محصول مورد نظر را پیدا نکردید؟ محصول جدید ایجاد کنید
          </p>
        </div>
        
        {filteredProducts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400 text-lg">
              {productSearchTerm ? 'هیچ محصولی با این جستجو یافت نشد' : 'لطفاً در کادر جستجو تایپ کنید تا محصولات نمایش داده شوند'}
            </p>
          </div>
        ) : (
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl border border-white/20 dark:border-slate-700/50 overflow-hidden isolate" style={{ contain: 'layout style paint' }}>
            <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
              <table className="w-full border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-700/50">
                  <tr>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">نام کامل محصول</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">نام محصول</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">ابعاد</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">معدن</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">پرداخت</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">قیمت</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => (
                    <tr
                      key={product.id}
                      onClick={() => handleProductSelection(product)}
                      className="cursor-pointer border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors duration-150"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleProductSelection(product);
                        }
                      }}
                      aria-label={`انتخاب محصول ${product.namePersian || product.name}`}
                    >
                      <td className="py-4 px-6 min-w-[200px] max-w-[300px]">
                        <div className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed break-words">
                          {generateFullProductName(product)}
                        </div>
                      </td>
                      <td className="py-4 px-6 min-w-[150px]">
                        <div className="font-medium text-slate-800 dark:text-slate-200 break-words">
                          {product.namePersian}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400 break-words">
                          {product.stoneTypeNamePersian}
                        </div>
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        <div className="text-slate-800 dark:text-slate-200 font-medium">
                          عرض {product.widthValue} × ضخامت {product.thicknessValue} سانتی‌متر
                        </div>
                      </td>
                      <td className="py-4 px-6 min-w-[120px]">
                        <div className="text-slate-800 dark:text-slate-200 font-medium break-words">
                          {product.mineNamePersian}
                        </div>
                      </td>
                      <td className="py-4 px-6 min-w-[100px]">
                        <div className="text-slate-800 dark:text-slate-200 font-medium break-words">
                          {product.finishNamePersian}
                        </div>
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        <div className="text-slate-800 dark:text-slate-200 font-medium">
                          {product.basePrice ? (
                            <span className="text-teal-600 dark:text-teal-400 font-bold">
                              {formatPrice(product.basePrice, product.currency)}
                            </span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">
                              قیمت تعیین نشده
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleProductSelection(product);
                          }}
                          className="px-4 py-2 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-lg hover:from-teal-600 hover:to-teal-700 transition-colors duration-150 font-medium text-sm"
                        >
                          <span className="flex items-center justify-center gap-2">
                            <FaPlus className="w-3 h-3" />
                            افزودن
                          </span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {wizardData.products.length > 0 && (
          <div className="mt-8 p-6 bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-900/20 dark:to-teal-800/20 rounded-xl border border-teal-200 dark:border-teal-800">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-teal-500 rounded-full flex items-center justify-center">
                <FaCheck className="w-4 h-4 text-white" />
              </div>
              <h4 className="font-semibold text-gray-800 dark:text-white text-lg">محصولات انتخاب شده</h4>
              <span className="bg-teal-500 text-white px-3 py-1 rounded-full text-sm font-medium">
                {wizardData.products.length} محصول
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-white dark:bg-gray-900/30 rounded-lg border border-teal-200 dark:border-teal-800 shadow-sm">
                <p className="text-xs text-teal-600 dark:text-teal-300 mb-1">قیمت کل قرارداد</p>
                <p className="text-xl font-semibold text-teal-700 dark:text-teal-200">
                  {formatPrice(productsSummary.totalPrice, 'تومان')}
                </p>
              </div>
              <div className="p-4 bg-white dark:bg-gray-900/30 rounded-lg border border-blue-200 dark:border-blue-800 shadow-sm">
                <p className="text-xs text-blue-600 dark:text-blue-300 mb-1">متر مربع کل</p>
                <p className="text-xl font-semibold text-blue-700 dark:text-blue-200">
                  {formatSquareMeters(productsSummary.totalSquareMeters)}
                </p>
              </div>
              <div className="p-4 bg-white dark:bg-gray-900/30 rounded-lg border border-purple-200 dark:border-purple-800 shadow-sm">
                <p className="text-xs text-purple-600 dark:text-purple-300 mb-1">تعداد کل قطعات</p>
                <p className="text-xl font-semibold text-purple-700 dark:text-purple-200">
                  {formatQuantity(productsSummary.totalQuantity)}
                </p>
              </div>
            </div>
            
            {/* Selected Products List */}
            <div className="space-y-3">
              {wizardData.products.map((product, index) => (
                <div
                  key={index}
                  className="p-4 bg-white dark:bg-gray-900/30 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h5 className="font-medium text-gray-800 dark:text-white mb-2">
                        {product.stoneName || `محصول ${index + 1}`}
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">تعداد: </span>
                          <span className="font-medium text-gray-700 dark:text-gray-300">{product.quantity}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">متر مربع: </span>
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            {formatSquareMeters(product.squareMeters || 0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">قیمت واحد: </span>
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            {formatPrice(product.unitPrice || 0, 'تومان')}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">قیمت کل: </span>
                          <span className="font-medium text-teal-600 dark:text-teal-400">
                            {formatPrice(product.totalPrice || 0, 'تومان')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => {
                          setSelectedProductIndexForEdit(index);
                          setSelectedProductForConfiguration(product as any);
                          setShowProductModal(true);
                        }}
                        className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        title="ویرایش"
                      >
                        <FaEdit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemoveProduct(index)}
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        title="حذف"
                      >
                        <FaTrash className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

