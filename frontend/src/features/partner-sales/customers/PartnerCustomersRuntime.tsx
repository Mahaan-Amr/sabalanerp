'use client';
import { partnerSalesActionFeedback } from '../partnerSalesErrorMessage';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ErpBadge, ErpButton, ErpEmptyState, ErpListPage,
  ErpInlineState, type ErpColumn, type ErpMetric, type ErpTone } from '@/components/erp';
import { FaBan, FaBuilding, FaCheckCircle, FaEdit, FaEye,
  FaFileContract, FaLock, FaMapMarkerAlt, FaPhone, FaPlus, FaUser, FaUsers } from 'react-icons/fa';
import api from '@/lib/api';
import { buildPartnerCustomerUpdateCommand,
  type PartnerCustomerDraft } from '@/features/contract-creation/partner/partnerCustomerCreation';

type PartnerCustomer = {
  customerId: string; revision: number; displayName: string; firstName: string; lastName: string;
  companyName?: string; customerType: 'Individual' | 'Company' | 'Government'; personType: 'NATURAL' | 'LEGAL';
  status: string; isBlacklisted: boolean; isLocked: boolean; nationalCode?: string; city?: string;
  address?: string; phone: string; projectCount: number;
  responsibleSeller?: { id: string; displayName: string };
};
type ListPayload = { items: PartnerCustomer[]; total: number; nextCursor?: string };

const statusTone: Record<string, ErpTone> = { Active: 'success', Inactive: 'neutral', Prospect: 'info', Lead: 'warning' };
const statusLabel = (value: string) => ({ Active: 'فعال', Inactive: 'غیرفعال', Prospect: 'بالقوه', Lead: 'سرنخ' }[value] ?? value);
const typeLabel = (value: PartnerCustomer['customerType']) => value === 'Government' ? 'دولتی' : value === 'Company' ? 'حقوقی' : 'حقیقی';
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
  const [error, setError] = useState<ReturnType<typeof partnerSalesActionFeedback>>();

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
    } catch (failure) { setError(partnerSalesActionFeedback(failure, 'دریافت مشتریان')); }
    finally { setPending(false); }
  }, [search]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); }, [load]);
  const visible = useMemo(() => customers.filter(customer => (!status || customer.status === status)
    && (!customerType || customer.customerType === customerType)
    && (!blacklist || customer.isBlacklisted === (blacklist === 'true'))
    && (!locked || customer.isLocked === (locked === 'true'))), [blacklist, customerType, customers, locked, status]);

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
    } catch (failure) { setError(partnerSalesActionFeedback(failure, kind === 'blacklist' ? 'تغییر وضعیت بلک‌لیست' : 'تغییر وضعیت قفل')); }
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
      <p className="mt-1 text-xs text-[var(--sds-info)]">مسئول فروش: {customer.responsibleSeller?.displayName || '—'}</p>
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

  if (error && !customers.length) return <ErpInlineState kind={error.kind} title={error.message}
    action={{ label: 'تلاش دوباره', onClick: () => void load() }} />;

  return <>
    <ErpListPage eyebrow="CRM" title="مدیریت مشتریان" metrics={metrics}
      actions={[{ label: 'مشتری جدید', onClick: () => router.push('/dashboard/sales/contracts/create?newCustomer=1'), icon: FaPlus, tone: 'primary', variant: 'solid' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: search, placeholder: 'جستجو بر اساس نام، شماره تماس یا شرکت...', onChange: setSearch },
        { id: 'status', label: 'وضعیت', type: 'select', value: status, onChange: setStatus, options: [
          { label: 'همه وضعیت‌ها', value: '' }, { label: 'فعال', value: 'Active' }, { label: 'غیرفعال', value: 'Inactive' },
          { label: 'بالقوه', value: 'Prospect' }, { label: 'سرنخ', value: 'Lead' }] },
        { id: 'customerType', label: 'نوع مشتری', type: 'select', value: customerType, onChange: setCustomerType, options: [
          { label: 'همه انواع', value: '' }, { label: 'حقیقی', value: 'Individual' }, { label: 'حقوقی', value: 'Company' }, { label: 'دولتی', value: 'Government' }] },
        { id: 'blacklist', label: 'بلک‌لیست', type: 'select', value: blacklist, onChange: setBlacklist, options: [
          { label: 'همه', value: '' }, { label: 'خیر', value: 'false' }, { label: 'بله', value: 'true' }] },
        { id: 'locked', label: 'قفل', type: 'select', value: locked, onChange: setLocked, options: [
          { label: 'همه', value: '' }, { label: 'خیر', value: 'false' }, { label: 'بله', value: 'true' }] },
      ]}
      isLoading={pending} rows={visible} rowKey={customer => customer.customerId} columns={columns}
      rowActions={customer => [
        { label: 'مشاهده مشتری', icon: FaEye, href: `/dashboard/sales/partner-customers/${encodeURIComponent(customer.customerId)}` },
        { label: 'ویرایش', icon: FaEdit, href: `/dashboard/sales/partner-customers/${encodeURIComponent(customer.customerId)}/edit` },
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

    {error && customers.length > 0 && <div className="mt-4"><ErpInlineState kind={error.kind} title={error.message} /></div>}
  </>;
}
