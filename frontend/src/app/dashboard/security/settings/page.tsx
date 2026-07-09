'use client';

import { useEffect, useState } from 'react';
import { FaCog, FaPlus, FaSave } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { securityAPI } from '@/lib/api';

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';

const emptyForm = { id: '', name: '', description: '', displayOrder: 0, isActive: true };

export default function SecuritySettingsPage() {
  const [types, setTypes] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await securityAPI.getInstantReportTypes(true);
      if (response.data.success) setTypes(response.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت تنظیمات حراست ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const saveType = async () => {
    setSaving(true);
    setError('');
    try {
      if (form.id) {
        await securityAPI.updateInstantReportType(form.id, form);
        setMessage('نوع گزارش ویرایش شد.');
      } else {
        await securityAPI.createInstantReportType(form);
        setMessage('نوع گزارش ثبت شد.');
      }
      setForm(emptyForm);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ذخیره نوع گزارش ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="حراست"
      title="تنظیمات حراست"
      description="تعریف نوع گزارش‌های لحظه‌ای که در گزارش شیفت استفاده می‌شوند."
      metrics={[{ label: 'نوع گزارش', value: types.length.toLocaleString('fa-IR'), icon: FaCog, tone: 'info' }]}
    >
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

      <ErpSection title={form.id ? 'ویرایش نوع گزارش' : 'نوع گزارش جدید'}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_160px_auto] lg:items-end">
          <label>
            <span className={labelClass}>نام</span>
            <input className={inputClass} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            <span className={labelClass}>توضیحات</span>
            <input className={inputClass} value={form.description || ''} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
          </label>
          <label>
            <span className={labelClass}>ترتیب نمایش</span>
            <input className={inputClass} type="number" min={0} value={form.displayOrder} onChange={(event) => setForm((current) => ({ ...current, displayOrder: Number(event.target.value || 0) }))} />
          </label>
          <label className="flex min-h-12 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 dark:border-slate-700 dark:bg-slate-800">
            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />
            <span className="text-sm text-slate-700 dark:text-slate-200">فعال</span>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ErpButton label={form.id ? 'ذخیره تغییرات' : 'ثبت نوع گزارش'} icon={form.id ? FaSave : FaPlus} onClick={saveType} disabled={saving || !form.name.trim()} variant="solid" />
          {form.id && <ErpButton label="انصراف" onClick={() => setForm(emptyForm)} tone="neutral" variant="outline" />}
        </div>
      </ErpSection>

      <ErpSection title="انواع گزارش لحظه‌ای">
        {types.length === 0 ? (
          <ErpEmptyState icon={FaCog} title="نوع گزارش تعریف نشده است" />
        ) : (
          <div className="space-y-3">
            {types.map((type) => (
              <ErpCard key={type.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900 dark:text-white">{type.name}</p>
                      <ErpBadge tone={type.isActive ? 'success' : 'neutral'}>{type.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">ترتیب: {type.displayOrder.toLocaleString('fa-IR')}</p>
                    {type.description && <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{type.description}</p>}
                  </div>
                  <ErpButton label="ویرایش" onClick={() => setForm({ id: type.id, name: type.name, description: type.description || '', displayOrder: type.displayOrder || 0, isActive: type.isActive })} tone="neutral" variant="outline" />
                </div>
              </ErpCard>
            ))}
          </div>
        )}
      </ErpSection>
    </ErpPage>
  );
}
