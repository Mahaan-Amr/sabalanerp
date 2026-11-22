'use client';
import { useState } from 'react';
import api from '@/lib/api';
import { estimateScanClock, type ClockSample } from './clockEstimate';
import { ErpButton, ErpField, ErpInlineState, ErpSection, ErpSelect, ErpSheet, ErpStatus } from '@/components/erp';

type Mapping = { id: string; deviceCode: string; nameSnapshot: string | null; personnelId: string | null; ignored: boolean; initialState: string };
type Terminal = { id: string; name: string; mode: string; activatedAt: string | null; mappings: Mapping[] };
export type InitialReview = { dateKey: string; rows: { mappingId: string; latestScanAt: string | null; scanCount: number }[] };
const statusLabels: Record<string, string> = { UNKNOWN: 'نامعلوم', INSIDE: 'داخل مجموعه', OUTSIDE: 'بیرون مجموعه' };
const clock = (value?: string | null) => value ? new Date(value).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hourCycle: 'h23' }) : 'اسکنی دریافت نشده';

export default function InitialAttendanceReview({ terminals, review, rosterIds, clockSamples, onSaved }: { terminals: Terminal[]; review: InitialReview; rosterIds: string[]; clockSamples: ClockSample[]; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState<Mapping | null>(null);
  const [choice, setChoice] = useState('UNKNOWN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!editing) return;
    setBusy(true); setError('');
    try {
      await api.post(`/attendance-device/mappings/${editing.id}/initial-state`, { initialState: choice, expectedInitialState: editing.initialState, reason: 'ثبت وضعیت اولیه از جدول مرور توسط کاربر مجاز؛ بدون ثبت تردد یا فعال‌سازی.' });
      setEditing(null); await onSaved();
    } catch (e: any) { setError(e.response?.data?.error || 'ثبت وضعیت ناموفق بود.'); }
    finally { setBusy(false); }
  };
  return <>
    {terminals.filter(t => t.mode === 'SHADOW' && !t.activatedAt && t.mappings.some(m => !m.ignored)).map(t => <ErpSection key={t.id} title={`مرور وضعیت اولیه · ${t.name}`}>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[640px] text-right text-sm" aria-label={`مرور وضعیت اولیه ${t.name}`}>
          <thead><tr className="border-b sds-divider"><th scope="col" className="p-3">کد</th><th scope="col" className="p-3">نام پرسنل</th><th scope="col" className="p-3">آخرین اسکن امروز</th><th scope="col" className="p-3">وضعیت بررسی‌شده</th><th scope="col" className="p-3">بررسی</th></tr></thead>
          <tbody>{t.mappings.filter(m => !m.ignored && m.personnelId).sort((a, b) => a.deviceCode.localeCompare(b.deviceCode, 'fa', { numeric: true })).map(m => {
            const scan = review.rows.find(row => row.mappingId === m.id);
            const estimate = estimateScanClock(scan?.latestScanAt, clockSamples.find(sample => sample.terminalId === t.id));
            return <tr key={m.id} className="border-b sds-divider">
              <td className="p-3"><bdi>{m.deviceCode}</bdi></td>
              <th scope="row" className="p-3 font-medium">{m.nameSnapshot}{!rosterIds.includes(m.personnelId!) && <p className="mt-1 font-normal sds-text-secondary">عضو فهرست گارد نیست</p>}</th>
              <td className="p-3"><bdi>{clock(scan?.latestScanAt)}</bdi>{estimate && <p className="mt-1 sds-text-secondary">برآورد با جبران ساعت: <bdi>{clock(estimate.at)}</bdi> · ±{estimate.uncertaintySeconds} ثانیه</p>}</td>
              <td className="p-3"><ErpStatus label={statusLabels[m.initialState] || 'نامعلوم'} tone={m.initialState === 'UNKNOWN' ? 'warning' : 'info'} /></td>
              <td className="p-3"><ErpButton label={`تعیین وضعیت ${m.nameSnapshot || m.deviceCode}`} onClick={() => { setEditing(m); setChoice(m.initialState); setError(''); }} /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </ErpSection>)}
    <ErpSheet presentation="modal" open={Boolean(editing)} onClose={() => !busy && setEditing(null)} pending={busy} title={`وضعیت اولیه ${editing?.nameSnapshot || ''}`} footer={<ErpButton label="ثبت وضعیت اولیه" variant="solid" disabled={busy} onClick={save} />}>
      <div className="space-y-4">
        <ErpInlineState kind="stale" title="وضعیت واقعی را بررسی کنید؛ اگر مطمئن نیستید نامعلوم بماند. این ثبت، ورود یا خروج ایجاد نمی‌کند و ثبت خودکار را فعال نمی‌کند." />
        <p className="sds-text-secondary">کد {editing?.deviceCode} · آخرین اسکن امروز: {clock(review.rows.find(row => row.mappingId === editing?.id)?.latestScanAt)}</p>
        <ErpField label="وضعیت بررسی‌شده اولیه"><ErpSelect value={choice} disabled={busy} onChange={e => setChoice(e.target.value)}><option value="UNKNOWN">نامعلوم؛ نیازمند بررسی</option><option value="INSIDE">داخل مجموعه</option><option value="OUTSIDE">بیرون مجموعه</option></ErpSelect></ErpField>
        {error && <ErpInlineState kind="error" title={error} />}
      </div>
    </ErpSheet>
  </>;
}
