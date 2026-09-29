'use client';

import React from 'react';
import { ErpBadge, ErpNeumorphicCard, ErpPressable } from '@/components/erp';
import { FaEdit, FaTrash } from 'react-icons/fa';
import { formatPrice } from '@/lib/numberFormat';
import type { PaymentEntry } from '../../types/contract.types';
import { contractPaymentMethodOptions } from './ContractPaymentMethodSelect';

export function ContractPaymentEntriesList({ payments, currency, onEdit, onRemove }: {
  payments: PaymentEntry[];
  currency: string;
  onEdit: (payment: PaymentEntry, index: number) => void;
  onRemove: (index: number) => void;
}) {
  return <div className="space-y-3">
    {payments.map((payment, index) => <ErpNeumorphicCard key={payment.id ?? index} className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <strong>پرداخت {(index + 1).toLocaleString('fa-IR')}</strong>
            <ErpBadge tone="info">{contractPaymentMethodOptions.find(option => option.value === payment.method)?.label
              ?? (payment.method === 'CUSTOMER_BALANCE' ? 'مانده مشتری'
                : String(payment.method) === 'CASH' ? (payment.cashType === 'CARD' ? 'نقد (کارت)' : 'نقد (شبا)')
                : String(payment.method) === 'RECEIPT' ? 'رسید' : 'نامشخص')}</ErpBadge>
          </div>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 md:grid-cols-3">
            <div><span className="sds-text-muted">مبلغ: </span><span className="sds-text-secondary font-medium">{formatPrice(payment.amount, currency)}</span></div>
            {payment.paymentDate && <div><span className="sds-text-muted">تاریخ: </span><span className="sds-text-secondary font-medium">{payment.paymentDate}</span></div>}
          </div>
        </div>
        <div className="flex gap-2">
          <ErpPressable aria-label={`ویرایش پرداخت ${index + 1}`} title="ویرایش" tone="info" variant="ghost" className="p-2"
            onClick={() => onEdit(payment, index)}><FaEdit /></ErpPressable>
          <ErpPressable aria-label={`حذف پرداخت ${index + 1}`} title="حذف" tone="danger" variant="ghost" className="p-2"
            onClick={() => onRemove(index)}><FaTrash /></ErpPressable>
        </div>
      </div>
    </ErpNeumorphicCard>)}
  </div>;
}
