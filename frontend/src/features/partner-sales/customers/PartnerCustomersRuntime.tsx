'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErpBadge, ErpButton, ErpEmptyState, ErpField, ErpFieldView, ErpInput, ErpListPage,
  ErpSelect, ErpSheet, ErpTextarea, type ErpColumn, type ErpMetric, type ErpTone } from '@/components/erp';
import { FaBan, FaBuilding, FaCheckCircle, FaEdit, FaExclamationTriangle, FaEye,
  FaFileContract, FaLock, FaMapMarkerAlt, FaPhone, FaPlus, FaUser, FaUsers } from 'react-icons/fa';
import api from '@/lib/api';
import { buildPartnerCustomerUpdateCommand, emptyPartnerCustomerDraft, validatePartnerCustomerDraft,
  type PartnerCustomerDraft } from '@/features/contract-creation/partner/partnerCustomerCreation';

type PartnerCustomer = {
  customerId: string; revision: number; displayName: string; firstName: string; lastName: string;
  companyName?: string; customerType: 'Individual' | 'Company'; personType: 'NATURAL' | 'LEGAL';
  status: string; isBlacklisted: boolean; isLocked: boolean; nationalCode?: string; city?: string;
  address?: string; phone: string; projectCount: number;
};
type PartnerCustomerDetail = PartnerCustomer & { projects?: Array<{ projectId: string; title: string; status: string }> };
type ListPayload = { items: PartnerCustomer[]; total: number; nextCursor?: string };

const statusTone: Record<string, ErpTone> = { Active: 'success', Inactive: 'neutral', Prospect: 'info', Lead: 'warning' };
const statusLabel = (value: string) => ({ Active: 'فعال', Inactive: 'غیرفعال', Prospect: 'بالقوه', Lead: 'سرنخ' }[value] ?? value);
const typeLabel = (value: PartnerCustomer['customerType']) => value === 'Company' ? 'حقوقی' : 'حقیقی';
const toDraft = (customer: PartnerCustomer): PartnerCustomerDraft => ({
  firstName: customer.firstName, lastName: customer.lastName, companyName: customer.companyName ?? '',
  customerType: customer.customerType, city: customer.city ?? '', address: customer.address ?? '',
  nationalCode: customer.nationalCode ?? '', phone: customer.phone,
});

export function PartnerCustomersRuntime() {
  const router = useRouter();
  const [customers, setCustomers] = useState<PartnerCustomer[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [customerType, setCustomerType] = useState('');
  const [blacklist, setBlacklist] = useState('');
  const [locked, setLocked] = useState('');
  const [pending, setPending] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [detail, setDetail] = useState<PartnerCustomerDetail>();
  const [editing, setEditing] = useState<PartnerCustomer>();
  const [draft, setDraft] = useState<PartnerCustomerDraft>(emptyPartnerCustomerDraft);

  const load = useCallback(async () => {
    setPending(true); setError(undefined);
    try {
      const collected: PartnerCustomer[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page += 1) {
        const response = await api.get('/crm/partner/customers', { params: { limit: 50,
          ...(cursor ? { cursor } : {}), ...(search.trim() ? { query: search.trim() } : {}) } });
        const payload = (response.data as { data?: ListPayload })?.data;
        if (!payload || !Array.isArray(payload.items)) throw new Error('invalid partner customer page');
        collected.push(...payload.items); cursor = payload.nextCursor;
        if (!cursor) break;
      }
      setCustomers(collected);
    } catch { setError('دریافت مشتریان شما انجام نشد.'); }
    finally { setPending(false); }
  }, [search]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); }, [load]);
  const visible = useMemo(() => customers.filter(customer => (!status || customer.status === status)
    && (!customerType || customer.customerType === customerType)
    && (!blacklist || customer.isBlacklisted === (blacklist === 'true'))
    && (!locked || customer.isLocked === (locked === 'true'))), [blacklist, customerType, customers, locked, status]);

  const openDetail = async (customer: PartnerCustomer) => {
    setError(undefined);
    try {
      const response = await api.get(`/crm/partner/customers/${encodeURIComponent(customer.customerId)}`);
      const value = (response.data as { data?: PartnerCustomerDetail })?.data;
      if (!value?.customerId) throw new Error('invalid customer');
      setDetail(value);
    } catch { setError('دریافت جزئیات مشتری انجام نشد.'); }
  };
  const beginEdit = (customer: PartnerCustomer) => { setEditing(customer); setDraft(toDraft(customer)); };
  const saveEdit = async () => {
    if (!editing || saving || !validatePartnerCustomerDraft(draft)) return;
    setSaving(true); setError(undefined);
    try {
      const command = await buildPartnerCustomerUpdateCommand(draft, { customerId: editing.customerId,
        expectedRevision: editing.revision, commandId: `partner-customer-update-${crypto.randomUUID()}`,
        correlationId: `partner-customer-update-correlation-${crypto.randomUUID()}`,
        idempotencyKey: `partner-customer-update-idempotency-${crypto.randomUUID()}` });
      await api.put(`/crm/partner/customers/${encodeURIComponent(editing.customerId)}`, command,
        { headers: { 'X-Correlation-Id': command.correlationId } });
      setEditing(undefined); await load();
    } catch { setError('ذخیره تغییرات مشتری انجام نشد.'); }
    finally { setSaving(false); }
  };
  const toggleRestriction = async (customer: PartnerCustomer, kind: 'blacklist' | 'lock') => {
    if (saving) return;
    setSaving(true); setError(undefined);
    try {
      const command = await buildPartnerCustomerUpdateCommand(toDraft(customer), { customerId: customer.customerId,
        expectedRevision: customer.revision, commandId: `partner-customer-restriction-${crypto.randomUUID()}`,
        correlationId: `partner-customer-restriction-correlation-${crypto.randomUUID()}`,
        idempotencyKey: `partner-customer-restriction-idempotency-${crypto.randomUUID()}`,
        ...(kind === 'blacklist' ? { isBlacklisted: !customer.isBlacklisted } : { isLocked: !customer.isLocked }) });
      await api.put(`/crm/partner/customers/${encodeURIComponent(customer.customerId)}`, command,
        { headers: { 'X-Correlation-Id': command.correlationId } });
      await load();
    } catch { setError(kind === 'blacklist' ? 'تغییر وضعیت بلک‌لیست انجام نشد.' : 'تغییر وضعیت قفل انجام نشد.'); }
    finally { setSaving(false); }
  };

  const metrics: ErpMetric[] = [
    { label: 'کل نتایج', value: customers.length.toLocaleString('fa-IR'), icon: FaUsers, tone: 'primary' },
    { label: 'نمایش فعلی', value: visible.length.toLocaleString('fa-IR'), icon: FaBuilding, tone: 'info' },
    { label: 'بلک‌لیست', value: customers.filter(item => item.isBlacklisted).length.toLocaleString('fa-IR'), icon: FaBan, tone: 'danger' },
    { label: 'قفل‌شده', value: customers.filter(item => item.isLocked).length.toLocaleString('fa-IR'), icon: FaLock, tone: 'warning' },
  ];
  const columns: ErpColumn<PartnerCustomer>[] = [
    { id: 'customer', header: 'مشتری', priority: 'primary', cell: customer => <div>
      <p className="font-semibold text-[var(--sds-text-primary)]">{customer.firstName} {customer.lastName}</p>
      {customer.companyName && <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{customer.companyName}</p>}
      <p className="mt-1 text-xs text-[var(--sds-info)]">مسئول فروش: حساب همکار من</p>
      {customer.nationalCode && <p className="mt-1 text-xs text-[var(--sds-text-muted)]">کد ملی: {customer.nationalCode}</p>}
    </div> },
    { id: 'status', header: 'وضعیت', priority: 'secondary', cell: customer => <div className="flex flex-wrap gap-1.5">
      <ErpBadge tone={statusTone[customer.status] ?? 'neutral'}>{statusLabel(customer.status)}</ErpBadge>
      <ErpBadge tone="neutral">{typeLabel(customer.customerType)}</ErpBadge>
    </div> },
    { id: 'contact', header: 'اطلاعات تماس', priority: 'secondary', cell: customer => <div className="space-y-1 text-xs text-[var(--sds-text-secondary)]">
      <p className="flex items-center gap-1"><FaUser className="h-3 w-3" />{customer.displayName}</p>
      <p className="flex items-center gap-1"><FaPhone className="h-3 w-3" />{customer.phone}</p>
    </div> },
    { id: 'project', header: 'پروژه', priority: 'meta', cell: customer => <div className="space-y-1 text-xs text-[var(--sds-text-secondary)]">
      {customer.address && <p className="flex items-center gap-1"><FaMapMarkerAlt className="h-3 w-3" />{customer.address}</p>}
      <p>{customer.projectCount.toLocaleString('fa-IR')} پروژه</p>
    </div> },
    { id: 'flags', header: 'نشانگرها', priority: 'meta', cell: customer => <div className="flex flex-wrap gap-1.5">
      {customer.isBlacklisted && <ErpBadge tone="danger">بلک‌لیست</ErpBadge>}
      {customer.isLocked && <ErpBadge tone="warning">قفل‌شده</ErpBadge>}
      {!customer.isBlacklisted && !customer.isLocked && <span className="text-xs text-[var(--sds-text-secondary)]">بدون محدودیت</span>}
    </div> },
  ];

  if (error && !customers.length) return <ErpEmptyState icon={FaExclamationTriangle} title="خطا در دریافت اطلاعات"
    description={error} action={{ label: 'تلاش مجدد', onClick: () => void load(), tone: 'primary', variant: 'solid' }} />;

  return <>
    <ErpListPage eyebrow="CRM" title="مدیریت مشتریان" metrics={metrics}
      actions={[{ label: 'مشتری جدید', onClick: () => router.push('/dashboard/sales/contracts/create?newCustomer=1'), icon: FaPlus, tone: 'primary', variant: 'solid' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: search, placeholder: 'جستجو بر اساس نام، شماره تماس یا شرکت...', onChange: setSearch },
        { id: 'status', label: 'وضعیت', type: 'select', value: status, onChange: setStatus, options: [
          { label: 'همه وضعیت‌ها', value: '' }, { label: 'فعال', value: 'Active' }, { label: 'غیرفعال', value: 'Inactive' },
          { label: 'بالقوه', value: 'Prospect' }, { label: 'سرنخ', value: 'Lead' }] },
        { id: 'customerType', label: 'نوع مشتری', type: 'select', value: customerType, onChange: setCustomerType, options: [
          { label: 'همه انواع', value: '' }, { label: 'حقیقی', value: 'Individual' }, { label: 'حقوقی', value: 'Company' }] },
        { id: 'blacklist', label: 'بلک‌لیست', type: 'select', value: blacklist, onChange: setBlacklist, options: [
          { label: 'همه', value: '' }, { label: 'خیر', value: 'false' }, { label: 'بله', value: 'true' }] },
        { id: 'locked', label: 'قفل', type: 'select', value: locked, onChange: setLocked, options: [
          { label: 'همه', value: '' }, { label: 'خیر', value: 'false' }, { label: 'بله', value: 'true' }] },
      ]}
      isLoading={pending} rows={visible} rowKey={customer => customer.customerId} columns={columns}
      rowActions={customer => [
        { label: 'مشاهده مشتری', icon: FaEye, onClick: () => void openDetail(customer) },
        { label: 'ویرایش', icon: FaEdit, onClick: () => beginEdit(customer) },
        { label: customer.isBlacklisted ? 'حذف از بلک‌لیست' : 'افزودن به بلک‌لیست',
          icon: customer.isBlacklisted ? FaCheckCircle : FaBan, tone: customer.isBlacklisted ? 'success' : 'danger',
          onClick: () => void toggleRestriction(customer, 'blacklist') },
        { label: customer.isLocked ? 'باز کردن قفل' : 'قفل کردن',
          icon: customer.isLocked ? FaCheckCircle : FaLock, tone: customer.isLocked ? 'success' : 'warning',
          onClick: () => void toggleRestriction(customer, 'lock') },
        { label: 'ایجاد قرارداد', icon: FaFileContract, onClick: () => router.push(`/dashboard/sales/contracts/create?customerId=${encodeURIComponent(customer.customerId)}&entry=new-contract`) },
      ]}
      emptyState={<ErpEmptyState icon={FaUsers} title="مشتری یافت نشد" description="با این فیلترها نتیجه‌ای پیدا نشد."
        action={{ label: 'افزودن مشتری جدید', onClick: () => router.push('/dashboard/sales/contracts/create?newCustomer=1'), icon: FaPlus, tone: 'primary', variant: 'solid' }} />}
      footer={(search || status || customerType || blacklist || locked) ? <div className="flex justify-end">
        <ErpButton label="پاک کردن فیلترها" tone="neutral" variant="outline" onClick={() => { setSearch(''); setStatus(''); setCustomerType(''); setBlacklist(''); setLocked(''); }} />
      </div> : undefined} />

    <ErpSheet open={Boolean(detail)} onClose={() => setDetail(undefined)} title="مشاهده مشتری">
      {detail && <div className="space-y-4" dir="rtl"><div className="grid gap-3 sm:grid-cols-2">
        <ErpFieldView label="نام مشتری" value={detail.displayName} /><ErpFieldView label="شماره تماس" value={detail.phone} />
        <ErpFieldView label="نوع مشتری" value={typeLabel(detail.customerType)} /><ErpFieldView label="نشانی" value={detail.address ?? '—'} />
      </div><ErpFieldView label="پروژه‌ها" value={(detail.projects?.length ?? detail.projectCount).toLocaleString('fa-IR')} /></div>}
    </ErpSheet>

    <ErpSheet open={Boolean(editing)} onClose={() => setEditing(undefined)} title="ویرایش مشتری" pending={saving}
      footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="outline" onClick={() => setEditing(undefined)} />
        <ErpButton label="ذخیره تغییرات" icon={FaCheckCircle} disabled={saving || !validatePartnerCustomerDraft(draft)} onClick={() => void saveEdit()} /></div>}>
      <div className="grid gap-4 sm:grid-cols-2" dir="rtl">
        <ErpField label="نام"><ErpInput value={draft.firstName} onChange={event => setDraft(value => ({ ...value, firstName: event.target.value }))} /></ErpField>
        <ErpField label="نام خانوادگی"><ErpInput value={draft.lastName} onChange={event => setDraft(value => ({ ...value, lastName: event.target.value }))} /></ErpField>
        <ErpField label="نوع مشتری"><ErpSelect value={draft.customerType} onChange={event => setDraft(value => ({ ...value, customerType: event.target.value as PartnerCustomerDraft['customerType'] }))}><option value="Individual">حقیقی</option><option value="Company">حقوقی</option></ErpSelect></ErpField>
        <ErpField label="نام شرکت"><ErpInput value={draft.companyName} onChange={event => setDraft(value => ({ ...value, companyName: event.target.value }))} /></ErpField>
        <ErpField label="شماره تماس"><ErpInput value={draft.phone} onChange={event => setDraft(value => ({ ...value, phone: event.target.value }))} /></ErpField>
        <ErpField label="کد ملی"><ErpInput value={draft.nationalCode} onChange={event => setDraft(value => ({ ...value, nationalCode: event.target.value }))} /></ErpField>
        <ErpField label="شهر"><ErpInput value={draft.city} onChange={event => setDraft(value => ({ ...value, city: event.target.value }))} /></ErpField>
        <ErpField label="نشانی" className="sm:col-span-2"><ErpTextarea value={draft.address} onChange={event => setDraft(value => ({ ...value, address: event.target.value }))} /></ErpField>
      </div>
    </ErpSheet>
    {error && customers.length > 0 && <div className="mt-4"><ErpEmptyState icon={FaExclamationTriangle} title="عملیات انجام نشد" description={error} /></div>}
  </>;
}
