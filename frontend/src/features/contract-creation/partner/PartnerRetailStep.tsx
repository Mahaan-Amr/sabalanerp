'use client';

import React from 'react';
import type { Money } from '@sabalanerp/partner-sales-contracts';
import { ErpCard, ErpCheckboxControl, ErpField, ErpInlineState, ErpInput } from '@/components/erp';
import { normalizeDigits } from '@/lib/numberFormat';
import { partnerMoneyText, partnerRetailSummary, type PartnerRetailRow } from './partnerRetail';

export interface PartnerRetailStepProps {
  rows: PartnerRetailRow[];
  discount: Money;
  belowCostConfirmed: boolean;
  disabled: boolean;
  onRowsChange: (rows: PartnerRetailRow[]) => void;
  onDiscountChange: (discount: Money) => void;
  onConfirmLoss: (confirmed: boolean) => void;
}

export function PartnerRetailStep({ rows, discount, belowCostConfirmed, disabled, onRowsChange, onDiscountChange, onConfirmLoss }: PartnerRetailStepProps) {
  const summary = partnerRetailSummary(rows, discount);
  return <section aria-label="قیمت فروش به مشتری" className="min-w-0 space-y-4" dir="rtl">
    {rows.map((row, index) => <ErpCard key={row.productRowId} className="space-y-3 p-4">
      <h3 className="break-words font-semibold">{row.inquiryRow.description}</h3>
      <p className="text-sm text-[var(--sds-text-secondary)]">قیمت فروش سبلان به شما: {row.inquiryRow.approvedPrice && partnerMoneyText(row.inquiryRow.approvedPrice.amount, row.inquiryRow.approvedPrice.currency)}</p>
      <ErpField label={`قیمت فروش به مشتری — ${row.inquiryRow.description}`}
        error={!summary.valid && summary.field === 'price' && summary.productRowId === row.productRowId ? summary.message : undefined}>
        <ErpInput inputMode="decimal" dir="ltr" disabled={disabled} value={row.retailUnitPrice.amount} onChange={event => {
          onConfirmLoss(false);
          onRowsChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, retailUnitPrice: { ...item.retailUnitPrice, amount: normalizeDigits(event.target.value) } } : item));
        }} />
      </ErpField>
    </ErpCard>)}
    <ErpField label={`تخفیف فروش به مشتری (${discount.currency === 'IRR' ? 'ریال' : 'تومان'})`}
      error={!summary.valid && summary.field === 'discount' ? summary.message : undefined}>
      <ErpInput inputMode="decimal" dir="ltr" value={discount.amount} disabled={disabled} onChange={event => {
        onConfirmLoss(false);
        onDiscountChange({ ...discount, amount: normalizeDigits(event.target.value) });
      }} />
    </ErpField>
    {!summary.valid ? <ErpInlineState kind="error" title={summary.message} /> : <>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="text-sm text-[var(--sds-text-secondary)]">جمع فروش پس از تخفیف</dt><dd className="mt-1 font-bold">{partnerMoneyText(summary.retail, discount.currency)}</dd></div>
        <div><dt className="text-sm text-[var(--sds-text-secondary)]">اختلاف بازفروش، بدون مالیات و هزینه عبوری</dt><dd className="mt-1 font-bold">{partnerMoneyText(summary.difference, discount.currency)}</dd></div>
      </dl>
      {summary.loss && <>
        <ErpInlineState kind="stale" title="فروش با زیان: مبلغ خالص فروش به مشتری کمتر از مبلغ خرید شماست. می‌توانید با تأیید زیان ادامه دهید." />
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <ErpCheckboxControl checked={belowCostConfirmed} disabled={disabled} onChange={event => onConfirmLoss(event.target.checked)} />
          زیان را بررسی کرده‌ام و ادامه می‌دهم
        </label>
      </>}
    </>}
  </section>;
}
