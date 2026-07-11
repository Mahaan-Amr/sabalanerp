'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FaCalendarAlt, FaCheck, FaClock, FaExclamationTriangle, FaHistory, FaPlay, FaRedo, FaStop, FaTrash, FaUserEdit, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpSegmentedControl } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import PersianCalendar from '@/lib/persian-calendar';
import { securityAPI } from '@/lib/api';
import { askSecurityAction } from '@/components/SecurityNoticeHost';

type ShiftView = 'mine' | 'coverage' | 'plans' | 'history';
type DraftMode = 'replacement' | 'temporary' | 'force-close' | 'correction' | null;

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-teal-600 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';

const coverageLabel: Record<string, string> = {
  COVERED: 'پوشش کامل',
  NEEDS_REPLACEMENT: 'نیازمند جایگزین',
  EMERGENCY_UNCOVERED: 'بدون پوشش اضطراری',
};

const sessionLabel: Record<string, string> = {
  ACTIVE: 'فعال',
  CLOSED: 'پایان‌یافته',
  FORCE_CLOSED: 'بسته‌شده توسط مدیر',
};

const personName = (personnel: any) => personnel?.user ? `${personnel.user.firstName} ${personnel.user.lastName}` : '—';
const slotWorker = (slot: any) => slot.replacementPersonnel || slot.plannedPersonnel;
const dateTimeFa = (value: string | Date) => new Date(value).toLocaleString('fa-IR');
const dateFa = (value: string | Date) => PersianCalendar.toPersian(value, 'jYYYY/jMM/jDD');
const timeFa = (value: string | Date) => new Date(value).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
const timeInput = (value: string | Date) => new Date(value).toTimeString().slice(0, 5);
const toIsoFromPersian = (date: string, time: string) => PersianCalendar.toGregorian(`${date} ${time}`, 'jYYYY/jMM/jDD HH:mm').toISOString();
const elapsedMinutes = (from: string | Date, now: number) => Math.max(0, Math.floor((now - new Date(from).getTime()) / 60_000));

export default function SecurityShiftsPage() {
  const currentYear = Number(PersianCalendar.now().split('/')[0]);
  const [view, setView] = useState<ShiftView>('mine');
  const [workflow, setWorkflow] = useState<any>(null);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [slots, setSlots] = useState<any[]>([]);
  const [defaults, setDefaults] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const [visibleMonth, setVisibleMonth] = useState(() => PersianCalendar.now().slice(0, 7));
  const [draft, setDraft] = useState<{ mode: DraftMode; slotId: string }>({ mode: null, slotId: '' });
  const [replacement, setReplacement] = useState({ personnelId: '', overrideReason: '' });
  const [temporary, setTemporary] = useState({ personnelId: '', startsDate: PersianCalendar.now(), startsTime: '07:00', endsDate: PersianCalendar.now(), endsTime: '19:00', note: '' });
  const [forceClose, setForceClose] = useState({ reason: '', summary: '' });
  const [correction, setCorrection] = useState({ attendanceId: '', arrivedDate: PersianCalendar.now(), arrivedTime: '07:00', reason: '' });
  const [form, setForm] = useState({
    title: `برنامه شیفت ${currentYear}`,
    persianYear: currentYear,
    anchorDate: PersianCalendar.now(),
    anchorTime: '07:00',
    untilDate: `${currentYear}/12/29`,
    slotDurationMinutes: 720,
    earlyArrivalMinutes: 30,
    lateAlertMinutes: 15,
    primaryPersonnelIds: ['', '', ''],
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const from = new Date(Date.now() - 35 * 86_400_000).toISOString();
      const to = new Date(Date.now() + 75 * 86_400_000).toISOString();
      const [workflowResult, plansResult, slotsResult] = await Promise.allSettled([
        securityAPI.getMyShiftWorkflow(),
        securityAPI.getShiftPlans(true),
        securityAPI.getShiftPlanSlots({ from, to }),
      ]);
      if (workflowResult.status === 'fulfilled') setWorkflow(workflowResult.value.data.data);
      if (plansResult.status === 'fulfilled') setPlans(plansResult.value.data.data || []);
      if (slotsResult.status === 'fulfilled') setSlots(slotsResult.value.data.data || []);
      const currentResult = await securityAPI.getCurrentShiftWorkflow();
      setCurrentShift(currentResult.data.data);
      try {
        const defaultsResult = await securityAPI.getShiftPlanDefaults();
        const data = defaultsResult.data.data;
        setDefaults(data);
        const ids = data.personnel.slice(0, 3).map((person: any) => person.id);
        const anchor = data.anchorAt ? new Date(data.anchorAt) : null;
        setForm((current) => ({
          ...current,
          anchorDate: anchor ? PersianCalendar.toPersian(anchor) : current.anchorDate,
          anchorTime: anchor ? anchor.toTimeString().slice(0, 5) : current.anchorTime,
          slotDurationMinutes: data.slotDurationMinutes,
          earlyArrivalMinutes: data.earlyArrivalMinutes,
          lateAlertMinutes: data.lateAlertMinutes,
          primaryPersonnelIds: ids.length === 3 ? ids : current.primaryPersonnelIds,
        }));
      } catch {
        setDefaults(null);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت برنامه شیفت ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const [year, month] = visibleMonth.split('/').map(Number);
    if (!year || !month) return;
    const from = PersianCalendar.toGregorian(`${visibleMonth}/01`, 'jYYYY/jMM/jDD');
    const nextMonth = month === 12 ? `${year + 1}/01/01` : `${year}/${String(month + 1).padStart(2, '0')}/01`;
    const to = PersianCalendar.toGregorian(nextMonth, 'jYYYY/jMM/jDD');
    securityAPI.getMyShiftWorkflow({ from: from.toISOString(), to: to.toISOString() })
      .then((result) => setWorkflow(result.data.data))
      .catch((err) => setError(err.response?.data?.error || 'دریافت برنامه من ناموفق بود.'));
  }, [visibleMonth]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const personnelOptions = defaults?.personnel || [];
  const mySlots = useMemo(() => workflow?.slots || [], [workflow]);
  const nextSlot = useMemo(() => mySlots.find((slot: any) => new Date(slot.endsAt).getTime() > now), [mySlots, now]);
  const monthSlots = useMemo(() => mySlots.filter((slot: any) => PersianCalendar.toPersian(slot.startsAt, 'jYYYY/jMM') === visibleMonth), [mySlots, visibleMonth]);
  const dayGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    monthSlots.forEach((slot: any) => {
      const day = PersianCalendar.toPersian(slot.startsAt, 'jYYYY/jMM/jDD');
      groups.set(day, [...(groups.get(day) || []), slot]);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [monthSlots]);
  const historySlots = useMemo(() => slots.filter((slot) => slot.session || slot.report || slot.attendance?.length || slot.temporaryCoverage?.length || slot.replacementPersonnelId || slot.probableNoShowAt), [slots]);
  const activeShiftWorker = currentShift?.activeSession?.personnel || (currentShift?.activeSession?.slot ? slotWorker(currentShift.activeSession.slot) : null);
  const scheduledCurrentWorker = currentShift?.currentSlot ? slotWorker(currentShift.currentSlot) : null;

  const run = async (action: () => Promise<any>, success: string) => {
    try {
      setError('');
      await action();
      setMessage(success);
      setDraft({ mode: null, slotId: '' });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'عملیات انجام نشد.');
    }
  };

  const createPlan = async () => {
    const anchorAt = PersianCalendar.toGregorian(`${form.anchorDate} 07:00`, 'jYYYY/jMM/jDD HH:mm');
    const generateUntil = PersianCalendar.toGregorian(`${form.untilDate} 19:00`, 'jYYYY/jMM/jDD HH:mm');
    await run(() => securityAPI.createShiftPlan({ ...form, anchorAt: anchorAt.toISOString(), generateUntil: generateUntil.toISOString() }), 'پیش‌نویس برنامه سالانه ساخته شد.');
  };

  const deletePlan = async (plan: any) => {
    if (!await askSecurityAction({ title: 'حذف پیش‌نویس', description: 'این پیش‌نویس برنامه حذف شود؟' })) return;
    run(() => securityAPI.deleteShiftPlan(plan.id), '\u067e\u06cc\u0634\u200c\u0646\u0648\u06cc\u0633 \u0628\u0631\u0646\u0627\u0645\u0647 \u062d\u0630\u0641 \u0634\u062f.');
  };

  const openDraft = (mode: DraftMode, slot: any) => {
    setDraft({ mode, slotId: slot.id });
    if (mode === 'replacement') setReplacement({ personnelId: slot.replacementPersonnelId || '', overrideReason: slot.overrideReason || '' });
    if (mode === 'temporary') setTemporary({ personnelId: '', startsDate: dateFa(slot.startsAt), startsTime: timeInput(slot.startsAt), endsDate: dateFa(slot.endsAt), endsTime: timeInput(slot.endsAt), note: '' });
    if (mode === 'force-close') setForceClose({ reason: '', summary: '' });
    if (mode === 'correction') {
      const attendance = slot.attendance?.[0];
      setCorrection({ attendanceId: attendance?.id || '', arrivedDate: attendance ? dateFa(attendance.arrivedAt) : dateFa(slot.startsAt), arrivedTime: attendance ? timeInput(attendance.arrivedAt) : timeInput(slot.startsAt), reason: '' });
    }
  };

  const submitReplacement = (slot: any) => run(
    () => securityAPI.setShiftReplacement(slot.id, replacement.personnelId, replacement.overrideReason || undefined),
    'جایگزین شیفت ثبت شد.'
  );

  const submitTemporary = (slot: any) => run(
    () => securityAPI.addTemporaryShiftCoverage(slot.id, {
      personnelId: temporary.personnelId,
      startsAt: toIsoFromPersian(temporary.startsDate, temporary.startsTime),
      endsAt: toIsoFromPersian(temporary.endsDate, temporary.endsTime),
      note: temporary.note,
    }),
    'پوشش موقت ثبت شد.'
  );

  const submitForceClose = (sessionId: string) => run(
    () => securityAPI.forceCloseShift(sessionId, forceClose.reason, forceClose.summary),
    'شیفت با حسابرسی مدیر بسته شد.'
  );

  const submitCorrection = () => run(
    () => securityAPI.correctShiftAttendance(correction.attendanceId, toIsoFromPersian(correction.arrivedDate, correction.arrivedTime), correction.reason),
    'اصلاح حضور با حسابرسی ثبت شد.'
  );

  const closeShift = async (slot: any) => {
    const closureSummary = await askSecurityAction({ title: 'پایان شیفت', inputLabel: 'توضیح پایان شیفت', defaultValue: 'بدون مورد دیگر' });
    if (closureSummary === null) return;
    await run(() => securityAPI.endPlannedShift(slot.id, closureSummary.trim() || '\u0628\u062f\u0648\u0646 \u0645\u0648\u0631\u062f \u062f\u06cc\u06af\u0631'), '\u0634\u06cc\u0641\u062a \u067e\u0627\u06cc\u0627\u0646 \u06cc\u0627\u0641\u062a.');
  };

  const viewOptions = useMemo(() => {
    const options: Array<{ value: ShiftView; label: string; icon: any }> = [{ value: 'mine', label: 'برنامه من', icon: FaCalendarAlt }];
    if (defaults) {
      options.push({ value: 'coverage', label: 'پوشش شیفت‌ها', icon: FaUsers });
      options.push({ value: 'plans', label: 'برنامه سالانه', icon: FaClock });
      options.push({ value: 'history', label: 'تاریخچه و حسابرسی', icon: FaHistory });
    }
    return options;
  }, [defaults]);

  const slotStatusBadge = (slot: any) => {
    if (slot.session?.status === 'ACTIVE') return <ErpBadge tone="success">فعال</ErpBadge>;
    if (slot.session?.status === 'FORCE_CLOSED') return <ErpBadge tone="danger">بسته‌شده توسط مدیر</ErpBadge>;
    if (slot.session?.status === 'CLOSED') return <ErpBadge tone="neutral">تکمیل‌شده</ErpBadge>;
    if (slot.probableNoShowAt) return <ErpBadge tone="warning">عدم حضور احتمالی</ErpBadge>;
    if (slot.coverageStatus === 'NEEDS_REPLACEMENT') return <ErpBadge tone="danger">نیازمند جایگزین</ErpBadge>;
    return <ErpBadge tone="info">در انتظار</ErpBadge>;
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حراست"
      title="شیفت‌ها"
      description="برنامه سالانه، پوشش شیفت، حضور و غیاب، تحویل شیفت و تاریخچه حسابرسی"
      actions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load, tone: 'neutral' }]}
      metrics={[
        { label: 'شیفت بعدی من', value: nextSlot ? dateTimeFa(nextSlot.startsAt) : '—', icon: FaClock, tone: 'info' },
        { label: 'نیازمند جایگزین', value: slots.filter((slot) => slot.coverageStatus === 'NEEDS_REPLACEMENT').length, icon: FaExclamationTriangle, tone: 'warning' },
        { label: 'عدم حضور احتمالی', value: slots.filter((slot) => slot.probableNoShowAt).length, icon: FaExclamationTriangle, tone: 'danger' },
        { label: 'شیفت فعال', value: workflow?.activeSession ? 1 : 0, icon: FaPlay, tone: 'success' },
      ]}
    >
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      <ErpSegmentedControl<ShiftView> value={view} onChange={setView} options={viewOptions} />

      <ErpCard className="p-4" tone={currentShift?.activeSession ? 'success' : currentShift?.currentSlot ? 'warning' : 'neutral'}>
        {currentShift?.activeSession ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900 dark:text-white">شیفت فعال: {personName(activeShiftWorker)}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">از {dateTimeFa(currentShift.activeSession.startedAt)} · بازه برنامه {dateTimeFa(currentShift.activeSession.slot.startsAt)} تا {dateTimeFa(currentShift.activeSession.slot.endsAt)}</p>
            </div>
            <ErpBadge tone="success">فعال</ErpBadge>
          </div>
        ) : currentShift?.currentSlot ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900 dark:text-white">مسئول برنامه‌ریزی‌شده اکنون: {personName(scheduledCurrentWorker)}</p>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">برای بازه {dateTimeFa(currentShift.currentSlot.startsAt)} تا {dateTimeFa(currentShift.currentSlot.endsAt)} هنوز شیفت فعال شروع نشده است.</p>
            </div>
            <ErpBadge tone="warning">شروع نشده</ErpBadge>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900 dark:text-white">شیفت فعال وجود ندارد</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">برای زمان فعلی بازه برنامه‌ریزی‌شده‌ای پیدا نشد.</p>
            </div>
            <ErpBadge tone="neutral">بدون شیفت</ErpBadge>
          </div>
        )}
      </ErpCard>

      {view === 'mine' && (
        <ErpSection title="برنامه من" description="نمای سال/ماه از شیفت‌ها، مرخصی، جایگزینی، حضور، تأخیر و شمارش انتظار">
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <label>
              <span className={labelClass}>ماه برنامه</span>
              <select className={inputClass} value={visibleMonth} onChange={(e) => setVisibleMonth(e.target.value)}>
                {Array.from({ length: 36 }, (_, index) => {
                  const [baseYear, baseMonth] = PersianCalendar.now().slice(0, 7).split('/').map(Number);
                  const offset = index - 12;
                  const absolute = baseYear * 12 + (baseMonth - 1) + offset;
                  const year = Math.floor(absolute / 12);
                  const month = (absolute % 12) + 1;
                  const value = `${year}/${String(month).padStart(2, '0')}`;
                  return <option key={value} value={value}>{value}</option>;
                })}
              </select>
            </label>
            {workflow?.activeSession && (
              <ErpCard className="p-4" tone="success">
                <p className="font-bold">شیفت فعال از {dateTimeFa(workflow.activeSession.startedAt)}</p>
                <p className="mt-1 text-sm">تا پایان و ثبت گزارش این شیفت، شیفت بعدی آغاز نمی‌شود.</p>
              </ErpCard>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {dayGroups.map(([day, items]) => (
              <ErpCard key={day} className="p-4">
                <p className="font-semibold text-slate-900 dark:text-white">{day} · {PersianCalendar.getPersianDayOfWeek(day)}</p>
                <div className="mt-3 space-y-3">
                  {items.map((slot: any) => {
                    const attendance = slot.attendance?.find((item: any) => item.personnelId === workflow.personnel.id);
                    const isWorker = slot.effectivePersonnelId === workflow.personnel.id;
                    const canAttend = isWorker && !attendance && now >= new Date(slot.startsAt).getTime() - slot.plan.earlyArrivalMinutes * 60_000;
                    const waiting = elapsedMinutes(slot.startsAt, now);
                    return (
                      <div key={slot.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold">{timeFa(slot.startsAt)} تا {timeFa(slot.endsAt)}</p>
                          {slotStatusBadge(slot)}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {slot.replacementPersonnelId === workflow.personnel.id ? 'وظیفه جایگزین' : 'شیفت برنامه‌ریزی‌شده'}
                          {attendance ? ` · حضور ${dateTimeFa(attendance.arrivedAt)}${attendance.delayMinutes ? ` · ${attendance.delayMinutes} دقیقه تأخیر` : ''}` : ` · انتظار ${waiting.toLocaleString('fa-IR')} دقیقه`}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {canAttend && <ErpButton label="ثبت حضور" icon={FaCheck} onClick={() => run(() => securityAPI.registerShiftAttendance(slot.id), 'حضور ثبت شد.')} />}
                          {attendance && !slot.session && now >= new Date(slot.startsAt).getTime() && <ErpButton label="شروع شیفت" icon={FaPlay} tone="success" onClick={() => run(() => securityAPI.startPlannedShift(slot.id), 'شیفت شروع شد.')} />}
                          {slot.session?.status === 'ACTIVE' && slot.session.personnelId === workflow.personnel.id && <ErpButton label="گزارش و پایان شیفت" icon={FaStop} tone="danger" onClick={() => closeShift(slot)} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ErpCard>
            ))}
            {!dayGroups.length && <ErpEmptyState icon={FaCalendarAlt} title="برنامه منتشرشده‌ای برای این ماه وجود ندارد" />}
          </div>
        </ErpSection>
      )}

      {view === 'coverage' && defaults && (
        <ErpSection title="پوشش شیفت‌ها" description="نمای عملیاتی مدیر: پوشش، عدم حضور احتمالی، تحویل، جایگزین و پوشش موقت">
          <div className="space-y-3">
            {slots.map((slot) => {
              const worker = slotWorker(slot);
              const isDraft = draft.slotId === slot.id;
              return (
                <ErpCard key={slot.id} className="p-4" tone={slot.probableNoShowAt ? 'warning' : slot.coverageStatus === 'NEEDS_REPLACEMENT' ? 'danger' : 'neutral'}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{dateTimeFa(slot.startsAt)} تا {dateTimeFa(slot.endsAt)} · {personName(worker)}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        برنامه: {personName(slot.plannedPersonnel)}
                        {slot.replacementPersonnel ? ` · جایگزین: ${personName(slot.replacementPersonnel)}` : ''}
                        {slot.probableNoShowAt ? ` · عدم حضور احتمالی از ${dateTimeFa(slot.probableNoShowAt)}` : ''}
                        {slot.attendance?.[0] ? ` · حضور ${dateTimeFa(slot.attendance[0].arrivedAt)}` : ' · در انتظار حضور'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {slotStatusBadge(slot)}
                      <ErpButton label="جایگزین" icon={FaUserEdit} onClick={() => openDraft('replacement', slot)} />
                      <ErpButton label="پوشش موقت" onClick={() => openDraft('temporary', slot)} />
                      {slot.attendance?.length ? <ErpButton label="اصلاح حضور" onClick={() => openDraft('correction', slot)} /> : null}
                      {slot.coverageStatus === 'NEEDS_REPLACEMENT' && <ErpButton label="اضطراری بدون پوشش" tone="danger" onClick={async () => { const reason = await askSecurityAction({ title: 'پوشش اضطراری', inputLabel: 'دلیل وضعیت اضطراری' }); if (reason) run(() => securityAPI.markShiftEmergencyUncovered(slot.id, reason), 'وضعیت اضطراری ثبت شد.'); }} />}
                      {slot.session?.status === 'ACTIVE' && <ErpButton label="بستن اجباری" tone="danger" onClick={() => openDraft('force-close', slot)} />}
                    </div>
                  </div>

                  {isDraft && draft.mode === 'replacement' && (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-3 dark:border-slate-700">
                      <label><span className={labelClass}>نیروی جایگزین</span><select className={inputClass} value={replacement.personnelId} onChange={(e) => setReplacement({ ...replacement, personnelId: e.target.value })}><option value="">انتخاب کنید</option>{personnelOptions.map((person: any) => <option key={person.id} value={person.id}>{personName(person)}</option>)}</select></label>
                      <label className="md:col-span-2"><span className={labelClass}>دلیل override در صورت هشدار استراحت/تداخل</span><input className={inputClass} value={replacement.overrideReason} onChange={(e) => setReplacement({ ...replacement, overrideReason: e.target.value })} /></label>
                      <ErpButton label="ثبت جایگزین" icon={FaCheck} disabled={!replacement.personnelId} onClick={() => submitReplacement(slot)} />
                    </div>
                  )}

                  {isDraft && draft.mode === 'temporary' && (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-3 dark:border-slate-700">
                      <label><span className={labelClass}>نیروی پوشش موقت</span><select className={inputClass} value={temporary.personnelId} onChange={(e) => setTemporary({ ...temporary, personnelId: e.target.value })}><option value="">انتخاب کنید</option>{personnelOptions.map((person: any) => <option key={person.id} value={person.id}>{personName(person)}</option>)}</select></label>
                      <label><span className={labelClass}>تاریخ شروع</span><PersianCalendarComponent value={temporary.startsDate} onChange={(startsDate) => setTemporary({ ...temporary, startsDate })} /></label>
                      <label><span className={labelClass}>ساعت شروع</span><input className={inputClass} type="time" value={temporary.startsTime} onChange={(e) => setTemporary({ ...temporary, startsTime: e.target.value })} /></label>
                      <label><span className={labelClass}>تاریخ پایان</span><PersianCalendarComponent value={temporary.endsDate} onChange={(endsDate) => setTemporary({ ...temporary, endsDate })} /></label>
                      <label><span className={labelClass}>ساعت پایان</span><input className={inputClass} type="time" value={temporary.endsTime} onChange={(e) => setTemporary({ ...temporary, endsTime: e.target.value })} /></label>
                      <label><span className={labelClass}>یادداشت</span><input className={inputClass} value={temporary.note} onChange={(e) => setTemporary({ ...temporary, note: e.target.value })} /></label>
                      <ErpButton label="ثبت پوشش موقت" icon={FaCheck} disabled={!temporary.personnelId} onClick={() => submitTemporary(slot)} />
                    </div>
                  )}

                  {isDraft && draft.mode === 'force-close' && (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-red-200 p-3 md:grid-cols-2 dark:border-red-900">
                      <label><span className={labelClass}>دلیل بستن اجباری</span><input className={inputClass} value={forceClose.reason} onChange={(e) => setForceClose({ ...forceClose, reason: e.target.value })} /></label>
                      <label><span className={labelClass}>خلاصه گزارش مدیر</span><input className={inputClass} value={forceClose.summary} onChange={(e) => setForceClose({ ...forceClose, summary: e.target.value })} /></label>
                      <ErpButton label="بستن با حسابرسی" tone="danger" disabled={!forceClose.reason.trim() || !forceClose.summary.trim()} onClick={() => submitForceClose(slot.session.id)} />
                    </div>
                  )}

                  {isDraft && draft.mode === 'correction' && (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-amber-200 p-3 md:grid-cols-4 dark:border-amber-900">
                      <label><span className={labelClass}>تاریخ اصلاح‌شده</span><PersianCalendarComponent value={correction.arrivedDate} onChange={(arrivedDate) => setCorrection({ ...correction, arrivedDate })} /></label>
                      <label><span className={labelClass}>ساعت اصلاح‌شده</span><input className={inputClass} type="time" value={correction.arrivedTime} onChange={(e) => setCorrection({ ...correction, arrivedTime: e.target.value })} /></label>
                      <label className="md:col-span-2"><span className={labelClass}>دلیل اصلاح</span><input className={inputClass} value={correction.reason} onChange={(e) => setCorrection({ ...correction, reason: e.target.value })} /></label>
                      <ErpButton label="ثبت اصلاح حضور" tone="warning" disabled={!correction.attendanceId || !correction.reason.trim()} onClick={submitCorrection} />
                    </div>
                  )}
                </ErpCard>
              );
            })}
          </div>
        </ErpSection>
      )}

      {view === 'plans' && defaults && (
        <ErpSection title="برنامه سالانه شیفت" description="تولید پیش‌نویس از نقطه شروع قابل تنظیم و انتشار پس از بازبینی">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 [&>label:nth-child(4)]:hidden [&>label:nth-child(6)]:hidden">
            <label><span className={labelClass}>عنوان</span><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label><span className={labelClass}>سال شمسی</span><input className={inputClass} type="number" value={form.persianYear} onChange={(e) => setForm({ ...form, persianYear: Number(e.target.value) })} /></label>
            <label><span className={labelClass}>تاریخ شروع</span><PersianCalendarComponent value={form.anchorDate} onChange={(anchorDate) => setForm({ ...form, anchorDate })} /></label>
            <label><span className={labelClass}>ساعت شروع</span><input className={inputClass} type="time" value={form.anchorTime} onChange={(e) => setForm({ ...form, anchorTime: e.target.value })} /></label>
            <label><span className={labelClass}>تاریخ پایان تولید</span><PersianCalendarComponent value={form.untilDate} onChange={(untilDate) => setForm({ ...form, untilDate })} /></label>
            <label><span className={labelClass}>مدت هر شیفت (دقیقه)</span><input className={inputClass} type="number" min={60} value={form.slotDurationMinutes} onChange={(e) => setForm({ ...form, slotDurationMinutes: Number(e.target.value) })} /></label>
            <label><span className={labelClass}>پنجره حضور زودهنگام</span><input className={inputClass} type="number" value={form.earlyArrivalMinutes} onChange={(e) => setForm({ ...form, earlyArrivalMinutes: Number(e.target.value) })} /></label>
            <label><span className={labelClass}>آستانه هشدار تأخیر</span><input className={inputClass} type="number" value={form.lateAlertMinutes} onChange={(e) => setForm({ ...form, lateAlertMinutes: Number(e.target.value) })} /></label>
            {[0, 1, 2].map((index) => (
              <label key={index}>
                <span className={labelClass}>نیروی اصلی {['A', 'B', 'C'][index]}</span>
                <select className={inputClass} value={form.primaryPersonnelIds[index]} onChange={(e) => { const ids = [...form.primaryPersonnelIds]; ids[index] = e.target.value; setForm({ ...form, primaryPersonnelIds: ids }); }}>
                  <option value="">انتخاب کنید</option>
                  {personnelOptions.map((person: any) => <option key={person.id} value={person.id}>{personName(person)}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-4">
            <ErpButton label="ساخت پیش‌نویس" icon={FaCalendarAlt} onClick={createPlan} disabled={new Set(form.primaryPersonnelIds.filter(Boolean)).size !== 3} />
          </div>
          <div className="mt-6 space-y-3">
            {plans.map((plan) => (
              <ErpCard key={plan.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{plan.title} · بازنگری {plan.revision.toLocaleString('fa-IR')}</p>
                    <p className="mt-1 text-xs text-slate-500">{personName(plan.primaryA)} ← {personName(plan.primaryB)} ← {personName(plan.primaryC)} · {plan._count.slots.toLocaleString('fa-IR')} بازه</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {plan.status === 'DRAFT' && <ErpButton label="حذف پیش‌نویس" icon={FaTrash} tone="danger" variant="outline" onClick={() => deletePlan(plan)} />}
                    <ErpBadge tone={plan.status === 'PUBLISHED' ? 'success' : 'warning'}>{plan.status === 'PUBLISHED' ? 'منتشر شده' : plan.status === 'DRAFT' ? 'پیش‌نویس' : 'جایگزین شده'}</ErpBadge>
                    {plan.status === 'DRAFT' && <ErpButton label="انتشار" icon={FaCheck} tone="success" onClick={() => run(() => securityAPI.publishShiftPlan(plan.id), 'برنامه منتشر شد.')} />}
                  </div>
                </div>
              </ErpCard>
            ))}
          </div>
        </ErpSection>
      )}

      {view === 'history' && defaults && (
        <ErpSection title="تاریخچه و حسابرسی شیفت‌ها" description="تعویض نیرو، پوشش موقت، حضور، اصلاح حضور، گزارش شیفت و بستن اجباری در یکجا دیده می‌شود.">
          <div className="space-y-3">
            {historySlots.map((slot) => (
              <ErpCard key={slot.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{dateTimeFa(slot.startsAt)} · {personName(slotWorker(slot))}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      برنامه: {personName(slot.plannedPersonnel)}
                      {slot.replacementPersonnel ? ` · جایگزین: ${personName(slot.replacementPersonnel)}${slot.overrideReason ? ` · دلیل: ${slot.overrideReason}` : ''}` : ''}
                      {slot.leaveRequestId ? ' · ناشی از مرخصی تأییدشده' : ''}
                    </p>
                  </div>
                  {slotStatusBadge(slot)}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  {slot.attendance?.map((item: any) => (
                    <div key={item.id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                      حضور: {dateTimeFa(item.arrivedAt)} · تأخیر {item.delayMinutes.toLocaleString('fa-IR')} دقیقه
                      {item.originalArrivedAt && <span className="block text-xs text-amber-700">اصلاح‌شده از {dateTimeFa(item.originalArrivedAt)} · دلیل: {item.correctionReason}</span>}
                    </div>
                  ))}
                  {slot.session && <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">جلسه: {sessionLabel[slot.session.status]} · شروع {dateTimeFa(slot.session.startedAt)}{slot.session.endedAt ? ` · پایان ${dateTimeFa(slot.session.endedAt)}` : ''}{slot.session.forceCloseReason ? ` · دلیل مدیر: ${slot.session.forceCloseReason}` : ''}</div>}
                  {slot.temporaryCoverage?.map((coverage: any) => <div key={coverage.id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">پوشش موقت: {personName(coverage.personnel)} · {dateTimeFa(coverage.startsAt)} تا {dateTimeFa(coverage.endsAt)}{coverage.note ? ` · ${coverage.note}` : ''}</div>)}
                  {slot.report && <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">گزارش شیفت: {slot.report.summary}</div>}
                  {slot.probableNoShowAt && <div className="rounded-lg bg-amber-50 p-3 text-amber-800">عدم حضور احتمالی در {dateTimeFa(slot.probableNoShowAt)}</div>}
                </div>
              </ErpCard>
            ))}
            {!historySlots.length && <ErpEmptyState icon={FaHistory} title="هنوز رکورد حسابرسی برای بازه فعلی وجود ندارد" />}
          </div>
        </ErpSection>
      )}
    </ErpPage>
  );
}
