'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaSave } from 'react-icons/fa';
import { CrmGuide } from '@/components/crm/CrmGuide';
import { ErpButton, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { crmAPI } from '@/lib/api';
import { crmPersonName, CRM_WORK_TYPES, persianDateToApiDate, POTENTIAL_PROJECT_STATUSES } from '@/lib/crmPipeline';

type Customer = { id: string; firstName?: string; lastName?: string; companyName?: string; phoneNumbers?: Array<{ number: string }> };
type Seller = { id: string; firstName?: string; lastName?: string; username?: string };

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'block text-sm font-semibold text-slate-700 dark:text-slate-200';

const guideSteps = [
  {
    targetId: 'potential-project-required',
    title: 'اطلاعات الزامی پروژه',
    body: 'برای شروع پیگیری فقط اطلاعات اصلی لازم است. جزئیات برآوردی می‌تواند بعداً تکمیل شود.',
    fields: ['مخاطب CRM', 'عنوان پروژه', 'فروشنده مسئول', 'وضعیت', 'نوع کار/معامله'],
  },
  {
    targetId: 'potential-project-optional',
    title: 'اطلاعات تکمیلی',
    body: 'ارزش، احتمال تبدیل و تاریخ احتمالی بستن معامله اختیاری هستند و برای پیش‌بینی مدیر CRM استفاده می‌شوند.',
    mistakes: ['اجبار فروشنده به وارد کردن ارزش برآوردی وقتی پروژه هنوز در مرحله کشف است'],
  },
];

export default function CreatePotentialProjectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customerId: searchParams.get('customerId') || '',
    title: '',
    responsibleSellerId: '',
    status: 'جدید',
    workType: CRM_WORK_TYPES[0],
    address: '',
    estimatedValue: '',
    probability: '',
    expectedCloseDate: '',
    description: '',
    source: '',
  });

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    setLoading(true);
    try {
      const [customerResponse, ownersResponse] = await Promise.all([
        crmAPI.getCustomers({ limit: 100 }),
        crmAPI.getSellers(),
      ]);
      if (customerResponse.data.success) setCustomers(customerResponse.data.data);
      if (ownersResponse.data.success) {
        setSellers(ownersResponse.data.data);
        setForm((prev) => ({ ...prev, responsibleSellerId: prev.responsibleSellerId || ownersResponse.data.data[0]?.id || '' }));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'بارگذاری گزینه‌های فرم ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  const update = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await crmAPI.createPotentialProject({
        ...form,
        estimatedValue: form.estimatedValue || null,
        probability: form.probability || null,
        expectedCloseDate: persianDateToApiDate(form.expectedCloseDate),
      });
      if (response.data.success) router.push(`/dashboard/crm/potential-projects/${response.data.data.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت پروژه احتمالی ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;
  if (error && !customers.length) return <ErpEmptyState title="خطا در بارگذاری فرم" description={error} action={{ label: 'تلاش دوباره', onClick: loadOptions, tone: 'primary' }} />;

  return (
    <ErpPage
      title="ثبت پروژه احتمالی"
      eyebrow="CRM"
      description="پروژه یا فرصتی که هنوز به قرارداد فروش تبدیل نشده است."
      backHref="/dashboard/crm/potential-projects"
      actions={[{ label: saving ? 'در حال ذخیره...' : 'ذخیره', onClick: () => document.getElementById('potential-project-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })), icon: FaSave, tone: 'primary', variant: 'solid', disabled: saving }]}
    >
      <div className="flex justify-end"><CrmGuide steps={guideSteps} /></div>
      {error && <ErpEmptyState title="خطا" description={error} />}
      <form id="potential-project-form" onSubmit={submit} className="space-y-5">
        <ErpSection title="اطلاعات اصلی" description="این فیلدها برای ایجاد پروژه احتمالی الزامی هستند." className="space-y-4">
          <div data-crm-guide="potential-project-required" className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={labelClass}>مخاطب CRM
              <EnhancedDropdown
                className="mt-2"
                value={form.customerId}
                onChange={(value) => update('customerId', value)}
                placeholder="انتخاب مخاطب"
                options={customers.map((customer) => ({ value: customer.id, label: crmPersonName(customer) }))}
                searchable
                required
                noOptionsText="مخاطبی پیدا نشد"
              />
            </label>
            <label className={labelClass}>عنوان پروژه
              <input className={`${inputClass} mt-2`} value={form.title} onChange={(e) => update('title', e.target.value)} required />
            </label>
            <label className={labelClass}>فروشنده مسئول
              <EnhancedDropdown
                className="mt-2"
                value={form.responsibleSellerId}
                onChange={(value) => update('responsibleSellerId', value)}
                placeholder="انتخاب فروشنده"
                options={sellers.map((seller) => ({ value: seller.id, label: [seller.firstName, seller.lastName].filter(Boolean).join(' ') || seller.username || 'نامشخص' }))}
                searchable
                required
                noOptionsText="فروشنده‌ای پیدا نشد"
              />
            </label>
            <label className={labelClass}>وضعیت
              <EnhancedDropdown className="mt-2" value={form.status} onChange={(value) => update('status', value)} options={POTENTIAL_PROJECT_STATUSES.map((status) => ({ value: status, label: status }))} searchable required />
            </label>
            <label className={`${labelClass} md:col-span-2`}>نوع کار/معامله
              <EnhancedDropdown className="mt-2" value={form.workType} onChange={(value) => update('workType', value)} options={CRM_WORK_TYPES.map((type) => ({ value: type, label: type }))} searchable required />
            </label>
          </div>
        </ErpSection>

        <ErpSection title="اطلاعات تکمیلی" className="space-y-4">
          <div data-crm-guide="potential-project-optional" className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={labelClass}>آدرس/موقعیت
              <input className={`${inputClass} mt-2`} value={form.address} onChange={(e) => update('address', e.target.value)} />
            </label>
            <label className={labelClass}>منبع/معرف
              <input className={`${inputClass} mt-2`} value={form.source} onChange={(e) => update('source', e.target.value)} />
            </label>
            <label className={labelClass}>ارزش برآوردی
              <input className={`${inputClass} mt-2`} inputMode="numeric" value={form.estimatedValue} onChange={(e) => update('estimatedValue', e.target.value)} />
            </label>
            <label className={labelClass}>احتمال تبدیل
              <input className={`${inputClass} mt-2`} inputMode="numeric" min="0" max="100" value={form.probability} onChange={(e) => update('probability', e.target.value)} placeholder="۰ تا ۱۰۰" />
            </label>
            <label className={labelClass}>تاریخ احتمالی بستن
              <div className="mt-2">
                <PersianCalendarComponent value={form.expectedCloseDate} onChange={(value) => update('expectedCloseDate', value)} placeholder="انتخاب تاریخ" disablePastDates />
              </div>
            </label>
            <label className={`${labelClass} md:col-span-2`}>توضیحات
              <textarea className={`${inputClass} mt-2 min-h-28`} value={form.description} onChange={(e) => update('description', e.target.value)} />
            </label>
          </div>
        </ErpSection>

        <div className="flex justify-end">
          <ErpButton
            label={saving ? 'در حال ذخیره...' : 'ذخیره پروژه'}
            icon={FaSave}
            tone="primary"
            variant="solid"
            disabled={saving}
            onClick={() => document.getElementById('potential-project-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))}
          />
        </div>
      </form>
    </ErpPage>
  );
}
