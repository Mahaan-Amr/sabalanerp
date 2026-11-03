'use client';

import React from 'react';
import type { PartnerQueryResults } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpCard, ErpCheckbox, ErpField, ErpInput, ErpSegmentedControl, ErpTextarea } from '@/components/erp';
import type { ResponseDraft } from './responseDraft';

const families = { longitudinal: 'سنگ طولی', stair: 'پله', slab: 'اسلب', prepared: 'سنگ آماده', volumetric: 'سنگ حجمی' };
const configurationLabels: Record<string, string> = { width: 'عرض', length: 'طول', thickness: 'ضخامت', finish: 'پرداخت', edge: 'لبه', tool: 'ابزار' };

export function ResponseRow({ row, number, canRespond, status, draft, pending, error, onChange }: {
  row: PartnerQueryResults['RESPONDER_INQUIRY']['rows'][number]; number: number;
  canRespond: boolean; status: React.ReactNode; draft: ResponseDraft; pending: boolean;
  error?: string; onChange: (draft: ResponseDraft) => void;
}) {
  const currency = row.identity.currency === 'IRR' ? 'ریال' : 'تومان';
  return <ErpCard className="min-w-0 space-y-4 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-bold">ردیف {number} · {families[row.identity.family]}</h3>
      <ErpBadge tone={row.used ? 'info' : 'neutral'}>{row.used ? 'استفاده شده در پرونده' : 'هنوز استفاده نشده'}</ErpBadge>
    </div>
    <dl className="grid grid-cols-2 gap-3">
      {row.identity.configuration.map((item, index) => <div key={`${item.key}-${index}`} className="min-w-0">
        <dt className="sds-text-secondary text-sm">{configurationLabels[item.key] || `ویژگی ${index + 1}`}</dt>
        <dd className="break-words font-medium">{item.value}</dd>
      </div>)}
      <div><dt className="sds-text-secondary text-sm">واحد</dt><dd>{row.identity.unit}</dd></div>
    </dl>
    {row.approvedPrice && <p>قیمت مصوب هر واحد: <b dir="ltr">{row.approvedPrice.amount}</b> {row.approvedPrice.currency === 'IRR' ? 'ریال' : 'تومان'}</p>}
    <div className="sds-text-secondary text-sm" role="status">{status}</div>
    {canRespond && <div className="space-y-4">
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
