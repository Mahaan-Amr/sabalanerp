'use client';
import { WHOLESALE_MANDATORY_DEFAULT_PERCENTAGE } from '@sabalanerp/partner-sales-contracts';

import React from 'react';
import type { PartnerQueryV2Results } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpCard, ErpField, ErpInput, ErpRialInput, ErpSegmentedControl, ErpTextarea } from '@/components/erp';
import { formatPartnerMoney } from '../presentation';
import type { ResponseDraft } from './responseDraft';
import { CompactSwitch } from '@/features/contract-creation/components/product-modal-system/productModalPrimitives';

const families = { longitudinal: 'سنگ طولی', stair: 'پله', slab: 'اسلب', prepared: 'سنگ آماده', volumetric: 'سنگ حجمی' };
const units: Record<string, string> = { count: 'عدد', squareMeter: 'متر مربع', ton: 'تن', meter: 'متر', m: 'متر' };

export function ResponseRow({ row, number, canRespond, status, draft, pending, error, onChange }: {
  row: PartnerQueryV2Results['RESPONDER_INQUIRY']['rows'][number]; number: number;
  canRespond: boolean; status: React.ReactNode; draft: ResponseDraft; pending: boolean;
  error?: string; onChange: (draft: ResponseDraft) => void;
}) {
  const currency = row.identity.currency === 'IRR' ? 'ریال' : 'تومان';
  return <ErpCard className="min-w-0 space-y-3 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold sds-text-secondary">گروه {number.toLocaleString('fa-IR')} · {families[row.identity.family]}</p>
        <h3 className="break-words text-base font-bold text-[var(--sds-text-primary)]">{row.description}</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        <ErpBadge tone="neutral">واحد قیمت: {units[row.identity.unit] || row.identity.unit}</ErpBadge>
        <ErpBadge tone={row.used ? 'info' : 'neutral'}>{row.used ? 'استفاده شده در پرونده' : 'هنوز استفاده نشده'}</ErpBadge>
      </div>
    </div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-2" aria-label="مشخصات فنی درخواست">
      {row.configuration.map((item, index) => <div key={`${item.label}-${index}`} className="min-w-0">
        <dt className="text-xs font-semibold sds-text-secondary">{item.label}</dt>
        <dd className="mt-1 break-words font-medium text-[var(--sds-text-primary)]">{item.value}</dd>
      </div>)}
    </dl>
    {row.deliveryFacts?.length ? <div className="space-y-2" aria-label="برنامه تحویل لازم برای قیمت‌گذاری">
      <p className="text-sm font-bold">برنامه تحویل</p>
      {row.deliveryFacts.map((fact, index) => <p key={`${fact.date}-${index}`} className="text-sm sds-text-secondary">
        {fact.date} · مقدار {fact.quantity} {units[row.identity.unit] || row.identity.unit}
      </p>)}
    </div> : null}
    {row.sellerNote && <p className="rounded-xl bg-[var(--sds-surface-subtle)] p-3 text-sm">یادداشت فروشنده: {row.sellerNote}</p>}
    {row.approvedPrice && <p>قیمت مصوب هر واحد: <b>{formatPartnerMoney(row.approvedPrice.amount, row.approvedPrice.currency)}</b></p>}
    <div className="sds-text-secondary text-sm" role="status">{status}</div>
    {canRespond && <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
      <div className="sm:col-span-2"><ErpSegmentedControl value={draft.outcome} onChange={outcome => onChange({ ...draft, outcome })}
        options={[{ value: 'APPROVED', label: 'ثبت قیمت سبلان', disabled: pending }, { value: 'REJECTED', label: 'رد جهت اصلاح', disabled: pending }]} /></div>
      {draft.outcome === 'APPROVED' && <ErpField label={`قیمت هر ${units[row.identity.unit] || row.identity.unit} (${currency})`} required error={error}>
        <ErpRialInput dir="ltr" value={draft.amount} maxDigits={18} disabled={pending}
          onValueChange={amount => onChange({ ...draft, amount })} />
      </ErpField>}
      {draft.outcome === 'APPROVED' && <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm font-semibold">حکمی سبلان</span>
        <CompactSwitch label="حکمی سبلان" checked={draft.mandatoryEnabled ?? false} disabled={pending}
          onChange={mandatoryEnabled => onChange({ ...draft, mandatoryEnabled, mandatoryPercentage: draft.mandatoryPercentage ?? WHOLESALE_MANDATORY_DEFAULT_PERCENTAGE })} />
        {draft.mandatoryEnabled && <ErpField label="درصد حکمی سبلان" required>
          <ErpInput dir="ltr" inputMode="decimal" value={draft.mandatoryPercentage ?? WHOLESALE_MANDATORY_DEFAULT_PERCENTAGE} maxLength={80} disabled={pending}
            onChange={event => onChange({ ...draft, mandatoryPercentage: event.target.value })} />
        </ErpField>}
      </div>}
      {draft.outcome === 'REJECTED' && <ErpField label={`دلیل رد ردیف ${number}`}
        required error={error}>
        <ErpTextarea rows={2} value={draft.note} maxLength={2000} disabled={pending}
          onChange={event => onChange({ ...draft, note: event.target.value })} />
      </ErpField>}
    </div>}
  </ErpCard>;
}
