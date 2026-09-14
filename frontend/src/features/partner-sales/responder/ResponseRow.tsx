'use client';

import React from 'react';
import type { PartnerQueryV2Results } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpCard, ErpCheckbox, ErpField, ErpInput, ErpSegmentedControl, ErpTextarea } from '@/components/erp';
import type { ResponseDraft } from './responseDraft';

const families = { longitudinal: 'سنگ طولی', stair: 'پله', slab: 'اسلب', prepared: 'سنگ آماده', volumetric: 'سنگ حجمی' };
const units: Record<string, string> = { count: 'عدد', squareMeter: 'متر مربع', ton: 'تن', meter: 'متر', m: 'متر' };

export function ResponseRow({ row, number, canRespond, status, draft, pending, error, onChange }: {
  row: PartnerQueryV2Results['RESPONDER_INQUIRY']['rows'][number]; number: number;
  canRespond: boolean; status: React.ReactNode; draft: ResponseDraft; pending: boolean;
  error?: string; onChange: (draft: ResponseDraft) => void;
}) {
  const currency = row.identity.currency === 'IRR' ? 'ریال' : 'تومان';
  return <ErpCard className="min-w-0 space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--sds-border-subtle)] pb-4">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold sds-text-secondary">ردیف {number} · {families[row.identity.family]}</p>
        <h3 className="break-words text-lg font-bold text-[var(--sds-text-primary)]">{row.description}</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        <ErpBadge tone="neutral">واحد قیمت: {units[row.identity.unit] || row.identity.unit}</ErpBadge>
        <ErpBadge tone={row.used ? 'info' : 'neutral'}>{row.used ? 'استفاده شده در پرونده' : 'هنوز استفاده نشده'}</ErpBadge>
      </div>
    </div>
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="مشخصات فنی درخواست">
      {row.configuration.map((item, index) => <div key={`${item.label}-${index}`} className="min-w-0">
        <dt className="text-xs font-semibold sds-text-secondary">{item.label}</dt>
        <dd className="mt-1 break-words font-medium text-[var(--sds-text-primary)]">{item.value}</dd>
      </div>)}
    </dl>
    {row.approvedPrice && <p>قیمت مصوب هر واحد: <b dir="ltr">{row.approvedPrice.amount}</b> {row.approvedPrice.currency === 'IRR' ? 'ریال' : 'تومان'}</p>}
    <div className="sds-text-secondary text-sm" role="status">{status}</div>
    {canRespond && <div className="space-y-4 rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-4">
      <p className="font-bold text-[var(--sds-text-primary)]">پاسخ قیمت این ردیف</p>
      <ErpCheckbox checked={draft.selected} onChange={event => onChange({ ...draft, selected: event.target.checked })}
        disabled={pending} label={`انتخاب ردیف ${number}`} />
      <ErpSegmentedControl value={draft.outcome} onChange={outcome => onChange({ ...draft, outcome })}
        options={[{ value: 'APPROVED', label: 'تأیید قیمت', disabled: pending }, { value: 'REJECTED', label: 'رد ردیف', disabled: pending }]} />
      {draft.outcome === 'APPROVED' && <ErpField label={`قیمت هر واحد ردیف ${number} (${currency})`} required error={error}>
        <ErpInput inputMode="decimal" dir="ltr" value={draft.amount} maxLength={80} disabled={pending}
          onChange={event => onChange({ ...draft, amount: event.target.value })} />
      </ErpField>}
      <ErpField label={draft.outcome === 'REJECTED' ? `دلیل رد ردیف ${number}` : `یادداشت ردیف ${number} (اختیاری)`}
        required={draft.outcome === 'REJECTED'} error={draft.outcome === 'REJECTED' ? error : undefined}>
        <ErpTextarea rows={2} value={draft.note} maxLength={2000} disabled={pending}
          onChange={event => onChange({ ...draft, note: event.target.value })} />
      </ErpField>
    </div>}
  </ErpCard>;
}
