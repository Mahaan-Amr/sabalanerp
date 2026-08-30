'use client';

import React from 'react';
import type { Money, PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpCard, ErpFieldView, ErpInlineState, ErpSection } from '@/components/erp';
import { FaPlus } from 'react-icons/fa';
import { formatPartnerMoney } from '../presentation';

type PaymentPlan = PartnerCaseView['customerPaymentPlan'];
export type RetailCollectionHistory = {
  currentPlan: PaymentPlan;
  historicalPlans: PaymentPlan[];
  receipts: Array<{ receiptId: string; planId: string; amount: Money; effectiveDate: string; status: 'PENDING' | 'POSTED' | 'FAILED' | 'REVERSED' }>;
  collected: Money;
  balance: Money;
};

const statusCopy = { PENDING: ['در حال ثبت', 'warning'], POSTED: ['ثبت‌شده', 'success'], FAILED: ['ناموفق', 'danger'], REVERSED: ['برگشت‌خورده', 'neutral'] } as const;

export function RetailCollectionsPanel({ history, canRecord, onRecord }: { history: RetailCollectionHistory; canRecord: boolean; onRecord?: () => void }) {
  return <div className="space-y-4"><ErpInlineState kind="permission" title="وصول از مشتری خصوصی است و بدهی شما به سبلان را تغییر نمی‌دهد." />
    <div className="grid gap-3 sm:grid-cols-2"><ErpFieldView label="وصول مؤثر مشتری" value={formatPartnerMoney(history.collected.amount, history.collected.currency)} tone="success" />
      <ErpFieldView label="مانده مشتری" value={formatPartnerMoney(history.balance.amount, history.balance.currency)} tone="warning" /></div>
    {canRecord && <div className="flex justify-end"><ErpButton label="ثبت وصول مشتری" icon={FaPlus} onClick={onRecord} /></div>}
    <ErpSection title="تاریخچه وصول"><div className="space-y-2">{history.receipts.map(receipt => { const status = statusCopy[receipt.status]; return <ErpCard key={receipt.receiptId} className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div><strong>{formatPartnerMoney(receipt.amount.amount, receipt.amount.currency)}</strong><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{receipt.effectiveDate} · برنامه {receipt.planId}</p></div><ErpBadge tone={status[1]}>{status[0]}</ErpBadge></ErpCard>; })}</div></ErpSection>
    {history.historicalPlans.length > 0 && <ErpSection title="برنامه‌های تاریخی" description="وصول و برگشت هر دوره به همان برنامه ثبت‌شده متصل می‌ماند.">
      <div className="flex flex-wrap gap-2">{history.historicalPlans.map(plan => <ErpBadge key={plan.planId} tone="neutral">نسخه {plan.version.toLocaleString('fa-IR')} · {plan.effectiveDate}</ErpBadge>)}</div></ErpSection>}
  </div>;
}
