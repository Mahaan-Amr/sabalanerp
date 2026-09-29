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
  numberRequired = false, nationalCodeRequired = false, showNationalCode = nationalCodeRequired, dateFormat = 'jalali', onChange }: {
  value: ContractPaymentCheckEvidence;
  errors?: ContractPaymentCheckErrors;
  showCheckFields?: boolean;
  showBank?: boolean;
  numberRequired?: boolean;
  nationalCodeRequired?: boolean;
  showNationalCode?: boolean;
  dateFormat?: 'jalali' | 'gregorian';
  onChange: (updates: Partial<ContractPaymentCheckEvidence>) => void;
}) {
  return <div className="grid gap-3 sm:grid-cols-2">
    {showCheckFields && <>
      <ErpField className="[&>label]:mb-0" label={`شماره چک${numberRequired ? '' : ' (اختیاری)'}`} required={numberRequired} error={errors.number}>
        <ErpInput className="h-12" value={value.number} onChange={event => onChange({ number: event.target.value })}
          placeholder={numberRequired ? 'شماره چک' : 'در صورت موجود بودن وارد کنید'} />
      </ErpField>
      <ErpField className="[&>label]:mb-0" label="نام صاحب چک" required error={errors.ownerName}>
        <ErpInput className="h-12" value={value.ownerName} onChange={event => onChange({ ownerName: event.target.value })}
          placeholder="نام صاحب چک" />
      </ErpField>
      <ErpField className="[&>label]:mb-0" label="تاریخ تحویل چک" required error={errors.handoverDate}>
        <PersianCalendarComponent valueFormat={dateFormat} value={value.handoverDate} onChange={handoverDate => onChange({ handoverDate })}
          className="w-full [&>button]:h-12" disablePastDates />
      </ErpField>
      {showBank && <ErpField className="[&>label]:mb-0" label="بانک" required error={errors.bank}>
        <ErpInput className="h-12" value={value.bank ?? ''} onChange={event => onChange({ bank: event.target.value })} placeholder="نام بانک" />
      </ErpField>}
    </>}
    {showNationalCode && <ErpField className="[&>label]:mb-0" label="کد ملی" required={nationalCodeRequired} error={errors.nationalCode}
      hint={nationalCodeRequired ? "برای پرداخت با تاریخ غیر از امروز الزامی است." : "برای پرداخت امروز اختیاری است."}>
      <ErpInput className="h-12" value={value.nationalCode} maxLength={10} inputMode="numeric"
        onChange={event => onChange({ nationalCode: event.target.value })} placeholder="کد ملی مشتری" />
    </ErpField>}
  </div>;
}
