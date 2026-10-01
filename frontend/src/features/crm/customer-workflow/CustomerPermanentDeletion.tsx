'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { ErpButton, ErpField, ErpInlineState, ErpLoading, ErpSheet, ErpTextarea } from '@/components/erp';

type Preview = { mode?: 'RETAIN_HISTORY' | 'REMOVE_UNUSED'; retained?: Array<{ label: string; count: number }>; name: string; eligible: boolean; previewToken: string; blockers: Array<{ label: string; count: number }>;
  affected: Record<'phones' | 'contacts' | 'projects', Array<{ id: string; label: string }>> };
export function CustomerPermanentDeletion({ customerId, onClose, onDeleted }: {
  customerId: string | null; onClose: () => void; onDeleted: (receiptId: string) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setPreview(null); setError(null); setReason('');
    if (!customerId) return;
    setLoading(true);
    api.get(`/crm/customers/${customerId}/deletion-preview`).then(response => {
      if (active) setPreview(response.data.data);
    }).catch(error => { if (active) setError(error.response?.data?.error || 'پیش‌نمایش حذف دریافت نشد.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [customerId, revision]);
  const remove = async () => {
    if (!customerId || !preview?.eligible || pending) return;
    setPending(true); setError(null);
    try {
      const response = await api.delete(`/crm/customers/${customerId}`, { data: { reason: reason.trim(), confirmed: true, previewToken: preview.previewToken } });
      onDeleted(response.data.data.receiptId);
    } catch (error: any) {
      setError(error.response?.data?.error || 'حذف انجام نشد.');
      // A stale or newly blocked preview must never be reused for another command.
      setPreview(null);
    } finally { setPending(false); }
  };
  return <ErpSheet open={Boolean(customerId)} onClose={onClose} title="حذف دائمی مشتری" presentation="modal" pending={pending}
    footer={<div className="flex flex-wrap gap-2">
      <ErpButton label={pending ? 'در حال حذف…' : 'تأیید و حذف دائمی'} tone="danger" variant="solid" onClick={remove}
        disabled={pending || loading || !preview?.eligible || reason.trim().length < 3} />
      <ErpButton label="انصراف" variant="ghost" onClick={onClose} disabled={pending} />
    </div>}>
    {loading && <ErpLoading />}
    {preview && <div className="space-y-4">
      <p className="font-semibold">{preview.name}</p>
      {preview.eligible ? <>
        <ErpInlineState kind="stale" title={preview.mode === 'RETAIN_HISTORY'
          ? 'کارت مشتری برای همیشه از CRM و انتخاب مشتری جدید حذف می‌شود. سوابق و مشخصات تاریخی او حفظ می‌شوند؛ دلیل و رسید حذف ثبت می‌شود.'
          : 'حذف دائمی قابل بازگشت نیست. کارت مشتری و موارد زیر حذف می‌شوند؛ دلیل، اقدام‌کننده و زمان ثبت می‌شود.'} />
        {preview.mode === 'RETAIN_HISTORY' && <div><p className="font-medium">سوابق محفوظ</p>
          <ul className="list-inside list-disc">{preview.retained?.map(item => <li key={item.label}>{item.label}: {item.count.toLocaleString('fa-IR')}</li>)}</ul>
          <p className="text-sm sds-text-secondary">شماره‌ها، مخاطبان و نشانی‌های زیر نیز فقط به‌عنوان اطلاعات تاریخی نگهداری می‌شوند.</p></div>}
        {([['phones', 'شماره‌های تماس'], ['contacts', 'مخاطبان'], ['projects', 'نشانی پروژه‌ها']] as const).map(([key, label]) =>
          <div key={key}><p className="font-medium">{label} ({preview.affected[key].length.toLocaleString('fa-IR')})</p>
            <ul className="list-inside list-disc text-sm">{preview.affected[key].map(item => <li key={item.id}>{item.label}</li>)}</ul>
          </div>)}
        <ErpField label="دلیل حذف" required><ErpTextarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} /></ErpField>
      </> : <>
        <ErpInlineState kind="stale" title="این مشتری سابقه دارد و قابل حذف دائمی نیست." />
        <ul className="list-inside list-disc">{preview.blockers.map(blocker => <li key={blocker.label}>{blocker.label}: {blocker.count.toLocaleString('fa-IR')}</li>)}</ul>
      </>}
    </div>}
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'دریافت دوباره پیش‌نمایش', onClick: () => setRevision(value => value + 1) }} />}
  </ErpSheet>;
}
