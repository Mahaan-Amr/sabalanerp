'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { estimateScanClock, type ClockSample } from './clockEstimate';
import InitialAttendanceReview, { type InitialReview } from './InitialAttendanceReview';
import { ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInput, ErpInlineState, ErpSection, ErpSelect, ErpSheet, ErpStatus, ErpTextarea } from '@/components/erp';

type Interval = { id: string; enteredAt: string; exitedAt: string | null; exitUnknown: boolean; revision: number; confirmedRevision: number; attendanceRecord: { personnelFirstName: string; personnelLastName: string } };
type Punch = { id: string; terminalId: string; deviceCode: string; nameSnapshot: string | null; occurredAt: string; receivedAt: string; verifyMode: number; status: string; reason: string | null; direction: string | null };
type Mapping = { id: string; deviceCode: string; nameSnapshot: string | null; ignored: boolean; initialState: string; personnelId: string | null };
type Terminal = { id: string; name: string; mode: string; activatedAt: string | null; lastSeenAt: string | null; lastReadAt: string | null; lastReceivedAt: string | null; mappings: Mapping[] };
type State = { clockSamples?: ClockSample[]; initialReview?: InitialReview | null; capabilities: { manage: boolean; review: boolean }; terminals: Terminal[]; punches: Punch[]; intervals: Interval[]; reviewCount: number; pendingIntervalsCount: number; personnel: { id: string; firstName: string; lastName: string }[]; assignees: { userId: string; user: { firstName: string; lastName: string } }[]; handovers: { id: string; reason: string; assigneeId: string; createdAt: string }[]; rosterIds?: string[] };
const labels: Record<string, string> = { REVIEW: 'نیازمند بررسی', UNMATCHED: 'نیازمند تطبیق', DUPLICATE: 'تکرار احتمالی', APPLIED: 'تأییدنشده / موقت', LINKED: 'شاهد ثبت دستی', CONFIRMED: 'تأییدشده', BEFORE_START: 'پیش از شروع', IGNORED: 'کنارگذاشته‌شده', DISMISSED: 'رسیدگی‌شده', ACTIVE: 'ثبت خودکار فعال', PAUSED: 'متوقف', SHADOW: 'دریافت مقایسه‌ای' };
const stamp = (v: string | null) => v ? new Date(v).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }) : 'هنوز دریافت نشده';

export function AttendanceDeviceBanner() {
  const [data, setData] = useState<{ pending: number; disconnected: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const r = await api.get('/attendance-device/summary'); if (active) setData(r.data.data); } catch { if (active) setData(null); }
      finally { if (active) timer = setTimeout(load, 2000); }
    };
    void load(); return () => { active = false; clearTimeout(timer); };
  }, []);
  if (!data) return null;
  return <ErpSection title="بررسی حضور‌وغیاب دستگاه"><div className="flex flex-wrap items-center justify-between gap-3"><ErpStatus tone={data.pending || data.disconnected ? 'warning' : 'success'} label={`${data.pending.toLocaleString('fa-IR')} مورد نیازمند تأیید یا بررسی${data.disconnected ? ' · ارتباط دریافت‌کننده قطع یا با تأخیر است' : ''}`} /><ErpButton className="max-w-full whitespace-normal" href="/dashboard/security/attendance#device-attendance" label="بررسی حضور‌وغیاب" variant="solid" /></div></ErpSection>;
}

export default function AttendanceDevicePanel({ onChange }: { onChange?: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [cursor, setCursor] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [intervalCursor, setIntervalCursor] = useState('');
  const [intervalPages, setIntervalPages] = useState<string[]>([]);
  const [pages, setPages] = useState<string[]>([]);
  const [token, setToken] = useState('');
  const [dialog, setDialog] = useState<{ title: string; kind: string; id: string; action?: string } | null>(null);
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [personnelId, setPersonnelId] = useState('');
  const [initialState, setInitialState] = useState('UNKNOWN');
  const [ignored, setIgnored] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const load = useCallback(async () => { const r = await api.get('/attendance-device/state', { params: { cursor: cursor || undefined, status: showAll ? 'all' : undefined, intervalCursor: intervalCursor || undefined } }); setState(r.data.data); }, [cursor, showAll, intervalCursor]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const r = await api.get('/attendance-device/state', { params: { cursor: cursor || undefined, status: showAll ? 'all' : undefined, intervalCursor: intervalCursor || undefined } }); if (active) { setState(r.data.data); setError(''); } }
      catch (e: any) { if (active) setError(e.response?.data?.error || 'دریافت اطلاعات دستگاه ناموفق بود.'); }
      finally { if (active) timer = setTimeout(poll, 1500); }
    };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [cursor, showAll, intervalCursor]);
  const open = (kind: string, id: string, title: string, action?: string) => { setReason(''); setName(''); setDeviceCode(''); setPersonnelId(''); setInitialState('UNKNOWN'); setIgnored(false); setDialog({ kind, id, title, action }); };
  const mutate = async (path: string, body: object) => {
    setBusy(true); setError('');
    try { const r = await api.post(`/attendance-device/${path}`, body); if (r.data.data?.token) setToken(r.data.data.token); setDialog(null); setSelected({}); await load(); onChange?.(); }
    catch (e: any) { setError(e.response?.data?.error || 'ثبت تغییر ناموفق بود.'); }
    finally { setBusy(false); }
  };
  const submit = () => {
    if (!dialog) return;
    const { kind, id, action } = dialog;
    if (kind === 'create') return mutate('terminals', { name });
    if (kind === 'mapping') return mutate(`terminals/${id}/mappings`, { deviceCode, personnelId, initialState, ignored, reason });
    if (kind === 'mode') return mutate(`terminals/${id}/mode`, { mode: action, reason });
    if (kind === 'end') return mutate(`mappings/${id}/end`, { reason });
    if (kind === 'resolve') return mutate(`punches/${id}/resolve`, { action, reason });
    if (kind === 'handover') return mutate('handover', { reason, assigneeId });
  };
  const pending = state?.intervals.filter(i => i.revision !== i.confirmedRevision) || [];
  return <ErpSection title="تردد دستگاه و تأیید نگهبان"><div id="device-attendance" className="min-w-0 space-y-4 break-words">
    {error && <ErpInlineState kind="error" title={error} />}
    {!state && !error && <ErpInlineState kind="stale" title="در حال دریافت وضعیت دستگاه…" />}
    {state && <>
      <ErpInlineState kind="stale" title={`تأیید حضور‌وغیاب تا پایان شیفت ضروری است: ${state.pendingIntervalsCount.toLocaleString('fa-IR')} بازه تأییدنشده و ${state.reviewCount.toLocaleString('fa-IR')} تردد مبهم.`} />
      <div className="flex flex-wrap gap-2">{state.capabilities.manage && <ErpButton className="max-w-full whitespace-normal" label="افزودن دستگاه" onClick={() => open('create', '', 'افزودن دستگاه')} />}{state.capabilities.review && <ErpButton className="max-w-full whitespace-normal" label="تحویل موارد به شیفت بعد" onClick={() => open('handover', '', 'تحویل با مسئول پیگیری')} />}</div>
      {state.capabilities.manage && state.initialReview && <InitialAttendanceReview terminals={state.terminals} review={state.initialReview} rosterIds={state.rosterIds || []} clockSamples={state.clockSamples || []} onSaved={load} />}
      {state.terminals.map(t => <ErpCard key={t.id}><div className="space-y-3"><div className="flex flex-wrap items-center gap-3"><strong>{t.name}</strong><ErpStatus label={labels[t.mode]} tone={t.mode === 'ACTIVE' ? 'success' : 'warning'} /><ErpStatus label={t.lastSeenAt && t.lastReadAt && Date.now() - Math.min(new Date(t.lastSeenAt).getTime(), new Date(t.lastReadAt).getTime()) < 10000 ? 'دریافت‌کننده متصل' : 'قطع یا تأخیر ارتباط'} tone={t.lastSeenAt && t.lastReadAt && Date.now() - Math.min(new Date(t.lastSeenAt).getTime(), new Date(t.lastReadAt).getTime()) < 10000 ? 'success' : 'warning'} /></div><p className="text-sm sds-text-secondary">آخرین ارتباط: {stamp(t.lastSeenAt)} · آخرین دریافت تردد: {stamp(t.lastReceivedAt)}</p>
        {state.capabilities.manage && <><p className="text-sm sds-text-muted">شناسه دریافت‌کننده: <bdi className="break-all">{t.id}</bdi></p><div className="flex flex-wrap gap-2"><ErpButton className="max-w-full whitespace-normal" label="افزودن یا تغییر اتصال فرد" onClick={() => open('mapping', t.id, 'اتصال فرد به دستگاه')} />{['SHADOW', 'ACTIVE', 'PAUSED'].filter(m => m !== t.mode).map(mode => <ErpButton className="max-w-full whitespace-normal" key={mode} label={labels[mode]} tone={mode === 'PAUSED' ? 'warning' : 'primary'} onClick={() => open('mode', t.id, labels[mode], mode)} />)}</div><div className="space-y-2">{t.mappings.map(m => <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b sds-divider py-2"><span>کد {m.deviceCode} · {m.ignored ? 'عمداً کنارگذاشته‌شده' : m.nameSnapshot} · {m.initialState === 'UNKNOWN' ? 'وضعیت اولیه نامعلوم' : m.initialState === 'INSIDE' ? 'اولیه: داخل' : 'اولیه: بیرون'}{!m.ignored && !state.rosterIds?.includes(m.personnelId || '') ? ' · ثبت خودکار غیرفعال؛ عضو فهرست گارد نیست' : ''}</span><div className="flex flex-wrap gap-2">{!m.ignored && !state.rosterIds?.includes(m.personnelId || '') && <ErpButton className="max-w-full whitespace-normal" label="افزودن صریح به فهرست گارد" disabled={busy} onClick={async () => { setBusy(true); try { await api.post('/security/attendance-roster', { personnelId: m.personnelId, effectiveDate: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' }) }); await load(); } catch (e: any) { setError(e.response?.data?.error || 'افزودن به فهرست ناموفق بود.'); } finally { setBusy(false); } }} />}<ErpButton className="max-w-full whitespace-normal" label="قطع اتصال" tone="warning" onClick={() => open('end', m.id, 'قطع ثبت خودکار این فرد')} /></div></div>)}</div></>}
      </div></ErpCard>)}
      {state.capabilities.review && <><div className="flex flex-wrap gap-2"><ErpButton className="max-w-full whitespace-normal" label={`تأیید ${Object.keys(selected).length.toLocaleString('fa-IR')} بازه انتخاب‌شده`} disabled={busy || !Object.keys(selected).length} onClick={() => mutate('confirm', { intervals: Object.entries(selected).map(([id, revision]) => ({ id, revision })) })} variant="solid" /></div><div className="space-y-2">{pending.map(i => <ErpCard key={i.id}><ErpCheckbox label={`${i.attendanceRecord.personnelFirstName} ${i.attendanceRecord.personnelLastName} · ${stamp(i.enteredAt)} تا ${i.exitUnknown ? 'خروج با ساعت نامعلوم' : i.exitedAt ? stamp(i.exitedAt) : 'باز'} · تأییدنشده / موقت`} checked={selected[i.id] !== undefined} disabled={i.exitUnknown || busy} onChange={e => setSelected(old => { const next = { ...old }; if (e.target.checked) next[i.id] = i.revision; else delete next[i.id]; return next; })} /></ErpCard>)}</div></>}
      {state.capabilities.review && <div className="flex flex-wrap gap-2"><ErpButton className="max-w-full whitespace-normal" label="بازه‌های جدیدتر" disabled={!intervalPages.length} onClick={() => { setIntervalCursor(intervalPages.at(-1) || ''); setIntervalPages(old => old.slice(0, -1)); }} /><ErpButton className="max-w-full whitespace-normal" label="بازه‌های تأییدنشده قدیمی‌تر" disabled={state.intervals.length < 100} onClick={() => { setIntervalPages(old => [...old, intervalCursor]); setIntervalCursor(state.intervals.at(-1)!.id); }} /></div>}
      <ErpCheckbox label="نمایش همه شواهد، شامل تأییدشده و کنارگذاشته‌شده" checked={showAll} onChange={e => { setShowAll(e.target.checked); setCursor(''); setPages([]); }} />
      <div className="space-y-3">{state.punches.map(p => { const estimate = estimateScanClock(p.occurredAt, state.clockSamples?.find(sample => sample.terminalId === p.terminalId)); return <ErpCard key={p.id}><div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><strong>{p.nameSnapshot || `کد متصل‌نشده ${p.deviceCode}`}</strong><ErpStatus label={labels[p.status] || p.status} tone={p.status === 'REVIEW' ? 'warning' : 'info'} /></div><p className="text-sm sds-text-secondary">کد {p.deviceCode} · {state.terminals.find(t => t.id === p.terminalId)?.name} · اسکن: {stamp(p.occurredAt)} · دریافت: {stamp(p.receivedAt)} · روش شناسایی خام: {p.verifyMode}</p><p className="text-sm sds-text-muted">{p.reason}</p>{estimate && <p className="text-sm sds-text-secondary">زمان برآوردی با جبران اختلاف ساعت: {stamp(estimate.at)} · ±{estimate.uncertaintySeconds} ثانیه؛ زمان خام اسکن حفظ شده است.</p>}{state.capabilities.review && ['REVIEW', 'DUPLICATE'].includes(p.status) && <div className="flex flex-wrap gap-2">{[['ENTRY', 'ثبت به‌عنوان ورود'], ['EXIT', 'ثبت به‌عنوان خروج'], ['DISMISS', 'عدم ایجاد تردد با دلیل']].map(([action, title]) => <ErpButton className="max-w-full whitespace-normal" key={action} label={title} onClick={() => open('resolve', p.id, title, action)} />)}</div>}</div></ErpCard>; })}</div>
      <div className="flex flex-wrap gap-2"><ErpButton className="max-w-full whitespace-normal" label="صفحه قبل" disabled={!pages.length} onClick={() => { setCursor(pages.at(-1) || ''); setPages(old => old.slice(0, -1)); }} /><ErpButton className="max-w-full whitespace-normal" label="موارد قدیمی‌تر" disabled={state.punches.length < 100} onClick={() => { setPages(old => [...old, cursor]); setCursor(state.punches.at(-1)!.id); }} /></div>
      {state.handovers.map(h => <ErpInlineState key={h.id} kind="stale" title={`تحویل پیگیری ${stamp(h.createdAt)} · مسئول: ${state.assignees.find(a => a.userId === h.assigneeId)?.user.firstName || h.assigneeId} · ${h.reason}`} />)}
    </>}
    <ErpSheet presentation="modal" open={Boolean(dialog)} onClose={() => !busy && setDialog(null)} pending={busy} title={dialog?.title || ''} footer={<ErpButton className="max-w-full whitespace-normal" label="ثبت" variant="solid" disabled={busy || (dialog?.kind === 'create' ? !name.trim() : !reason.trim())} onClick={submit} />}>
      <div className="space-y-4">
        {dialog?.kind === 'create' && <ErpField label="نام دستگاه"><ErpInput value={name} onChange={e => setName(e.target.value)} /></ErpField>}
        {dialog?.kind === 'mapping' && <><ErpField label="کد فرد در دستگاه"><ErpInput value={deviceCode} onChange={e => setDeviceCode(e.target.value)} /></ErpField><ErpCheckbox label="عمداً کنارگذاشته‌شده" checked={ignored} onChange={e => setIgnored(e.target.checked)} />{!ignored && <ErpField label="پرونده پرسنلی"><ErpSelect value={personnelId} onChange={e => setPersonnelId(e.target.value)}><option value="">انتخاب پرسنل</option>{state?.personnel.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} · {p.id.slice(-6)}</option>)}</ErpSelect></ErpField>}<ErpField label="وضعیت بررسی‌شده اولیه"><ErpSelect value={initialState} onChange={e => setInitialState(e.target.value)}><option value="UNKNOWN">نامعلوم؛ نیازمند بررسی</option><option value="OUTSIDE">بیرون مجموعه</option><option value="INSIDE">داخل مجموعه</option></ErpSelect></ErpField></>}
        {dialog?.kind === 'handover' && <ErpField label="مسئول پیگیری"><ErpSelect value={assigneeId} onChange={e => setAssigneeId(e.target.value)}><option value="">انتخاب مسئول</option>{state?.assignees.map(a => <option key={a.userId} value={a.userId}>{a.user.firstName} {a.user.lastName}</option>)}</ErpSelect></ErpField>}
        {dialog?.kind !== 'create' && <ErpField label="دلیل"><ErpTextarea value={reason} onChange={e => setReason(e.target.value)} /></ErpField>}
        {dialog?.kind === 'mode' && dialog.action === 'ACTIVE' && <ErpInlineState kind="stale" title="شروع یا ازسرگیری ثبت خودکار فقط پس از بررسی وضعیت افراد انجام شود؛ تردد دوره توقف نیازمند بررسی می‌ماند." />}
        {error && <ErpInlineState kind="error" title={error} />}
      </div>
    </ErpSheet>
    <ErpSheet open={Boolean(token)} onClose={() => setToken('')} title="اعتبار دریافت‌کننده" footer={<ErpButton className="max-w-full whitespace-normal" label="ثبت کردم؛ بستن" onClick={() => setToken('')} />}><p className="sds-text-secondary">این اعتبار فقط اکنون نمایش داده می‌شود؛ آن را در تنظیمات محلی دریافت‌کننده نگه دارید.</p><ErpField label="اعتبار دستگاه"><ErpInput value={token} readOnly dir="ltr" /></ErpField></ErpSheet>
  </div></ErpSection>;
}
