'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { ErpButton, ErpCheckbox, ErpField, ErpInlineState, ErpSelect, ErpSheet, ErpTextarea } from '@/components/erp';

type Times = { enteredAt: string | null; exitedAt: string | null; exitUnknown: boolean; status: string };
type Preview = { before: Times; after: Times; fingerprint: string; expiresAt: string };
export type CorrectionTarget = { id: string; name: string };
const describe = (row: Times) => {
  const stamp = (v: string) => new Date(v).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
  return `${row.enteredAt ? stamp(row.enteredAt) : 'ورود با ساعت نامعلوم'} تا ${row.exitUnknown ? 'خروج با ساعت نامعلوم' : row.exitedAt ? stamp(row.exitedAt) : 'حضور باز'}${row.status === 'VOIDED' ? ' · باطل‌شده' : ''}`;
};
export function AuditedAttendanceCorrection({ target, onClose, onSaved }: { target: CorrectionTarget | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [action, setAction] = useState(''); const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null); const [facts, setFacts] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setAction(''); setReason(''); setPreview(null); setFacts({}); setConfirm(false); setError(''); }, [target?.id]);
  const resetPreview = () => { setPreview(null); setFacts({}); setConfirm(false); setError(''); };
  const run = async (apply: boolean) => {
    if (!target) return; setBusy(true); setError('');
    try {
      const response = await api.post(`/attendance-device/intervals/${target.id}/${apply ? 'correction' : 'correction-preview'}`, {
        action, reason, ...(apply ? { fingerprint: preview?.fingerprint, expiresAt: preview?.expiresAt, facts, confirmApply: confirm } : {}),
      });
      if (apply) { await onSaved(); onClose(); } else { setPreview(response.data.data); setFacts({}); setConfirm(false); }
    } catch (e: any) { setError(e.response?.data?.error || 'بررسی اصلاح ناموفق بود.'); setPreview(null); setFacts({}); setConfirm(false); }
    finally { setBusy(false); }
  };
  const factsReady = action === 'UNKNOWN_EXIT' ? facts.entryReviewed && facts.departureConfirmed : facts.incorrectIntervalConfirmed;
  return <ErpSheet presentation="modal" open={Boolean(target)} pending={busy} onClose={onClose} title={`اصلاح حسابرسی‌شده ${target?.name || ''}`} footer={<div className="flex flex-wrap justify-end gap-2">
    <ErpButton label="انصراف" variant="ghost" onClick={onClose} disabled={busy} />
    {preview ? <ErpButton label="ثبت اصلاح بررسی‌شده" variant="solid" disabled={busy || !factsReady || !confirm} onClick={() => run(true)} /> : <ErpButton label="نمایش پیش‌نمایش اصلاح" disabled={busy || !action || !reason.trim()} onClick={() => run(false)} />}
  </div>}>
    <div className="space-y-4">
      {error && <ErpInlineState kind="error" title={error} />}
      <ErpInlineState kind="stale" title="تا روشن‌شدن واقعیت‌ها، انصراف دهید؛ هیچ ساعت حدسی ثبت نکنید." />
      <ErpField label="نوع اصلاح"><ErpSelect value={action} disabled={busy} onChange={e => { resetPreview(); setAction(e.target.value); }}><option value="">انتخاب تصمیم</option><option value="UNKNOWN_EXIT">خروج انجام شده؛ ساعت نامعلوم</option><option value="VOID">این بازه اشتباه ثبت شده است</option></ErpSelect></ErpField>
      <ErpField label="دلیل و مبنای اصلاح"><ErpTextarea value={reason} maxLength={1000} disabled={busy} onChange={e => { resetPreview(); setReason(e.target.value); }} /></ErpField>
      {preview && <>
        <dl className="space-y-2 text-sm"><div><dt className="font-semibold">قبل</dt><dd>{describe(preview.before)}</dd></div><div><dt className="font-semibold">بعد از اصلاح پیشنهادی</dt><dd>{describe(preview.after)}</dd></div></dl>
        {action === 'UNKNOWN_EXIT' ? <>
          <ErpInlineState kind="stale" title="ساعت خروج قبلی در سابقه حفظ می‌شود؛ مدت نامعلوم، صفر کارکرد نیست. ورود ثبت‌شده نیز باید بررسی شود." />
          <ErpCheckbox label="درست‌بودن ورود یا مشاهدهٔ حضور ثبت‌شدهٔ این بازه را تأیید می‌کنم" checked={Boolean(facts.entryReviewed)} disabled={busy} onChange={e => setFacts(f => ({ ...f, entryReviewed: e.target.checked }))} />
          <ErpCheckbox label="خروج واقعاً انجام شده و ساعت ثبت‌شدهٔ خروج قابل اتکا نیست یا معلوم نیست" checked={Boolean(facts.departureConfirmed)} disabled={busy} onChange={e => setFacts(f => ({ ...f, departureConfirmed: e.target.checked }))} />
        </> : <ErpCheckbox label="اشتباه‌بودن این بازه را تأیید می‌کنم؛ سابقه و زمان‌های اولیه حفظ شوند" checked={Boolean(facts.incorrectIntervalConfirmed)} disabled={busy} onChange={e => setFacts({ incorrectIntervalConfirmed: e.target.checked })} />}
        <ErpCheckbox label="پیش‌نمایش و دلیل را بررسی کردم؛ اصلاح ثبت شود" checked={confirm} disabled={busy} onChange={e => setConfirm(e.target.checked)} />
      </>}
    </div>
  </ErpSheet>;
}
