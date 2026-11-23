'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInlineState, ErpSelect, ErpSheet, ErpTextarea } from '@/components/erp';
type Case = { personnelId: string; name: string; date: string; evidenceHash: string; issueLabels: string[]; requiredMinutes: number | null; canConfirm: boolean };
type Assignee = { userId: string; user: { firstName: string; lastName: string } };
export default function AttendanceAbsenceCases({ assignees, onChange }: { assignees: Assignee[]; onChange?: () => void | Promise<void> }) {
  const [rows, setRows] = useState<Case[]>([]), [selected, setSelected] = useState<Case | null>(null), [reason, setReason] = useState(''), [absent, setAbsent] = useState(false), [noAuthorization, setNoAuthorization] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [handoverRequired, setHandoverRequired] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [handoverReason, setHandoverReason] = useState('');
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [handoverError, setHandoverError] = useState('');
  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/attendance-device/absence-cases');
      setRows(data.data);
      setHandoverRequired(data.handoverRequired === true);
    } catch (error) {
      setHandoverRequired(false);
      throw error;
    }
  }, []);
  useEffect(() => {
    void load().catch(() => setError('دریافت روزهای نیازمند رسیدگی ناموفق بود.'));
    const timer = setInterval(() => { void load().catch(() => undefined); }, 15000);
    return () => clearInterval(timer);
  }, [load]);
  const submitHandover = async () => {
    if (!handoverRequired || !assigneeId || !handoverReason.trim() || handoverBusy) return;
    setHandoverBusy(true);
    setHandoverError('');
    try {
      await api.post('/attendance-device/handover', { assigneeId, reason: handoverReason });
      setHandoverRequired(false);
      setHandoverOpen(false);
      await load();
      await onChange?.();
    } catch (error: any) {
      setHandoverError(error.response?.data?.error || 'ثبت تحویل ناموفق بود.');
    } finally {
      setHandoverBusy(false);
    }
  };
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
    {handoverRequired && <ErpButton label="تحویل موارد به شیفت بعد" onClick={() => {
      setAssigneeId('');
      setHandoverReason('');
      setHandoverError('');
      setHandoverOpen(true);
    }} />}
    {handoverError && !handoverOpen && <ErpInlineState kind="error" title={handoverError} />}
    <ErpSheet presentation="modal" open={handoverOpen} pending={handoverBusy} onClose={() => setHandoverOpen(false)}
      title="تحویل موارد به شیفت بعد" footer={<ErpButton label="ثبت تحویل"
        disabled={handoverBusy || !handoverRequired || !assigneeId || !handoverReason.trim()} onClick={submitHandover} />}>
      <div className="space-y-4">
        <ErpField label="مسئول پیگیری"><ErpSelect value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
          <option value="">انتخاب کنید</option>
          {assignees.map(a => <option key={a.userId} value={a.userId}>{a.user.firstName} {a.user.lastName}</option>)}
        </ErpSelect></ErpField>
        <ErpField label="دلیل"><ErpTextarea value={handoverReason} onChange={e => setHandoverReason(e.target.value)} /></ErpField>
        {handoverError && <ErpInlineState kind="error" title={handoverError} />}
      </div>
    </ErpSheet>
    <ErpSheet presentation="modal" open={Boolean(selected)} pending={busy} onClose={() => !busy && setSelected(null)} title={`تعیین تکلیف عدم حضور ${selected?.name || ''}`} footer={<ErpButton label="ثبت تصمیم حسابرسی‌شده" disabled={busy || !absent || !noAuthorization || !reason.trim()} onClick={confirm} />}>
      <div className="space-y-4"><ErpInlineState kind="stale" title="این تصمیم کسری روز را قطعی می‌کند؛ ورود یا خروج فرضی نمی‌سازد و تصمیم کسر حقوق نیست." />
        <ErpCheckbox label="عدم حضور واقعی در ساعات موظفی پوشش‌داده‌نشده این روز را تأیید می‌کنم" checked={absent} onChange={e => setAbsent(e.target.checked)} />
        <ErpCheckbox label="برای ساعات پوشش‌داده‌نشده، مجوز مرخصی یا مأموریت دیگری وجود ندارد" checked={noAuthorization} onChange={e => setNoAuthorization(e.target.checked)} />
        <ErpField label="دلیل و مبنای بررسی"><ErpTextarea value={reason} onChange={e => setReason(e.target.value)} /></ErpField>{error && <ErpInlineState kind="error" title={error} />}
      </div>
    </ErpSheet>
  </div>;
}
