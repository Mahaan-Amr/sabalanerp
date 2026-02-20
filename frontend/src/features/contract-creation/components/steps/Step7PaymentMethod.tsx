// Step 7: Payment Method Component
// Payment entries management

import React from 'react';
import { FaPlus, FaTrash, FaEdit, FaCheck } from 'react-icons/fa';
import { formatPrice, formatDisplayNumber, tomanToRial } from '@/lib/numberFormat';
import type { ContractWizardData, PaymentEntry, PaymentEntryMethod } from '../../types/contract.types';

function getPaymentMethodLabel(payment: PaymentEntry): string {
  const m = (payment as PaymentEntry & { method?: string }).method;
  if (m === 'CASH_CARD') return 'نقد (کارت)';
  if (m === 'CASH_SHIBA') return 'نقد (شبا)';
  if (m === 'CHECK') return 'چک';
  if (m === 'CASH') return payment.cashType === 'CARD' ? 'نقد (کارت)' : 'نقد (شبا)';
  return 'نامشخص';
}

interface Step7PaymentMethodProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
  showPaymentEntryModal: boolean;
  setShowPaymentEntryModal: (show: boolean) => void;
  onEditPaymentEntry?: (entryId: string) => void;
}

export const Step7PaymentMethod: React.FC<Step7PaymentMethodProps> = ({
  wizardData,
  updateWizardData,
  errors,
  showPaymentEntryModal,
  setShowPaymentEntryModal,
  onEditPaymentEntry
}) => {
  const paymentSum = wizardData.payment.payments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = wizardData.payment.totalContractAmount - paymentSum;
  const paymentSumMatchesTotal = Math.abs(remainingAmount) < 0.01;

  const handleAddPaymentEntry = () => {
    setShowPaymentEntryModal(true);
  };

  const handleRemovePayment = (index: number) => {
    const newPayments = wizardData.payment.payments.filter((_, i) => i !== index);
    updateWizardData({
      payment: {
        ...wizardData.payment,
        payments: newPayments
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
          روش پرداخت
        </h3>
        <p className="text-gray-600 dark:text-gray-300">
          روش‌های پرداخت را تعیین کنید (مجموع پرداخت‌ها باید برابر مبلغ قرارداد باشد)
        </p>
      </div>
      
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Summary Section */}
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <span className="text-sm text-gray-600 dark:text-gray-400">مبلغ قرارداد:</span>
              <div className="mr-2">
                <span className="font-semibold text-gray-800 dark:text-white">
                  {formatPrice(wizardData.payment.totalContractAmount, wizardData.payment.currency)}
                </span>
                {wizardData.payment.currency === 'تومان' && (
                  <span className="mr-2 text-xs text-gray-500 dark:text-gray-400">
                    ({formatDisplayNumber(tomanToRial(wizardData.payment.totalContractAmount))} ریال)
                  </span>
                )}
              </div>
            </div>
            <div>
              <span className="text-sm text-gray-600 dark:text-gray-400">جمع پرداخت:</span>
              <div className="mr-2">
                <span className={`font-semibold ${paymentSumMatchesTotal ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                  {formatPrice(paymentSum, wizardData.payment.currency)}
                </span>
                {wizardData.payment.currency === 'تومان' && (
                  <span className="mr-2 text-xs text-gray-500 dark:text-gray-400">
                    ({formatDisplayNumber(tomanToRial(paymentSum))} ریال)
                  </span>
                )}
              </div>
            </div>
            <div>
              <span className="text-sm text-gray-600 dark:text-gray-400">باقیمانده:</span>
              <div className="mr-2">
                <span className={`font-semibold ${
                  Math.abs(remainingAmount) < 0.01 
                    ? 'text-green-600 dark:text-green-400' 
                    : remainingAmount > 0 
                      ? 'text-yellow-600 dark:text-yellow-400' 
                      : 'text-red-600 dark:text-red-400'
                }`}>
                  {formatPrice(remainingAmount, wizardData.payment.currency)}
                </span>
                {wizardData.payment.currency === 'تومان' && (
                  <span className="mr-2 text-xs text-gray-500 dark:text-gray-400">
                    ({formatDisplayNumber(tomanToRial(remainingAmount))} ریال)
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {!paymentSumMatchesTotal && (
            <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
              <p className="text-yellow-700 dark:text-yellow-300 text-sm">
                مجموع پرداخت‌ها ({formatPrice(paymentSum, wizardData.payment.currency)}) با مبلغ قرارداد ({formatPrice(wizardData.payment.totalContractAmount, wizardData.payment.currency)}) برابر نیست
              </p>
            </div>
          )}
          
          {paymentSumMatchesTotal && paymentSum > 0 && (
            <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
              <p className="text-green-700 dark:text-green-300 text-sm flex items-center gap-2">
                <FaCheck className="w-4 h-4" />
                مجموع پرداخت‌ها با مبلغ قرارداد برابر است
              </p>
            </div>
          )}
        </div>

        {/* Payment Entries List */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="text-lg font-medium text-gray-800 dark:text-white">
              لیست پرداخت‌ها
            </h4>
            <button
              onClick={handleAddPaymentEntry}
              className="px-4 py-2 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white rounded-lg transition-all duration-200 font-medium flex items-center gap-2"
            >
              <FaPlus className="w-4 h-4" />
              افزودن پرداخت
            </button>
          </div>

          {wizardData.payment.payments.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                هنوز پرداختی ثبت نشده است
              </p>
              <button
                onClick={handleAddPaymentEntry}
                className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
              >
                ایجاد پرداخت جدید
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {wizardData.payment.payments.map((payment, index) => (
                <div
                  key={index}
                  className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-semibold text-gray-800 dark:text-white">
                          پرداخت {index + 1}
                        </span>
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                          {getPaymentMethodLabel(payment)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">مبلغ: </span>
                          <span className="font-medium text-gray-700 dark:text-gray-300">
                            {formatPrice(payment.amount, wizardData.payment.currency)}
                          </span>
                        </div>
                        {payment.paymentDate && (
                          <div>
                            <span className="text-gray-500 dark:text-gray-400">تاریخ: </span>
                            <span className="font-medium text-gray-700 dark:text-gray-300">
                              {payment.paymentDate}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => {
                          if (onEditPaymentEntry && payment.id) {
                            onEditPaymentEntry(payment.id);
                          } else {
                            setShowPaymentEntryModal(true);
                          }
                        }}
                        className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        title="ویرایش"
                      >
                        <FaEdit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemovePayment(index)}
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
          )}
        </div>

        {(errors.paymentMethod || errors.payments) && (
          <p className="text-red-500 text-sm mt-2">{errors.paymentMethod || errors.payments}</p>
        )}
      </div>
    </div>
  );
};


