'use client';

import React from 'react';
import type { PartnerAccountView } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpCard, ErpEmptyState, ErpFieldView, ErpInlineState } from '@/components/erp';
import { FaMoneyCheckAlt } from 'react-icons/fa';
import { formatPartnerMoney, partnerPaymentMethodCopy } from '../presentation';

const statusCopy = { AWAITING_REVIEW: ['در انتظار بررسی', 'warning'], PAYABLE: ['قابل پرداخت', 'info'], PARTIALLY_PAID: ['بخشی پرداخت‌شده', 'warning'], SETTLED: ['تسویه‌شده', 'success'], VOIDED: ['باطل‌شده', 'danger'] } as const;
export function PartnerAccountPanel({ view }: { view: PartnerAccountView }) {
  return <section aria-labelledby="partner-account-title" className="space-y-4"><div><h2 id="partner-account-title" className="text-xl font-black text-[var(--sds-text-primary)]">حساب من با سبلان</h2>
    <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">نمای فقط‌خواندنی از خریدها، پرداخت‌های ثبت‌شده و مانده حسابداری</p></div>
    <ErpInlineState kind="permission" title="این نما فقط‌خواندنی است؛ ثبت و بررسی اسناد مالی در حسابداری انجام می‌شود." />
    {!view.purchases.length ? <ErpEmptyState icon={FaMoneyCheckAlt} title="خریدی در حساب ثبت نشده است" /> : <div className="space-y-3">{view.purchases.map(item => { const status = statusCopy[item.status]; return <ErpCard key={`${item.owner.caseId}:${item.owner.revision}`} className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>پرونده {item.caseNumber}</strong><ErpBadge tone={status[1]}>{status[0]}</ErpBadge></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><ErpFieldView label="خرید" value={formatPartnerMoney(item.amount.amount, item.amount.currency)} />
        <ErpFieldView label="پرداخت ثبت‌شده" value={formatPartnerMoney(item.received.amount, item.received.currency)} tone="success" />
        <ErpFieldView label="مانده" value={formatPartnerMoney(item.balance.amount, item.balance.currency)} tone="warning" /></div>
      <div className="mt-4"><h3 className="mb-2 text-sm font-bold text-[var(--sds-text-primary)]">برنامه پرداخت به سبلان</h3>
        <div className="grid gap-2 sm:grid-cols-2">{item.sabalanPaymentPlan.installments.map(installment => <ErpFieldView key={installment.installmentId}
          label={`سررسید ${installment.dueDate}`} value={formatPartnerMoney(installment.amount.amount, installment.amount.currency)}
          hint={partnerPaymentMethodCopy[installment.method]} />)}</div></div>
    </ErpCard>; })}</div>}
  </section>;
}
