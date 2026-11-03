'use client';
import { ErpCheckbox, ErpField, ErpInlineState, ErpInput, ErpSelect } from '@/components/erp';
import { useEffect, useMemo, useState } from 'react';
import { FaCalendarAlt, FaPlus, FaSave } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { sabalanCalendarAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';


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
      {message && <ErpInlineState kind="success" title={message} />}
      {error && <ErpInlineState kind="error" title={error} />}

      <ErpSection title={form.id ? 'ویرایش رویداد' : 'رویداد جدید'}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ErpField label="تاریخ" required>
            <PersianCalendarComponent value={form.date} onChange={(date) => setForm((current) => ({ ...current, date }))} placeholder="تاریخ" />
          </ErpField>
          <ErpField label="عنوان" required><ErpInput value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></ErpField>
          <ErpField label="نوع رویداد"><ErpSelect value={form.eventType} onChange={(event) => setForm((current) => ({ ...current, eventType: event.target.value }))}>
              {Object.entries(eventLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </ErpSelect></ErpField>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
          <ErpField label="توضیحات"><ErpInput value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></ErpField>
          <ErpCheckbox label="تعطیل" checked={form.isHoliday} onChange={(event) => setForm((current) => ({ ...current, isHoliday: event.target.checked }))} />
          <ErpCheckbox label="فعال" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />
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
                    <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{date}</p>
                    {holiday && <ErpBadge tone="warning">تعطیل</ErpBadge>}
                  </div>
                  <div className="space-y-3">
                    {dayEntries.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-3 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{entry.title}</p>
                              <ErpBadge tone={entry.isActive ? 'info' : 'neutral'}>{eventLabels[entry.eventType] || entry.eventType}</ErpBadge>
                              {entry.isHoliday && <ErpBadge tone="warning">تعطیل</ErpBadge>}
                              {!entry.isActive && <ErpBadge tone="neutral">غیرفعال</ErpBadge>}
                            </div>
                            {entry.description && <p className="mt-2 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{entry.description}</p>}
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
