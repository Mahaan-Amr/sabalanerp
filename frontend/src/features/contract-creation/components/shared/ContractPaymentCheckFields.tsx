'use client';

import React from 'react';
import { ErpField, ErpInput } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';

export type ContractPaymentCheckEvidence = {
  number: string;
  ownerName: string;
  handoverDate: string;
  bank?: string;
  nationalCode: string;
};

export type ContractPaymentCheckErrors = Partial<Record<keyof ContractPaymentCheckEvidence, string>>;

export function ContractPaymentCheckFields({ value, errors = {}, showCheckFields = true, showBank = false,
  numberRequired = false, nationalCodeRequired = false, onChange }: {
  value: ContractPaymentCheckEvidence;
  errors?: ContractPaymentCheckErrors;
  showCheckFields?: boolean;
  showBank?: boolean;
  numberRequired?: boolean;
  nationalCodeRequired?: boolean;
  onChange: (updates: Partial<ContractPaymentCheckEvidence>) => void;
}) {
  return <div className="grid gap-3 sm:grid-cols-2">
    {showCheckFields && <>
      <ErpField label={`شماره چک${numberRequired ? '' : ' (اختیاری)'}`} required={numberRequired} error={errors.number}>
        <ErpInput value={value.number} onChange={event => onChange({ number: event.target.value })}
          placeholder={numberRequired ? 'شماره چک' : 'در صورت موجود بودن وارد کنید'} />
      </ErpField>
      <ErpField label="نام صاحب چک" required error={errors.ownerName}>
        <ErpInput value={value.ownerName} onChange={event => onChange({ ownerName: event.target.value })}
          placeholder="نام صاحب چک" />
      </ErpField>
      <ErpField label="تاریخ تحویل چک" required error={errors.handoverDate}>
        <PersianCalendarComponent value={value.handoverDate} onChange={handoverDate => onChange({ handoverDate })}
          className="w-full" disablePastDates />
      </ErpField>
      {showBank && <ErpField label="بانک" required error={errors.bank}>
        <ErpInput value={value.bank ?? ''} onChange={event => onChange({ bank: event.target.value })} placeholder="نام بانک" />
      </ErpField>}
    </>}
    {nationalCodeRequired && <ErpField label="کد ملی" required error={errors.nationalCode}
      hint="برای پرداخت با تاریخ غیر از امروز الزامی است.">
      <ErpInput value={value.nationalCode} maxLength={10} inputMode="numeric"
        onChange={event => onChange({ nationalCode: event.target.value })} placeholder="کد ملی مشتری" />
    </ErpField>}
  </div>;
}
