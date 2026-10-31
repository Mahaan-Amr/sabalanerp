'use client';
import React from 'react';
import { FaDownload, FaPrint } from 'react-icons/fa';
import { ErpButton, ErpField, ErpSelect, ErpInlineState } from '@/components/erp';

export const accountingContractTabs = [
  { value: 'summary', label: 'خلاصه' }, { value: 'items', label: 'اقلام' },
  { value: 'financial', label: 'رکوردهای مالی' }, { value: 'collections', label: 'دریافت‌ها' },
  { value: 'compliance', label: 'مالیات و اصلاحات' },
] as const;

/** Shared Accounting print action layout; each source owns its authorized PDF. */
export default function AccountingContractPrintActions({ value, options, onChange, pending, blockedReason, onDownload, onPrint }: {
  value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void;
  pending: boolean; blockedReason?: string; onDownload: () => void; onPrint: () => void;
}) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
    <div className="min-w-0 flex-1"><ErpField label="نسخه چاپ">
      <ErpSelect value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </ErpSelect>
    </ErpField></div>
    <div className="flex flex-wrap gap-2">
      <ErpButton label="دانلود PDF" icon={FaDownload} tone="success" disabled={pending || Boolean(blockedReason)} onClick={onDownload} />
      <ErpButton label="چاپ" icon={FaPrint} tone="purple" disabled={pending || Boolean(blockedReason)} onClick={onPrint} />
    </div>
    {blockedReason && <ErpInlineState kind="stale" title={blockedReason} />}
  </div>;
}
