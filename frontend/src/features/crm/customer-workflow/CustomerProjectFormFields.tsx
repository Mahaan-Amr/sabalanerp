'use client';

import { ErpField, ErpInput, ErpSelect } from '@/components/erp';
import { PROJECT_TYPE_OPTIONS } from '@/lib/projectTypes';

export type CustomerProjectFormValue = {
  projectName: string;
  projectAddress: string;
  projectCity: string;
  projectType: string;
  projectManagerName: string;
  projectManagerNumber: string;
  marketerFirstName: string;
  marketerLastName: string;
  marketerPhoneNumber: string;
};

export const emptyCustomerProjectFormValue: CustomerProjectFormValue = {
  projectName: '', projectAddress: '', projectCity: '', projectType: '',
  projectManagerName: '', projectManagerNumber: '', marketerFirstName: '',
  marketerLastName: '', marketerPhoneNumber: '',
};

export function CustomerProjectFormFields({ value, onChange, errors = {} }: {
  value: CustomerProjectFormValue;
  onChange: <K extends keyof CustomerProjectFormValue>(field: K, next: CustomerProjectFormValue[K]) => void;
  errors?: Partial<Record<keyof CustomerProjectFormValue, string>>;
}) {
  return <div className="space-y-6">
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <ErpField label="نام پروژه" error={errors.projectName} required>
        <ErpInput value={value.projectName} maxLength={300}
          onChange={event => onChange('projectName', event.target.value)} placeholder="نام پروژه" />
      </ErpField>
      <ErpField label="آدرس پروژه" error={errors.projectAddress} required>
        <ErpInput value={value.projectAddress} maxLength={1000}
          onChange={event => onChange('projectAddress', event.target.value)} placeholder="آدرس پروژه" />
      </ErpField>
      <ErpField label="شهر پروژه">
        <ErpInput value={value.projectCity} maxLength={500}
          onChange={event => onChange('projectCity', event.target.value)} placeholder="شهر پروژه" />
      </ErpField>
      <ErpField label="نوع پروژه">
        <ErpSelect value={value.projectType} onChange={event => onChange('projectType', event.target.value)}>
          <option value="">نوع پروژه را انتخاب کنید</option>
          {PROJECT_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </ErpSelect>
      </ErpField>
    </div>
    <div className="border-t border-[var(--sds-border-subtle)] pt-5">
      <h3 className="mb-4 font-semibold text-[var(--sds-text-primary)]">اطلاعات مدیر پروژه</h3>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ErpField label="نام مدیر پروژه">
          <ErpInput value={value.projectManagerName} maxLength={500}
            onChange={event => onChange('projectManagerName', event.target.value)} placeholder="نام مدیر پروژه" />
        </ErpField>
        <ErpField label="شماره تماس مدیر پروژه" error={errors.projectManagerNumber}>
          <ErpInput value={value.projectManagerNumber} maxLength={30}
            onChange={event => onChange('projectManagerNumber', event.target.value)} placeholder="شماره تماس مدیر پروژه" />
        </ErpField>
      </div>
    </div>
    <div className="border-t border-[var(--sds-border-subtle)] pt-5">
      <h3 className="mb-4 font-semibold text-[var(--sds-text-primary)]">اطلاعات بازاریاب</h3>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ErpField label="نام بازاریاب">
          <ErpInput value={value.marketerFirstName} maxLength={500}
            onChange={event => onChange('marketerFirstName', event.target.value)} placeholder="نام بازاریاب" />
        </ErpField>
        <ErpField label="نام خانوادگی بازاریاب">
          <ErpInput value={value.marketerLastName} maxLength={500}
            onChange={event => onChange('marketerLastName', event.target.value)} placeholder="نام خانوادگی بازاریاب" />
        </ErpField>
        <ErpField label="شماره تماس بازاریاب" error={errors.marketerPhoneNumber} className="md:col-span-2">
          <ErpInput value={value.marketerPhoneNumber} maxLength={30}
            onChange={event => onChange('marketerPhoneNumber', event.target.value)} placeholder="شماره تماس بازاریاب" />
        </ErpField>
      </div>
    </div>
  </div>;
}
