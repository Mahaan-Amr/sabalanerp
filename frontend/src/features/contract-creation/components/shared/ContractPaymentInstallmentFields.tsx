'use client';

import React from 'react';
import { ErpField, ErpInlineState, ErpRialInput } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import type { PaymentEntryMethod } from '../../types/contract.types';
import { ContractPaymentMethodSelect } from './ContractPaymentMethodSelect';

export function ContractPaymentInstallmentFields({ method, amount, date, amountLabel = 'مبلغ (تومان)',
  dateLabel = 'تاریخ پرداخت', disabledAmount = false, disabled = false, existingContract = false, amountError, dateError,
  onMethodChange, onAmountChange, onDateChange }: {
  method: PaymentEntryMethod;
  amount: string;
  date: string;
  amountLabel?: string;
  dateLabel?: string;
  disabledAmount?: boolean;
  disabled?: boolean;
  existingContract?: boolean;
  amountError?: string;
  dateError?: string;
  onMethodChange: (method: PaymentEntryMethod) => void;
  onAmountChange: (amount: string) => void;
  onDateChange: (date: string) => void;
}) {
  return <div className="grid gap-3 sm:grid-cols-3">
    <ErpField label="روش پرداخت"><ContractPaymentMethodSelect value={method} disabled={disabled} existingContract={existingContract}
      onChange={onMethodChange} /></ErpField>
    <ErpField label={amountLabel} error={amountError}><ErpRialInput dir="ltr" value={amount}
      disabled={disabled || disabledAmount} onValueChange={onAmountChange} /></ErpField>
    <ErpField label={dateLabel} error={dateError}><PersianCalendarComponent value={date}
      onChange={onDateChange} className="w-full" disablePastDates disabled={disabled} /></ErpField>
    {method === 'CUSTOMER_BALANCE' && <div className="sm:col-span-3"><ErpInlineState kind="stale"
      title="در صورت مغایرت مانده مشتری با حسابداری، قرارداد منقضی می‌شود." /></div>}
  </div>;
}
