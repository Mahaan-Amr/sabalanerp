// Payment Entry Modal — minimal, compact overlay for adding/editing a payment

import React from 'react';
import { ErpInput, ErpSelect } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import type { PaymentEntry, PaymentEntryMethod } from '../../types/contract.types';
import { CentralProductModalShell } from '../product-modal-system';

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
  { value: 'CHECK', label: 'چک' },
  { value: 'CUSTOMER_BALANCE', label: 'استفاده از باقی مانده مشتری' }
];

const inputClass =
  'w-full px-3 py-2 text-sm border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-md bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] focus:outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]';
const labelClass = 'block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mb-1';

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
  const isCustomerBalance = method === 'CUSTOMER_BALANCE';

  return (
    <CentralProductModalShell
      open
      title={isEdit ? 'ویرایش پرداخت' : 'افزودن پرداخت'}
      view="main"
      onClose={onClose}
      primaryLabel={nationalCodeConflict ? 'ادامه بدون تغییر اطلاعات مشتری' : 'ذخیره'}
      pending={false}
      onPrimary={nationalCodeConflict && onContinueNationalCodeConflict
        ? onContinueNationalCodeConflict
        : onSave}
    >
        <div className="mx-auto w-full max-w-sm px-0 py-0">
          <div className="space-y-3">
            <div>
              <label className={labelClass}>نوع پرداخت</label>
              <ErpSelect
                value={method}
                onChange={(e) => onFormChange({ method: e.target.value as PaymentEntryMethod })}
                className={`${inputClass} cursor-pointer`}
              >
                {METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </ErpSelect>
            </div>

            {isCustomerBalance && (
              <div className="rounded-md border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 text-xs leading-6 text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
                در صورت مغایرت با حسابداری قرارداد منقضی میشود
              </div>
            )}

            {(isCash || isCustomerBalance) && (
              <>
                <div>
                  <label className={labelClass}>{isCustomerBalance ? 'مبلغ مانده مشتری (تومان)' : 'مبلغ (تومان)'}</label>
                  <FormattedNumberInput
                    value={form.amount ?? 0}
                    onChange={(v) => onFormChange({ amount: v })}
                    min={0}
                    formatWhileTyping
                    className={`${inputClass} ${fieldErrors.amount ? 'border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]' : ''}`}
                  />
                  {fieldErrors.amount && <p className="mt-1 text-xs text-[var(--sds-danger)]">{fieldErrors.amount}</p>}
                </div>
                <div>
                  <label className={labelClass}>{isCustomerBalance ? 'تاریخ استفاده از مانده' : 'تاریخ پرداخت'}</label>
                  <div className={`${inputClass} flex items-center min-h-[38px] ${fieldErrors.paymentDate ? 'border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]' : ''}`}>
                    <PersianCalendarComponent
                      value={form.paymentDate ?? ''}
                      onChange={(d: string) => onFormChange({ paymentDate: d })}
                      className="w-full"
                      disablePastDates
                    />
                  </div>
                  {fieldErrors.paymentDate && <p className="mt-1 text-xs text-[var(--sds-danger)]">{fieldErrors.paymentDate}</p>}
                </div>
              </>
            )}

            {isCheck && (
              <>
                <div>
                  <label className={labelClass}>شماره چک (اختیاری)</label>
                  <ErpInput
                    type="text"
                    value={form.checkNumber ?? ''}
                    onChange={(e) => onFormChange({ checkNumber: e.target.value })}
                    className={`${inputClass} ${fieldErrors.checkNumber ? 'border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]' : ''}`}
                    placeholder="در صورت موجود بودن وارد کنید"
                  />
                  {fieldErrors.checkNumber && <p className="mt-1 text-xs text-[var(--sds-danger)]">{fieldErrors.checkNumber}</p>}
                </div>
                <div>
                  <label className={labelClass}>نام صاحب چک</label>
                  <ErpInput
                    type="text"
                    value={form.checkOwnerName ?? ''}
                    onChange={(e) => onFormChange({ checkOwnerName: e.target.value })}
                    className={`${inputClass} ${fieldErrors.checkOwnerName ? 'border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]' : ''}`}
                    placeholder="نام صاحب چک"
                  />
                  {fieldErrors.checkOwnerName && <p className="mt-1 text-xs text-[var(--sds-danger)]">{fieldErrors.checkOwnerName}</p>}
                </div>
                <div>
                  <label className={labelClass}>مبلغ چک (تومان)</label>
                  <FormattedNumberInput
                    value={form.amount ?? 0}
                    onChange={(v) => onFormChange({ amount: v })}
                    min={0}
                    formatWhileTyping
                    className={`${inputClass} ${fieldErrors.amount ? 'border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]' : ''}`}
                  />
                  {fieldErrors.amount && <p className="mt-1 text-xs text-[var(--sds-danger)]">{fieldErrors.amount}</p>}
                </div>
                <div>
                  <label className={labelClass}>تاریخ تحویل چک</label>
                  <div className={`${inputClass} flex items-center min-h-[38px] ${fieldErrors.handoverDate ? 'border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]' : ''}`}>
                    <PersianCalendarComponent
                      value={form.handoverDate ?? ''}
                      onChange={(d: string) => onFormChange({ handoverDate: d })}
                      className="w-full"
                      disablePastDates
                    />
                  </div>
                  {fieldErrors.handoverDate && <p className="mt-1 text-xs text-[var(--sds-danger)]">{fieldErrors.handoverDate}</p>}
                </div>
                <div>
                  <label className={labelClass}>تاریخ سررسید چک</label>
                  <div className={`${inputClass} flex items-center min-h-[38px] ${fieldErrors.paymentDate ? 'border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]' : ''}`}>
                    <PersianCalendarComponent
                      value={form.paymentDate ?? ''}
                      onChange={(d: string) => onFormChange({ paymentDate: d })}
                      className="w-full"
                      disablePastDates
                    />
                  </div>
                  {fieldErrors.paymentDate && <p className="mt-1 text-xs text-[var(--sds-danger)]">{fieldErrors.paymentDate}</p>}
                </div>
              </>
            )}

            {nationalCodeRequired && (
              <div>
                <label className={labelClass}>کد ملی *</label>
                <ErpInput
                  type="text"
                  value={form.nationalCode ?? ''}
                  onChange={(e) => onFormChange({ nationalCode: e.target.value })}
                  className={`${inputClass} ${fieldErrors.nationalCode ? 'border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]' : ''}`}
                  placeholder="کد ملی مشتری"
                  maxLength={10}
                  inputMode="numeric"
                />
                {fieldErrors.nationalCode && <p className="mt-1 text-xs text-[var(--sds-danger)]">{fieldErrors.nationalCode}</p>}
                <p className="mt-1 text-[11px] leading-5 text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                  برای پرداخت با تاریخ غیر از امروز الزامی است.
                </p>
              </div>
            )}

            {error && <p className="text-[var(--sds-danger)] text-xs">{error}</p>}

            {nationalCodeConflict && (
              <div className="rounded-md border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 text-xs leading-6 text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
                <p className="font-semibold">کد ملی واردشده با کد ملی ثبت‌شده مشتری متفاوت است.</p>
                <p>کد ثبت‌شده: {nationalCodeConflict.existing}</p>
                <p>کد واردشده: {nationalCodeConflict.entered}</p>
                <p>این مقدار فقط برای پرداخت ثبت می‌شود و اطلاعات مشتری تغییر نمی‌کند.</p>
              </div>
            )}
          </div>
        </div>
    </CentralProductModalShell>
  );
};
