'use client';

import React from 'react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { ErpField, ErpNeumorphicCard, ErpRialInput, ErpSegmentedControl } from '@/components/erp';

export interface ContractDiscountSummaryItem {
  label: string;
  value: string;
}

export function ContractDiscountEditor({ mode, value, label, max, disabled = false, description,
  summaryItems, result, warning, error, commitOnBlur = true, onModeChange, onValueChange }: {
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
  commitOnBlur?: boolean;
  onModeChange?: (mode: 'percent' | 'amount') => void;
  onValueChange: (value: string) => void;
}) {
  const maximum = max === undefined ? undefined : Number(max);
  return <ErpNeumorphicCard className="space-y-3 p-4">
    {onModeChange && <ErpSegmentedControl options={[{ value: 'amount', label: 'تومان', disabled }, { value: 'percent', label: 'درصد', disabled }]}
      value={mode} onChange={onModeChange} />}
    {description && <p className="text-sm text-[var(--sds-text-muted)]">{description}</p>}
    {summaryItems.length > 0 && <dl className="grid gap-2 text-sm sm:grid-cols-3">
      {summaryItems.map(item => <div key={item.label}><dt className="text-[var(--sds-text-secondary)]">{item.label}</dt>
        <dd className="font-medium text-[var(--sds-text-primary)]">{item.value}</dd></div>)}
    </dl>}
    <div className="max-w-xs"><ErpField label={label} error={error}>{mode === 'amount'
      ? <ErpRialInput dir="ltr" value={value} disabled={disabled} onValueChange={onValueChange} />
      : <FormattedNumberInput value={value} onTextChange={onValueChange} min={0} max={maximum} commitOnBlur={commitOnBlur}
        step={0.1} decimalScale={2} disabled={disabled} />}</ErpField></div>
    {warning && <p className="text-sm text-[var(--sds-warning)]">{warning}</p>}
    {result && <p className="text-sm font-medium text-[var(--sds-success)]">{result}</p>}
  </ErpNeumorphicCard>;
}
