'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FaCalendarAlt, FaCheck, FaClock, FaExclamationTriangle, FaHistory, FaPlay, FaRedo, FaStop, FaTrash, FaUserEdit, FaUsers } from 'react-icons/fa';
import { ErpActionMenu, ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpInlineState, ErpSection, ErpSegmentedControl, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
import { ErpCheckboxControl, ErpInput, ErpSelect, ErpTextarea } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import PersianCalendar from '@/lib/persian-calendar';
import { securityAPI } from '@/lib/api';
import { askSecurityAction } from '@/components/SecurityNoticeHost';
import { categorizeSecurityCoverageSlots } from './securityShiftCoverageViewModel';

type ShiftView = 'current' | 'plans' | 'history';
type CoverageCategory = 'open' | 'finished';
type DraftMode = 'replacement' | 'temporary' | 'force-close' | 'attendance-correction' | 'session-correction' | 'confirm-no-shift' | null;

const inputClass = 'sds-field min-h-12 w-full px-4 py-3 text-sm';
const labelClass = 'mb-2 block text-sm font-medium sds-text-secondary ';

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
const dateTimeInput = (value?: string | Date | null) => value ? `${dateFa(value)} ${timeInput(value)}` : '';
const dateTimeToIso = (value: string) => PersianCalendar.toGregorian(value, 'jYYYY/jMM/jDD HH:mm').toISOString();
const elapsedMinutes = (from: string | Date, now: number) => Math.max(0, Math.floor((now - new Date(from).getTime()) / 60_000));

export default function SecurityShiftsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const currentYear = Number(PersianCalendar.now().split('/')[0]);
  const [view, setView] = useState<ShiftView>('current');
  const [queryReady, setQueryReady] = useState(false);
  const [workflow, setWorkflow] = useState<any>(null);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [slots, setSlots] = useState<any[]>([]);
  const [defaults, setDefaults] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const [visibleMonth, setVisibleMonth] = useState(() => PersianCalendar.now().slice(0, 7));
  const [coverageCategory, setCoverageCategory] = useState<CoverageCategory>('open');
  const [draft, setDraft] = useState<{ mode: DraftMode; slotId: string }>({ mode: null, slotId: '' });
  const [replacement, setReplacement] = useState({ personnelId: '', overrideReason: '' });
  const [temporary, setTemporary] = useState({ personnelId: '', startsAt: `${PersianCalendar.now()} 07:00`, endsAt: `${PersianCalendar.now()} 19:00`, note: '' });
  const [forceClose, setForceClose] = useState({ reason: '', summary: '' });
  const [correction, setCorrection] = useState({ attendanceId: '', arrivedAt: `${PersianCalendar.now()} 07:00`, reason: '' });
  const [sessionCorrection, setSessionCorrection] = useState({ startedAt: '', endedAt: '', reason: '', deviationConfirmed: false });
  const [noShiftReason, setNoShiftReason] = useState('');
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

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
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
  useEffect(() => {
    if (view !== 'current') return undefined;
    const timer = window.setInterval(() => { void load(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load, view]);
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('view');
    if (value === 'current' || value === 'plans' || value === 'history') setView(value);
    setQueryReady(true);
  }, []);
  useEffect(() => {
    if (!queryReady) return;
    router.replace(view === 'current' ? pathname : `${pathname}?view=${view}`, { scroll: false });
  }, [pathname, queryReady, router, view]);

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
  const historySlots = useMemo(() => slots
    .filter((slot) => slot.session || slot.report || slot.attendance?.length || slot.temporaryCoverage?.length || slot.replacementPersonnelId || slot.probableNoShowAt)
    .sort((a, b) => new Date(b.session?.endedAt || b.startsAt).getTime() - new Date(a.session?.endedAt || a.startsAt).getTime()), [slots]);
  const categorizedCoverageSlots = useMemo(() => categorizeSecurityCoverageSlots(slots), [slots]);
  const coverageSlots = categorizedCoverageSlots[coverageCategory];
  const activeShiftWorker = currentShift?.activeSession?.personnel || (currentShift?.activeSession?.slot ? slotWorker(currentShift.activeSession.slot) : null);
  const scheduledCurrentWorker = currentShift?.currentSlot ? slotWorker(currentShift.currentSlot) : null;
  const publishedPlan = useMemo(() => plans.find((plan) => plan.status === 'PUBLISHED'), [plans]);

  const run = async (action: () => Promise<any>, success: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      setError('');
      await action();
      setMessage(success);
      setDraft({ mode: null, slotId: '' });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'عملیات انجام نشد.');
    } finally {
      savingRef.current = false;
      setSaving(false);
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
    if (mode === 'temporary') setTemporary({ personnelId: '', startsAt: dateTimeInput(slot.startsAt), endsAt: dateTimeInput(slot.endsAt), note: '' });
    if (mode === 'force-close') setForceClose({ reason: '', summary: '' });
    if (mode === 'attendance-correction') {
      const attendance = slot.attendance?.[0];
      setCorrection({ attendanceId: attendance?.id || '', arrivedAt: dateTimeInput(attendance?.arrivedAt || slot.startsAt), reason: '' });
    }
    if (mode === 'session-correction') setSessionCorrection({
      startedAt: dateTimeInput(slot.session?.startedAt || slot.startsAt),
      endedAt: dateTimeInput(slot.session?.endedAt || (slot.managerReviewRequired ? slot.endsAt : null)),
      reason: '',
      deviationConfirmed: false,
    });
    if (mode === 'confirm-no-shift') setNoShiftReason('');
  };

  const submitReplacement = (slot: any) => run(
    () => securityAPI.setShiftReplacement(slot.id, replacement.personnelId, replacement.overrideReason || undefined),
    'جایگزین شیفت ثبت شد.'
  );

  const submitTemporary = (slot: any) => run(
    () => securityAPI.addTemporaryShiftCoverage(slot.id, {
      personnelId: temporary.personnelId,
      startsAt: dateTimeToIso(temporary.startsAt),
      endsAt: dateTimeToIso(temporary.endsAt),
      note: temporary.note,
    }),
    'پوشش موقت ثبت شد.'
  );

  const submitForceClose = (sessionId: string) => run(
    () => securityAPI.forceCloseShift(sessionId, forceClose.reason, forceClose.summary),
    'شیفت با حسابرسی مدیر بسته شد.'
  );

  const submitCorrection = () => run(
    () => securityAPI.correctShiftAttendance(correction.attendanceId, dateTimeToIso(correction.arrivedAt), correction.reason),
    'اصلاح حضور با حسابرسی ثبت شد.'
  );

  const submitSessionCorrection = (slot: any) => run(
    () => securityAPI.correctShiftSession(slot.id, {
      startedAt: sessionCorrection.startedAt ? dateTimeToIso(sessionCorrection.startedAt) : undefined,
      endedAt: sessionCorrection.endedAt ? dateTimeToIso(sessionCorrection.endedAt) : undefined,
      reason: sessionCorrection.reason,
      deviationConfirmed: sessionCorrection.deviationConfirmed,
    }),
    'اصلاح زمان‌های شیفت با حسابرسی ثبت شد.'
  );

  const submitNoShiftConfirmation = (slot: any) => run(
    () => securityAPI.confirmNoShift(slot.id, noShiftReason),
    'عدم انجام شیفت با حسابرسی تأیید شد.'
  );

  const closeShift = async (slot: any) => {
    const closureSummary = await askSecurityAction({ title: 'پایان شیفت', inputLabel: 'توضیح پایان شیفت', defaultValue: 'بدون مورد دیگر' });
    if (closureSummary === null) return;
    await run(() => securityAPI.endPlannedShift(slot.id, closureSummary.trim() || '\u0628\u062f\u0648\u0646 \u0645\u0648\u0631\u062f \u062f\u06cc\u06af\u0631'), '\u0634\u06cc\u0641\u062a \u067e\u0627\u06cc\u0627\u0646 \u06cc\u0627\u0641\u062a.');
  };

  const viewOptions = useMemo(() => [{ value: 'current' as ShiftView, label: 'شیفت جاری', icon: FaPlay }, { value: 'plans' as ShiftView, label: 'برنامه شیفت‌ها', icon: FaCalendarAlt }, { value: 'history' as ShiftView, label: 'سوابق', icon: FaHistory }], []);

  const slotStatusBadge = (slot: any) => {
    if (slot.operationalState === 'MANAGER_REVIEW') return <ErpBadge tone="warning">نیازمند بررسی مدیر</ErpBadge>;
    if (slot.operationalState === 'NO_SHIFT_CONFIRMED') return <ErpBadge tone="neutral">عدم انجام شیفت تأیید شد</ErpBadge>;
    if (slot.session?.status === 'ACTIVE') return <ErpBadge tone="success">فعال</ErpBadge>;
    if (slot.session?.status === 'FORCE_CLOSED') return <ErpBadge tone="danger">بسته‌شده توسط مدیر</ErpBadge>;
    if (slot.session?.status === 'CLOSED') return <ErpBadge tone="neutral">تکمیل‌شده</ErpBadge>;
    if (slot.probableNoShowAt) return <ErpBadge tone="warning">عدم حضور احتمالی</ErpBadge>;
    if (slot.coverageStatus === 'NEEDS_REPLACEMENT') return <ErpBadge tone="danger">نیازمند جایگزین</ErpBadge>;
    return <ErpBadge tone="info">در انتظار</ErpBadge>;
  };

  const openSlotEvidence = (slot: any) => {
    if (slot.session?.status === 'ACTIVE') return router.push('/dashboard/security/supervisor-reports');
    if (['CLOSED', 'FORCE_CLOSED'].includes(slot.session?.status)) return router.push(`/dashboard/security/reports/shifts/${slot.id}`);
    return router.push(`/dashboard/security/shifts/${slot.id}`);
  };

  const slotEvidenceLabel = (slot: any) => {
    if (slot.session?.status === 'ACTIVE') return 'گزارش جاری';
    if (['CLOSED', 'FORCE_CLOSED'].includes(slot.session?.status)) return 'گزارش شیفت';
    return 'جزئیات برنامه';
  };

  const managementActions = (slot: any) => {
    const actions: any[] = [];
    if (!slot.session && !slot.noShiftConfirmedAt && !slot.managerReviewRequired) {
      actions.push({ label: 'جایگزین', icon: FaUserEdit, onClick: () => openDraft('replacement', slot) });
      actions.push({ label: 'پوشش موقت', icon: FaUsers, onClick: () => openDraft('temporary', slot) });
    }
    if (slot.attendance?.length) actions.push({ label: 'اصلاح زمان حضور', icon: FaClock, onClick: () => openDraft('attendance-correction', slot) });
    if (!slot.noShiftConfirmedAt && (slot.session || new Date(slot.startsAt).getTime() <= now)) actions.push({ label: 'اصلاح زمان‌های شیفت', icon: FaClock, onClick: () => openDraft('session-correction', slot) });
    if (slot.managerReviewRequired) actions.push({ label: 'تأیید عدم انجام شیفت', tone: 'danger', onClick: () => openDraft('confirm-no-shift', slot) });
    if (slot.coverageStatus === 'NEEDS_REPLACEMENT') actions.push({
      label: 'اضطراری بدون پوشش',
      tone: 'danger',
      onClick: async () => {
        const reason = await askSecurityAction({ title: 'پوشش اضطراری', inputLabel: 'دلیل وضعیت اضطراری' });
        if (reason) await run(() => securityAPI.markShiftEmergencyUncovered(slot.id, reason), 'وضعیت اضطراری ثبت شد.');
      }
    });
    if (slot.session?.status === 'ACTIVE') actions.push({ label: 'بستن اجباری', tone: 'danger', onClick: () => openDraft('force-close', slot) });
    return actions;
  };

  return (
    <ErpWorkspacePage title="شیفت‌ها" primaryAction={defaults ? { label: 'برنامه جدید', icon: FaCalendarAlt, onClick: () => setView('plans'), variant: 'solid' } : undefined} secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load }]}>
      {loading && !slots.length && !plans.length ? <ErpSkeleton lines={6} /> : <>
      {message && <ErpInlineState kind="success" title={message} />}
      {error && <ErpInlineState kind={slots.length || plans.length ? 'stale' : 'error'} title={error} action={{ label: 'تلاش مجدد', onClick: load }} />}
      <ErpSegmentedControl<ShiftView> value={view} onChange={setView} options={viewOptions} />

      <ErpCard className="p-4" tone={currentShift?.activeSession ? 'success' : currentShift?.currentSlot ? 'warning' : 'neutral'}>
        {currentShift?.activeSession ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold sds-text-primary ">شیفت فعال: {personName(activeShiftWorker)}</p>
              <p className="mt-1 text-sm sds-text-secondary ">از {dateTimeFa(currentShift.activeSession.startedAt)} · بازه برنامه {dateTimeFa(currentShift.activeSession.slot.startsAt)} تا {dateTimeFa(currentShift.activeSession.slot.endsAt)}</p>
            </div>
            <ErpBadge tone="success">فعال</ErpBadge>
          </div>
        ) : currentShift?.currentSlot ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold sds-text-primary ">مسئول برنامه‌ریزی‌شده اکنون: {personName(scheduledCurrentWorker)}</p>
              <p className="mt-1 text-sm text-[var(--sds-warning)]">برای بازه {dateTimeFa(currentShift.currentSlot.startsAt)} تا {dateTimeFa(currentShift.currentSlot.endsAt)} هنوز شیفت فعال شروع نشده است.</p>
            </div>
            <ErpBadge tone="warning">شروع نشده</ErpBadge>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold sds-text-primary ">شیفت فعال وجود ندارد</p>
              <p className="mt-1 text-sm sds-text-secondary ">برای زمان فعلی بازه برنامه‌ریزی‌شده‌ای پیدا نشد.</p>
            </div>
            <ErpBadge tone="neutral">بدون شیفت</ErpBadge>
          </div>
        )}
      </ErpCard>

      {view === 'current' && (
        <ErpSection title="برنامه من">
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <label>
              <span className={labelClass}>ماه برنامه</span>
              <ErpSelect className={inputClass} value={visibleMonth} onChange={(e) => setVisibleMonth(e.target.value)}>
                {Array.from({ length: 36 }, (_, index) => {
                  const [baseYear, baseMonth] = PersianCalendar.now().slice(0, 7).split('/').map(Number);
                  const offset = index - 12;
                  const absolute = baseYear * 12 + (baseMonth - 1) + offset;
                  const year = Math.floor(absolute / 12);
                  const month = (absolute % 12) + 1;
                  const value = `${year}/${String(month).padStart(2, '0')}`;
                  return <option key={value} value={value}>{value}</option>;
                })}
              </ErpSelect>
            </label>
            {workflow?.activeSession && (
              <ErpCard className="p-4" tone="success">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold">شیفت فعال از {dateTimeFa(workflow.activeSession.startedAt)}</p>
                    <p className="mt-1 text-sm">تا پایان و ثبت گزارش این شیفت، شیفت بعدی آغاز نمی‌شود.</p>
                  </div>
                  {workflow.activeSession.personnelId === workflow.personnel?.id && workflow.activeSession.slot && <ErpButton label="ثبت پایان شیفت" icon={FaStop} tone="danger" disabled={saving} onClick={() => closeShift(workflow.activeSession.slot)} />}
                </div>
              </ErpCard>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {dayGroups.map(([day, items]) => (
              <ErpCard key={day} className="p-4">
                <p className="font-semibold sds-text-primary ">{day} · {PersianCalendar.getPersianDayOfWeek(day)}</p>
                <div className="mt-3 space-y-3">
                  {items.map((slot: any) => {
                    const attendance = slot.attendance?.find((item: any) => item.personnelId === workflow.personnel.id);
                    const isWorker = slot.effectivePersonnelId === workflow.personnel.id;
                    const canAttend = isWorker && !attendance && now >= new Date(slot.startsAt).getTime() - slot.plan.earlyArrivalMinutes * 60_000;
                    const waiting = elapsedMinutes(slot.startsAt, now);
                    return (
                      <div key={slot.id} className="rounded-lg border border-[var(--sds-border-subtle)] p-3 dark:border-[var(--sds-border-default)]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold">{timeFa(slot.startsAt)} تا {timeFa(slot.endsAt)}</p>
                          {slotStatusBadge(slot)}
                        </div>
                        <p className="mt-1 text-xs leading-5 sds-text-muted">
                          {slot.replacementPersonnelId === workflow.personnel.id ? 'وظیفه جایگزین' : 'شیفت برنامه‌ریزی‌شده'}
                          {attendance ? ` · حضور ${dateTimeFa(attendance.arrivedAt)}${attendance.delayMinutes ? ` · ${attendance.delayMinutes} دقیقه تأخیر` : ''}` : ` · انتظار ${waiting.toLocaleString('fa-IR')} دقیقه`}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {canAttend && <ErpButton label="ثبت حضور" icon={FaCheck} disabled={saving} onClick={() => run(() => securityAPI.registerShiftAttendance(slot.id), 'حضور ثبت شد.')} />}
                          {attendance && !slot.session && now >= new Date(slot.startsAt).getTime() && <ErpButton label="شروع شیفت" icon={FaPlay} tone="success" disabled={saving} onClick={() => run(() => securityAPI.startPlannedShift(slot.id), 'شیفت شروع شد.')} />}
                          {slot.session?.status === 'ACTIVE' && slot.session.personnelId === workflow.personnel.id && <ErpButton label="ثبت پایان شیفت" icon={FaStop} tone="danger" disabled={saving} onClick={() => closeShift(slot)} />}
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

      {view === 'current' && defaults && (
        <ErpSection title="پوشش شیفت‌ها">
          <ErpSegmentedControl<CoverageCategory>
            value={coverageCategory}
            onChange={setCoverageCategory}
            options={[
              { value: 'open', label: 'جاری و در انتظار', icon: FaPlay },
              { value: 'finished', label: 'پایان‌یافته', icon: FaHistory },
            ]}
          />
          <div className="space-y-3">
            {coverageSlots.map((slot) => {
              const worker = slotWorker(slot);
              const isDraft = draft.slotId === slot.id;
              return (
                <ErpCard key={slot.id} className="p-4" tone={slot.probableNoShowAt ? 'warning' : slot.coverageStatus === 'NEEDS_REPLACEMENT' ? 'danger' : 'neutral'}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{dateTimeFa(slot.startsAt)} تا {dateTimeFa(slot.endsAt)} · {personName(worker)}</p>
                      <p className="mt-1 text-xs leading-5 sds-text-muted">
                        برنامه: {personName(slot.plannedPersonnel)}
                        {slot.replacementPersonnel ? ` · جایگزین: ${personName(slot.replacementPersonnel)}` : ''}
                        {slot.probableNoShowAt ? ` · عدم حضور احتمالی از ${dateTimeFa(slot.probableNoShowAt)}` : ''}
                        {slot.attendance?.[0] ? ` · حضور ${dateTimeFa(slot.attendance[0].arrivedAt)}` : ' · در انتظار حضور'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {slotStatusBadge(slot)}
                      {slot.isManagerCorrected && <ErpBadge tone="warning">اصلاح‌شده توسط مدیر</ErpBadge>}
                      <ErpButton label={slotEvidenceLabel(slot)} variant="ghost" onClick={() => openSlotEvidence(slot)} />
                      {managementActions(slot).length > 0 && <ErpActionMenu label="اقدامات مدیریتی شیفت" actions={managementActions(slot)} />}
                    </div>
                  </div>

                  {isDraft && draft.mode === 'replacement' && (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-[var(--sds-border-subtle)] p-3 md:grid-cols-3 dark:border-[var(--sds-border-default)]">
                      <label><span className={labelClass}>نیروی جایگزین</span><ErpSelect className={inputClass} value={replacement.personnelId} onChange={(e) => setReplacement({ ...replacement, personnelId: e.target.value })}><option value="">انتخاب کنید</option>{personnelOptions.map((person: any) => <option key={person.id} value={person.id}>{personName(person)}</option>)}</ErpSelect></label>
                      <label className="md:col-span-2"><span className={labelClass}>دلیل override در صورت هشدار استراحت/تداخل</span><ErpInput className={inputClass} value={replacement.overrideReason} onChange={(e) => setReplacement({ ...replacement, overrideReason: e.target.value })} /></label>
                      <ErpButton label="ثبت جایگزین" icon={FaCheck} disabled={!replacement.personnelId} onClick={() => submitReplacement(slot)} />
                    </div>
                  )}

                  {isDraft && draft.mode === 'temporary' && (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-[var(--sds-border-subtle)] p-3 md:grid-cols-3 dark:border-[var(--sds-border-default)]">
                      <label><span className={labelClass}>نیروی پوشش موقت</span><ErpSelect className={inputClass} value={temporary.personnelId} onChange={(e) => setTemporary({ ...temporary, personnelId: e.target.value })}><option value="">انتخاب کنید</option>{personnelOptions.map((person: any) => <option key={person.id} value={person.id}>{personName(person)}</option>)}</ErpSelect></label>
                      <label><span className={labelClass}>شروع پوشش</span><PersianCalendarComponent showTime value={temporary.startsAt} onChange={(startsAt) => setTemporary({ ...temporary, startsAt })} /></label>
                      <label><span className={labelClass}>پایان پوشش</span><PersianCalendarComponent showTime value={temporary.endsAt} onChange={(endsAt) => setTemporary({ ...temporary, endsAt })} /></label>
                      <label><span className={labelClass}>یادداشت</span><ErpInput className={inputClass} value={temporary.note} onChange={(e) => setTemporary({ ...temporary, note: e.target.value })} /></label>
                      <ErpButton label="ثبت پوشش موقت" icon={FaCheck} disabled={!temporary.personnelId} onClick={() => submitTemporary(slot)} />
                    </div>
                  )}

                  {isDraft && draft.mode === 'force-close' && (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-[var(--sds-danger)] p-3 md:grid-cols-2">
                      <label><span className={labelClass}>دلیل بستن اجباری</span><ErpInput className={inputClass} value={forceClose.reason} onChange={(e) => setForceClose({ ...forceClose, reason: e.target.value })} /></label>
                      <label><span className={labelClass}>خلاصه گزارش مدیر</span><ErpInput className={inputClass} value={forceClose.summary} onChange={(e) => setForceClose({ ...forceClose, summary: e.target.value })} /></label>
                      <ErpButton label="بستن با حسابرسی" tone="danger" disabled={!forceClose.reason.trim() || !forceClose.summary.trim()} onClick={() => submitForceClose(slot.session.id)} />
                    </div>
                  )}

                  {isDraft && draft.mode === 'attendance-correction' && (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-[var(--sds-warning)] p-3 md:grid-cols-4">
                      <label className="md:col-span-2"><span className={labelClass}>زمان اصلاح‌شده حضور</span><PersianCalendarComponent showTime value={correction.arrivedAt} onChange={(arrivedAt) => setCorrection({ ...correction, arrivedAt })} /></label>
                      <label className="md:col-span-2"><span className={labelClass}>دلیل اصلاح</span><ErpInput className={inputClass} value={correction.reason} onChange={(e) => setCorrection({ ...correction, reason: e.target.value })} /></label>
                      <ErpButton label="ثبت اصلاح حضور" tone="warning" disabled={!correction.attendanceId || !correction.reason.trim()} onClick={submitCorrection} />
                    </div>
                  )}

                  {isDraft && draft.mode === 'session-correction' && (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-[var(--sds-warning)] p-3 md:grid-cols-2">
                      <label><span className={labelClass}>شروع مؤثر شیفت</span><PersianCalendarComponent showTime value={sessionCorrection.startedAt} onChange={(startedAt) => setSessionCorrection({ ...sessionCorrection, startedAt })} /></label>
                      <label><span className={labelClass}>پایان مؤثر شیفت</span><PersianCalendarComponent showTime value={sessionCorrection.endedAt} onChange={(endedAt) => setSessionCorrection({ ...sessionCorrection, endedAt })} clearable /></label>
                      <label className="md:col-span-2"><span className={labelClass}>دلیل اصلاح یا بازسازی</span><ErpTextarea className={`${inputClass} min-h-24`} value={sessionCorrection.reason} onChange={(event) => setSessionCorrection({ ...sessionCorrection, reason: event.target.value })} /></label>
                      <label className="md:col-span-2 flex min-h-11 items-center gap-2 text-sm"><ErpCheckboxControl checked={sessionCorrection.deviationConfirmed} onChange={(event) => setSessionCorrection({ ...sessionCorrection, deviationConfirmed: event.target.checked })} className="h-5 w-5 accent-[var(--sds-accent)]" />خروج احتمالی زمان مؤثر از بازه برنامه را بررسی و تأیید می‌کنم.</label>
                      <ErpButton label="ثبت اصلاح زمان‌های شیفت" tone="warning" disabled={!sessionCorrection.startedAt || !sessionCorrection.reason.trim()} onClick={() => submitSessionCorrection(slot)} />
                    </div>
                  )}

                  {isDraft && draft.mode === 'confirm-no-shift' && (
                    <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-[var(--sds-danger)] p-3">
                      <ErpInlineState kind="stale" title="این تصمیم تأیید می‌کند که در این بازه هیچ جلسه عملیاتی شیفت انجام نشده است." />
                      <label><span className={labelClass}>دلیل عدم انجام شیفت</span><ErpTextarea className={`${inputClass} min-h-24`} value={noShiftReason} onChange={(event) => setNoShiftReason(event.target.value)} /></label>
                      <ErpButton label="تأیید عدم انجام شیفت" tone="danger" disabled={!noShiftReason.trim()} onClick={() => submitNoShiftConfirmation(slot)} />
                    </div>
                  )}
                </ErpCard>
              );
            })}
            {!coverageSlots.length && <ErpEmptyState icon={coverageCategory === 'open' ? FaPlay : FaHistory} title={coverageCategory === 'open' ? 'شیفت جاری یا در انتظار وجود ندارد' : 'شیفت پایان‌یافته‌ای وجود ندارد'} />}
          </div>
        </ErpSection>
      )}

      {view === 'plans' && defaults && (
        <ErpSection title="برنامه شیفت‌ها">
          {publishedPlan && <div className="mb-5 rounded-xl border border-[var(--sds-border-subtle)] p-4 dark:border-[var(--sds-border-subtle)]"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">جمعیت عملیاتی جاری</h3><ErpStatus label="برنامه منتشرشده" tone="success" /></div><p className="mt-2 text-sm sds-text-secondary ">{personName(publishedPlan.primaryA)} ← {personName(publishedPlan.primaryB)} ← {personName(publishedPlan.primaryC)}</p></div>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 [&>label:nth-child(4)]:hidden [&>label:nth-child(6)]:hidden">
            <label><span className={labelClass}>عنوان</span><ErpInput className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label><span className={labelClass}>سال شمسی</span><ErpInput className={inputClass} type="number" value={form.persianYear} onChange={(e) => setForm({ ...form, persianYear: Number(e.target.value) })} /></label>
            <label><span className={labelClass}>تاریخ شروع</span><PersianCalendarComponent value={form.anchorDate} onChange={(anchorDate) => setForm({ ...form, anchorDate })} /></label>
            <label><span className={labelClass}>ساعت شروع</span><ErpInput className={inputClass} type="time" value={form.anchorTime} onChange={(e) => setForm({ ...form, anchorTime: e.target.value })} /></label>
            <label><span className={labelClass}>تاریخ پایان تولید</span><PersianCalendarComponent value={form.untilDate} onChange={(untilDate) => setForm({ ...form, untilDate })} /></label>
            <label><span className={labelClass}>مدت هر شیفت (دقیقه)</span><ErpInput className={inputClass} type="number" min={60} value={form.slotDurationMinutes} onChange={(e) => setForm({ ...form, slotDurationMinutes: Number(e.target.value) })} /></label>
            <label><span className={labelClass}>پنجره حضور زودهنگام</span><ErpInput className={inputClass} type="number" value={form.earlyArrivalMinutes} onChange={(e) => setForm({ ...form, earlyArrivalMinutes: Number(e.target.value) })} /></label>
            <label><span className={labelClass}>آستانه هشدار تأخیر</span><ErpInput className={inputClass} type="number" value={form.lateAlertMinutes} onChange={(e) => setForm({ ...form, lateAlertMinutes: Number(e.target.value) })} /></label>
            {[0, 1, 2].map((index) => (
              <label key={index}>
                <span className={labelClass}>نیروی اصلی {['A', 'B', 'C'][index]}</span>
                <ErpSelect className={inputClass} value={form.primaryPersonnelIds[index]} onChange={(e) => { const ids = [...form.primaryPersonnelIds]; ids[index] = e.target.value; setForm({ ...form, primaryPersonnelIds: ids }); }}>
                  <option value="">انتخاب کنید</option>
                  {personnelOptions.map((person: any) => <option key={person.id} value={person.id}>{personName(person)}</option>)}
                </ErpSelect>
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
                    <p className="mt-1 text-xs sds-text-muted">{personName(plan.primaryA)} ← {personName(plan.primaryB)} ← {personName(plan.primaryC)} · {plan._count.slots.toLocaleString('fa-IR')} بازه</p>
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
        <ErpSection title="سوابق شیفت‌ها">
          <div className="space-y-3">
            {historySlots.map((slot) => (
              <ErpCard key={slot.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{dateTimeFa(slot.startsAt)} · {personName(slotWorker(slot))}</p>
                    <p className="mt-1 text-xs leading-5 sds-text-muted">
                      برنامه: {personName(slot.plannedPersonnel)}
                      {slot.replacementPersonnel ? ` · جایگزین: ${personName(slot.replacementPersonnel)}${slot.overrideReason ? ` · دلیل: ${slot.overrideReason}` : ''}` : ''}
                      {slot.leaveRequestId ? ' · ناشی از مرخصی تأییدشده' : ''}
                    </p>
                  </div>
                  {slotStatusBadge(slot)}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  {slot.attendance?.map((item: any) => (
                    <div key={item.id} className="rounded-lg bg-[var(--sds-surface-subtle)] p-3 dark:bg-[var(--sds-surface-subtle)]">
                      حضور: {dateTimeFa(item.arrivedAt)} · تأخیر {item.delayMinutes.toLocaleString('fa-IR')} دقیقه
                      {item.originalArrivedAt && <span className="block text-xs text-[var(--sds-warning)]">اصلاح‌شده از {dateTimeFa(item.originalArrivedAt)} · دلیل: {item.correctionReason}</span>}
                    </div>
                  ))}
                  {slot.session && <div className="rounded-lg bg-[var(--sds-surface-subtle)] p-3 dark:bg-[var(--sds-surface-subtle)]">جلسه: {sessionLabel[slot.session.status]} · شروع {dateTimeFa(slot.session.startedAt)}{slot.session.endedAt ? ` · پایان ${dateTimeFa(slot.session.endedAt)}` : ''}{slot.session.forceCloseReason ? ` · دلیل مدیر: ${slot.session.forceCloseReason}` : ''}</div>}
                  {slot.temporaryCoverage?.map((coverage: any) => <div key={coverage.id} className="rounded-lg bg-[var(--sds-surface-subtle)] p-3 dark:bg-[var(--sds-surface-subtle)]">پوشش موقت: {personName(coverage.personnel)} · {dateTimeFa(coverage.startsAt)} تا {dateTimeFa(coverage.endsAt)}{coverage.note ? ` · ${coverage.note}` : ''}</div>)}
                  {slot.report && <div className="rounded-lg bg-[var(--sds-surface-subtle)] p-3 dark:bg-[var(--sds-surface-subtle)]">گزارش شیفت: {slot.report.summary}</div>}
                  {slot.probableNoShowAt && <div className="rounded-lg bg-[var(--sds-warning-soft)] p-3 text-[var(--sds-warning)]">عدم حضور احتمالی در {dateTimeFa(slot.probableNoShowAt)}</div>}
                </div>
              </ErpCard>
            ))}
            {!historySlots.length && <ErpEmptyState icon={FaHistory} title="هنوز رکورد حسابرسی برای بازه فعلی وجود ندارد" />}
          </div>
        </ErpSection>
      )}
      </>}
    </ErpWorkspacePage>
  );
}
