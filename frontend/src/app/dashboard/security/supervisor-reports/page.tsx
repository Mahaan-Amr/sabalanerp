'use client';

import { useEffect, useState } from 'react';
import { FaClipboardCheck, FaExclamationTriangle, FaList, FaPlus, FaRedo, FaTasks } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpSegmentedControl } from '@/components/erp';
import { securityAPI } from '@/lib/api';
import PersianCalendarComponent from '@/components/PersianCalendar';
import PersianCalendar from '@/lib/persian-calendar';

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';

const todayPersian = () => PersianCalendar.now('jYYYY/jMM/jDD');
type SupervisorSection = 'create' | 'reports' | 'follow-ups' | 'incidents';

export default function SecuritySupervisorReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [form, setForm] = useState({
    reportDate: todayPersian(),
    shiftId: '',
    summary: '',
    incidents: '',
    followUpNotes: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeSection, setActiveSection] = useState<SupervisorSection>('create');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [reportsResponse, shiftsResponse] = await Promise.all([
        securityAPI.getSupervisorReports(),
        securityAPI.getShifts(),
      ]);
      if (reportsResponse.data.success) setReports(reportsResponse.data.data);
      if (shiftsResponse.data.success) setShifts(shiftsResponse.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت گزارش‌های سرپرست ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const createReport = async () => {
    setSaving(true);
    setError('');
    try {
      await securityAPI.createSupervisorReport({
        ...form,
        reportDate: PersianCalendar.toGregorian(form.reportDate, 'jYYYY/jMM/jDD').toISOString(),
        shiftId: form.shiftId || null,
      });
      setForm({ reportDate: todayPersian(), shiftId: '', summary: '', incidents: '', followUpNotes: '' });
      setMessage('گزارش سرپرست ثبت شد.');
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت گزارش سرپرست ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حراست"
      title="گزارش سرپرست"
      description="گزارش روزانه یا شیفتی سرپرست حراست با خلاصه، رخدادها و پیگیری‌ها."
      actions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: loadData, tone: 'neutral' }]}
      metrics={[
        { label: 'گزارش‌ها', value: reports.length, icon: FaClipboardCheck, tone: 'info' },
      ]}
    >
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

      <ErpSegmentedControl<SupervisorSection>
        value={activeSection}
        onChange={setActiveSection}
        options={[
          { value: 'create', label: 'ثبت گزارش سرپرست', icon: FaPlus },
          { value: 'reports', label: 'گزارش‌های سرپرست', icon: FaList },
          { value: 'follow-ups', label: 'پیگیری‌ها', icon: FaTasks },
          { value: 'incidents', label: 'رخدادها', icon: FaExclamationTriangle },
        ]}
      />

      {activeSection === 'create' && (
      <ErpSection title="ثبت گزارش شیفت">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label>
            <span className={labelClass}>تاریخ گزارش</span>
            <PersianCalendarComponent value={form.reportDate} onChange={(reportDate) => setForm((current) => ({ ...current, reportDate }))} placeholder="تاریخ گزارش" />
          </label>
          <label>
            <span className={labelClass}>شیفت</span>
            <select className={inputClass} value={form.shiftId} onChange={(event) => setForm((current) => ({ ...current, shiftId: event.target.value }))}>
              <option value="">بدون شیفت</option>
              {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.namePersian}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <label>
            <span className={labelClass}>خلاصه</span>
            <textarea className={`${inputClass} min-h-28`} value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} />
          </label>
          <label>
            <span className={labelClass}>رخدادها</span>
            <textarea className={`${inputClass} min-h-24`} value={form.incidents} onChange={(event) => setForm((current) => ({ ...current, incidents: event.target.value }))} />
          </label>
          <label>
            <span className={labelClass}>پیگیری‌ها</span>
            <textarea className={`${inputClass} min-h-24`} value={form.followUpNotes} onChange={(event) => setForm((current) => ({ ...current, followUpNotes: event.target.value }))} />
          </label>
        </div>
        <div className="mt-3">
          <ErpButton label="ثبت گزارش" icon={FaPlus} onClick={createReport} disabled={saving || !form.summary.trim()} variant="solid" />
        </div>
      </ErpSection>
      )}

      {activeSection === 'reports' && (
      <ErpSection title="گزارش‌های سرپرست">
        {reports.length === 0 ? (
          <ErpEmptyState icon={FaClipboardCheck} title="گزارش سرپرست ثبت نشده است" />
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <ErpCard key={report.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">{new Date(report.reportDate).toLocaleDateString('fa-IR')}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{report.summary}</p>
                    {report.incidents && <p className="mt-2 text-sm text-amber-700 dark:text-amber-200">{report.incidents}</p>}
                    {report.followUpNotes && <p className="mt-1 text-sm text-slate-500">{report.followUpNotes}</p>}
                  </div>
                  <ErpBadge tone="info">{report.shift?.namePersian || 'بدون شیفت'}</ErpBadge>
                </div>
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>
      )}

      {activeSection === 'follow-ups' && (
      <ErpSection title="پیگیری‌ها">
        {reports.filter((report) => report.followUpNotes).length === 0 ? (
          <ErpEmptyState icon={FaTasks} title="پیگیری ثبت نشده است" />
        ) : (
          <div className="space-y-3">
            {reports.filter((report) => report.followUpNotes).map((report) => (
              <ErpCard key={report.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">{new Date(report.reportDate).toLocaleDateString('fa-IR')}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{report.followUpNotes}</p>
                  </div>
                  <ErpBadge tone="warning">در پیگیری</ErpBadge>
                </div>
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>
      )}

      {activeSection === 'incidents' && (
      <ErpSection title="رخدادها">
        {reports.filter((report) => report.incidents).length === 0 ? (
          <ErpEmptyState icon={FaExclamationTriangle} title="رخدادی ثبت نشده است" />
        ) : (
          <div className="space-y-3">
            {reports.filter((report) => report.incidents).map((report) => (
              <ErpCard key={report.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">{new Date(report.reportDate).toLocaleDateString('fa-IR')}</p>
                    <p className="mt-2 text-sm leading-6 text-amber-700 dark:text-amber-200">{report.incidents}</p>
                  </div>
                  <ErpBadge tone="danger">رخداد</ErpBadge>
                </div>
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>
      )}
    </ErpPage>
  );
}
