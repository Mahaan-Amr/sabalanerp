// Step 6: Delivery Schedule Component
// Delivery schedule management

import React from 'react';
import { FaPlus, FaTrash, FaEdit } from 'react-icons/fa';
import PersianCalendarComponent from '@/components/PersianCalendar';
import type { ContractWizardData, DeliverySchedule } from '../../types/contract.types';

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
      projectManagerName: '',
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

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
          برنامه تحویل
        </h3>
        <p className="text-gray-600 dark:text-gray-300">
          تعیین تاریخ و آدرس تحویل
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
            افزودن تحویل جدید
          </button>
        </div>

        {wizardData.deliveries.length === 0 ? (
          <div className="p-8 text-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              هیچ تحویلی اضافه نشده است
            </p>
            <button
              onClick={handleAddDelivery}
              className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
            >
              افزودن اولین تحویل
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
                      راننده (اختیاری)
                    </label>
                    <input
                      type="text"
                      value={delivery.driver || ''}
                      onChange={(e) => handleUpdateDelivery(index, { driver: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                      placeholder="نام راننده"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      وسیله نقلیه (اختیاری)
                    </label>
                    <input
                      type="text"
                      value={delivery.vehicle || ''}
                      onChange={(e) => handleUpdateDelivery(index, { vehicle: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                      placeholder="شماره پلاک یا نوع وسیله"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    یادداشت (اختیاری)
                  </label>
                  <textarea
                    value={delivery.notes || ''}
                    onChange={(e) => handleUpdateDelivery(index, { notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                    rows={3}
                    placeholder="یادداشت‌های مربوط به این تحویل"
                  />
                </div>

                {delivery.products && delivery.products.length > 0 && (
                  <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {delivery.products.length} محصول در این تحویل
                    </p>
                  </div>
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

