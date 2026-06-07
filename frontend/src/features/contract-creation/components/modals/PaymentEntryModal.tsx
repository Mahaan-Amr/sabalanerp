// Payment Entry Modal — minimal, compact overlay for adding/editing a payment

import React from 'react';
import { FaTimes } from 'react-icons/fa';
import PersianCalendarComponent from '@/components/PersianCalendar';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import type { PaymentEntry, PaymentEntryMethod } from '../../types/contract.types';

interface PaymentEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: Partial<PaymentEntry>;
  onFormChange: (updates: Partial<PaymentEntry>) => void;
  onSave: () => void;
  currency: string;
  error?: string;
  fieldErrors?: Partial<Record<'amount' | 'paymentDate' | 'checkNumber' | 'checkOwnerName' | 'handoverDate' | 'nationalCode', string>>;
  isEdit?: boolean;
  nationalCodeRequired?: boolean;
  nationalCodeConflict?: {
    existing: string;
    entered: string;
  } | null;
  onContinueNationalCodeConflict?: () => void;
}

const METHOD_OPTIONS: { value: PaymentEntryMethod; label: string }[] = [
  { value: 'CASH_CARD', label: 'نقدی (کارت‌خوان)' },
  { value: 'CASH_SHIBA', label: 'نقدی (شبا)' },
  { value: 'CHECK', label: 'چک' }
];

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500';
const labelClass = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1';

export const PaymentEntryModal: React.FC<PaymentEntryModalProps> = ({
  isOpen,
  onClose,
  form,
  onFormChange,
  onSave,
  currency: _currency,
  error,
  fieldErrors = {},
  isEdit,
  nationalCodeRequired = false,
  nationalCodeConflict = null,
  onContinueNationalCodeConflict
}) => {
  if (!isOpen) return null;

  const method = (form.method || 'CASH_CARD') as PaymentEntryMethod;
  const isCash = method === 'CASH_CARD' || method === 'CASH_SHIBA';
  const isCheck = method === 'CHECK';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal card - narrow, fixed width, centered */}
      <div
        className="relative z-10 flex min-w-0 flex-col rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl"
        style={{
          width: '100%',
          maxWidth: 320,
          minWidth: 280,
          maxHeight: '85vh'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between flex-shrink-0 px-4 py-2.5 border-b border-gray-200 dark:border-gray-600">
          <h2 id="payment-modal-title" className="text-sm font-semibold text-gray-800 dark:text-white">
            {isEdit ? 'ویرایش پرداخت' : 'افزودن پرداخت'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            aria-label="بستن"
          >
            <FaTimes className="w-4 h-4" />
          </button>
        </div>

        {/* Body - scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <div className="space-y-3">
            <div>
              <label className={labelClass}>نوع پرداخت</label>
              <select
                value={method}
                onChange={(e) => onFormChange({ method: e.target.value as PaymentEntryMethod })}
                className={`${inputClass} cursor-pointer`}
              >
                {METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {isCash && (
              <>
                <div>
                  <label className={labelClass}>مبلغ (تومان)</label>
                  <FormattedNumberInput
                    value={form.amount ?? 0}
                    onChange={(v) => onFormChange({ amount: v })}
                    min={0}
                    formatWhileTyping
                    className={`${inputClass} ${fieldErrors.amount ? 'border-red-500 dark:border-red-400' : ''}`}
                  />
                  {fieldErrors.amount && <p className="mt-1 text-xs text-red-500">{fieldErrors.amount}</p>}
                </div>
                <div>
                  <label className={labelClass}>تاریخ پرداخت</label>
                  <div className={`${inputClass} flex items-center min-h-[38px] ${fieldErrors.paymentDate ? 'border-red-500 dark:border-red-400' : ''}`}>
                    <PersianCalendarComponent
                      value={form.paymentDate ?? ''}
                      onChange={(d: string) => onFormChange({ paymentDate: d })}
                      className="w-full"
                      disablePastDates
                    />
                  </div>
                  {fieldErrors.paymentDate && <p className="mt-1 text-xs text-red-500">{fieldErrors.paymentDate}</p>}
                </div>
              </>
            )}

            {isCheck && (
              <>
                <div>
                  <label className={labelClass}>شماره چک</label>
                  <input
                    type="text"
                    value={form.checkNumber ?? ''}
                    onChange={(e) => onFormChange({ checkNumber: e.target.value })}
                    className={`${inputClass} ${fieldErrors.checkNumber ? 'border-red-500 dark:border-red-400' : ''}`}
                    placeholder="شماره چک"
                  />
                  {fieldErrors.checkNumber && <p className="mt-1 text-xs text-red-500">{fieldErrors.checkNumber}</p>}
                </div>
                <div>
                  <label className={labelClass}>نام صاحب چک</label>
                  <input
                    type="text"
                    value={form.checkOwnerName ?? ''}
                    onChange={(e) => onFormChange({ checkOwnerName: e.target.value })}
                    className={`${inputClass} ${fieldErrors.checkOwnerName ? 'border-red-500 dark:border-red-400' : ''}`}
                    placeholder="نام صاحب چک"
                  />
                  {fieldErrors.checkOwnerName && <p className="mt-1 text-xs text-red-500">{fieldErrors.checkOwnerName}</p>}
                </div>
                <div>
                  <label className={labelClass}>مبلغ چک (تومان)</label>
                  <FormattedNumberInput
                    value={form.amount ?? 0}
                    onChange={(v) => onFormChange({ amount: v })}
                    min={0}
                    formatWhileTyping
                    className={`${inputClass} ${fieldErrors.amount ? 'border-red-500 dark:border-red-400' : ''}`}
                  />
                  {fieldErrors.amount && <p className="mt-1 text-xs text-red-500">{fieldErrors.amount}</p>}
                </div>
                <div>
                  <label className={labelClass}>تاریخ تحویل چک</label>
                  <div className={`${inputClass} flex items-center min-h-[38px] ${fieldErrors.handoverDate ? 'border-red-500 dark:border-red-400' : ''}`}>
                    <PersianCalendarComponent
                      value={form.handoverDate ?? ''}
                      onChange={(d: string) => onFormChange({ handoverDate: d })}
                      className="w-full"
                      disablePastDates
                    />
                  </div>
                  {fieldErrors.handoverDate && <p className="mt-1 text-xs text-red-500">{fieldErrors.handoverDate}</p>}
                </div>
                <div>
                  <label className={labelClass}>تاریخ سررسید چک</label>
                  <div className={`${inputClass} flex items-center min-h-[38px] ${fieldErrors.paymentDate ? 'border-red-500 dark:border-red-400' : ''}`}>
                    <PersianCalendarComponent
                      value={form.paymentDate ?? ''}
                      onChange={(d: string) => onFormChange({ paymentDate: d })}
                      className="w-full"
                      disablePastDates
                    />
                  </div>
                  {fieldErrors.paymentDate && <p className="mt-1 text-xs text-red-500">{fieldErrors.paymentDate}</p>}
                </div>
              </>
            )}

            {nationalCodeRequired && (
              <div>
                <label className={labelClass}>کد ملی *</label>
                <input
                  type="text"
                  value={form.nationalCode ?? ''}
                  onChange={(e) => onFormChange({ nationalCode: e.target.value })}
                  className={`${inputClass} ${fieldErrors.nationalCode ? 'border-red-500 dark:border-red-400' : ''}`}
                  placeholder="کد ملی مشتری"
                  maxLength={10}
                  inputMode="numeric"
                />
                {fieldErrors.nationalCode && <p className="mt-1 text-xs text-red-500">{fieldErrors.nationalCode}</p>}
                <p className="mt-1 text-[11px] leading-5 text-gray-500 dark:text-gray-400">
                  برای پرداخت با تاریخ غیر از امروز الزامی است.
                </p>
              </div>
            )}

            {error && <p className="text-red-500 text-xs">{error}</p>}

            {nationalCodeConflict && (
              <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-xs leading-6 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-200">
                <p className="font-semibold">کد ملی واردشده با کد ملی ثبت‌شده مشتری متفاوت است.</p>
                <p>کد ثبت‌شده: {nationalCodeConflict.existing}</p>
                <p>کد واردشده: {nationalCodeConflict.entered}</p>
                <p>این مقدار فقط برای پرداخت ثبت می‌شود و اطلاعات مشتری تغییر نمی‌کند.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer - match modal body in both themes */}
        <div className="flex flex-shrink-0 gap-2 justify-end px-4 py-2.5 border-t border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={nationalCodeConflict && onContinueNationalCodeConflict ? onContinueNationalCodeConflict : onSave}
            className="px-3 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md"
          >
            {nationalCodeConflict ? 'ادامه بدون تغییر اطلاعات مشتری' : 'ذخیره'}
          </button>
        </div>
      </div>
    </div>
  );
};
