// Step 7: Payment Method Component
// Payment entries management

import React from 'react';
import { ErpPressable, ErpSelect } from '@/components/erp';
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
        <h3 className="text-xl font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] mb-2">
          روش پرداخت
        </h3>
        <p className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
          روش‌های پرداخت را تعیین کنید (جمع پرداخت و مانده مشتری نباید کمتر از مبلغ قرارداد باشد)
        </p>
      </div>
      
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="p-4 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-1">
              <h4 className="text-lg font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">تخفیف</h4>
              <p className="text-sm text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                تخفیف فقط روی جمع پایه محصولات سنگی اعمال می‌شود.
              </p>
              <div className="grid grid-cols-1 gap-2 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] sm:grid-cols-3">
                <span>جمع پایه: {formatPrice(baseSubtotal, wizardData.payment.currency)}</span>
                <span>جمع قبل از تخفیف: {formatPrice(productsTotal, wizardData.payment.currency)}</span>
                <span>سقف مجاز: {formatDisplayNumber(maxDiscountPercent)}٪</span>
              </div>
            </div>
            <div className="w-full md:w-44">
              <label className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">درصد تخفیف</label>
              <FormattedNumberInput
                value={discountPercent}
                onChange={(value) => onDiscountPercentChange(Math.min(Math.max(value || 0, 0), maxDiscountPercent))}
                min={0}
                max={maxDiscountPercent}
                step={0.1}
                disabled={!hasMatchingDiscountRange || baseSubtotal <= 0}
                className="w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-3 py-2.5 text-[var(--sds-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--sds-border-default)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-inverse)]"
              />
            </div>
          </div>
          {!hasMatchingDiscountRange && baseSubtotal > 0 && (
            <p className="mt-3 rounded border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-2 text-sm text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
              برای این مبلغ پایه، بازه تخفیف فعالی تعریف نشده است.
            </p>
          )}
          {discountAmount > 0 && (
            <div className="mt-3 rounded border border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] p-3 text-sm text-[var(--sds-success)] dark:border-[var(--sds-success-border)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]">
              مبلغ تخفیف: {formatPrice(discountAmount, wizardData.payment.currency)}
            </div>
          )}
        </div>

        {/* Summary Section */}
        <div className="p-4 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <span className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">مبلغ قرارداد:</span>
              <div className="mr-2">
                <span className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                  {formatPrice(totalContractAmount, wizardData.payment.currency)}
                </span>
                {wizardData.payment.currency === 'تومان' && (
                  <span className="mr-2 text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                    ({formatDisplayNumber(tomanToRial(totalContractAmount))} ریال)
                  </span>
                )}
              </div>
            </div>
            <div>
              <span className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">جمع پرداخت:</span>
              <div className="mr-2">
                <span className={`font-semibold ${isPaymentCovered ? 'text-[var(--sds-success)] dark:text-[var(--sds-success)]' : 'text-[var(--sds-warning)] dark:text-[var(--sds-warning)]'}`}>
                  {formatPrice(paymentSum, wizardData.payment.currency)}
                </span>
                {wizardData.payment.currency === 'تومان' && (
                  <span className="mr-2 text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                    ({formatDisplayNumber(tomanToRial(paymentSum))} ریال)
                  </span>
                )}
              </div>
            </div>
            <div>
              <span className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{hasExtraPayment ? 'مبلغ اضافه:' : 'باقیمانده:'}</span>
              <div className="mr-2">
                <span className={`font-semibold ${
                  Math.abs(remainingAmount) < 0.01 
                    ? 'text-[var(--sds-success)] dark:text-[var(--sds-success)]'
                    : remainingAmount > 0 
                      ? 'text-[var(--sds-warning)] dark:text-[var(--sds-warning)]'
                      : 'text-[var(--sds-info)] dark:text-[var(--sds-info)]'
                }`}>
                  {formatPrice(Math.abs(remainingAmount), wizardData.payment.currency)}
                </span>
                {wizardData.payment.currency === 'تومان' && (
                  <span className="mr-2 text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                    ({formatDisplayNumber(tomanToRial(remainingAmount))} ریال)
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {remainingAmount > 0.01 && (
            <div className="mt-3 p-3 bg-[var(--sds-warning-surface)] dark:bg-[var(--sds-warning-surface)] border border-[var(--sds-warning-border)] dark:border-[var(--sds-warning-border)] rounded">
              <p className="text-[var(--sds-warning)] dark:text-[var(--sds-warning)] text-sm">
                مجموع پرداخت و مانده مشتری ({formatPrice(paymentSum, wizardData.payment.currency)}) کمتر از مبلغ قرارداد ({formatPrice(totalContractAmount, wizardData.payment.currency)}) است
              </p>
            </div>
          )}

          {hasExtraPayment && (
            <div className="mt-3 rounded border border-[var(--sds-info-border)] bg-[var(--sds-info-surface)] p-3 text-sm text-[var(--sds-info)] dark:border-[var(--sds-info-border)] dark:bg-[var(--sds-info-surface)] dark:text-[var(--sds-info)]">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px] md:items-end">
                <div>
                  <p className="font-semibold">مبلغ اضافه: {formatPrice(extraPaymentAmount, wizardData.payment.currency)}</p>
                  <p className="mt-1 text-xs leading-5">
                    برای مبلغ اضافه باید توضیح انتخاب شود تا در چاپ/PDF قرارداد نمایش داده شود.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">توضیحات</label>
                  <ErpSelect
                    value={wizardData.payment.extraPaymentReason || ''}
                    onChange={(event) => updateWizardData({
                      payment: {
                        ...wizardData.payment,
                        extraPaymentReason: event.target.value === 'PREVIOUS_DEBT' ? 'PREVIOUS_DEBT' : null
                      }
                    })}
                    className="w-full rounded-md border border-[var(--sds-info-border)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
                  >
                    <option value="">انتخاب کنید</option>
                    <option value="PREVIOUS_DEBT">به علت بدهی از قبل</option>
                  </ErpSelect>
                </div>
              </div>
            </div>
          )}
          
          {paymentSumMatchesTotal && paymentSum > 0 && (
            <div className="mt-3 p-3 bg-[var(--sds-success-surface)] dark:bg-[var(--sds-success-surface)] border border-[var(--sds-success-border)] dark:border-[var(--sds-success-border)] rounded">
              <p className="text-[var(--sds-success)] dark:text-[var(--sds-success)] text-sm flex items-center gap-2">
                <FaCheck className="w-4 h-4" />
                مجموع پرداخت‌ها با مبلغ قرارداد برابر است
              </p>
            </div>
          )}
        </div>

        {/* Payment Entries List */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h4 className="text-lg font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
              لیست پرداخت‌ها
            </h4>
            <ErpPressable
              onClick={handleAddPaymentEntry}
              className="sds-tone-primary sds-action-solid flex items-center gap-2 px-4 py-2 font-medium"
            >
              <FaPlus className="w-4 h-4" />
              <span>افزودن پرداخت</span>
              {remainingAmount > 0 && (
                <span className="text-xs font-normal opacity-90">
                  مانده: {formatPrice(remainingAmount, wizardData.payment.currency)}
                </span>
              )}
            </ErpPressable>
          </div>

          {wizardData.payment.payments.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-lg">
              <p className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)] mb-4">
                هنوز پرداختی ثبت نشده است
              </p>
              <ErpPressable
                onClick={handleAddPaymentEntry}
                className="px-4 py-2 bg-[var(--sds-accent-soft)] text-[var(--sds-text-inverse)] rounded-lg hover:bg-[var(--sds-accent-soft)] transition-colors"
              >
                ایجاد پرداخت جدید
              </ErpPressable>
            </div>
          ) : (
            <div className="space-y-3">
              {wizardData.payment.payments.map((payment, index) => (
                <div
                  key={index}
                  className="p-4 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                          پرداخت {index + 1}
                        </span>
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-[var(--sds-info-surface)] text-[var(--sds-info)] dark:bg-[var(--sds-info-surface)] dark:text-[var(--sds-info)]">
                          {getPaymentMethodLabel(payment)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                        <div>
                          <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">مبلغ: </span>
                          <span className="font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                            {formatPrice(payment.amount, wizardData.payment.currency)}
                          </span>
                        </div>
                        {payment.paymentDate && (
                          <div>
                            <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">تاریخ: </span>
                            <span className="font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
                              {payment.paymentDate}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <ErpPressable
                        onClick={() => {
                          if (onEditPaymentEntry && payment.id) {
                            onEditPaymentEntry(payment.id);
                          } else {
                            setShowPaymentEntryModal(true);
                          }
                        }}
                        className="p-2 text-[var(--sds-info)] dark:text-[var(--sds-info)] hover:bg-[var(--sds-info-surface)] dark:hover:bg-[var(--sds-info-surface)] rounded-lg transition-colors"
                        title="ویرایش"
                      >
                        <FaEdit className="w-4 h-4" />
                      </ErpPressable>
                      <ErpPressable
                        onClick={() => handleRemovePayment(index)}
                        className="p-2 text-[var(--sds-danger)] dark:text-[var(--sds-danger)] hover:bg-[var(--sds-danger-surface)] dark:hover:bg-[var(--sds-danger-surface)] rounded-lg transition-colors"
                        title="حذف"
                      >
                        <FaTrash className="w-4 h-4" />
                      </ErpPressable>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {(errors.paymentMethod || errors.payments) && (
          <p className="text-[var(--sds-danger)] text-sm mt-2">{errors.paymentMethod || errors.payments}</p>
        )}

        {errors.paymentWarning && (
          <div className="mt-2 rounded border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 text-sm text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
            {errors.paymentWarning}
          </div>
        )}
      </div>
    </div>
  );
};


