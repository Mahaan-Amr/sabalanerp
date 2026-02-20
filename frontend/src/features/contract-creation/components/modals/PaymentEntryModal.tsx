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
  isEdit?: boolean;
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
  isEdit
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
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>تاریخ پرداخت</label>
                  <div className={`${inputClass} flex items-center min-h-[38px]`}>
                    <PersianCalendarComponent
                      value={form.paymentDate ?? ''}
                      onChange={(d: string) => onFormChange({ paymentDate: d })}
                      className="w-full"
                    />
                  </div>
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
                    className={inputClass}
                    placeholder="شماره چک"
                  />
                </div>
                <div>
                  <label className={labelClass}>نام صاحب چک</label>
                  <input
                    type="text"
                    value={form.checkOwnerName ?? ''}
                    onChange={(e) => onFormChange({ checkOwnerName: e.target.value })}
                    className={inputClass}
                    placeholder="نام صاحب چک"
                  />
                </div>
                <div>
                  <label className={labelClass}>مبلغ چک (تومان)</label>
                  <FormattedNumberInput
                    value={form.amount ?? 0}
                    onChange={(v) => onFormChange({ amount: v })}
                    min={0}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>تاریخ تحویل چک</label>
                  <div className={`${inputClass} flex items-center min-h-[38px]`}>
                    <PersianCalendarComponent
                      value={form.handoverDate ?? ''}
                      onChange={(d: string) => onFormChange({ handoverDate: d })}
                      className="w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>تاریخ سررسید چک</label>
                  <div className={`${inputClass} flex items-center min-h-[38px]`}>
                    <PersianCalendarComponent
                      value={form.paymentDate ?? ''}
                      onChange={(d: string) => onFormChange({ paymentDate: d })}
                      className="w-full"
                    />
                  </div>
                </div>
              </>
            )}

            {error && <p className="text-red-500 text-xs">{error}</p>}
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
            onClick={onSave}
            className="px-3 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-md"
          >
            ذخیره
          </button>
        </div>
      </div>
    </div>
  );
};
