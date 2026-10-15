"use client";

import { ErpInput, ErpSelect } from '@/components/erp';
import { COMPANY_PLATE_LETTERS, plateDigits, type CompanyPlateParts } from './companyVehicleEntry';

export default function CompanyPlateFields({ value, onChange, label = 'پلاک', disabled = false }: {
  value: CompanyPlateParts; onChange: (value: CompanyPlateParts) => void; label?: string; disabled?: boolean;
}) {
  return <div role="group" aria-label={label} className="text-sm font-medium sds-text-secondary">
    <div dir="ltr" className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,3fr)_minmax(0,2fr)] gap-1.5">
      <span dir="rtl" className="col-span-3 text-left">{label}</span>
      <span className="text-center text-xs">ایران</span>
    </div>
    <div dir="ltr" className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,3fr)_minmax(0,2fr)] items-end gap-1.5">
      <ErpInput aria-label={`${label}: دو رقم سمت چپ`} inputMode="numeric" required disabled={disabled} dir="ltr" className="h-12 min-w-0 px-2 text-center" value={value.first} onChange={event => onChange({ ...value, first: plateDigits(event.target.value, 2) })} />
      <ErpSelect insetArrow aria-label={`${label}: حرف`} required disabled={disabled} dir="rtl" className="h-12 min-w-0 px-2 text-center" value={value.letter} onChange={event => onChange({ ...value, letter: event.target.value })}>
        <option value="">حرف</option>
        {COMPANY_PLATE_LETTERS.map(letter => <option key={letter} value={letter}>{letter}</option>)}
      </ErpSelect>
      <ErpInput aria-label={`${label}: سه رقم`} inputMode="numeric" required disabled={disabled} dir="ltr" className="h-12 min-w-0 px-2 text-center" value={value.serial} onChange={event => onChange({ ...value, serial: plateDigits(event.target.value, 3) })} />
      <ErpInput aria-label={`${label}: کد ایران`} inputMode="numeric" required disabled={disabled} dir="ltr" className="h-12 min-w-0 px-2 text-center" placeholder="ایران" value={value.region} onChange={event => onChange({ ...value, region: plateDigits(event.target.value, 2) })} />
    </div>
  </div>;
}
