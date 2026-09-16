'use client';

import React from 'react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { ErpField, ErpNeumorphicCard, ErpRialInput } from '@/components/erp';

export interface ContractDiscountSummaryItem {
  label: string;
  value: string;
}

export function ContractDiscountEditor({ mode, value, label, max, disabled = false, description,
  summaryItems, result, warning, error, onValueChange }: {
  mode: 'percent' | 'amount';
  value: string;
  label: string;
  max?: string;
  disabled?: boolean;
  description?: string;
  summaryItems: readonly ContractDiscountSummaryItem[];
  result?: string;
  warning?: string;
  error?: string;
  onValueChange: (value: string) => void;
}) {
  const maximum = max === undefined ? undefined : Number(max);
  return <ErpNeumorphicCard className="space-y-3 p-4">
    <div>
      <h4 className="text-lg font-medium text-[var(--sds-text-primary)]">تخفیف</h4>
      {description && <p className="text-sm text-[var(--sds-text-muted)]">{description}</p>}
    </div>
    {summaryItems.length > 0 && <dl className="grid gap-2 text-sm sm:grid-cols-3">
      {summaryItems.map(item => <div key={item.label}><dt className="text-[var(--sds-text-secondary)]">{item.label}</dt>
        <dd className="font-medium text-[var(--sds-text-primary)]">{item.value}</dd></div>)}
    </dl>}
    <div className="max-w-xs"><ErpField label={label} error={error}>{mode === 'amount'
      ? <ErpRialInput dir="ltr" value={value} disabled={disabled} onValueChange={onValueChange} />
      : <FormattedNumberInput value={value} onTextChange={onValueChange} min={0} max={maximum}
        step={0.1} decimalScale={2} disabled={disabled} />}</ErpField></div>
    {warning && <p className="text-sm text-[var(--sds-warning)]">{warning}</p>}
    {result && <p className="text-sm font-medium text-[var(--sds-success)]">{result}</p>}
  </ErpNeumorphicCard>;
}
