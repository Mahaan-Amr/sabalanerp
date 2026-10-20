'use client';

import { CustomerActivityCategoryBadge } from './CustomerActivityCategory';
import { useState } from 'react';
import { FaEdit, FaEye, FaPlus, FaTrash, FaBan, FaLock } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCheckbox, ErpEmptyState, ErpField, ErpFieldView, ErpInlineState, ErpInput, ErpSelect, ErpSheet, ErpTextarea } from '@/components/erp';
import api from '@/lib/api';
import { normalizeDigits } from '@/lib/numberFormat';
import PersianCalendar from '@/lib/persian-calendar';
import { DirectCustomerTransfer } from '@/features/partner-sales/customers/DirectCustomerTransfer';
import { CustomerWorkflowPage, CustomerWorkflowSection } from './CustomerWorkflowUi';
import { CustomerProjectFormFields, emptyCustomerProjectFormValue } from './CustomerProjectFormFields';

type Resource = 'project_addresses' | 'contacts' | 'leads';
type Row = { id: string; isActive?: boolean; [field: string]: any };
export type PartnerCrmCustomer = {
  activityCategory?: string | null;
  id: string; firstName: string; lastName: string; partnerRevision: number; crmVersion: string;
  canManageCustomerCard?: boolean; partnerOwnerView?: boolean; crmCapabilities: Record<string, boolean>;
  projectAddresses: Row[]; contacts: Row[]; leads: Row[]; phoneNumbers: Row[]; salesContracts: Row[];
  [field: string]: any;
};
const labels: Record<Resource, string> = { project_addresses: 'آدرس پروژه', contacts: 'مخاطب', leads: 'سرنخ' };
const leadStatuses: Record<string, string> = { New: 'جدید', Contacted: 'تماس گرفته‌شده', Qualified: 'واجد شرایط', Converted: 'تبدیل‌شده', Lost: 'از دست رفته' };
const contractStatuses: Record<string, string> = { DRAFT: 'یادداشت', AWAITING_CUSTOMER_CONFIRMATION: 'در انتظار تأیید مشتری', CUSTOMER_APPROVED: 'تأیید مشتری', COMMITTED: 'قطعی', CANCELLED: 'لغوشده', VOIDED: 'باطل‌شده' };
const initial = (resource: Resource) => resource === 'project_addresses' ? { ...emptyCustomerProjectFormValue, postalCode: '' } : resource === 'contacts'
  ? { firstName: '', lastName: '', position: '', email: '', phone: '', mobile: '', isPrimary: false }
  : { companyName: '', contactName: '', source: '', status: 'New', phone: '', email: '', notes: '', probability: '0', score: '0' };

export function PartnerCustomerSections({ customer, onRefresh }: { customer: PartnerCrmCustomer; onRefresh: () => Promise<void> }) {
  const [editor, setEditor] = useState<{ resource: Resource; row?: Row; deleting?: boolean } | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [contract, setContract] = useState<Row | null>(null);
  const [finance, setFinance] = useState<any>(null);
  const [financePending, setFinancePending] = useState(false);
  const [cardPending, setCardPending] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const base = customer.partnerOwnerView ? '/dashboard/sales/partner-customers' : '/dashboard/crm/customers';
  const toggle = async (kind: 'blacklist' | 'lock') => {
    setCardPending(true); setCardError(null);
    try {
      const payload = kind === 'blacklist' ? { isBlacklisted: !customer.isBlacklisted } : { isLocked: !customer.isLocked };
      if (customer.partnerOwnerView) await api.put(`/crm/partner/customers/${customer.id}/full-card`, { ...payload, expectedRevision: customer.partnerRevision, expectedCardVersion: customer.cardVersion });
      else await api.put(`/crm/customers/${customer.id}/${kind}`);
      await onRefresh();
    } catch (error: any) { setCardError(error.response?.data?.error || 'تغییر وضعیت انجام نشد.'); }
    finally { setCardPending(false); }
  };
  const open = (resource: Resource, row?: Row, deleting = false) => {
    setEditor({ resource, row, deleting }); setFeedback(null);
    setDraft(resource === 'project_addresses' && row ? { ...initial(resource), ...row, projectAddress: row.address || '', projectCity: row.city || '' }
      : { ...initial(resource), ...row });
  };
  const field = (key: string, label: string, numeric = false, required = false) => <ErpField key={key} label={label} required={required}>
    <ErpInput value={String(draft[key] ?? '')} required={required} inputMode={numeric ? 'numeric' : undefined}
      onChange={event => setDraft(value => ({ ...value, [key]: numeric ? normalizeDigits(event.target.value) : event.target.value }))} />
  </ErpField>;
  const save = async () => {
    if (!editor || pending) return;
    setPending(true); setFeedback(null);
    try {
      const { resource, row, deleting } = editor;
      const data = resource === 'project_addresses' ? { address: draft.projectAddress, city: draft.projectCity || null, postalCode: draft.postalCode || null,
        projectName: draft.projectName || null, projectType: draft.projectType || null, projectManagerName: draft.projectManagerName || null,
        projectManagerNumber: normalizeDigits(draft.projectManagerNumber || '') || null, marketerFirstName: draft.marketerFirstName || null,
        marketerLastName: draft.marketerLastName || null, marketerPhoneNumber: normalizeDigits(draft.marketerPhoneNumber || '') || null, isActive: true }
        : resource === 'contacts' ? { firstName: draft.firstName, lastName: draft.lastName, position: draft.position || null, email: draft.email || null,
          phone: normalizeDigits(draft.phone || '') || null, mobile: normalizeDigits(draft.mobile || '') || null, isPrimary: Boolean(draft.isPrimary), isActive: true }
        : { companyName: draft.companyName, contactName: draft.contactName, source: draft.source, status: draft.status,
          phone: normalizeDigits(draft.phone || '') || null, email: draft.email || null, notes: draft.notes || null, probability: Number(draft.probability), score: Number(draft.score) };
      await api.post(`/crm/customers/${customer.id}/crm-actions`, { resource, operation: deleting ? 'delete' : row ? 'edit' : 'create',
        ...(row ? { id: row.id } : {}), expectedRevision: customer.partnerRevision, expectedCrmVersion: customer.crmVersion,
        ...(!deleting ? { data } : {}) });
      setEditor(null); await onRefresh();
    } catch (error: any) { setFeedback(error.response?.data?.error || 'ذخیره انجام نشد؛ اطلاعات واردشده حفظ شده است.'); }
    finally { setPending(false); }
  };
  const showContract = async (row: Row) => {
    setContract(row); setFinance(null); setFinanceError(null);
    if (!customer.crmCapabilities.financial_view) return;
    setFinancePending(true);
    try { const response = await api.get(`/crm/customers/${customer.id}/contracts/${row.caseId}/finance`); setFinance(response.data.data); }
    catch (error: any) { setFinanceError(error.response?.data?.error || 'اطلاعات مالی دریافت نشد.'); }
    finally { setFinancePending(false); }
  };
  const actions = (resource: Resource, row: Row) => <div className="flex flex-wrap gap-2">
    {customer.crmCapabilities[`${resource}_edit`] && <ErpButton label={`ویرایش ${labels[resource]}`} icon={FaEdit} variant="ghost" onClick={() => open(resource, row)} />}
    {customer.crmCapabilities[`${resource}_delete`] && <ErpButton label={`حذف ${labels[resource]}`} icon={FaTrash} tone="danger" variant="ghost" onClick={() => open(resource, row, true)} />}
  </div>;
  const section = (resource: Resource, title: string, rows: Row[]) => <CustomerWorkflowSection title={title}>
    <div className="space-y-4">
      {customer.crmCapabilities[`${resource}_create`] && <ErpButton label={`افزودن ${labels[resource]}`} icon={FaPlus} onClick={() => open(resource)} />}
      {!customer.crmCapabilities[`${resource}_view`] ? <ErpInlineState kind="permission" title="مجوز مشاهده این بخش فعال نیست." />
        : !rows.length ? <ErpEmptyState title={`هنوز ${labels[resource]} ثبت نشده است`} /> : rows.map(row => <div key={row.id} className="space-y-3 rounded-lg border border-[var(--sds-border-default)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1 break-words">
              <p className="font-bold">{resource === 'project_addresses' ? row.projectName || 'نشانی پروژه' : resource === 'contacts' ? `${row.firstName} ${row.lastName}` : row.companyName}</p>
              <p>{resource === 'project_addresses' ? [row.address, row.city].filter(Boolean).join(' • ') : resource === 'contacts' ? [row.position, row.phone, row.mobile, row.email].filter(Boolean).join(' • ') : row.contactName}</p>
              {resource === 'leads' && <><ErpBadge tone="info">{leadStatuses[row.status] || row.status}</ErpBadge><p>{[row.source, row.phone, row.email].filter(Boolean).join(' • ')}</p><p>احتمال موفقیت: {Number(row.probability).toLocaleString('fa-IR')}٪</p></>}
              {resource === 'contacts' && row.isPrimary && <ErpBadge tone="primary">اصلی</ErpBadge>}
              {resource === 'project_addresses' && row.projectManagerName && <p>مدیر پروژه: {row.projectManagerName} {row.projectManagerNumber}</p>}
            </div>{actions(resource, row)}
          </div>
        </div>)}
    </div>
  </CustomerWorkflowSection>;
  return <CustomerWorkflowPage title={`${customer.firstName} ${customer.lastName}`} backHref={base}
    actions={customer.canManageCustomerCard ? [{ label: 'ویرایش', icon: FaEdit, href: `${base}/${customer.id}/edit` }] : []}>
    {!customer.partnerOwnerView && <DirectCustomerTransfer customerId={customer.id} onTransferred={() => void onRefresh()} />}
    {(customer.crmCapabilities.customers_blacklist || customer.crmCapabilities.customers_lock) && <CustomerWorkflowSection title="مدیریت مشتری">
      {cardError && <ErpInlineState kind="error" title={cardError} />}
      <div className="flex flex-wrap gap-3">
        {customer.crmCapabilities.customers_blacklist && <ErpButton label={customer.isBlacklisted ? 'حذف از لیست سیاه' : 'افزودن به لیست سیاه'} icon={FaBan} tone="danger" variant="soft" disabled={cardPending} onClick={() => void toggle('blacklist')} />}
        {customer.crmCapabilities.customers_lock && <ErpButton label={customer.isLocked ? 'باز کردن قفل' : 'قفل کردن'} icon={FaLock} tone="warning" variant="soft" disabled={cardPending} onClick={() => void toggle('lock')} />}
      </div>
    </CustomerWorkflowSection>}
    <CustomerWorkflowSection title="اطلاعات مشتری">
      <CustomerActivityCategoryBadge value={customer.activityCategory} />
      <div className="grid gap-3 sm:grid-cols-2">
        <ErpFieldView label="نام و نام خانوادگی" value={`${customer.firstName} ${customer.lastName}`} />
        <ErpFieldView label="نوع مشتری" value={({ Individual: 'حقیقی', Company: 'حقوقی', Government: 'دولتی' } as Record<string, string>)[customer.customerType] || '—'} />
        <ErpFieldView label="نام شرکت" value={customer.companyName || '—'} />
        <ErpFieldView label="وضعیت" value={({ Active: 'فعال', Inactive: 'غیرفعال', Prospect: 'بالقوه', Lead: 'سرنخ' } as Record<string, string>)[customer.status] || '—'} />
        <ErpFieldView label="مسئول فروش" value={[customer.ownerUser?.firstName, customer.ownerUser?.lastName].filter(Boolean).join(' ') || customer.ownerUser?.username || '—'} />
        <ErpFieldView label="صنعت" value={customer.industry || '—'} />
      </div>
      <CustomerWorkflowSection title="اطلاعات تماس" collapsible>
        <div className="grid gap-3 sm:grid-cols-2">{[['nationalCode', 'کد ملی'], ['homeAddress', 'نشانی منزل'], ['homeNumber', 'شماره منزل'], ['workAddress', 'نشانی کار'], ['workNumber', 'شماره محل کار']].map(([key, label]) => <ErpFieldView key={key} label={label} value={customer[key] || '—'} />)}
          {customer.phoneNumbers.filter(row => row.isActive !== false).map(row => <ErpFieldView key={row.id} label="شماره تماس" value={row.number} />)}</div>
      </CustomerWorkflowSection>
      <CustomerWorkflowSection title="مدیریت پروژه" collapsible><div className="grid gap-3 sm:grid-cols-2"><ErpFieldView label="نام مدیر پروژه" value={customer.projectManagerName || '—'} /><ErpFieldView label="شماره مدیر پروژه" value={customer.projectManagerNumber || '—'} /></div></CustomerWorkflowSection>
      <CustomerWorkflowSection title="اطلاعات برند" collapsible><ErpFieldView label="نام برند" value={customer.brandName || '—'} /><ErpFieldView label="توضیحات برند" value={customer.brandNameDescription || '—'} /></CustomerWorkflowSection>
    </CustomerWorkflowSection>
    {section('project_addresses', 'آدرس‌های پروژه', customer.projectAddresses.filter(row => row.isActive !== false))}
    {section('contacts', 'مخاطبین', customer.contacts.filter(row => row.isActive !== false))}
    {section('leads', 'سرنخ‌ها', customer.leads)}
    <CustomerWorkflowSection title="قراردادها"><div className="space-y-3">
      {!customer.crmCapabilities.contracts_view ? <ErpInlineState kind="permission" title="مجوز مشاهده قراردادها فعال نیست." /> : !customer.salesContracts.length ? <ErpEmptyState title="هنوز قراردادی ثبت نشده است" />
        : customer.salesContracts.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--sds-border-default)] p-4">
          <div><p className="font-bold">قرارداد شماره {row.contractNumber}</p><p>{PersianCalendar.formatForDisplay(row.createdAt)}</p><ErpBadge tone="info">{contractStatuses[row.partnerCommercialStatus] || 'ثبت‌شده'}</ErpBadge></div>
          <ErpButton label="مشاهده" icon={FaEye} onClick={() => void showContract(row)} />
        </div>)}
    </div></CustomerWorkflowSection>
    <ErpSheet open={Boolean(editor)} onClose={() => setEditor(null)} title={editor ? `${editor.deleting ? 'حذف' : editor.row ? 'ویرایش' : 'افزودن'} ${labels[editor.resource]}` : ''}
      presentation="modal" pending={pending} footer={<div className="flex flex-wrap justify-end gap-2"><ErpButton label="انصراف" variant="outline" disabled={pending} onClick={() => setEditor(null)} />
        <ErpButton label={pending ? 'در حال ثبت…' : editor?.deleting ? 'حذف' : 'ذخیره'} tone={editor?.deleting ? 'danger' : 'primary'} disabled={pending} onClick={() => void save()} /></div>}>
      {feedback && <ErpInlineState kind="error" title={feedback} />}
      {editor?.deleting ? <p>این {labels[editor.resource]} از اطلاعات فعال مشتری حذف می‌شود و سابقهٔ تغییر محفوظ می‌ماند.</p>
        : editor?.resource === 'project_addresses' ? <><CustomerProjectFormFields value={draft as typeof emptyCustomerProjectFormValue} onChange={(key, value) => setDraft(current => ({ ...current, [key]: value }))} />{field('postalCode', 'کد پستی', true)}</>
        : editor?.resource === 'contacts' ? <div className="grid gap-4 sm:grid-cols-2">{field('firstName', 'نام', false, true)}{field('lastName', 'نام خانوادگی', false, true)}{field('position', 'سمت')}{field('email', 'ایمیل')}{field('phone', 'تلفن', true)}{field('mobile', 'موبایل', true)}<ErpCheckbox label="مخاطب اصلی" checked={Boolean(draft.isPrimary)} onChange={event => setDraft(value => ({ ...value, isPrimary: event.target.checked }))} /></div>
        : editor?.resource === 'leads' ? <div className="grid gap-4 sm:grid-cols-2">{field('companyName', 'نام شرکت', false, true)}{field('contactName', 'نام مخاطب', false, true)}{field('source', 'منبع', false, true)}
          <ErpField label="وضعیت"><ErpSelect value={draft.status || 'New'} onChange={event => setDraft(value => ({ ...value, status: event.target.value }))}>{Object.entries(leadStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</ErpSelect></ErpField>
          {field('phone', 'تلفن', true)}{field('email', 'ایمیل')}{field('probability', 'احتمال موفقیت (درصد)', true)}{field('score', 'امتیاز', true)}<ErpField label="یادداشت"><ErpTextarea value={draft.notes || ''} onChange={event => setDraft(value => ({ ...value, notes: event.target.value }))} /></ErpField>
        </div> : null}
    </ErpSheet>
    <ErpSheet open={Boolean(contract)} onClose={() => setContract(null)} title="مشاهده قرارداد" presentation="modal" pending={financePending}>
      {contract && <div className="space-y-4"><ErpFieldView label="شماره قرارداد" value={contract.contractNumber} /><ErpFieldView label="تاریخ" value={PersianCalendar.formatForDisplay(contract.createdAt)} /><ErpFieldView label="وضعیت" value={contractStatuses[contract.partnerCommercialStatus] || 'ثبت‌شده'} />
        {financePending && <ErpInlineState kind="empty" title="در حال دریافت اطلاعات مالی…" />}{financeError && <ErpInlineState kind="error" title={financeError} />}
        {finance?.metrics && <div className="grid gap-3 sm:grid-cols-2">{[['retailSales', 'مبلغ فروش'], ['retailCollected', 'دریافتی مشتری'], ['netComparableMargin', 'سود قابل مقایسه']].map(([key, label]) => finance.metrics[key] !== undefined && <ErpFieldView key={key} label={label} value={`${Number(finance.metrics[key]).toLocaleString('fa-IR')} ${finance.currency === 'TOMAN' ? 'تومان' : 'ریال'}`} />)}</div>}
      </div>}
    </ErpSheet>
  </CustomerWorkflowPage>;
}
