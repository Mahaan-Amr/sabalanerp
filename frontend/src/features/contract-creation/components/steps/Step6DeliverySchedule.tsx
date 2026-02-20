// Step 6: Delivery Schedule Component
// Delivery schedule management

import React, { useCallback } from 'react';
import { FaPlus, FaTrash, FaChevronUp, FaChevronDown } from 'react-icons/fa';
import PersianCalendarComponent from '@/components/PersianCalendar';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import type { ContractWizardData, DeliverySchedule, DeliveryProductItem } from '../../types/contract.types';

interface Step6DeliveryScheduleProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
}

export const Step6DeliverySchedule: React.FC<Step6DeliveryScheduleProps> = ({
  wizardData,
  updateWizardData,
  errors
}) => {
  const handleAddDelivery = () => {
    const newDelivery: DeliverySchedule = {
      deliveryDate: '',
      projectManagerName: wizardData.project?.projectManagerName ?? '',
      receiverName: '',
      deliveryAddress: wizardData.project?.address || '',
      driver: '',
      vehicle: '',
      notes: '',
      products: []
    };
    updateWizardData({
      deliveries: [...wizardData.deliveries, newDelivery]
    });
  };

  const handleUpdateDelivery = (index: number, updates: Partial<DeliverySchedule>) => {
    const newDeliveries = [...wizardData.deliveries];
    newDeliveries[index] = { ...newDeliveries[index], ...updates };
    updateWizardData({ deliveries: newDeliveries });
  };

  const handleRemoveDelivery = (index: number) => {
    const newDeliveries = wizardData.deliveries.filter((_, i) => i !== index);
    updateWizardData({ deliveries: newDeliveries });
  };

  // Total quantity already assigned for a product across deliveries, optionally excluding one delivery
  const getTotalDeliveredForProduct = useCallback((productIndex: number, excludeDeliveryIndex?: number): number => {
    return wizardData.deliveries.reduce((sum, d, i) => {
      if (excludeDeliveryIndex !== undefined && i === excludeDeliveryIndex) return sum;
      const dp = d.products?.find(p => p.productIndex === productIndex);
      return sum + (dp?.quantity ?? 0);
    }, 0);
  }, [wizardData.deliveries]);

  const handleDeliveryProductQuantityChange = (deliveryIndex: number, productIndex: number, quantity: number, productId: string) => {
    const delivery = wizardData.deliveries[deliveryIndex];
    const current = delivery.products ?? [];
    const existing = current.find(p => p.productIndex === productIndex);
    let newProducts: DeliveryProductItem[];
    if (quantity <= 0) {
      newProducts = current.filter(p => p.productIndex !== productIndex);
    } else if (existing) {
      newProducts = current.map(p =>
        p.productIndex === productIndex ? { ...p, productId, quantity } : p
      );
    } else {
      newProducts = [...current, { productIndex, productId, quantity }];
    }
    handleUpdateDelivery(deliveryIndex, { products: newProducts });
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
          برنامه تحویل
        </h3>
        <p className="text-gray-600 dark:text-gray-300">
          برنامه تحویل را مشخص کنید
        </p>
      </div>
      
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h4 className="text-lg font-medium text-gray-800 dark:text-white">
            لیست تحویل‌ها
          </h4>
          <button
            onClick={handleAddDelivery}
            className="px-4 py-2 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white rounded-lg transition-all duration-200 font-medium flex items-center gap-2"
          >
            <FaPlus className="w-4 h-4" />
            افزودن تحویل
          </button>
        </div>

        {wizardData.deliveries.length === 0 ? (
          <div className="p-8 text-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              هنوز برنامه تحویلی ثبت نشده است
            </p>
            <button
              onClick={handleAddDelivery}
              className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
            >
              ایجاد برنامه تحویل
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {wizardData.deliveries.map((delivery, index) => (
              <div
                key={index}
                className="p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <div className="flex justify-between items-start mb-4">
                  <h5 className="font-semibold text-gray-800 dark:text-white">
                    تحویل {index + 1}
                  </h5>
                  <button
                    onClick={() => handleRemoveDelivery(index)}
                    className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    aria-label={`حذف تحویل ${index + 1}`}
                    title="حذف تحویل"
                  >
                    <FaTrash className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      تاریخ تحویل
                    </label>
                    <PersianCalendarComponent
                      value={delivery.deliveryDate}
                      onChange={(date: string) => handleUpdateDelivery(index, { deliveryDate: date })}
                      className="w-full"
                    />
                    {errors[`delivery_${index}_date`] && (
                      <p className="text-red-500 text-xs mt-1">{errors[`delivery_${index}_date`]}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      آدرس تحویل
                    </label>
                    <input
                      type="text"
                      value={delivery.deliveryAddress}
                      onChange={(e) => handleUpdateDelivery(index, { deliveryAddress: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                      placeholder="آدرس تحویل"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      نام مدیر پروژه
                    </label>
                    <input
                      type="text"
                      value={delivery.projectManagerName || ''}
                      onChange={(e) => handleUpdateDelivery(index, { projectManagerName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                      placeholder="نام مدیر پروژه"
                    />
                    {errors[`delivery_${index}_projectManager`] && (
                      <p className="text-red-500 text-xs mt-1">{errors[`delivery_${index}_projectManager`]}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      نام تحویل‌گیرنده
                    </label>
                    <input
                      type="text"
                      value={delivery.receiverName || ''}
                      onChange={(e) => handleUpdateDelivery(index, { receiverName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                      placeholder="نام تحویل‌گیرنده"
                    />
                    {errors[`delivery_${index}_receiver`] && (
                      <p className="text-red-500 text-xs mt-1">{errors[`delivery_${index}_receiver`]}</p>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    توضیحات (اختیاری)
                  </label>
                  <textarea
                    value={delivery.notes || ''}
                    onChange={(e) => handleUpdateDelivery(index, { notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                    rows={3}
                    placeholder="توضیحات مربوط به این تحویل"
                  />
                </div>

                {wizardData.products.length > 0 && (
                  <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                    <h6 className="text-sm font-semibold text-gray-800 dark:text-white mb-1">
                      محصولات این تحویل
                    </h6>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                      تعداد هر محصول را برای این تحویل مشخص کنید. مجموع تعدادها نباید از تعداد کل قرارداد بیشتر شود.
                    </p>
                    <div className="space-y-4">
                      {wizardData.products.map((product, productIndex) => {
                        const contractQty = product.quantity ?? 0;
                        const alreadyAssigned = getTotalDeliveredForProduct(productIndex, index);
                        const maxForThisDelivery = Math.max(0, contractQty - alreadyAssigned);
                        const currentQty = delivery.products?.find(p => p.productIndex === productIndex)?.quantity ?? 0;
                        const remaining = maxForThisDelivery;
                        const productLabel = product.stoneName || product.product?.namePersian || `محصول ${productIndex + 1}`;
                        const setQty = (value: number) => handleDeliveryProductQuantityChange(index, productIndex, Math.max(0, Math.min(maxForThisDelivery, value)), product.productId);
                        return (
                          <div
                            key={productIndex}
                            className="p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/50 space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm font-medium text-gray-800 dark:text-white">
                                {productLabel}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setQty(currentQty - 1)}
                                  disabled={currentQty <= 0}
                                  className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                  aria-label="کم کردن"
                                >
                                  <FaChevronDown className="w-3.5 h-3.5" />
                                </button>
                                <FormattedNumberInput
                                  value={currentQty}
                                  onChange={(value) => handleDeliveryProductQuantityChange(index, productIndex, value, product.productId)}
                                  min={0}
                                  max={maxForThisDelivery}
                                  className="w-20 px-2 py-1.5 text-sm text-center border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => setQty(currentQty + 1)}
                                  disabled={currentQty >= maxForThisDelivery}
                                  className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                  aria-label="زیاد کردن"
                                >
                                  <FaChevronUp className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs">
                              <span className="text-gray-500 dark:text-gray-400">
                                کل قرارداد: <strong className="text-gray-700 dark:text-gray-300">{contractQty}</strong>
                              </span>
                              <span className="text-gray-500 dark:text-gray-400">
                                ارسال‌شده در تحویل‌های دیگر: <strong className="text-gray-700 dark:text-gray-300">{alreadyAssigned}</strong>
                              </span>
                              <span className="text-teal-600 dark:text-teal-400 font-medium">
                                مانده: <strong>{remaining}</strong>
                              </span>
                              {remaining > 0 && currentQty < remaining && (
                                <button
                                  type="button"
                                  onClick={() => setQty(remaining)}
                                  className="text-teal-600 dark:text-teal-400 hover:underline font-medium"
                                >
                                  پر کردن ({remaining})
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {errors[`delivery_${index}_products`] && (
                      <p className="text-red-500 text-sm mt-2">{errors[`delivery_${index}_products`]}</p>
                    )}
                  </div>
                )}

                {errors[`delivery_${index}_products`] && !wizardData.products.length && (
                  <p className="text-red-500 text-sm mt-2">{errors[`delivery_${index}_products`]}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {errors.deliveries && (
          <p className="text-red-500 text-sm mt-2">{errors.deliveries}</p>
        )}
      </div>
    </div>
  );
};


