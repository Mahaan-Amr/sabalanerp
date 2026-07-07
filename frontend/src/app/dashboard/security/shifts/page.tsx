'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FaCalendarAlt, FaCheck, FaClock, FaExclamationTriangle, FaPlay, FaRedo, FaStop, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpSegmentedControl } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import PersianCalendar from '@/lib/persian-calendar';
import { securityAPI } from '@/lib/api';

type ShiftView = 'mine' | 'coverage' | 'plans';

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-teal-600 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';
const coverageLabel: Record<string, string> = {
  COVERED: 'پوشش کامل',
  NEEDS_REPLACEMENT: 'نیازمند جایگزین',
  EMERGENCY_UNCOVERED: 'بدون پوشش اضطراری',
};

const personName = (personnel: any) => personnel?.user ? `${personnel.user.firstName} ${personnel.user.lastName}` : '—';
const slotWorker = (slot: any) => slot.replacementPersonnel || slot.plannedPersonnel;
const dateTimeFa = (value: string | Date) => new Date(value).toLocaleString('fa-IR');

export default function SecurityShiftsPage() {
  const currentYear = Number(PersianCalendar.now().split('/')[0]);
  const [view, setView] = useState<ShiftView>('mine');
  const [workflow, setWorkflow] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [slots, setSlots] = useState<any[]>([]);
  const [defaults, setDefaults] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
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
      const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const to = new Date(Date.now() + 45 * 86_400_000).toISOString();
      const [workflowResult, plansResult, slotsResult] = await Promise.allSettled([
        securityAPI.getMyShiftWorkflow(),
        securityAPI.getShiftPlans(true),
        securityAPI.getShiftPlanSlots({ from, to }),
      ]);
      if (workflowResult.status === 'fulfilled') setWorkflow(workflowResult.value.data.data);
      if (plansResult.status === 'fulfilled') setPlans(plansResult.value.data.data || []);
      if (slotsResult.status === 'fulfilled') setSlots(slotsResult.value.data.data || []);
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
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const mySlots = useMemo(() => workflow?.slots || [], [workflow]);
  const nextSlot = useMemo(() => mySlots.find((slot: any) => new Date(slot.endsAt).getTime() > now), [mySlots, now]);

  const run = async (action: () => Promise<any>, success: string) => {
    try {
      setError('');
      await action();
      setMessage(success);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'عملیات انجام نشد.');
    }
  };

  const createPlan = async () => {
    const anchorAt = PersianCalendar.toGregorian(`${form.anchorDate} ${form.anchorTime}`, 'jYYYY/jMM/jDD HH:mm');
    const generateUntil = PersianCalendar.toGregorian(`${form.untilDate} 23:59`, 'jYYYY/jMM/jDD HH:mm');
    await run(() => securityAPI.createShiftPlan({ ...form, anchorAt: anchorAt.toISOString(), generateUntil: generateUntil.toISOString() }), 'پیش‌نویس برنامه سالانه ساخته شد.');
  };

  const assignReplacement = async (slot: any) => {
    const personnelId = window.prompt('شناسه نیروی جایگزین را وارد کنید:');
    if (!personnelId) return;
    try {
      await securityAPI.setShiftReplacement(slot.id, personnelId);
      setMessage('جایگزین ثبت شد.');
      await load();
    } catch (err: any) {
      if (err.response?.status === 409) {
        const reason = window.prompt(`${err.response.data.error}\nدلیل تأیید مدیر:`);
        if (reason) await run(() => securityAPI.setShiftReplacement(slot.id, personnelId, reason), 'جایگزین با تأیید مدیر ثبت شد.');
      } else {
        setError(err.response?.data?.error || 'ثبت جایگزین ناموفق بود.');
      }
    }
  };

  const closeShift = async (slot: any) => {
    if (!slot.report) {
      const summary = window.prompt('خلاصه گزارش شیفت را وارد کنید (مثلاً بدون رخداد):');
      if (!summary?.trim()) return;
      await securityAPI.createSupervisorReport({ reportDate: new Date().toISOString(), planSlotId: slot.id, summary: summary.trim() });
    }
    await run(() => securityAPI.endPlannedShift(slot.id), 'شیفت پایان یافت و خروج ثبت شد.');
  };

  const addTemporaryCoverage = async (slot: any) => {
    const personnelId = window.prompt('شناسه نیروی پوشش موقت را وارد کنید:');
    if (!personnelId) return;
    const startsAt = window.prompt('زمان شروع پوشش موقت را وارد کنید:', new Date(slot.startsAt).toISOString());
    if (!startsAt) return;
    const endsAt = window.prompt('زمان پایان پوشش موقت را وارد کنید:', new Date(slot.endsAt).toISOString());
    if (!endsAt) return;
    const note = window.prompt('یادداشت پوشش موقت:') || '';
    await run(() => securityAPI.addTemporaryShiftCoverage(slot.id, { personnelId, startsAt, endsAt, note }), 'پوشش موقت ثبت شد.');
  };

  const viewOptions = useMemo(() => {
    const options: Array<{ value: ShiftView; label: string; icon: any }> = [{ value: 'mine', label: 'برنامه من', icon: FaCalendarAlt }];
    if (defaults) {
      options.push({ value: 'coverage', label: 'پوشش شیفت‌ها', icon: FaUsers });
      options.push({ value: 'plans', label: 'برنامه سالانه', icon: FaClock });
    }
    return options;
  }, [defaults]);

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حراست"
      title="شیفت‌ها"
      description="برنامه سالانه، پوشش شیفت و حضور و غیاب خودکار"
      actions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load, tone: 'neutral' }]}
      metrics={[
        { label: 'شیفت بعدی من', value: nextSlot ? dateTimeFa(nextSlot.startsAt) : '—', icon: FaClock, tone: 'info' },
        { label: 'نیازمند جایگزین', value: slots.filter((slot) => slot.coverageStatus === 'NEEDS_REPLACEMENT').length, icon: FaExclamationTriangle, tone: 'warning' },
        { label: 'شیفت فعال', value: workflow?.activeSession ? 1 : 0, icon: FaPlay, tone: 'success' },
      ]}
    >
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      <ErpSegmentedControl<ShiftView> value={view} onChange={setView} options={viewOptions} />

      {view === 'mine' && (
        <ErpSection title="برنامه من" description="تقویم شیفت‌های منتشرشده، حضور، تأخیر و مسئولیت جایگزینی">
          {workflow?.activeSession && (
            <ErpCard className="mb-4 p-4" tone="success">
              <p className="font-bold">شیفت فعال از {dateTimeFa(workflow.activeSession.startedAt)}</p>
              <p className="mt-1 text-sm">شیفت بعدی تا زمان پایان و ثبت گزارش این شیفت آغاز نمی‌شود.</p>
            </ErpCard>
          )}
          <div className="space-y-3">
            {mySlots.map((slot: any) => {
              const attendance = slot.attendance?.find((item: any) => item.personnelId === workflow.personnel.id);
              const isWorker = slot.effectivePersonnelId === workflow.personnel.id;
              const canAttend = isWorker && !attendance && now >= new Date(slot.startsAt).getTime() - slot.plan.earlyArrivalMinutes * 60_000;
              return (
                <ErpCard key={slot.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{dateTimeFa(slot.startsAt)} تا {dateTimeFa(slot.endsAt)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {slot.replacementPersonnelId === workflow.personnel.id ? 'وظیفه جایگزین' : 'شیفت برنامه‌ریزی‌شده'}
                        {attendance ? ` · حضور ${dateTimeFa(attendance.arrivedAt)}${attendance.delayMinutes ? ` · ${attendance.delayMinutes} دقیقه تأخیر` : ''}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ErpBadge tone={slot.coverageStatus === 'COVERED' ? 'success' : 'warning'}>{coverageLabel[slot.coverageStatus]}</ErpBadge>
                      {canAttend && <ErpButton label="ثبت حضور" icon={FaCheck} onClick={() => run(() => securityAPI.registerShiftAttendance(slot.id), 'حضور ثبت شد.')} />}
                      {attendance && !slot.session && now >= new Date(slot.startsAt).getTime() && <ErpButton label="شروع شیفت" icon={FaPlay} tone="success" onClick={() => run(() => securityAPI.startPlannedShift(slot.id), 'شیفت شروع شد.')} />}
                      {slot.session?.status === 'ACTIVE' && slot.session.personnelId === workflow.personnel.id && <ErpButton label="گزارش و پایان شیفت" icon={FaStop} tone="danger" onClick={() => closeShift(slot)} />}
                    </div>
                  </div>
                </ErpCard>
              );
            })}
            {!mySlots.length && <ErpEmptyState icon={FaCalendarAlt} title="برنامه منتشرشده‌ای برای شما وجود ندارد" />}
          </div>
        </ErpSection>
      )}

      {view === 'coverage' && defaults && (
        <ErpSection title="پوشش شیفت‌ها" description="وضعیت پوشش، حضور، تأخیر، تحویل و شکاف‌های آینده">
          {workflow?.activeSession && (
            <ErpCard className="mb-4 p-4" tone="warning">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-bold">یک شیفت فعال در انتظار تحویل است</p>
                  <p className="text-sm">شروع: {dateTimeFa(workflow.activeSession.startedAt)}</p>
                </div>
                <ErpButton
                  label="بستن اجباری"
                  tone="danger"
                  onClick={() => {
                    const reason = prompt('دلیل بستن اجباری:');
                    const summary = prompt('خلاصه گزارش مدیر:');
                    if (reason && summary) run(() => securityAPI.forceCloseShift(workflow.activeSession.id, reason, summary), 'شیفت با ثبت حسابرسی بسته شد.');
                  }}
                />
              </div>
            </ErpCard>
          )}
          <div className="space-y-3">
            {slots.map((slot) => {
              const worker = slotWorker(slot);
              const late = !slot.attendance?.length && now > new Date(slot.startsAt).getTime() + slot.plan.lateAlertMinutes * 60_000 && now < new Date(slot.endsAt).getTime();
              return (
                <ErpCard key={slot.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{dateTimeFa(slot.startsAt)} · {personName(worker)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        برنامه: {personName(slot.plannedPersonnel)}
                        {slot.replacementPersonnel ? ` · جایگزین: ${personName(slot.replacementPersonnel)}` : ''}
                        {late ? ' · عدم حضور احتمالی' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ErpBadge tone={slot.coverageStatus === 'COVERED' ? late ? 'warning' : 'success' : 'danger'}>{late ? 'عدم حضور احتمالی' : coverageLabel[slot.coverageStatus]}</ErpBadge>
                      <ErpButton label="پوشش موقت" onClick={() => addTemporaryCoverage(slot)} />
                      {slot.coverageStatus === 'NEEDS_REPLACEMENT' && <ErpButton label="تعیین جایگزین" onClick={() => assignReplacement(slot)} />}
                      {slot.coverageStatus === 'NEEDS_REPLACEMENT' && <ErpButton label="اضطراری بدون پوشش" tone="danger" onClick={() => { const reason = prompt('دلیل اضطراری:'); if (reason) run(() => securityAPI.markShiftEmergencyUncovered(slot.id, reason), 'وضعیت اضطراری ثبت شد.'); }} />}
                    </div>
                  </div>
                </ErpCard>
              );
            })}
          </div>
        </ErpSection>
      )}

      {view === 'plans' && defaults && (
        <ErpSection title="برنامه سالانه شیفت" description="تولید پیش‌نویس از نقطه شروع قابل تنظیم و انتشار پس از بازبینی">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
                  {defaults.personnel.map((person: any) => <option key={person.id} value={person.id}>{personName(person)}</option>)}
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
                  <div className="flex gap-2">
                    <ErpBadge tone={plan.status === 'PUBLISHED' ? 'success' : 'warning'}>{plan.status === 'PUBLISHED' ? 'منتشر شده' : plan.status === 'DRAFT' ? 'پیش‌نویس' : 'جایگزین شده'}</ErpBadge>
                    {plan.status === 'DRAFT' && <ErpButton label="انتشار" icon={FaCheck} tone="success" onClick={() => run(() => securityAPI.publishShiftPlan(plan.id), 'برنامه منتشر شد.')} />}
                  </div>
                </div>
              </ErpCard>
            ))}
          </div>
        </ErpSection>
      )}
    </ErpPage>
  );
}
