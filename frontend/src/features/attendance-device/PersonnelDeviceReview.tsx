'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import AttendanceAbsenceCases from './AttendanceAbsenceCases';
import { ErpButton, ErpCard, ErpEmptyState, ErpSegmentedControl, ErpSkeleton, ErpCheckbox, ErpField, ErpInlineState, ErpSelect, ErpSheet, ErpStatus, ErpTextarea } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import PersianCalendar from '@/lib/persian-calendar';
import { estimateScanClock, type ClockSample } from './clockEstimate';

import { AuditedAttendanceCorrection, type CorrectionTarget } from './AuditedAttendanceCorrection';

type Mapping = { id: string; personnelId: string | null; deviceCode: string; ignored: boolean; initialState: string; nameSnapshot: string | null };
type Terminal = { id: string; name: string; mode: string; activatedAt: string | null; lastSeenAt: string | null; lastReadAt: string | null; mappings: Mapping[] };
type Interval = { id: string; enteredAt: string | null; exitedAt: string | null; exitUnknown: boolean; exitSource?: string | null; hasConflict?: boolean; handoverRequired?: boolean; revision: number; confirmedRevision: number; attendanceRecord: { personnelId: string | null } };
type Punch = { id: string; personnelId: string | null; occurredAt: string; correctedOccurredAt: string | null; receivedAt: string; status: string; reason: string | null; deviceCode: string; nameSnapshot: string | null };
type State = { capabilities: { manage: boolean; review: boolean; report: boolean }; terminals: Terminal[]; personPending: { personnelId: string; count: number }[]; initialReview: { dateKey: string; rows: { mappingId: string; latestScanAt: string | null; latestCorrectedScanAt?: string | null }[] }; clockSamples: ClockSample[]; intervals: Interval[]; punches: Punch[]; reviewCount: number; assignees: { userId: string; user: { firstName: string; lastName: string } }[]; handovers: { id: string; assigneeId: string; reason: string }[] };
const stamp = (v?: string | null) => v ? new Date(v).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }) : 'اسکنی دریافت نشده';
const labels: Record<string, string> = { SHADOW: 'دریافت مقایسه‌ای', REVIEW: 'نیازمند بررسی', DUPLICATE: 'تکرار احتمالی', UNMATCHED: 'نیازمند تطبیق', APPLIED: 'ثبت سیستمی', LINKED: 'شاهد ثبت دستی', CONFIRMED: 'تأییدشده', IGNORED: 'کنارگذاشته‌شده', BEFORE_START: 'پیش از شروع', DISMISSED: 'رسیدگی‌شده' };

export function usePersonnelDeviceReview() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { const r = await api.get('/attendance-device/state'); setState(r.data.data); }, []);
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const r = await api.get('/attendance-device/state'); if (active) { setState(r.data.data); setError(''); } } catch { if (active) setError('دریافت وضعیت دستگاه ناموفق بود.'); } finally { if (active) timer = setTimeout(poll, 1500); } };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, []);
  return { state, load, error };
}

export function personnelDeviceInfo(state: State | null, personnelId: string) {
  const links = state?.terminals.flatMap(t => t.mappings.filter(m => m.personnelId === personnelId && !m.ignored).map(m => ({ terminal: t, mapping: m }))) || [];
  return { links, pending: state?.personPending.find(p => p.personnelId === personnelId)?.count || 0 };
}

export function PersonnelDeviceStatus({ state, personnelId, today, hasMovement, onInitial, onReview }: { state: State | null; personnelId: string; today: boolean; hasMovement: boolean; onInitial: (m: Mapping) => void; onReview: () => void }) {
  const { links, pending } = personnelDeviceInfo(state, personnelId);
  return <div className="space-y-2">
    {links.map(({ terminal: t, mapping: m }) => {
      const scan = today ? state?.initialReview.rows.find(s => s.mappingId === m.id) : null;
      const raw = scan?.latestScanAt;
      const corrected = scan?.latestCorrectedScanAt;
      const estimate = estimateScanClock(raw, state?.clockSamples.find(s => s.terminalId === t.id));
      const connected = t.lastSeenAt && t.lastReadAt && Date.now() - Math.min(Date.parse(t.lastSeenAt), Date.parse(t.lastReadAt)) < 10000;
      return <div key={m.id} className="flex flex-wrap items-center gap-2 text-xs sds-text-secondary">
        <span>کد {m.deviceCode}</span><ErpStatus label={t.mode === 'SHADOW' ? 'مقایسه‌ای · ثبت خودکار غیرفعال' : t.mode === 'ACTIVE' ? 'ثبت خودکار' : 'دریافت متوقف'} tone={t.mode === 'ACTIVE' ? 'success' : 'info'} />
        {!connected && <ErpStatus label="قطع یا تأخیر ارتباط" tone="warning" />}
        {today && <span>آخرین اسکن امروز: <bdi>{stamp(corrected || estimate?.at || raw)}</bdi>{corrected || estimate ? ' · با جبران ساعت' : raw ? ' · ساعت خام دستگاه' : ''}</span>}
        {today && !hasMovement && <ErpStatus label={m.initialState === 'INSIDE' ? 'داخل · وضعیت اولیه' : m.initialState === 'OUTSIDE' ? 'بیرون · وضعیت اولیه' : 'وضعیت اولیه نامعلوم'} tone={m.initialState === 'UNKNOWN' ? 'warning' : 'neutral'} />}
        {today && !hasMovement && state?.capabilities.manage && m.initialState === 'UNKNOWN' && t.mode === 'SHADOW' && !t.activatedAt && <ErpButton label="تعیین وضعیت اولیه" onClick={() => onInitial(m)} />}
      </div>;
    })}
    {pending > 0 && <ErpStatus label={`نیازمند رسیدگی · ${pending.toLocaleString('fa-IR')} مورد`} tone="warning" />}
    {(links.length > 0 || pending > 0) && <ErpButton label="بررسی تردد" onClick={onReview} tone={pending ? 'warning' : 'neutral'} variant="ghost" />}
  </div>;
}

export function PersonnelReviewDialogs({ state, person, initial, onClose, onSaved, onCorrect }: { state: State | null; person: { id: string; name: string } | null; initial: Mapping | null; onClose: () => void; onSaved: () => Promise<void>; onCorrect: (interval: Interval) => void }) {
  const [correction, setCorrection] = useState<CorrectionTarget | null>(null);
  const [view, setView] = useState('pending');
  const [selectedPunch, setSelectedPunch] = useState<string | null>(null);
  const [details, setDetails] = useState<State | null>(null);
  const [cursor, setCursor] = useState('');
  const [intervalCursor, setIntervalCursor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState('UNKNOWN');
  const [actualTime, setActualTime] = useState('');
  const load = useCallback(async () => { if (person) { const r = await api.get('/attendance-device/state', { params: { personnelId: person.id, status: view === 'history' ? 'all' : 'pending', cursor: cursor || undefined, intervalCursor: intervalCursor || undefined } }); setDetails(r.data.data); } }, [person, cursor, intervalCursor, view]);
  useEffect(() => { setCursor(''); setIntervalCursor(''); setView('pending'); setSelectedPunch(null); setDetails(null); setReason(''); setActualTime(''); setError(''); }, [person]);
  useEffect(() => { setChoice('UNKNOWN'); setError(''); }, [initial]);
  useEffect(() => { if (!person) return; let active = true; let timer: ReturnType<typeof setTimeout>; const poll = async () => { try { const r = await api.get('/attendance-device/state', { params: { personnelId: person.id, status: view === 'history' ? 'all' : 'pending', cursor: cursor || undefined, intervalCursor: intervalCursor || undefined } }); if (active) setDetails(r.data.data); } catch { if (active) setError('دریافت شواهد ناموفق بود.'); } finally { if (active) timer = setTimeout(poll, 1500); } }; void poll(); return () => { active = false; clearTimeout(timer); }; }, [person, cursor, intervalCursor, view]);
  const mutate = async (path: string, body: object, close = false) => { setBusy(true); setError(''); try { await api.post(`/attendance-device/${path}`, body); await onSaved(); if (close) onClose(); else await load(); } catch (e: any) { setError(e.response?.data?.error || 'ثبت تغییر ناموفق بود.'); } finally { setBusy(false); } };
  return <>
    <AuditedAttendanceCorrection target={correction} onClose={() => setCorrection(null)} onSaved={async () => { await onSaved(); await load(); }} />
    <ErpSheet presentation="modal" open={Boolean(initial)} pending={busy} onClose={onClose} title={`وضعیت اولیه ${initial?.nameSnapshot || ''}`} footer={<ErpButton label="ثبت وضعیت اولیه" variant="solid" disabled={busy} onClick={() => initial && mutate(`mappings/${initial.id}/initial-state`, { initialState: choice, expectedInitialState: initial.initialState, reason: 'بررسی وضعیت اولیه از کارت پرسنل؛ بدون ایجاد تردد.' }, true)} />}>
      <ErpField label="وضعیت بررسی‌شده اولیه"><ErpSelect value={choice} onChange={e => setChoice(e.target.value)}><option value="UNKNOWN">نامعلوم</option><option value="INSIDE">داخل مجموعه</option><option value="OUTSIDE">بیرون مجموعه</option></ErpSelect></ErpField>{error && <ErpInlineState kind="error" title={error} />}
    </ErpSheet>
    <ErpSheet presentation="modal" open={Boolean(person)} pending={busy} onClose={onClose} title={`بررسی تردد ${person?.name || ''}`}>
      <div className="space-y-4">
        {error && <ErpInlineState kind="error" title={error} />}
        <ErpSegmentedControl value={view} onChange={value => { setView(value); setCursor(''); setIntervalCursor(''); setDetails(null); setSelectedPunch(null); setReason(''); setActualTime(''); }} options={[{ value: 'pending', label: 'نیازمند رسیدگی' }, { value: 'history', label: 'سوابق و شواهد' }]} />
        {!details && <ErpSkeleton lines={3} />}
        {details && !details.intervals.length && !details.punches.length && <ErpEmptyState title={view === 'pending' ? 'موردی برای رسیدگی باقی نمانده است' : 'سابقه‌ای در این بخش نیست'} />}
        {details?.intervals.map(i => {
          const deferred = i.handoverRequired === false || (i.exitUnknown && i.exitSource === 'DAY_ROLLOVER');
          const issue = i.hasConflict ? 'زمان این بازه با تردد دیگری هم‌پوشانی دارد' : i.exitUnknown ? 'ساعت خروج ثبت نشده است' : !i.enteredAt ? 'ساعت ورود مشخص نیست' : !i.exitedAt ? 'خروج این حضور ثبت نشده است' : 'بازه ثبت‌شده';
          return <ErpCard key={i.id} className="space-y-3 p-3">
            <ErpStatus label={issue} tone={i.hasConflict || i.exitUnknown || !i.enteredAt || !i.exitedAt ? 'warning' : 'neutral'} />
            <div className="grid gap-1 text-sm sds-text-secondary"><p>ورود: <bdi>{i.enteredAt ? stamp(i.enteredAt) : 'ساعت نامعلوم'}</bdi></p><p>خروج: <bdi>{i.exitUnknown ? 'ساعت نامعلوم' : i.exitedAt ? stamp(i.exitedAt) : 'ثبت نشده'}</bdi></p></div>
            {deferred && <p className="text-xs sds-text-secondary">خروج روز قبل برای اصلاح باقی مانده؛ مانع ورود روز جدید یا تحویل شیفت نیست.</p>}
            {state?.capabilities.review && <div className="flex flex-wrap gap-2"><ErpButton label="اصلاح ورود/خروج" disabled={busy} onClick={() => onCorrect(i)} /><ErpButton label="بررسی ابطال یا خروج نامعلوم" variant="ghost" disabled={busy} onClick={() => setCorrection({ id: i.id, name: person?.name || '' })} /></div>}
          </ErpCard>;
        })}
        {details && details.intervals.length === 100 && <ErpButton label="بازه‌های قدیمی‌تر" onClick={() => setIntervalCursor(details.intervals.at(-1)!.id)} />}
        {details?.punches.map(p => <ErpCard key={p.id} className="space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{p.nameSnapshot || person?.name} · کد {p.deviceCode}</strong><ErpStatus label={labels[p.status] || p.status} tone={['REVIEW', 'DUPLICATE', 'UNMATCHED'].includes(p.status) ? 'warning' : 'info'} /></div>
          <p className="text-sm sds-text-secondary">اسکن: <bdi>{stamp(p.correctedOccurredAt || p.occurredAt)}</bdi>{p.correctedOccurredAt ? ' · با جبران ساعت' : ' · ساعت خام دستگاه'}</p>
          {p.reason && <p className="text-sm sds-text-secondary">{p.reason}</p>}
          {view === 'history' && <p className="text-xs sds-text-muted">دریافت: <bdi>{stamp(p.receivedAt)}</bdi>{p.correctedOccurredAt ? ` · ساعت خام: ${stamp(p.occurredAt)}` : ''}</p>}
          {state?.capabilities.review && ['REVIEW', 'DUPLICATE', 'LINKED'].includes(p.status) && (selectedPunch !== p.id ? <ErpButton label="رسیدگی به این اسکن" disabled={busy} onClick={() => { setSelectedPunch(p.id); setReason(''); setActualTime(''); setError(''); }} /> : <div className="space-y-3">
            <ErpField label="دلیل رسیدگی به این اسکن"><ErpTextarea value={reason} onChange={e => setReason(e.target.value)} /></ErpField>
            <ErpField label="زمان واقعی اسکن (فقط در صورت اصلاح ساعت)"><PersianCalendarComponent showTime clearable value={actualTime} onChange={setActualTime} /></ErpField>
            <div className="flex flex-wrap gap-2">{['ENTRY', 'EXIT', 'DISMISS'].map(action => <ErpButton key={action} label={action === 'ENTRY' ? 'ثبت به‌عنوان ورود' : action === 'EXIT' ? 'ثبت به‌عنوان خروج' : 'کنارگذاشتن شاهد'} disabled={busy || !reason.trim() || (action !== 'DISMISS' && !p.correctedOccurredAt && !actualTime)} onClick={async () => { await mutate(`punches/${p.id}/resolve`, { action, reason, ...(actualTime ? { occurredAt: PersianCalendar.toGregorian(actualTime, 'jYYYY/jMM/jDD HH:mm').toISOString() } : {}) }); }} />)}<ErpButton label="بستن رسیدگی" variant="ghost" disabled={busy} onClick={() => setSelectedPunch(null)} /></div>
          </div>)}
        </ErpCard>)}
        {details && details.punches.length === 100 && <ErpButton label="شواهد قدیمی‌تر" onClick={() => setCursor(details.punches.at(-1)!.id)} />}
        {(cursor || intervalCursor) && <ErpButton label="بازگشت به جدیدترین‌ها" onClick={() => { setCursor(''); setIntervalCursor(''); }} />}
      </div>
    </ErpSheet>
  </>;
}

export function AttendanceReviewToolbar({ state, selected, onSelect, onSaved }: { state: State | null; selected: Record<string, number>; onSelect: (v: Record<string, number>) => void; onSaved: () => Promise<void> }) {
  const [handover, setHandover] = useState(false); const [reason, setReason] = useState(''); const [assignee, setAssignee] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const mutate = async (path: string, body: object) => { setBusy(true); setError(''); try { await api.post(`/attendance-device/${path}`, body); onSelect({}); setHandover(false); await onSaved(); } catch (e: any) { setError(e.response?.data?.error || 'عملیات ناموفق بود.'); } finally { setBusy(false); } };
  if (!state) return null;
  const pending = state.personPending.reduce((n, p) => n + p.count, 0);
  return <div className="space-y-3" id="device-attendance">
    {state.capabilities.review && <AttendanceAbsenceCases onChange={() => { void onSaved(); }} />}
    {state.reviewCount > 0 && <ErpStatus tone="warning" label={`${state.reviewCount.toLocaleString('fa-IR')} شاهد دستگاه نیازمند رسیدگی`} />}
    {pending > 0 && <ErpInlineState kind="stale" title={`${pending.toLocaleString('fa-IR')} مورد نیازمند رسیدگی؛ خروج نامعلومِ منتقل‌شده از روز قبل مانع تحویل شیفت نیست.`} />}
    <div className="flex flex-wrap gap-2">{state.capabilities.review && <><ErpButton label="تحویل موارد به شیفت بعد" onClick={() => setHandover(true)} /></>}{state.capabilities.manage && <ErpButton label="مدیریت دستگاه‌ها" href="/dashboard/hr/attendance-devices" variant="ghost" />}{state.capabilities.report && <ErpButton label="گزارش کارکرد پرسنل" href="/dashboard/security/reports/personnel-attendance" variant="ghost" />}</div>
    {state.handovers[0] && <p className="text-xs sds-text-secondary">آخرین تحویل به {state.assignees.find(a => a.userId === state.handovers[0].assigneeId)?.user.firstName || 'مسئول پیگیری'}: {state.handovers[0].reason}</p>}
    {error && <ErpInlineState kind="error" title={error} />}
    <ErpSheet presentation="modal" open={handover} pending={busy} onClose={() => setHandover(false)} title="تحویل موارد به شیفت بعد" footer={<ErpButton label="ثبت تحویل" disabled={busy || !reason.trim() || !assignee} onClick={() => mutate('handover', { reason, assigneeId: assignee })} />}><ErpField label="دلیل"><ErpTextarea value={reason} onChange={e => setReason(e.target.value)} /></ErpField><ErpField label="مسئول پیگیری"><ErpSelect value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">انتخاب کنید</option>{state.assignees.map(a => <option key={a.userId} value={a.userId}>{a.user.firstName} {a.user.lastName}</option>)}</ErpSelect></ErpField></ErpSheet>
  </div>;
}

// Ordinary valid movements do not require a separate Guard signature.
export function IntervalReviewSelection(_props: { state: State | null; personnelId: string; selected: Record<string, number>; onSelect: (v: Record<string, number>) => void }) {
  return null;
}
