'use client';
import { ErpInput, ErpTextarea } from '@/components/erp';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaSave } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { crmAPI } from '@/lib/api';
import {
  crmPersonName,
  CRM_COMMUNICATION_TYPES,
  CRM_WORK_TYPES,
  persianDateTimeToApiDate,
  persianNowDateTime,
} from '@/lib/crmPipeline';

const inputClass = 'min-h-12 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-4 py-3 text-sm text-[var(--sds-text-primary)] outline-none transition focus:border-[var(--sds-accent)] focus:bg-[var(--sds-surface-raised)] focus:ring-2 focus:ring-[var(--sds-accent)]/15 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] dark:focus:border-[var(--sds-border-strong)] dark:focus:bg-[var(--sds-surface-raised)]';
const labelClass = 'block text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]';

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
    happenedAt: persianNowDateTime(),
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
        happenedAt: persianDateTimeToApiDate(form.happenedAt),
        summary: form.summary,
        outcome: form.outcome,
        hasNextAction: form.hasNextAction,
        noNextActionReason: form.hasNextAction ? null : form.noNextActionReason,
        nextAction: form.hasNextAction ? {
          title: form.nextTitle,
          communicationType: form.nextCommunicationType,
          workType: form.workType,
          dueAt: persianDateTimeToApiDate(form.nextDueAt),
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

      {error && <ErpEmptyState title="خطا" description={error} />}
      <form id="followup-form" onSubmit={submit} className="space-y-5">
        <ErpSection title="گزارش پیگیری" description="ثبت کنید چه ارتباطی برقرار شد و نتیجه چه بود.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={labelClass}>مخاطب CRM
              <EnhancedDropdown
                className="mt-2"
                value={form.customerId}
                onChange={(value) => { update('customerId', value); update('potentialProjectId', ''); }}
                placeholder="انتخاب مخاطب"
                options={customers.map((customer) => ({ value: customer.id, label: crmPersonName(customer) }))}
                searchable
                required
                noOptionsText="مخاطبی پیدا نشد"
              />
            </label>
            <label className={labelClass}>پروژه احتمالی
              <EnhancedDropdown
                className="mt-2"
                value={form.potentialProjectId}
                onChange={(value) => update('potentialProjectId', value)}
                placeholder="پیگیری عمومی مخاطب"
                options={[
                  { value: '', label: 'پیگیری عمومی مخاطب' },
                  ...visibleProjects.map((project) => ({ value: project.id, label: project.title })),
                ]}
                searchable
                clearable
                noOptionsText="پروژه‌ای پیدا نشد"
              />
            </label>
            <label className={labelClass}>نوع ارتباط
              <EnhancedDropdown className="mt-2" value={form.communicationType} onChange={(value) => update('communicationType', value)} options={CRM_COMMUNICATION_TYPES.map((type) => ({ value: type, label: type }))} searchable required />
            </label>
            <label className={labelClass}>نوع کار/معامله
              <EnhancedDropdown className="mt-2" value={form.workType} onChange={(value) => update('workType', value)} options={CRM_WORK_TYPES.map((type) => ({ value: type, label: type }))} searchable required />
            </label>
            <label className={labelClass}>زمان پیگیری
              <div className="mt-2">
                <PersianCalendarComponent value={form.happenedAt} onChange={(value) => update('happenedAt', value)} placeholder="انتخاب زمان" showTime disablePastDates />
              </div>
            </label>
            <label className={`${labelClass} md:col-span-2`}>خلاصه اتفاقات
              <ErpTextarea className={`${inputClass} mt-2 min-h-28`} value={form.summary} onChange={(e) => update('summary', e.target.value)} required />
            </label>
            <label className={`${labelClass} md:col-span-2`}>نتیجه پیگیری
              <ErpTextarea className={`${inputClass} mt-2 min-h-24`} value={form.outcome} onChange={(e) => update('outcome', e.target.value)} required />
            </label>
          </div>
        </ErpSection>

        <ErpSection title="اقدام بعدی" description="برای پیگیری‌های فعال، اقدام بعدی باید روشن و زمان‌دار باشد.">
          <div className="space-y-4">
            <label className="flex items-center gap-3 text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
              <ErpInput type="checkbox" checked={form.hasNextAction} onChange={(e) => update('hasNextAction', e.target.checked)} className="h-5 w-5 rounded border-[var(--sds-border-default)]" />
              این پیگیری اقدام بعدی دارد
            </label>
            {form.hasNextAction ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className={labelClass}>عنوان اقدام بعدی
                  <ErpInput className={`${inputClass} mt-2`} value={form.nextTitle} onChange={(e) => update('nextTitle', e.target.value)} required={form.hasNextAction} />
                </label>
                <label className={labelClass}>نوع ارتباط بعدی
                  <EnhancedDropdown className="mt-2" value={form.nextCommunicationType} onChange={(value) => update('nextCommunicationType', value)} options={CRM_COMMUNICATION_TYPES.map((type) => ({ value: type, label: type }))} searchable required={form.hasNextAction} />
                </label>
                <label className={labelClass}>زمان سررسید
                  <div className="mt-2">
                    <PersianCalendarComponent value={form.nextDueAt} onChange={(value) => update('nextDueAt', value)} placeholder="انتخاب زمان سررسید" showTime disablePastDates />
                  </div>
                </label>
                <label className={`${labelClass} md:col-span-2`}>دستور کار اقدام بعدی
                  <ErpTextarea className={`${inputClass} mt-2 min-h-28`} value={form.nextInstructions} onChange={(e) => update('nextInstructions', e.target.value)} required={form.hasNextAction} />
                </label>
              </div>
            ) : (
              <label className={labelClass}>دلیل نداشتن اقدام بعدی
                <ErpTextarea className={`${inputClass} mt-2 min-h-24`} value={form.noNextActionReason} onChange={(e) => update('noNextActionReason', e.target.value)} />
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
