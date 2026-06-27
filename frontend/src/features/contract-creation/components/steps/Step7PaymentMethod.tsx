// Step 7: Payment Method Component
// Payment entries management

import React from 'react';
import { FaPlus, FaTrash, FaEdit, FaCheck } from 'react-icons/fa';
import { formatPrice, formatDisplayNumber, sumNumericValues, tomanToRial, toFiniteNumber } from '@/lib/numberFormat';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import type { ContractWizardData, PaymentEntry, PaymentEntryMethod } from '../../types/contract.types';

function getPaymentMethodLabel(payment: PaymentEntry): string {
  const m = (payment as PaymentEntry & { method?: string }).method;
  if (m === 'CASH_CARD') return 'نقد (کارت)';
  if (m === 'CASH_SHIBA') return 'نقد (شبا)';
  if (m === 'CHECK') return 'چک';
  if (m === 'CUSTOMER_BALANCE') return 'استفاده از باقی مانده مشتری';
  if (m === 'CASH') return payment.cashType === 'CARD' ? 'نقد (کارت)' : 'نقد (شبا)';
  if (m === 'RECEIPT') return 'رسید';
  return 'نامشخص';
}

interface Step7PaymentMethodProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
  baseSubtotal: number;
  productsTotal: number;
  discountPercent: number;
  maxDiscountPercent: number;
  discountAmount: number;
  hasMatchingDiscountRange: boolean;
  onDiscountPercentChange: (value: number) => void;
  showPaymentEntryModal: boolean;
  setShowPaymentEntryModal: (show: boolean) => void;
  onAddPaymentEntry?: () => void;
  onEditPaymentEntry?: (entryId: string) => void;
}

export const Step7PaymentMethod: React.FC<Step7PaymentMethodProps> = ({
  wizardData,
  updateWizardData,
  errors,
  baseSubtotal,
  productsTotal,
  discountPercent,
  maxDiscountPercent,
  discountAmount,
  hasMatchingDiscountRange,
  onDiscountPercentChange,
  showPaymentEntryModal,
  setShowPaymentEntryModal,
  onAddPaymentEntry,
  onEditPaymentEntry
}) => {
  const paymentSum = sumNumericValues(wizardData.payment.payments, (payment) => payment.amount);
  const totalContractAmount = toFiniteNumber(wizardData.payment.totalContractAmount);
  const remainingAmount = totalContractAmount - paymentSum;
  const isPaymentCovered = paymentSum + 0.01 >= totalContractAmount;
  const paymentSumMatchesTotal = Math.abs(remainingAmount) < 0.01;
  const extraPaymentAmount = paymentSum - totalContractAmount;
  const hasExtraPayment = extraPaymentAmount > 0.01;

  const handleAddPaymentEntry = () => {
    if (onAddPaymentEntry) {
      onAddPaymentEntry();
      return;
    }
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
          روش‌های پرداخت را تعیین کنید (جمع پرداخت و مانده مشتری نباید کمتر از مبلغ قرارداد باشد)
        </p>
      </div>
      
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <h4 className="text-lg font-medium text-gray-800 dark:text-white">تخفیف</h4>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                تخفیف فقط روی جمع پایه محصولات سنگی اعمال می‌شود.
              </p>
              <div className="grid grid-cols-1 gap-2 text-sm text-gray-600 dark:text-gray-300 sm:grid-cols-3">
                <span>جمع پایه: {formatPrice(baseSubtotal, wizardData.payment.currency)}</span>
                <span>جمع قبل از تخفیف: {formatPrice(productsTotal, wizardData.payment.currency)}</span>
                <span>سقف مجاز: {formatDisplayNumber(maxDiscountPercent)}٪</span>
              </div>
            </div>
            <div className="w-full md:w-44">
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">درصد تخفیف</label>
              <FormattedNumberInput
                value={discountPercent}
                onChange={(value) => onDiscountPercentChange(Math.min(Math.max(value || 0, 0), maxDiscountPercent))}
                min={0}
                max={maxDiscountPercent}
                step={0.1}
                disabled={!hasMatchingDiscountRange || baseSubtotal <= 0}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700/50 dark:text-white"
              />
            </div>
          </div>
          {!hasMatchingDiscountRange && baseSubtotal > 0 && (
            <p className="mt-3 rounded border border-yellow-200 bg-yellow-50 p-2 text-sm text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
              برای این مبلغ پایه، بازه تخفیف فعالی تعریف نشده است.
            </p>
          )}
          {discountAmount > 0 && (
            <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
              مبلغ تخفیف: {formatPrice(discountAmount, wizardData.payment.currency)}
            </div>
          )}
        </div>

        {/* Summary Section */}
        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <span className="text-sm text-gray-600 dark:text-gray-400">مبلغ قرارداد:</span>
              <div className="mr-2">
                <span className="font-semibold text-gray-800 dark:text-white">
                  {formatPrice(totalContractAmount, wizardData.payment.currency)}
                </span>
                {wizardData.payment.currency === 'تومان' && (
                  <span className="mr-2 text-xs text-gray-500 dark:text-gray-400">
                    ({formatDisplayNumber(tomanToRial(totalContractAmount))} ریال)
                  </span>
                )}
              </div>
            </div>
            <div>
              <span className="text-sm text-gray-600 dark:text-gray-400">جمع پرداخت:</span>
              <div className="mr-2">
                <span className={`font-semibold ${isPaymentCovered ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
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
              <span className="text-sm text-gray-600 dark:text-gray-400">{hasExtraPayment ? 'مبلغ اضافه:' : 'باقیمانده:'}</span>
              <div className="mr-2">
                <span className={`font-semibold ${
                  Math.abs(remainingAmount) < 0.01 
                    ? 'text-green-600 dark:text-green-400' 
                    : remainingAmount > 0 
                      ? 'text-yellow-600 dark:text-yellow-400' 
                      : 'text-blue-600 dark:text-blue-400'
                }`}>
                  {formatPrice(Math.abs(remainingAmount), wizardData.payment.currency)}
                </span>
                {wizardData.payment.currency === 'تومان' && (
                  <span className="mr-2 text-xs text-gray-500 dark:text-gray-400">
                    ({formatDisplayNumber(tomanToRial(remainingAmount))} ریال)
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {remainingAmount > 0.01 && (
            <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded">
              <p className="text-yellow-700 dark:text-yellow-300 text-sm">
                مجموع پرداخت و مانده مشتری ({formatPrice(paymentSum, wizardData.payment.currency)}) کمتر از مبلغ قرارداد ({formatPrice(totalContractAmount, wizardData.payment.currency)}) است
              </p>
            </div>
          )}

          {hasExtraPayment && (
            <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px] md:items-end">
                <div>
                  <p className="font-semibold">مبلغ اضافه: {formatPrice(extraPaymentAmount, wizardData.payment.currency)}</p>
                  <p className="mt-1 text-xs leading-5">
                    برای مبلغ اضافه باید توضیح انتخاب شود تا در چاپ/PDF قرارداد نمایش داده شود.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">توضیحات</label>
                  <select
                    value={wizardData.payment.extraPaymentReason || ''}
                    onChange={(event) => updateWizardData({
                      payment: {
                        ...wizardData.payment,
                        extraPaymentReason: event.target.value === 'PREVIOUS_DEBT' ? 'PREVIOUS_DEBT' : null
                      }
                    })}
                    className="w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-blue-700 dark:bg-gray-800 dark:text-white"
                  >
                    <option value="">انتخاب کنید</option>
                    <option value="PREVIOUS_DEBT">به علت بدهی از قبل</option>
                  </select>
                </div>
              </div>
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
              <span>افزودن پرداخت</span>
              {remainingAmount > 0 && (
                <span className="text-xs font-normal opacity-90">
                  مانده: {formatPrice(remainingAmount, wizardData.payment.currency)}
                </span>
              )}
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

        {errors.paymentWarning && (
          <div className="mt-2 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
            {errors.paymentWarning}
          </div>
        )}
      </div>
    </div>
  );
};


