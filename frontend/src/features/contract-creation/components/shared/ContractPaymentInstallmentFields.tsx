'use client';

import React from 'react';
import { ErpField, ErpInlineState, ErpRialInput } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import type { PaymentEntryMethod } from '../../types/contract.types';
import { ContractPaymentMethodSelect } from './ContractPaymentMethodSelect';

export function ContractPaymentInstallmentFields({ method, amount, date, amountLabel = 'مبلغ (تومان)',
  dateLabel = 'تاریخ پرداخت', disabledAmount = false, disabled = false, existingContract = false, allowCustomerBalance = false, methodError, amountError, dateError,
  dateFormat = 'jalali', onMethodChange, onAmountChange, onDateChange }: {
  method: PaymentEntryMethod | undefined;
  amount: string;
  date: string;
  dateFormat?: 'jalali' | 'gregorian';
  amountLabel?: string;
  dateLabel?: string;
  disabledAmount?: boolean;
  disabled?: boolean;
  existingContract?: boolean;
  allowCustomerBalance?: boolean;
  methodError?: string;
  amountError?: string;
  dateError?: string;
  onMethodChange: (method: PaymentEntryMethod) => void;
  onAmountChange: (amount: string) => void;
  onDateChange: (date: string) => void;
}) {
  return <div className="grid gap-3 sm:grid-cols-3">
    <ErpField className="[&>label]:mb-0" label="روش پرداخت" error={methodError}><ContractPaymentMethodSelect value={method} disabled={disabled} existingContract={existingContract} allowCustomerBalance={allowCustomerBalance} className="h-12"
      onChange={onMethodChange} /></ErpField>
    <ErpField className="[&>label]:mb-0" label={amountLabel} error={amountError}><ErpRialInput className="h-12" dir="ltr" value={amount}
      disabled={disabled || disabledAmount} onValueChange={onAmountChange} /></ErpField>
    <ErpField className="[&>label]:mb-0" label={dateLabel} error={dateError}><PersianCalendarComponent valueFormat={dateFormat} value={date}
      onChange={onDateChange} className="w-full [&>button]:h-12" disablePastDates disabled={disabled} /></ErpField>
    {method === 'CUSTOMER_BALANCE' && <div className="sm:col-span-3"><ErpInlineState kind="stale"
      title="در صورت مغایرت مانده مشتری با حسابداری، قرارداد منقضی می‌شود." /></div>}
  </div>;
}
