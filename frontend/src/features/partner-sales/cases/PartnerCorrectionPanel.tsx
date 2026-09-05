'use client';

import React, { useMemo, useState } from 'react';
import type { PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpField, ErpInlineState, ErpRialInput, ErpSection } from '@/components/erp';
import { FaEdit, FaLock, FaSave } from 'react-icons/fa';

export type PartnerCorrectionStatus = {
  opportunityId: string;
  scope: 'RETAIL_ONLY' | 'SHARED' | 'SABALAN_TERMS' | 'VOID';
  status: 'REQUESTED' | 'APPROVED_TO_EDIT' | 'SAVED' | 'REJECTED' | 'EXPIRED' | 'EFFECTIVE' | 'FAILED';
  expiresAt?: string;
  saved: boolean;
  /** Server-approved future installments that may be included in successor-plan intent. */
  editableCustomerInstallmentIds: readonly string[];
};

export type CustomerPaymentPlanSuccessorIntent = {
  predecessorPlanId: string;
  predecessorVersion: number;
  installments: Array<{ installmentId: string; amount: PartnerCaseView['customerPaymentPlan']['installments'][number]['amount'] }>;
};

const statusCopy: Record<PartnerCorrectionStatus['status'], { label: string; kind: 'success' | 'error' | 'stale' | 'permission' }> = {
  REQUESTED: { label: 'در انتظار بررسی دامنه اصلاح', kind: 'permission' },
  APPROVED_TO_EDIT: { label: 'فرصت ویرایش فعال است', kind: 'success' },
  SAVED: { label: 'ذخیره شد؛ در انتظار تأیید دوباره مشتری', kind: 'stale' },
  REJECTED: { label: 'درخواست اصلاح رد شد', kind: 'error' },
  EXPIRED: { label: 'فرصت اصلاح پایان یافته است', kind: 'error' },
  EFFECTIVE: { label: 'نسخه اصلاح‌شده مؤثر شد', kind: 'success' },
  FAILED: { label: 'اصلاح مؤثر نشد؛ حقیقت قبلی بدون تغییر باقی است', kind: 'error' },
};

export function PartnerCorrectionPanel({ view, correction, pending, onRequest, onSave }: {
  view: PartnerCaseView; correction?: PartnerCorrectionStatus | null; pending: boolean;
  onRequest: (scope: PartnerCorrectionStatus['scope']) => void;
  onSave: (input: { opportunityId: string; retailPrices: Array<{ productRowId: string; amount: string }>; customerPaymentPlanIntent: CustomerPaymentPlanSuccessorIntent }) => void;
}) {
  const initial = useMemo(() => Object.fromEntries(view.products.map(row => [row.productRowId, row.retailUnitPrice])), [view.products]);
  const [prices, setPrices] = useState<Record<string, string>>(initial);
  const [installments, setInstallments] = useState<Record<string, string>>(() => Object.fromEntries(
    view.customerPaymentPlan.installments.map(item => [item.installmentId, item.amount.amount])));
  const editable = correction?.scope === 'RETAIL_ONLY' && correction.status === 'APPROVED_TO_EDIT' && !correction.saved;
  const editableInstallments = correction ? view.customerPaymentPlan.installments.filter(item => correction.editableCustomerInstallmentIds.includes(item.installmentId)) : [];
  if (!correction) return <ErpSection title="اصلاح پرونده"><p className="text-sm text-[var(--sds-text-secondary)]">برای تغییر قیمت فروش، برنامه پرداخت مشتری یا اطلاعات مشترک، ابتدا دامنه اصلاح بررسی می‌شود.</p>
    <div className="mt-4 flex flex-wrap gap-2"><ErpButton label="درخواست اصلاح retail" icon={FaEdit} onClick={() => onRequest('RETAIL_ONLY')} />
      <ErpButton label="درخواست اصلاح مشترک" icon={FaEdit} tone="warning" variant="outline" onClick={() => onRequest('SHARED')} /></div></ErpSection>;
  const status = statusCopy[correction.status];
  return <ErpSection title={correction.scope === 'RETAIL_ONLY' ? 'اصلاح قیمت فروش و پرداخت مشتری' : 'وضعیت اصلاح پرونده'}>
    <div className="space-y-4"><ErpInlineState kind={status.kind} title={status.label} />
      {correction.expiresAt && <div className="flex flex-wrap items-center gap-2"><ErpBadge tone="warning">مهلت: {correction.expiresAt}</ErpBadge>
        <span className="text-xs text-[var(--sds-text-secondary)]">این فرصت فقط یک‌بار ذخیره موفق دارد.</span></div>}
      {editable && <><p className="text-sm text-[var(--sds-text-secondary)]">پس از ذخیره نهایی، ویرایش قفل می‌شود و نسخه تازه فقط بعد از تأیید دوباره مشتری مؤثر خواهد شد.</p>
        <div className="grid gap-3 sm:grid-cols-2">{view.products.map(row => <ErpField key={row.productRowId} label={row.description} hint={`قیمت فعلی: ${row.retailUnitPrice}`}>
          <ErpRialInput value={prices[row.productRowId] || ''} disabled={pending} onValueChange={amount => setPrices(current => ({ ...current, [row.productRowId]: amount }))} />
        </ErpField>)}</div>
        <div><h3 className="mb-1 text-sm font-bold text-[var(--sds-text-primary)]">برنامه پرداخت آینده مشتری</h3>
          <p className="mb-3 text-xs text-[var(--sds-text-secondary)]">فقط اقساط آینده تأییدشده تغییر می‌کنند؛ سرور نسخه جانشین و تاریخ اثر آن را می‌سازد.</p>
          <div className="grid gap-3 sm:grid-cols-2">{editableInstallments.map(item => <ErpField key={item.installmentId} label={`سررسید ${item.dueDate}`}>
          <ErpRialInput value={installments[item.installmentId] || ''} disabled={pending} onValueChange={amount => setInstallments(current => ({ ...current, [item.installmentId]: amount }))} />
        </ErpField>)}</div></div>
        <ErpButton label="ذخیره نهایی اصلاح" icon={FaSave} tone="success" disabled={pending || [...Object.values(prices), ...editableInstallments.map(item => installments[item.installmentId])].some(value => !value)}
          onClick={() => onSave({ opportunityId: correction.opportunityId, retailPrices: view.products.map(row => ({ productRowId: row.productRowId, amount: prices[row.productRowId] })),
            customerPaymentPlanIntent: { predecessorPlanId: view.customerPaymentPlan.planId, predecessorVersion: view.customerPaymentPlan.version,
              installments: editableInstallments.map(item => ({ installmentId: item.installmentId,
                amount: { ...item.amount, amount: installments[item.installmentId] } })) } })} />
      </>}
      {!editable && correction.saved && <div className="flex items-center gap-2 text-sm text-[var(--sds-text-secondary)]"><FaLock />ویرایش این فرصت قفل شده است.</div>}
    </div>
  </ErpSection>;
}
