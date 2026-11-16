'use client';
import React from 'react';
import { ErpButton, ErpField, ErpInput, ErpInlineState, ErpPersianDateField } from '@/components/erp';

type Details = { systemInvoiceNumber: string; systemInvoiceDate: string; sepidarAmount: string };
type RecordView = { id: string; amount: string; currency?: string; draftDetails?: Partial<Details> | null };
const values = (record: RecordView): Details => ({ systemInvoiceNumber: record.draftDetails?.systemInvoiceNumber ?? '',
  systemInvoiceDate: record.draftDetails?.systemInvoiceDate ?? '', sepidarAmount: record.draftDetails?.sepidarAmount ?? '' });

export function InvoiceDraftEditor({ record, canSave, canApprove, busy, onSave, onApprove, onDirtyChange }:
  { record: RecordView; canSave: boolean; canApprove: boolean; busy: boolean;
    onSave: (details: Details) => Promise<boolean>; onApprove: (details: Details) => Promise<boolean>;
    onDirtyChange?: (dirty: boolean) => void }) {
  const [initial, setInitial] = React.useState(() => values(record));
  const [details, setDetails] = React.useState(() => values(record));
  React.useEffect(() => { const next = values(record); setInitial(next); setDetails(next); }, [record.id]);
  const dirty = JSON.stringify(initial) !== JSON.stringify(details);
  React.useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  const missing = [!details.systemInvoiceNumber.trim() && 'شماره فاکتور', !details.systemInvoiceDate.trim() && 'تاریخ فاکتور',
    (!details.sepidarAmount.trim() || !Number.isFinite(Number(details.sepidarAmount)) || Number(details.sepidarAmount) <= 0) && 'مبلغ سپیدار'].filter(Boolean);
  if (details.sepidarAmount.trim() && Number(details.sepidarAmount) > 0 && Number(details.sepidarAmount) !== Number(record.amount)) missing.push('برابری مبلغ سپیدار با صورتحساب');
  const update = (name: keyof Details, value: string) => setDetails(current => ({ ...current, [name]: value }));
  const save = async () => { if (await onSave(details)) setInitial(details); };
  return <div className="space-y-3">
    <ErpInlineState kind="empty" title="پیش‌نویس ذخیره‌شده هنوز تأیید مالی نشده است." />
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <ErpField label="شماره فاکتور سیستمی"><ErpInput value={details.systemInvoiceNumber} disabled={busy || (!canSave && !canApprove)} onChange={e => update('systemInvoiceNumber', e.target.value)} /></ErpField>
      <ErpPersianDateField label="تاریخ فاکتور سیستمی" valueFormat="iso-date" value={details.systemInvoiceDate} disabled={busy || (!canSave && !canApprove)} onChange={value => update('systemInvoiceDate', value)} />
      <ErpField label="مبلغ سپیدار (ریال)"><ErpInput value={details.sepidarAmount} disabled={busy || (!canSave && !canApprove)} onChange={e => update('sepidarAmount', e.target.value)} inputMode="decimal" dir="ltr" /></ErpField>
    </div>
    {missing.length > 0 && <p className="sds-text-secondary text-sm">برای تأیید لازم است: {missing.join('، ')}</p>}
    <div className="flex flex-wrap gap-2">
      {canSave && <ErpButton label="ذخیره پیش‌نویس" disabled={busy || !dirty} onClick={save} />}
      {canApprove && <ErpButton label="تأیید مالی" tone="success" disabled={busy || missing.length > 0} onClick={() => onApprove(details)} />}
    </div>
  </div>;
}
