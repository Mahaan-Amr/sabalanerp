'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaSave } from 'react-icons/fa';
import { CrmGuide } from '@/components/crm/CrmGuide';
import { ErpButton, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { crmAPI } from '@/lib/api';
import { crmPersonName, CRM_COMMUNICATION_TYPES, CRM_WORK_TYPES } from '@/lib/crmPipeline';

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'block text-sm font-semibold text-slate-700 dark:text-slate-200';

const guideSteps = [
  {
    targetId: 'followup-event',
    title: 'گزارش اتفاقی که افتاد',
    body: 'ابتدا نوع ارتباط، زمان، خلاصه اتفاق و نتیجه پیگیری را ثبت کنید. این بخش تاریخچه پروژه یا مخاطب را می‌سازد.',
    fields: ['مخاطب', 'پروژه احتمالی اختیاری', 'نوع ارتباط', 'خلاصه', 'نتیجه'],
  },
  {
    targetId: 'followup-next-action',
    title: 'اقدام بعدی',
    body: 'برای پیگیری‌های فعال، اقدام بعدی باید تاریخ، نوع ارتباط و دستور کار روشن داشته باشد. فقط وقتی ادامه‌ای وجود ندارد می‌توانید آن را غیرفعال کنید.',
    mistakes: ['نوشتن «پیگیری شود» بدون توضیح دقیق اقدام بعدی'],
  },
];

export default function CreateFollowUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    customerId: searchParams.get('customerId') || '',
    potentialProjectId: searchParams.get('projectId') || '',
    communicationType: CRM_COMMUNICATION_TYPES[0],
    workType: CRM_WORK_TYPES[0],
    happenedAt: new Date().toISOString().slice(0, 16),
    summary: '',
    outcome: '',
    hasNextAction: true,
    noNextActionReason: '',
    nextTitle: '',
    nextCommunicationType: CRM_COMMUNICATION_TYPES[0],
    nextDueAt: '',
    nextInstructions: '',
  });

  useEffect(() => {
    loadOptions();
  }, []);

  const loadOptions = async () => {
    setLoading(true);
    try {
      const [customersResponse, projectsResponse] = await Promise.all([
        crmAPI.getCustomers({ limit: 100 }),
        crmAPI.getPotentialProjects({ limit: 100 }),
      ]);
      if (customersResponse.data.success) setCustomers(customersResponse.data.data);
      if (projectsResponse.data.success) setProjects(projectsResponse.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'بارگذاری فرم ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  const update = (key: keyof typeof form, value: any) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await crmAPI.createFollowUp({
        customerId: form.customerId,
        potentialProjectId: form.potentialProjectId || null,
        communicationType: form.communicationType,
        workType: form.workType,
        happenedAt: form.happenedAt,
        summary: form.summary,
        outcome: form.outcome,
        hasNextAction: form.hasNextAction,
        noNextActionReason: form.hasNextAction ? null : form.noNextActionReason,
        nextAction: form.hasNextAction ? {
          title: form.nextTitle,
          communicationType: form.nextCommunicationType,
          workType: form.workType,
          dueAt: form.nextDueAt,
          instructions: form.nextInstructions,
        } : null,
      });
      if (response.data.success) {
        const projectId = response.data.data?.potentialProjectId;
        router.push(projectId ? `/dashboard/crm/potential-projects/${projectId}` : '/dashboard/crm/follow-ups');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'ثبت گزارش پیگیری ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const visibleProjects = form.customerId ? projects.filter((project) => project.customerId === form.customerId) : projects;

  if (loading) return <ErpLoading />;
  if (error && !customers.length) return <ErpEmptyState title="خطا در بارگذاری فرم" description={error} action={{ label: 'تلاش دوباره', onClick: loadOptions, tone: 'primary' }} />;

  return (
    <ErpPage
      title="ثبت گزارش پیگیری"
      eyebrow="CRM"
      description="گزارش اتفاق فعلی و اقدام بعدی لازم برای ادامه پیگیری."
      backHref="/dashboard/crm/follow-ups"
      actions={[{ label: saving ? 'در حال ذخیره...' : 'ذخیره', icon: FaSave, tone: 'primary', variant: 'solid', disabled: saving, onClick: () => document.getElementById('followup-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }]}
    >
      <div className="flex justify-end"><CrmGuide steps={guideSteps} /></div>
      {error && <ErpEmptyState title="خطا" description={error} />}
      <form id="followup-form" onSubmit={submit} className="space-y-5">
        <ErpSection title="گزارش پیگیری" description="ثبت کنید چه ارتباطی برقرار شد و نتیجه چه بود.">
          <div data-crm-guide="followup-event" className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={labelClass}>مخاطب CRM
              <select className={`${inputClass} mt-2`} value={form.customerId} onChange={(e) => { update('customerId', e.target.value); update('potentialProjectId', ''); }} required>
                <option value="">انتخاب مخاطب</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{crmPersonName(customer)}</option>)}
              </select>
            </label>
            <label className={labelClass}>پروژه احتمالی
              <select className={`${inputClass} mt-2`} value={form.potentialProjectId} onChange={(e) => update('potentialProjectId', e.target.value)}>
                <option value="">پیگیری عمومی مخاطب</option>
                {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select>
            </label>
            <label className={labelClass}>نوع ارتباط
              <select className={`${inputClass} mt-2`} value={form.communicationType} onChange={(e) => update('communicationType', e.target.value)} required>
                {CRM_COMMUNICATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className={labelClass}>نوع کار/معامله
              <select className={`${inputClass} mt-2`} value={form.workType} onChange={(e) => update('workType', e.target.value)} required>
                {CRM_WORK_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className={labelClass}>زمان پیگیری
              <input className={`${inputClass} mt-2`} type="datetime-local" value={form.happenedAt} onChange={(e) => update('happenedAt', e.target.value)} required />
            </label>
            <label className={`${labelClass} md:col-span-2`}>خلاصه اتفاقات
              <textarea className={`${inputClass} mt-2 min-h-28`} value={form.summary} onChange={(e) => update('summary', e.target.value)} required />
            </label>
            <label className={`${labelClass} md:col-span-2`}>نتیجه پیگیری
              <textarea className={`${inputClass} mt-2 min-h-24`} value={form.outcome} onChange={(e) => update('outcome', e.target.value)} required />
            </label>
          </div>
        </ErpSection>

        <ErpSection title="اقدام بعدی" description="برای پیگیری‌های فعال، اقدام بعدی باید روشن و زمان‌دار باشد.">
          <div data-crm-guide="followup-next-action" className="space-y-4">
            <label className="flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={form.hasNextAction} onChange={(e) => update('hasNextAction', e.target.checked)} className="h-5 w-5 rounded border-slate-300" />
              این پیگیری اقدام بعدی دارد
            </label>
            {form.hasNextAction ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className={labelClass}>عنوان اقدام بعدی
                  <input className={`${inputClass} mt-2`} value={form.nextTitle} onChange={(e) => update('nextTitle', e.target.value)} required={form.hasNextAction} />
                </label>
                <label className={labelClass}>نوع ارتباط بعدی
                  <select className={`${inputClass} mt-2`} value={form.nextCommunicationType} onChange={(e) => update('nextCommunicationType', e.target.value)} required={form.hasNextAction}>
                    {CRM_COMMUNICATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label className={labelClass}>زمان سررسید
                  <input className={`${inputClass} mt-2`} type="datetime-local" value={form.nextDueAt} onChange={(e) => update('nextDueAt', e.target.value)} required={form.hasNextAction} />
                </label>
                <label className={`${labelClass} md:col-span-2`}>دستور کار اقدام بعدی
                  <textarea className={`${inputClass} mt-2 min-h-28`} value={form.nextInstructions} onChange={(e) => update('nextInstructions', e.target.value)} required={form.hasNextAction} />
                </label>
              </div>
            ) : (
              <label className={labelClass}>دلیل نداشتن اقدام بعدی
                <textarea className={`${inputClass} mt-2 min-h-24`} value={form.noNextActionReason} onChange={(e) => update('noNextActionReason', e.target.value)} />
              </label>
            )}
          </div>
        </ErpSection>

        <div className="flex justify-end">
          <ErpButton label={saving ? 'در حال ذخیره...' : 'ذخیره گزارش'} icon={FaSave} tone="primary" variant="solid" disabled={saving} onClick={() => document.getElementById('followup-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))} />
        </div>
      </form>
    </ErpPage>
  );
}
