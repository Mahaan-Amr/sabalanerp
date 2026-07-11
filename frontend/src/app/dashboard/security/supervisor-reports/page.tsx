'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaBan, FaClipboardCheck, FaClock, FaPlus, FaRedo, FaRoute, FaStop } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { securityAPI } from '@/lib/api';
import { askSecurityAction } from '@/components/SecurityNoticeHost';

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';

const dateTimeFa = (value?: string | null) => value ? new Date(value).toLocaleString('fa-IR') : '-';
const durationMinutes = (start?: string, end?: string | null) => {
  if (!start) return 0;
  const to = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.floor((to - new Date(start).getTime()) / 60000));
};

export default function SecuritySupervisorReportsPage() {
  const [types, setTypes] = useState<any[]>([]);
  const [session, setSession] = useState<any>(null);
  const [personnel, setPersonnel] = useState<any>(null);
  const [form, setForm] = useState({ reportTypeId: '', description: '' });
  const [patrolDescription, setPatrolDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const activePatrol = useMemo(() => session?.patrolSessions?.find((patrol: any) => patrol.status === 'ACTIVE'), [session]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [typesResponse, logResponse] = await Promise.all([
        securityAPI.getInstantReportTypes(false),
        securityAPI.getActiveShiftLog(),
      ]);
      if (typesResponse.data.success) setTypes(typesResponse.data.data || []);
      if (logResponse.data.success) {
        setSession(logResponse.data.data.session);
        setPersonnel(logResponse.data.data.personnel);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت گزارش شیفت ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const createEntry = async () => {
    setSaving(true);
    setError('');
    try {
      await securityAPI.createShiftLogEntry(form);
      setForm({ reportTypeId: '', description: '' });
      setMessage('گزارش لحظه‌ای ثبت شد.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت گزارش لحظه‌ای ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const voidEntry = async (entry: any) => {
    const reason = await askSecurityAction({ title: 'ابطال گزارش', inputLabel: `دلیل ابطال ردیف ${entry.rowNumber.toLocaleString('fa-IR')}` });
    if (!reason?.trim()) return;
    setSaving(true);
    setError('');
    try {
      await securityAPI.voidShiftLogEntry(entry.id, reason.trim());
      setMessage('گزارش باطل شد.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ابطال گزارش ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const startPatrol = async () => {
    setSaving(true);
    setError('');
    try {
      await securityAPI.startPatrol();
      setMessage('گشت‌زنی شروع شد.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'شروع گشت‌زنی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const finishPatrol = async () => {
    if (!activePatrol || !patrolDescription.trim()) return;
    setSaving(true);
    setError('');
    try {
      await securityAPI.finishPatrol(activePatrol.id, patrolDescription.trim());
      setPatrolDescription('');
      setMessage('گشت‌زنی پایان یافت.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'پایان گشت‌زنی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حراست"
      title="گزارش شیفت"
      description="ثبت گزارش‌های لحظه‌ای و گشت‌زنی‌های شیفت فعال با زمان دقیق و سابقه ابطال."
      actions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: loadData, tone: 'neutral' }]}
      metrics={[
        { label: 'گزارش‌ها', value: (session?.logEntries?.length || 0).toLocaleString('fa-IR'), icon: FaClipboardCheck, tone: 'info' },
        { label: 'گشت‌زنی‌ها', value: (session?.patrolSessions?.length || 0).toLocaleString('fa-IR'), icon: FaRoute, tone: activePatrol ? 'warning' : 'success' },
      ]}
    >
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

      {!session ? (
        <ErpEmptyState icon={FaClock} title="شیفت فعال برای شما پیدا نشد" description={personnel ? 'برای ثبت گزارش، ابتدا شیفت برنامه‌ریزی‌شده خود را شروع کنید.' : 'کاربر فعلی جزو نفرات حراست نیست.'} />
      ) : (
        <>
          <ErpSection title="ثبت گزارش لحظه‌ای">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] lg:items-end">
              <label>
                <span className={labelClass}>نوع گزارش لحظه‌ای</span>
                <select className={inputClass} value={form.reportTypeId} onChange={(event) => setForm((current) => ({ ...current, reportTypeId: event.target.value }))}>
                  <option value="">انتخاب کنید</option>
                  {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </label>
              <label>
                <span className={labelClass}>توضیحات</span>
                <textarea className={`${inputClass} min-h-12`} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <ErpButton label="ثبت گزارش" icon={FaPlus} onClick={createEntry} disabled={saving || !form.reportTypeId || !form.description.trim()} variant="solid" />
            </div>
            {types.length === 0 && <p className="mt-3 text-sm text-amber-700">ابتدا نوع گزارش لحظه‌ای را در تنظیمات حراست تعریف کنید.</p>}
          </ErpSection>

          <ErpSection title="گشت‌زنی">
            {!activePatrol ? (
              <ErpButton label="شروع گشت‌زنی" icon={FaRoute} onClick={startPatrol} disabled={saving} variant="solid" tone="success" />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <label>
                  <span className={labelClass}>توضیحات پایان گشت‌زنی</span>
                  <textarea className={`${inputClass} min-h-24`} value={patrolDescription} onChange={(event) => setPatrolDescription(event.target.value)} />
                  <span className="mt-2 block text-xs text-slate-500">شروع: {dateTimeFa(activePatrol.startedAt)} · مدت: {durationMinutes(activePatrol.startedAt).toLocaleString('fa-IR')} دقیقه</span>
                </label>
                <ErpButton label="پایان گشت‌زنی" icon={FaStop} onClick={finishPatrol} disabled={saving || !patrolDescription.trim()} tone="warning" variant="solid" />
              </div>
            )}

            <div className="mt-4 space-y-3">
              {(session.patrolSessions || []).map((patrol: any) => (
                <ErpCard key={patrol.id} className="p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">شروع {dateTimeFa(patrol.startedAt)}</p>
                      <p className="mt-1 text-sm text-slate-500">پایان: {dateTimeFa(patrol.endedAt)} · مدت: {durationMinutes(patrol.startedAt, patrol.endedAt).toLocaleString('fa-IR')} دقیقه</p>
                      {patrol.description && <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{patrol.description}</p>}
                    </div>
                    <ErpBadge tone={patrol.status === 'ACTIVE' ? 'warning' : 'success'}>{patrol.status === 'ACTIVE' ? 'فعال' : 'پایان یافته'}</ErpBadge>
                  </div>
                </ErpCard>
              ))}
            </div>
          </ErpSection>

          <ErpSection title="ردیف‌های گزارش شیفت">
            {session.logEntries?.length === 0 ? (
              <ErpEmptyState icon={FaClipboardCheck} title="گزارش لحظه‌ای ثبت نشده است" />
            ) : (
              <div className="space-y-3">
                {session.logEntries.map((entry: any) => (
                  <ErpCard key={entry.id} className={`p-4 ${entry.status === 'VOIDED' ? 'opacity-75' : ''}`}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white">ردیف {entry.rowNumber.toLocaleString('fa-IR')}</span>
                          <ErpBadge tone={entry.status === 'VOIDED' ? 'danger' : 'info'}>{entry.status === 'VOIDED' ? 'باطل شده' : entry.reportType?.name}</ErpBadge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{entry.description}</p>
                        <p className="mt-2 text-xs text-slate-500">ثبت: {dateTimeFa(entry.createdAt)}</p>
                        {entry.status === 'VOIDED' && <p className="mt-2 text-sm text-red-700 dark:text-red-300">دلیل ابطال: {entry.voidReason} · زمان ابطال: {dateTimeFa(entry.voidedAt)}</p>}
                      </div>
                      {entry.status !== 'VOIDED' && <ErpButton label="ابطال گزارش" icon={FaBan} tone="danger" variant="soft" onClick={() => voidEntry(entry)} disabled={saving} />}
                    </div>
                  </ErpCard>
                ))}
              </div>
            )}
          </ErpSection>
        </>
      )}
    </ErpPage>
  );
}
