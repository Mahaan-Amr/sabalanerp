import React from 'react';
import { ErpSelect } from '@/components/erp';
import type { PaymentEntryMethod } from '../../types/contract.types';

export const contractPaymentMethodOptions: ReadonlyArray<{ value: PaymentEntryMethod; label: string }> = [
  { value: 'CASH_CARD', label: 'نقدی (کارت‌خوان)' },
  { value: 'CASH_SHIBA', label: 'نقدی (شبا)' },
  { value: 'CHECK', label: 'چک' },
  { value: 'CUSTOMER_BALANCE', label: 'استفاده از باقی مانده مشتری' },
];

export function ContractPaymentMethodSelect({ value, onChange, className }: {
  value: PaymentEntryMethod;
  onChange: (value: PaymentEntryMethod) => void;
  className?: string;
}) {
  return <ErpSelect aria-label="نوع پرداخت" value={value}
    onChange={event => onChange(event.target.value as PaymentEntryMethod)} className={className}>
    {contractPaymentMethodOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </ErpSelect>;
}
