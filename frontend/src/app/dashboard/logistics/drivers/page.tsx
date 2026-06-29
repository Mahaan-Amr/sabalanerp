'use client';

import { useEffect, useState } from 'react';
import { FaSave, FaSync, FaUsers } from 'react-icons/fa';
import { ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpTwoColumn } from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import { inputClass, labelClass } from '../logistics-ui';

const emptyForm = {
  firstName: '',
  lastName: '',
  vehiclePlate: '',
  vehicleType: '',
  phone: '',
  nationalCode: '',
  notes: '',
};

export default function LogisticsDriversPage() {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [form, setForm] = useState<any>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      const response = await logisticsAPI.getDrivers({ includeInactive: true });
      if (response.data.success) setDrivers(response.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      await logisticsAPI.createDriver(form);
      setForm(emptyForm);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت راننده ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (driver: any) => {
    await logisticsAPI.updateDriver(driver.id, { ...driver, isActive: !driver.isActive });
    await load();
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="لجستیک"
      title="راننده‌ها"
      description="راننده‌های ثابت را اینجا تعریف کنید؛ هر بارگیری همچنان snapshot مستقل خودش را ذخیره می‌کند."
      backHref="/dashboard/logistics"
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, tone: 'neutral' }]}
    >
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      <ErpTwoColumn
        main={
          <ErpSection title="لیست راننده‌ها">
            {drivers.length === 0 ? (
              <ErpEmptyState icon={FaUsers} title="راننده‌ای ثبت نشده است" />
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {drivers.map((driver) => (
                  <ErpCard key={driver.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{driver.firstName} {driver.lastName}</p>
                        <p className="mt-1 text-sm text-slate-500">{driver.vehicleType} · {driver.vehiclePlate}</p>
                        <p className="mt-1 text-xs text-slate-500">{driver.phone} · کد ملی {driver.nationalCode}</p>
                      </div>
                      <ErpButton label={driver.isActive ? 'غیرفعال' : 'فعال'} onClick={() => toggleActive(driver)} tone={driver.isActive ? 'danger' : 'success'} variant="soft" />
                    </div>
                  </ErpCard>
                ))}
              </div>
            )}
          </ErpSection>
        }
        aside={
          <ErpSection title="راننده جدید">
            <div className="space-y-3">
              {([
                ['firstName', 'نام'],
                ['lastName', 'نام خانوادگی'],
                ['vehiclePlate', 'شماره پلاک ماشین'],
                ['vehicleType', 'نوع ماشین'],
                ['phone', 'شماره تماس راننده'],
                ['nationalCode', 'کد ملی راننده'],
              ] as const).map(([field, label]) => (
                <label key={field}>
                  <span className={labelClass}>{label}</span>
                  <input className={inputClass} value={form[field]} onChange={(event) => setForm((current: any) => ({ ...current, [field]: event.target.value }))} />
                </label>
              ))}
              <label>
                <span className={labelClass}>یادداشت</span>
                <textarea className={`${inputClass} min-h-24`} value={form.notes} onChange={(event) => setForm((current: any) => ({ ...current, notes: event.target.value }))} />
              </label>
              <ErpButton label={saving ? 'در حال ثبت...' : 'ثبت راننده'} icon={FaSave} onClick={save} disabled={saving} variant="solid" />
            </div>
          </ErpSection>
        }
      />
    </ErpPage>
  );
}
