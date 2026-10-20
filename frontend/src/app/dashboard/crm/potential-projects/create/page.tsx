'use client';
import { ErpInput, ErpTextarea,ErpInlineState } from '@/components/erp';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaSave } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpLoading, ErpPage, ErpSection, useErpPresentationScope } from '@/components/erp';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { CustomerWorkflowSection } from '@/features/crm/customer-workflow/CustomerWorkflowUi';
import { crmAPI } from '@/lib/api';
import { crmPersonName, CRM_WORK_TYPES, persianDateToApiDate, POTENTIAL_PROJECT_STATUSES } from '@/lib/crmPipeline';
import {ModelDraftRecovery} from '@/components/ModelDraftRecovery';
import {useModelDraftRecovery} from '@/lib/useModelDraftRecovery';
import {parsePotentialProjectDraft,emptyPotentialProjectDraft} from '@/features/crm/potentialProjectDraft';

type Customer = { id: string; firstName?: string; lastName?: string; companyName?: string; phoneNumbers?: Array<{ number: string }> };
type Seller = { id: string; firstName?: string; lastName?: string; username?: string };

const inputClass = 'min-h-12 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-4 py-3 text-sm text-[var(--sds-text-primary)] outline-none transition focus:border-[var(--sds-accent)] focus:bg-[var(--sds-surface-raised)] focus:ring-2 focus:ring-[var(--sds-accent)]/15 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] dark:focus:border-[var(--sds-border-strong)] dark:focus:bg-[var(--sds-surface-raised)]';
const labelClass = 'block text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]';

export default function CreatePotentialProjectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presentationScope = useErpPresentationScope();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submissionUncertain,setSubmissionUncertain]=useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ReturnType<typeof parsePotentialProjectDraft>>({
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
  const draftEmpty=emptyPotentialProjectDraft(form,{customerId:searchParams.get('customerId')||'',responsibleSellerId:sellers[0]?.id||'',workType:CRM_WORK_TYPES[0]});
  const draftRecovery=useModelDraftRecovery({workflow:'crm-potential-project',route:'/dashboard/crm/potential-projects/create',record:'new',baseVersion:'new',
    model:form,empty:draftEmpty,active:!loading,busy:saving||loading,submissionUncertain,parse:parsePotentialProjectDraft,restore:setForm});

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
    if(submissionUncertain)return;
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
      if(!err?.response||Number(err.response.status)>=500)setSubmissionUncertain(true);
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
      eyebrow="ارتباط با مشتری"
      description="پروژه یا فرصتی که هنوز به قرارداد فروش تبدیل نشده است."
      backHref="/dashboard/crm/potential-projects"
      actions={presentationScope === 'workspace' ? [] : [{ label: saving ? 'در حال ذخیره...' : 'ذخیره', onClick: () => document.getElementById('potential-project-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })), icon: FaSave, tone: 'primary', variant: 'solid', disabled: saving||submissionUncertain }]}
    >

      {error && <ErpEmptyState title="خطا" description={error} />}
      {submissionUncertain&&<ErpInlineState kind="stale" title="نتیجهٔ ثبت مشخص نیست؛ پیش از تکرار، وضعیت ثبت را بررسی کنید. این فرم را نبندید."/>}
      <ModelDraftRecovery recovery={draftRecovery} empty={draftEmpty}/>
      <form id="potential-project-form" onSubmit={submit} className={presentationScope === 'workspace' ? "mx-auto max-w-[850px] space-y-5" : "space-y-5"}>
        <ErpSection title="اطلاعات اصلی" description="این فیلدها برای ایجاد پروژه احتمالی الزامی هستند." className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
              <ErpInput className={`${inputClass} mt-2`} value={form.title} onChange={(e) => update('title', e.target.value)} required />
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

        <CustomerWorkflowSection title="اطلاعات تکمیلی" collapsible className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={labelClass}>آدرس/موقعیت
              <ErpInput className={`${inputClass} mt-2`} value={form.address} onChange={(e) => update('address', e.target.value)} />
            </label>
            <label className={labelClass}>منبع/معرف
              <ErpInput className={`${inputClass} mt-2`} value={form.source} onChange={(e) => update('source', e.target.value)} />
            </label>
            <label className={labelClass}>ارزش برآوردی
              <ErpInput className={`${inputClass} mt-2`} inputMode="numeric" value={form.estimatedValue} onChange={(e) => update('estimatedValue', e.target.value)} />
            </label>
            <label className={labelClass}>احتمال تبدیل
              <ErpInput className={`${inputClass} mt-2`} inputMode="numeric" min="0" max="100" value={form.probability} onChange={(e) => update('probability', e.target.value)} placeholder="۰ تا ۱۰۰" />
            </label>
            <label className={labelClass}>تاریخ احتمالی بستن
              <div className="mt-2">
                <PersianCalendarComponent value={form.expectedCloseDate} onChange={(value) => update('expectedCloseDate', value)} placeholder="انتخاب تاریخ" disablePastDates />
              </div>
            </label>
            <label className={`${labelClass} md:col-span-2`}>توضیحات
              <ErpTextarea className={`${inputClass} mt-2 min-h-28`} value={form.description} onChange={(e) => update('description', e.target.value)} />
            </label>
          </div>
        </CustomerWorkflowSection>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ErpButton label="انصراف" href="/dashboard/crm/potential-projects" variant="ghost" disabled={saving} />
          <ErpButton
            label={saving ? 'در حال ذخیره...' : 'ذخیره پروژه'}
            icon={FaSave}
            tone="primary"
            variant="solid"
            disabled={saving||submissionUncertain}
            onClick={() => document.getElementById('potential-project-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))}
          />
        </div>
      </form>
    </ErpPage>
  );
}
