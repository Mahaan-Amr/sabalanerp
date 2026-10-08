import React from 'react';
import { ErpInput, ErpIconButton } from '@/components/erp';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';

/** Shared delivery presentation; allocation and decimal ownership stay with the caller. */
export function ContractDeliveryQuantityControl({ value, maximum, count, label, onChange, onTextChange, onDecrease, onIncrease }: {
  value: number | string; maximum: number; count: boolean; label?: string;
  onChange?: (value: number) => void; onTextChange?: (value: string) => void;
  onDecrease: () => void; onIncrease: () => void;
}) {
  const inputClass = 'min-w-0 text-center text-sm';
  return <div className="flex max-w-full flex-wrap items-center gap-1" role="group" aria-label={label}>
    <ErpIconButton onClick={onDecrease} disabled={Number(value) <= 0} label="کم کردن" icon={FaChevronDown} />
    <label className="w-20 min-w-0 max-w-full"><span className="sr-only">{label ?? 'مقدار تحویل'}</span>{onTextChange ? <ErpInput aria-label={label} inputMode="decimal" value={value} className={inputClass}
      onChange={event => onTextChange(event.target.value)} />
      : <FormattedNumberInput value={value} onChange={onChange} min={0} max={maximum}
        step={count ? 1 : 0.01} className={inputClass} />}</label>
    <ErpIconButton onClick={onIncrease} disabled={Number(value) >= maximum} label="زیاد کردن" icon={FaChevronUp} />
  </div>;
}
