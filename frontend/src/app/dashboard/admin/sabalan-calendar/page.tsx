'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaCalendarAlt, FaPlus, FaSave } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { sabalanCalendarAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';

const eventLabels: Record<string, string> = {
  OFFICIAL_HOLIDAY: 'تعطیل رسمی',
  COMPANY_HOLIDAY: 'تعطیل شرکت',
  INTERNAL_EVENT: 'رویداد داخلی',
  REMINDER: 'یادآوری',
  OTHER: 'سایر',
};

const emptyForm = {
  id: '',
  date: PersianCalendar.now(),
  title: '',
  description: '',
  eventType: 'INTERNAL_EVENT',
  isHoliday: false,
  isActive: true,
};

export default function SabalanCalendarPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, any[]>();
    entries.forEach((entry) => {
      const key = new Date(entry.date).toLocaleDateString('fa-IR');
      groups.set(key, [...(groups.get(key) || []), entry]);
    });
    return Array.from(groups.entries());
  }, [entries]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const start = PersianCalendar.toGregorian(`${PersianCalendar.now('jYYYY')}/01/01`, 'jYYYY/jMM/jDD').toISOString();
      const response = await sabalanCalendarAPI.getEntries({ from: start, includeInactive: true });
      if (response.data.success) setEntries(response.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت تقویم سالیانه ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const saveEntry = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        date: PersianCalendar.toGregorian(form.date, 'jYYYY/jMM/jDD').toISOString(),
      };
      if (form.id) {
        await sabalanCalendarAPI.updateEntry(form.id, payload);
        setMessage('رویداد تقویم ویرایش شد.');
      } else {
        await sabalanCalendarAPI.createEntry(payload);
        setMessage('رویداد تقویم ثبت شد.');
      }
      setForm(emptyForm);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ذخیره رویداد تقویم ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="مدیریت سیستم"
      title="تقویم سالیانه سبلان"
      description="تعریف تعطیلی‌ها و رویدادهای شرکت؛ این تقویم فعلاً فقط مرجع اطلاعاتی است."
      metrics={[
        { label: 'رویدادها', value: entries.length.toLocaleString('fa-IR'), icon: FaCalendarAlt, tone: 'info' },
        { label: 'روزهای تعطیل', value: new Set(entries.filter((entry) => entry.isActive && entry.isHoliday).map((entry) => new Date(entry.date).toDateString())).size.toLocaleString('fa-IR'), icon: FaCalendarAlt, tone: 'warning' },
      ]}
    >
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

      <ErpSection title={form.id ? 'ویرایش رویداد' : 'رویداد جدید'}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <label>
            <span className={labelClass}>تاریخ</span>
            <PersianCalendarComponent value={form.date} onChange={(date) => setForm((current) => ({ ...current, date }))} placeholder="تاریخ" />
          </label>
          <label>
            <span className={labelClass}>عنوان</span>
            <input className={inputClass} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label>
            <span className={labelClass}>نوع رویداد</span>
            <select className={inputClass} value={form.eventType} onChange={(event) => setForm((current) => ({ ...current, eventType: event.target.value }))}>
              {Object.entries(eventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
          <label>
            <span className={labelClass}>توضیحات</span>
            <input className={inputClass} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 dark:border-slate-700 dark:bg-slate-800">
            <input type="checkbox" checked={form.isHoliday} onChange={(event) => setForm((current) => ({ ...current, isHoliday: event.target.checked }))} />
            <span className="text-sm text-slate-700 dark:text-slate-200">تعطیل</span>
          </label>
          <label className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 dark:border-slate-700 dark:bg-slate-800">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />
            <span className="text-sm text-slate-700 dark:text-slate-200">فعال</span>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ErpButton label={form.id ? 'ذخیره تغییرات' : 'ثبت رویداد'} icon={form.id ? FaSave : FaPlus} onClick={saveEntry} disabled={saving || !form.title.trim()} variant="solid" />
          {form.id && <ErpButton label="انصراف" onClick={() => setForm(emptyForm)} tone="neutral" variant="outline" />}
        </div>
      </ErpSection>

      <ErpSection title="رویدادهای ثبت‌شده">
        {groupedByDate.length === 0 ? (
          <ErpEmptyState icon={FaCalendarAlt} title="رویدادی در تقویم ثبت نشده است" />
        ) : (
          <div className="space-y-4">
            {groupedByDate.map(([date, dayEntries]) => {
              const holiday = dayEntries.some((entry) => entry.isActive && entry.isHoliday);
              return (
                <ErpCard key={date} className="p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900 dark:text-white">{date}</p>
                    {holiday && <ErpBadge tone="warning">تعطیل</ErpBadge>}
                  </div>
                  <div className="space-y-3">
                    {dayEntries.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-slate-900 dark:text-white">{entry.title}</p>
                              <ErpBadge tone={entry.isActive ? 'info' : 'neutral'}>{eventLabels[entry.eventType] || entry.eventType}</ErpBadge>
                              {entry.isHoliday && <ErpBadge tone="warning">تعطیل</ErpBadge>}
                              {!entry.isActive && <ErpBadge tone="neutral">غیرفعال</ErpBadge>}
                            </div>
                            {entry.description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{entry.description}</p>}
                          </div>
                          <ErpButton label="ویرایش" variant="outline" tone="neutral" onClick={() => setForm({ id: entry.id, date: PersianCalendar.toPersian(entry.date), title: entry.title, description: entry.description || '', eventType: entry.eventType, isHoliday: entry.isHoliday, isActive: entry.isActive })} />
                        </div>
                      </div>
                    ))}
                  </div>
                </ErpCard>
              );
            })}
          </div>
        )}
      </ErpSection>
    </ErpPage>
  );
}
