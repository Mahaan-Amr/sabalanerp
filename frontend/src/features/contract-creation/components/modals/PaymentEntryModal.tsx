// Payment Entry Modal — minimal, compact overlay for adding/editing a payment

import React from 'react';
import { ErpInlineState } from '@/components/erp';
import type { PaymentEntry, PaymentEntryMethod } from '../../types/contract.types';
import { CentralProductModalShell } from '../product-modal-system';
import { ContractPaymentInstallmentFields } from '../shared/ContractPaymentInstallmentFields';
import { ContractPaymentCheckFields } from '../shared/ContractPaymentCheckFields';

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
            <ContractPaymentInstallmentFields method={method} amount={String(form.amount ?? '')}
              date={form.paymentDate ?? ''}
              amountLabel={isCustomerBalance ? 'مبلغ مانده مشتری (تومان)' : isCheck ? 'مبلغ چک (تومان)' : 'مبلغ (تومان)'}
              dateLabel={isCustomerBalance ? 'تاریخ استفاده از مانده' : isCheck ? 'تاریخ سررسید چک' : 'تاریخ پرداخت'}
              amountError={fieldErrors.amount} dateError={fieldErrors.paymentDate}
              onMethodChange={value => onFormChange({ method: value })}
              onAmountChange={value => onFormChange({ amount: Number(value || 0) })}
              onDateChange={value => onFormChange({ paymentDate: value })} />

            {(isCheck || nationalCodeRequired) && <ContractPaymentCheckFields showCheckFields={isCheck}
              nationalCodeRequired={nationalCodeRequired}
              value={{ number: form.checkNumber ?? '', ownerName: form.checkOwnerName ?? '',
                handoverDate: form.handoverDate ?? '', nationalCode: form.nationalCode ?? '' }}
              errors={{ number: fieldErrors.checkNumber, ownerName: fieldErrors.checkOwnerName,
                handoverDate: fieldErrors.handoverDate, nationalCode: fieldErrors.nationalCode }}
              onChange={updates => onFormChange({
                ...(updates.number !== undefined ? { checkNumber: updates.number } : {}),
                ...(updates.ownerName !== undefined ? { checkOwnerName: updates.ownerName } : {}),
                ...(updates.handoverDate !== undefined ? { handoverDate: updates.handoverDate } : {}),
                ...(updates.nationalCode !== undefined ? { nationalCode: updates.nationalCode } : {}),
              })} />}

            {error && <ErpInlineState kind="error" title={error} />}

            {nationalCodeConflict && (
              <ErpInlineState kind="stale" title={
                <span className="space-y-1">
                  <span className="block">کد ملی واردشده با کد ملی ثبت‌شده مشتری متفاوت است.</span>
                  <span className="block font-normal">کد ثبت‌شده: {nationalCodeConflict.existing}</span>
                  <span className="block font-normal">کد واردشده: {nationalCodeConflict.entered}</span>
                  <span className="block font-normal">این مقدار فقط برای پرداخت ثبت می‌شود و اطلاعات مشتری تغییر نمی‌کند.</span>
                </span>
              } />
            )}
          </div>
        </div>
    </CentralProductModalShell>
  );
};
