'use client';

import React from 'react';
import { ErpBadge, ErpButton, ErpCard, ErpInlineState } from '@/components/erp';
import {
  inquiryMoney, inquiryRowState, inquiryStateLabel, inquirySummary,
  persianCount, usableInquiryRows, type PartnerInquiryRow, type PartnerInquiryView,
} from './inquiryPresentation';

export interface PartnerInquiryPanelProps {
  inquiry: PartnerInquiryView;
  now: number;
  pending: boolean;
  onRefresh: () => void;
  onReinquire: (row: PartnerInquiryRow) => void;
  onEnterWizard: (rows: PartnerInquiryRow[]) => void;
  onOpenInquiry?: (inquiryId: string) => void;
  mismatchedRowIds?: readonly string[];
}

export function PartnerInquiryPanel({ inquiry, now, pending, onRefresh, onReinquire, onEnterWizard, onOpenInquiry, mismatchedRowIds = [] }: PartnerInquiryPanelProps) {
  const usable = usableInquiryRows(inquiry, now).filter(row => !mismatchedRowIds.includes(row.rowId));
  return <section dir="rtl" aria-label="استعلام قیمت" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold">{inquirySummary(inquiry)}</h2>
      <ErpButton label="تازه‌سازی پاسخ‌ها" variant="outline" disabled={pending} onClick={onRefresh} />
    </div>
    <div className="space-y-3" aria-live="polite" aria-busy={pending}>
      {inquiry.rows.map(row => {
        const state = inquiryRowState(row, now);
        const expiring = state === 'APPROVED' && row.expiresAt && Date.parse(row.expiresAt) - now <= 6 * 60 * 60 * 1000;
        return <ErpCard key={row.rowId} className="min-w-0 space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 break-words font-semibold">{row.description}</h3>
            <ErpBadge tone={state === 'APPROVED' ? 'success' : state === 'PENDING' ? 'info' : 'warning'}>{inquiryStateLabel[state]}</ErpBadge>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--sds-text-secondary)]">
            {row.configuration.map((fact, index) => <div key={`${fact.label}:${index}`} className="flex flex-wrap gap-1"><dt>{fact.label}:</dt><dd className="break-words">{fact.value}</dd></div>)}
          </dl>
          {row.approvedPrice && <p className="text-sm">قیمت فروش سبلان به شما: <strong>{inquiryMoney(row)}</strong></p>}
          {row.expiresAt && <p className="text-sm text-[var(--sds-text-secondary)]">اعتبار تا {new Date(row.expiresAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })}</p>}
          {row.noteOrReason && <p className="break-words text-sm">{row.noteOrReason}</p>}
          {row.predecessor && <div className="space-y-1 text-sm text-[var(--sds-text-secondary)]">
            <p>استعلام مجدد: {row.predecessor.reason}</p>
            {onOpenInquiry && <ErpButton label="مشاهده استعلام قبلی" variant="ghost" onClick={() => onOpenInquiry(row.predecessor!.inquiryId)} />}
          </div>}
          {row.successor && <div className="space-y-1 text-sm text-[var(--sds-text-secondary)]">
            <p>استعلام بعدی: {inquiryStateLabel[row.successor.state]}</p>
            {onOpenInquiry && <ErpButton label="مشاهده استعلام بعدی" variant="ghost" onClick={() => onOpenInquiry(row.successor!.inquiryId)} />}
          </div>}
          {mismatchedRowIds.includes(row.rowId) && <ErpInlineState kind="stale" title="مشخصات محصول تغییر کرده است؛ قیمت جدید استعلام بگیرید." />}
          {expiring && <ErpInlineState kind="stale" title="کمتر از شش ساعت تا پایان اعتبار قیمت باقی مانده است." />}
          {(['REJECTED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'].includes(state) || mismatchedRowIds.includes(row.rowId)) && <ErpButton label="استعلام مجدد" variant="outline" disabled={pending || row.successor?.state === 'PENDING'} onClick={() => onReinquire(row)} />}
        </ErpCard>;
      })}
    </div>
    <div aria-label="آمادگی پرونده" className="sticky bottom-0 z-10 flex flex-col gap-3 rounded-[var(--sds-radius-card)] border border-[var(--sds-border-default)] bg-[var(--sds-surface-panel)] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="font-bold">{persianCount(usable.length)} ردیف آماده</p><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">قیمت فروش به مشتری پیش از ثبت قابل تغییر است.</p></div>
      <ErpButton label="ساخت پرونده و ورود به Wizard" variant="solid" disabled={pending || usable.length === 0} onClick={() => onEnterWizard(usable)} className="w-full sm:w-auto" />
    </div>
  </section>;
}
