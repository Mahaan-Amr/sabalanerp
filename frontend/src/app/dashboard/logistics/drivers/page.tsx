'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaArrowLeft, FaArrowRight, FaCheck, FaSave, FaSearch, FaSync, FaTruck, FaUser, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpSegmentedControl } from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import { inputClass, labelClass } from '../logistics-ui';

type WizardStep = 'identity' | 'vehicle' | 'review';
type DriverFilter = 'all' | 'active' | 'inactive';

const emptyForm = {
  firstName: '',
  lastName: '',
  vehiclePlate: '',
  vehicleType: '',
  phone: '',
  nationalCode: '',
  notes: '',
};

const steps: Array<{ id: WizardStep; label: string; icon: any }> = [
  { id: 'identity', label: 'هویت راننده', icon: FaUser },
  { id: 'vehicle', label: 'خودرو', icon: FaTruck },
  { id: 'review', label: 'بازبینی', icon: FaCheck },
];

export default function LogisticsDriversPage() {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [form, setForm] = useState<any>(emptyForm);
  const [step, setStep] = useState<WizardStep>('identity');
  const [filter, setFilter] = useState<DriverFilter>('active');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

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

  const filteredDrivers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return drivers.filter((driver) => {
      if (filter === 'active' && !driver.isActive) return false;
      if (filter === 'inactive' && driver.isActive) return false;
      if (!query) return true;
      return [
        driver.firstName,
        driver.lastName,
        driver.vehiclePlate,
        driver.vehicleType,
        driver.phone,
        driver.nationalCode,
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [drivers, filter, search]);

  const blockers = [
    !form.firstName.trim() && 'نام راننده الزامی است.',
    !form.lastName.trim() && 'نام خانوادگی راننده الزامی است.',
    !form.phone.trim() && 'شماره تماس راننده الزامی است.',
    !form.nationalCode.trim() && 'کد ملی راننده الزامی است.',
    !form.vehiclePlate.trim() && 'شماره پلاک ماشین الزامی است.',
    !form.vehicleType.trim() && 'نوع ماشین الزامی است.',
  ].filter(Boolean) as string[];

  const save = async () => {
    setError('');
    setMessage('');
    if (blockers.length > 0) {
      setError('موارد لازم برای ثبت راننده را تکمیل کنید.');
      setStep('review');
      return;
    }

    setSaving(true);
    try {
      await logisticsAPI.createDriver(form);
      setForm(emptyForm);
      setStep('identity');
      setMessage('راننده ثبت شد.');
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

  const nextStep = () => {
    const index = steps.findIndex((item) => item.id === step);
    setStep(steps[Math.min(index + 1, steps.length - 1)].id);
  };

  const previousStep = () => {
    const index = steps.findIndex((item) => item.id === step);
    setStep(steps[Math.max(index - 1, 0)].id);
  };

  const updateForm = (patch: any) => setForm((current: any) => ({ ...current, ...patch }));

  const renderStepNav = () => (
    <div className="grid grid-cols-3 gap-2">
      {steps.map((item) => {
        const Icon = item.icon;
        const active = item.id === step;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setStep(item.id)}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border px-2 text-xs font-semibold transition ${
              active
                ? 'border-[#074747] bg-[#074747] text-white'
                : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );

  const renderIdentityStep = () => (
    <ErpSection title="هویت راننده" description="اطلاعات شخصی راننده ثابت را وارد کنید.">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label><span className={labelClass}>نام</span><input className={inputClass} value={form.firstName} onChange={(event) => updateForm({ firstName: event.target.value })} /></label>
        <label><span className={labelClass}>نام خانوادگی</span><input className={inputClass} value={form.lastName} onChange={(event) => updateForm({ lastName: event.target.value })} /></label>
        <label><span className={labelClass}>شماره تماس</span><input className={inputClass} value={form.phone} onChange={(event) => updateForm({ phone: event.target.value })} /></label>
        <label><span className={labelClass}>کد ملی</span><input className={inputClass} value={form.nationalCode} onChange={(event) => updateForm({ nationalCode: event.target.value })} /></label>
      </div>
    </ErpSection>
  );

  const renderVehicleStep = () => (
    <ErpSection title="خودرو" description="خودروی پیش‌فرض راننده را ثبت کنید؛ هر بارگیری همچنان snapshot مستقل خودش را ذخیره می‌کند.">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label><span className={labelClass}>شماره پلاک ماشین</span><input className={inputClass} value={form.vehiclePlate} onChange={(event) => updateForm({ vehiclePlate: event.target.value })} /></label>
        <label><span className={labelClass}>نوع ماشین</span><input className={inputClass} value={form.vehicleType} onChange={(event) => updateForm({ vehicleType: event.target.value })} /></label>
      </div>
      <label className="mt-3 block">
        <span className={labelClass}>یادداشت</span>
        <textarea className={`${inputClass} min-h-24`} value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} />
      </label>
    </ErpSection>
  );

  const renderReviewStep = () => (
    <ErpSection title="بازبینی و ثبت">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ErpCard className="p-4">
          <p className="text-sm text-slate-500">راننده</p>
          <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{form.firstName || 'نام'} {form.lastName || 'نام خانوادگی'}</p>
          <p className="mt-2 text-sm text-slate-500">{form.phone || 'شماره تماس'} · کد ملی {form.nationalCode || 'ثبت نشده'}</p>
          <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{form.vehicleType || 'نوع ماشین'}</p>
            <p className="mt-1 text-sm text-slate-500">{form.vehiclePlate || 'پلاک ثبت نشده'}</p>
          </div>
          {form.notes && <p className="mt-3 text-sm leading-6 text-slate-500">{form.notes}</p>}
        </ErpCard>
        <ErpCard className="p-4">
          <p className="font-semibold text-slate-900 dark:text-white">آمادگی ثبت</p>
          <div className="mt-3 space-y-2">
            {blockers.length === 0 ? (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">اطلاعات کامل است.</p>
            ) : blockers.map((blocker) => (
              <p key={blocker} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-100">{blocker}</p>
            ))}
          </div>
          <div className="mt-4">
            <ErpButton label={saving ? 'در حال ثبت...' : 'ثبت راننده'} icon={FaSave} onClick={save} disabled={saving} variant="solid" />
          </div>
        </ErpCard>
      </div>
    </ErpSection>
  );

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="لجستیک"
      title="راننده‌ها"
      description="راننده‌های ثابت را با یک wizard کوتاه تعریف کنید؛ راننده موقت همچنان در خود بارگیری ثبت می‌شود."
      backHref="/dashboard/logistics"
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, tone: 'neutral' }]}
    >
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">{error}</div>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <ErpSection title="لیست راننده‌ها">
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <label>
                <span className="sr-only">جستجو</span>
                <div className="relative">
                  <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input className={`${inputClass} pr-10`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جستجو با نام، موبایل، پلاک یا کد ملی" />
                </div>
              </label>
              <ErpSegmentedControl<DriverFilter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'active', label: 'فعال' },
                  { value: 'inactive', label: 'غیرفعال' },
                  { value: 'all', label: 'همه' },
                ]}
              />
            </div>

            {filteredDrivers.length === 0 ? (
              <ErpEmptyState icon={FaUsers} title="راننده‌ای برای نمایش وجود ندارد" />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {filteredDrivers.map((driver) => (
                  <ErpCard key={driver.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900 dark:text-white">{driver.firstName} {driver.lastName}</p>
                          <ErpBadge tone={driver.isActive ? 'success' : 'neutral'}>{driver.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">{driver.vehicleType} · {driver.vehiclePlate}</p>
                        <p className="mt-1 text-xs text-slate-500">{driver.phone} · کد ملی {driver.nationalCode}</p>
                      </div>
                      <ErpButton label={driver.isActive ? 'غیرفعال' : 'فعال'} onClick={() => toggleActive(driver)} tone={driver.isActive ? 'danger' : 'success'} variant="soft" />
                    </div>
                  </ErpCard>
                ))}
              </div>
            )}
          </ErpSection>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          {renderStepNav()}
          {step === 'identity' && renderIdentityStep()}
          {step === 'vehicle' && renderVehicleStep()}
          {step === 'review' && renderReviewStep()}
          <ErpCard className="p-3">
            <div className="flex items-center justify-between gap-3">
              <ErpButton label="قبلی" icon={FaArrowRight} onClick={previousStep} disabled={step === 'identity'} tone="neutral" variant="outline" />
              {step === 'review' ? (
                <ErpButton label="ثبت راننده" icon={FaCheck} onClick={save} disabled={saving} variant="solid" />
              ) : (
                <ErpButton label="بعدی" icon={FaArrowLeft} onClick={nextStep} variant="solid" />
              )}
            </div>
          </ErpCard>
        </aside>
      </div>
    </ErpPage>
  );
}
