'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInlineState, ErpSheet, ErpTextarea } from '@/components/erp';
type Case = { personnelId: string; name: string; date: string; evidenceHash: string; issueLabels: string[]; requiredMinutes: number | null; canConfirm: boolean };
export default function AttendanceAbsenceCases({ onChange }: { onChange?: () => void }) {
  const [rows, setRows] = useState<Case[]>([]), [selected, setSelected] = useState<Case | null>(null), [reason, setReason] = useState(''), [absent, setAbsent] = useState(false), [noAuthorization, setNoAuthorization] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(async () => { const response = await api.get('/attendance-device/absence-cases'); setRows(response.data.data); }, []);
  useEffect(() => { void load().catch(() => setError('دریافت روزهای نیازمند رسیدگی ناموفق بود.')); const timer = setInterval(() => { void load().catch(() => undefined); }, 15000); return () => clearInterval(timer); }, [load]);
  const confirm = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try { await api.post('/attendance-device/absence-decisions', { personnelId: selected.personnelId, date: selected.date, evidenceHash: selected.evidenceHash, reason, confirmedAbsent: absent, confirmedNoAuthorization: noAuthorization }); setSelected(null); await load(); onChange?.(); }
    catch (e: any) { setError(e.response?.data?.error || 'ثبت تصمیم ناموفق بود.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2">
    {error && !selected && <ErpInlineState kind="error" title={error} />}
    {rows.length > 0 && <ErpInlineState kind="stale" title={`${rows.length.toLocaleString('fa-IR')} روز حضور نیازمند تعیین تکلیف است؛ نبود اسکن، غیبت قطعی نیست.`} />}
    {rows.map(row => <ErpCard className="space-y-2 p-3" key={`${row.personnelId}:${row.date}`}><strong>{row.name} · {new Date(`${row.date}T12:00:00Z`).toLocaleDateString('fa-IR', { timeZone: 'UTC' })}</strong><p className="text-sm sds-text-secondary">{row.issueLabels.join(' · ')}</p>{row.canConfirm && <ErpButton label="ثبت واقعیت عدم حضور" tone="warning" onClick={() => { setSelected(row); setReason(''); setAbsent(false); setNoAuthorization(false); setError(''); }} />}</ErpCard>)}
    <ErpSheet presentation="modal" open={Boolean(selected)} pending={busy} onClose={() => !busy && setSelected(null)} title={`تعیین تکلیف عدم حضور ${selected?.name || ''}`} footer={<ErpButton label="ثبت تصمیم حسابرسی‌شده" disabled={busy || !absent || !noAuthorization || !reason.trim()} onClick={confirm} />}>
      <div className="space-y-4"><ErpInlineState kind="stale" title="این تصمیم کسری روز را قطعی می‌کند؛ ورود یا خروج فرضی نمی‌سازد و تصمیم کسر حقوق نیست." />
        <ErpCheckbox label="عدم حضور واقعی در ساعات موظفی پوشش‌داده‌نشده این روز را تأیید می‌کنم" checked={absent} onChange={e => setAbsent(e.target.checked)} />
        <ErpCheckbox label="برای ساعات پوشش‌داده‌نشده، مجوز مرخصی یا مأموریت دیگری وجود ندارد" checked={noAuthorization} onChange={e => setNoAuthorization(e.target.checked)} />
        <ErpField label="دلیل و مبنای بررسی"><ErpTextarea value={reason} onChange={e => setReason(e.target.value)} /></ErpField>{error && <ErpInlineState kind="error" title={error} />}
      </div>
    </ErpSheet>
  </div>;
}
