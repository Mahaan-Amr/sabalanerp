'use client';

import React from 'react';
import { ErpButton, ErpEmptyState } from '@/components/erp';
import { FaPlus } from 'react-icons/fa';
import { ContractPaymentEntriesList } from './ContractPaymentEntriesList';
import type { PaymentEntry } from '../../types/contract.types';

/** Presentation shared by Sales and Partner; each caller owns its payment rules. */
export function ContractPaymentEntriesSection({ payments, currency, remaining, disabled, onAdd, onEdit, onRemove }: {
  payments: PaymentEntry[];
  currency: string;
  remaining?: string;
  disabled?: boolean;
  onAdd: () => void;
  onEdit: (payment: PaymentEntry, index: number) => void;
  onRemove: (index: number) => void;
}) {
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h4 className="sds-text-primary text-lg font-medium">لیست پرداخت‌ها</h4>
      <div className="flex flex-wrap items-center gap-2">
        {remaining && <span className="sds-text-secondary text-xs">مانده: {remaining}</span>}
        <ErpButton label="افزودن پرداخت" icon={FaPlus} variant="outline" tone="neutral" disabled={disabled} onClick={onAdd} />
      </div>
    </div>
    {payments.length ? <ContractPaymentEntriesList payments={payments} currency={currency} onEdit={onEdit} onRemove={onRemove} />
      : <ErpEmptyState title="هنوز پرداختی ثبت نشده است"
        action={{ label: 'ایجاد پرداخت جدید', variant: 'outline', disabled, onClick: onAdd }} />}
  </div>;
}
