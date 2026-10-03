import React from 'react';
import { ErpSelect } from '@/components/erp';
import type { PaymentEntryMethod } from '../../types/contract.types';

export const contractPaymentMethodOptions: ReadonlyArray<{ value: PaymentEntryMethod; label: string }> = [
  { value: 'CASH_CARD', label: 'نقدی (کارت‌خوان)' },
  { value: 'CASH_SHIBA', label: 'نقدی (شبا)' },
  { value: 'CHECK', label: 'چک' },
  { value: 'SELLER_CREDIT', label: 'استفاده از اعتبار فروشنده' },
];

const legacyCustomerBalanceOption = { value: 'CUSTOMER_BALANCE' as const, label: 'استفاده از باقی مانده مشتری' };

export function ContractPaymentMethodSelect({ value, onChange, className, disabled, existingContract = false, allowCustomerBalance = false, allowSellerCredit = false, sellerCreditLabel }: {
  value: PaymentEntryMethod | undefined;
  onChange: (value: PaymentEntryMethod) => void;
  className?: string;
  disabled?: boolean;
  existingContract?: boolean;
  allowCustomerBalance?: boolean;
  allowSellerCredit?: boolean;
  sellerCreditLabel?: string;
}) {
  const isLegacyCustomerBalance = !allowCustomerBalance && value === 'CUSTOMER_BALANCE';
  return <ErpSelect aria-label="نوع پرداخت" value={value ?? ''} disabled={disabled}
    onChange={event => {
      if (allowCustomerBalance || event.target.value !== 'CUSTOMER_BALANCE') onChange(event.target.value as PaymentEntryMethod);
    }} className={className}>
    {value === undefined && <option value="" disabled>انتخاب روش پرداخت</option>}
    {isLegacyCustomerBalance && <option value="CUSTOMER_BALANCE" disabled>استفاده از باقی مانده مشتری (غیرفعال)</option>}
    {contractPaymentMethodOptions.filter(option => option.value !== 'SELLER_CREDIT' || allowSellerCredit || value === 'SELLER_CREDIT')
      .map(option => <option key={option.value} value={option.value} disabled={option.value === 'SELLER_CREDIT' && !allowSellerCredit}>
        {option.value === 'SELLER_CREDIT' && sellerCreditLabel ? `${option.label} — ${sellerCreditLabel}` : option.label}</option>)}
    {allowCustomerBalance && <option value={legacyCustomerBalanceOption.value}>{legacyCustomerBalanceOption.label}</option>}
  </ErpSelect>;
}
