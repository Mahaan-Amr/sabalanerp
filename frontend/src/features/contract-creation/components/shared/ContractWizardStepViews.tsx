import React, { useId } from 'react';
import { FaBuilding, FaCheck, FaPhone, FaPlus, FaSearch, FaUser, FaUserTie } from 'react-icons/fa';
import {
  ErpButton,
  ErpField,
  ErpInput,
  ErpInlineState,
  ErpNeumorphicCard,
  ErpNeumorphicInteractiveCard,
  ErpNeumorphicSelectedSummary,
  ErpTextarea,
} from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';

export function ContractDateStepView({ creatorName, dateControl, error, numberPreview, numberNotice }: {
  creatorName?: string;
  dateControl: React.ReactElement<{
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean | 'true' | 'false';
  }>;
  error?: string;
  numberPreview?: string;
  numberNotice: string;
}) {
  return <div className="mx-auto max-w-md space-y-6">
    {creatorName && <div>
      <p className="mb-2 text-sm font-medium text-[var(--sds-text-secondary)]">کاربر ایجادکننده</p>
      <ErpNeumorphicCard as="div" className="w-full px-4 py-3 font-medium text-[var(--sds-text-primary)]">
        {creatorName}
      </ErpNeumorphicCard>
    </div>}
    <ErpField label="تاریخ قرارداد" error={error} required>{dateControl}</ErpField>
    <div>
      {numberPreview !== undefined && <>
        <ErpField label="پیش‌نمایش شماره احتمالی قرارداد" hint={numberNotice}>
          <ErpInput type="text" value={numberPreview} readOnly className="w-full" />
        </ErpField>
      </>}
      {numberPreview === undefined && <p className="text-xs text-[var(--sds-text-muted)]">{numberNotice}</p>}
    </div>
  </div>;
}

export type ContractDeliveryDetails = {
  date: string;
  address: string;
  projectManagerName: string;
  receiverName: string;
  notes: string;
};

export function ContractDeliveryDetailsFields({ value, onChange, errors = {} }: {
  value: ContractDeliveryDetails;
  onChange: (updates: Partial<ContractDeliveryDetails>) => void;
  errors?: Partial<Record<'date' | 'address' | 'projectManagerName' | 'receiverName', string>>;
}) {
  return <div className="space-y-4">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <ErpField label="تاریخ تحویل" error={errors.date} required>
        <PersianCalendarComponent value={value.date} onChange={date => onChange({ date })}
          className="w-full" disablePastDates />
      </ErpField>
      <ErpField label="آدرس تحویل" error={errors.address} required>
        <ErpInput value={value.address} onChange={event => onChange({ address: event.target.value })}
          placeholder="آدرس تحویل" />
      </ErpField>
      <ErpField label="نام مدیر پروژه" error={errors.projectManagerName} required>
        <ErpInput value={value.projectManagerName} onChange={event => onChange({ projectManagerName: event.target.value })}
          placeholder="نام مدیر پروژه" />
      </ErpField>
      <ErpField label="نام تحویل‌گیرنده" error={errors.receiverName} required>
        <ErpInput value={value.receiverName} onChange={event => onChange({ receiverName: event.target.value })}
          placeholder="نام تحویل‌گیرنده" />
      </ErpField>
    </div>
    <ErpField label="توضیحات (اختیاری)">
      <ErpTextarea value={value.notes} onChange={event => onChange({ notes: event.target.value })}
        rows={3} placeholder="توضیحات مربوط به این تحویل" />
    </ErpField>
  </div>;
}

export type ContractCustomerOption = {
  id: string;
  title: string;
  companyName?: string;
  phone?: string;
  type?: string;
  status?: string;
  ownerLabel?: string;
  projectCount?: number;
};

export function ContractCustomerStepView({ customers, selectedCustomer, selectedCustomerId, searchTerm, totalCount, error,
  searchPlaceholder = 'جستجو با نام، شرکت، کد ملی یا شماره تلفن', onSearchChange, onSelect, onCreate }: {
  customers: ContractCustomerOption[];
  selectedCustomer?: ContractCustomerOption;
  selectedCustomerId?: string;
  searchTerm: string;
  totalCount: number;
  error?: string;
  searchPlaceholder?: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const selected = selectedCustomer ?? customers.find(customer => customer.id === selectedCustomerId);
  const hasSearch = searchTerm.trim().length > 0;
  const errorId = useId();
  return <div className="space-y-5">
    <div className="flex justify-end"><ErpButton label="ایجاد مشتری" icon={FaPlus} onClick={onCreate}
      tone="primary" variant="outline" className="flex-nowrap whitespace-nowrap px-4" /></div>
    {error && <div id={errorId}><ErpInlineState kind="error" title={error} /></div>}
    {selected && <ErpNeumorphicSelectedSummary icon={FaCheck} label="مشتری انتخاب شده" title={selected.title}>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--sds-text-secondary)]">
        {selected.companyName && <span>{selected.companyName}</span>}
        {selected.phone && <span>{selected.phone}</span>}
        {selected.ownerLabel && <span>مسئول فروش: {selected.ownerLabel}</span>}
        {selected.projectCount !== undefined && <span>{selected.projectCount.toLocaleString('fa-IR')} پروژه</span>}
      </div>
    </ErpNeumorphicSelectedSummary>}
    <ErpNeumorphicCard className="p-3 sm:p-4">
      <div className="relative">
        <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sds-text-muted)]" />
        <ErpInput type="search" aria-label="جستجوی مشتری" placeholder={searchPlaceholder}
          value={searchTerm} onChange={event => onSearchChange(event.target.value)} className="min-h-12 w-full py-3 pl-4 pr-10" />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--sds-text-muted)]">
        <span>{hasSearch ? `${customers.length.toLocaleString('fa-IR')} نتیجه پیدا شد` : `نمایش ${customers.length.toLocaleString('fa-IR')} مشتری اخیر`}</span>
        <span>{`${totalCount.toLocaleString('fa-IR')} مشتری در CRM`}</span>
      </div>
    </ErpNeumorphicCard>
    <div role="group" aria-label="انتخاب مشتری" aria-describedby={error ? errorId : undefined}>
    {customers.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-8 text-center">
      <p className="text-base font-medium text-[var(--sds-text-secondary)]">{hasSearch ? 'مشتری‌ای با این عبارت پیدا نشد' : 'هیچ مشتری‌ای موجود نیست'}</p>
      <ErpButton label="ایجاد مشتری" icon={FaPlus} onClick={onCreate} tone="primary" variant="outline" className="mt-5" />
    </div> : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{customers.map(customer => {
      const selectedRow = customer.id === selectedCustomerId;
      return <ErpNeumorphicInteractiveCard key={customer.id} type="button" aria-pressed={selectedRow} onClick={() => onSelect(customer.id)}
        className={`rounded-xl p-4 text-right ${selectedRow ? 'border-[var(--sds-accent)] bg-[var(--sds-accent-soft)]' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h4 className="break-words text-base font-semibold text-[var(--sds-text-primary)]">{customer.title}</h4>
            {customer.companyName && <p className="mt-1 flex items-center gap-2 text-sm text-[var(--sds-text-secondary)]"><FaBuilding className="h-3.5 w-3.5" /><span className="truncate">{customer.companyName}</span></p>}
          </div>
          <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${selectedRow ? 'bg-[var(--sds-accent-soft)] text-[var(--sds-accent-on-soft)]' : 'bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)]'}`}>
            {selectedRow ? <FaCheck className="h-4 w-4" /> : <FaUser className="h-4 w-4" />}
            <span className="sr-only">{selectedRow ? 'انتخاب‌شده' : 'انتخاب‌نشده'}</span>
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--sds-text-secondary)]">
          {customer.type && <span className="rounded-full bg-[var(--sds-surface-subtle)] px-2 py-1">{customer.type}</span>}
          {customer.status && <span className="rounded-full bg-[var(--sds-surface-subtle)] px-2 py-1">{customer.status}</span>}
          {customer.phone && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--sds-surface-subtle)] px-2 py-1"><FaPhone className="h-3 w-3" />{customer.phone}</span>}
          {customer.ownerLabel && <span className="rounded-full bg-[var(--sds-surface-subtle)] px-2 py-1">مسئول فروش: {customer.ownerLabel}</span>}
        </div>
      </ErpNeumorphicInteractiveCard>;
    })}</div>}
    </div>
  </div>;
}

export type ContractProjectOption = { id: string; title: string; address?: string; city?: string; managerName?: string; managerPhone?: string };

export function ContractProjectStepView({ customerName, projects, selectedProjectId, error, onSelect, onCreate }: {
  customerName?: string;
  projects: ContractProjectOption[];
  selectedProjectId?: string;
  error?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const selected = projects.find(project => project.id === selectedProjectId);
  const errorId = useId();
  return <div className="space-y-5">
    <div className="flex justify-end">{customerName && <ErpButton label="ایجاد پروژه" icon={FaPlus} onClick={onCreate}
      tone="primary" variant="outline" className="flex-nowrap whitespace-nowrap px-4" />}</div>
    {error && <div id={errorId}><ErpInlineState kind="error" title={error} /></div>}
    {selected && <ErpNeumorphicSelectedSummary icon={FaCheck} label="پروژه انتخاب شده" title={selected.title}>
      {selected.address && <p className="mt-1 text-sm leading-6 text-[var(--sds-text-secondary)]">{selected.address}</p>}
    </ErpNeumorphicSelectedSummary>}
    {customerName && <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[var(--sds-text-secondary)]">پروژه‌های {customerName}</p>
        <span className="rounded-full bg-[var(--sds-surface-subtle)] px-3 py-1 text-xs text-[var(--sds-text-secondary)]">{projects.length.toLocaleString('fa-IR')} پروژه</span></div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" role="group" aria-label={`انتخاب پروژه برای ${customerName}`}
        aria-describedby={error ? errorId : undefined}>
        {projects.length === 0 && <div className="rounded-xl border border-dashed border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-8 text-center lg:col-span-2">
          <p className="text-base font-medium text-[var(--sds-text-secondary)]">هیچ پروژه‌ای برای این مشتری ثبت نشده است.</p>
          <ErpButton label="ایجاد پروژه" icon={FaPlus} onClick={onCreate} tone="primary" variant="outline" className="mt-5 flex-nowrap whitespace-nowrap px-4" />
        </div>}
        {projects.map(project => { const selectedRow = project.id === selectedProjectId; return <ErpNeumorphicInteractiveCard key={project.id}
          type="button" aria-pressed={selectedRow} onClick={() => onSelect(project.id)} className={`rounded-xl p-4 text-right ${selectedRow ? 'border-[var(--sds-accent)] bg-[var(--sds-accent-soft)]' : ''}`}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words text-base font-semibold text-[var(--sds-text-primary)]">{project.title}</h4>
            {project.address && <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--sds-text-secondary)]">{project.address}</p>}{project.city && <p className="mt-1 text-xs text-[var(--sds-text-muted)]">{project.city}</p>}</div>
            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${selectedRow ? 'bg-[var(--sds-accent-soft)] text-[var(--sds-accent-on-soft)]' : 'bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)]'}`}>
              {selectedRow ? <FaCheck className="h-4 w-4" /> : <FaBuilding className="h-4 w-4" />}
              <span className="sr-only">{selectedRow ? 'انتخاب‌شده' : 'انتخاب‌نشده'}</span>
            </span></div>
          {(project.managerName || project.managerPhone) && <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--sds-border-default)] pt-3 text-xs text-[var(--sds-text-secondary)]">
            {project.managerName && <span className="inline-flex items-center gap-1"><FaUserTie />{project.managerName}</span>}
            {project.managerPhone && <span className="inline-flex items-center gap-1"><FaPhone />{project.managerPhone}</span>}
          </div>}
        </ErpNeumorphicInteractiveCard>; })}
      </div>
    </section>}
  </div>;
}
