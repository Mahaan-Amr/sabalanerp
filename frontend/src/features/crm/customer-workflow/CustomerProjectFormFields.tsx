'use client';

import { ErpField, ErpInput, ErpTextarea } from '@/components/erp';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import { FaUser } from 'react-icons/fa';
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
  const supplementary = <>
    <div className="border-t border-[var(--sds-border-default)] pt-4">
      <h4 className="mb-4 flex items-center gap-2 text-lg font-medium text-[var(--sds-text-primary)]"><FaUser className="text-[var(--sds-accent)]" />اطلاعات مدیر پروژه</h4>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ErpField label="نام مدیر پروژه">
          <ErpInput value={value.projectManagerName} maxLength={500}
            onChange={event => onChange('projectManagerName', event.target.value)} placeholder="نام مدیر پروژه" />
        </ErpField>
        <ErpField label="شماره مدیر پروژه" error={errors.projectManagerNumber}>
          <ErpInput value={value.projectManagerNumber} maxLength={30}
            onChange={event => onChange('projectManagerNumber', event.target.value)} placeholder="شماره تماس مدیر پروژه" />
        </ErpField>
      </div>
    </div>
    <div className="border-t border-[var(--sds-border-default)] pt-4">
      <h4 className="mb-4 flex items-center gap-2 text-lg font-medium text-[var(--sds-text-primary)]"><FaUser className="text-[var(--sds-info)]" />اطلاعات بازاریاب</h4>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
  </>;
  return <div className="space-y-4">
    <div className="grid grid-cols-1 gap-4">
      <ErpField label="نام پروژه" error={errors.projectName} required>
        <ErpInput value={value.projectName} maxLength={300}
          onChange={event => onChange('projectName', event.target.value)} placeholder="نام پروژه" required />
      </ErpField>
      <ErpField label="آدرس" error={errors.projectAddress} required>
        <ErpTextarea value={value.projectAddress} maxLength={1000} rows={3}
          onChange={event => onChange('projectAddress', event.target.value)} placeholder="آدرس پروژه" required />
      </ErpField>
      <ErpField label="شهر">
        <ErpInput value={value.projectCity} maxLength={500}
          onChange={event => onChange('projectCity', event.target.value)} placeholder="شهر" />
      </ErpField>
      <EnhancedDropdown label="نوع پروژه" value={value.projectType}
        onChange={next => onChange('projectType', next)} placeholder="انتخاب نوع پروژه"
        options={[{ value: '', label: 'بدون نوع پروژه' }, ...PROJECT_TYPE_OPTIONS]}
        searchable noOptionsText="نوع پروژه‌ای پیدا نشد" />
    </div>
    {supplementary}
  </div>;
}
