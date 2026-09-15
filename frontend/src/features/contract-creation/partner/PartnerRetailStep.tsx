'use client';

import React from 'react';
import type { Money } from '@sabalanerp/partner-sales-contracts';
import { ErpCard, ErpCheckboxControl, ErpField, ErpInlineState, ErpRialInput } from '@/components/erp';
import { partnerMoneyText, partnerRetailRowSummary, partnerRetailSummary, type PartnerRetailRow } from './partnerRetail';

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
    {rows.map((row, index) => { const rowSummary = partnerRetailRowSummary(row); return <ErpCard key={row.productRowId} className="space-y-3 p-4">
      <h3 className="break-words font-semibold">{row.inquiryRow.description}</h3>
      <p className="text-sm text-[var(--sds-text-secondary)]">قیمت خرید شما از سبلان: {rowSummary
        ? partnerMoneyText(rowSummary.wholesale, row.retailUnitPrice.currency) : 'در حال محاسبه'}</p>
      <ErpField label={`قیمت فروش به مشتری — ${row.inquiryRow.description}`}
        error={!summary.valid && summary.field === 'price' && summary.productRowId === row.productRowId ? summary.message : undefined}>
        <ErpRialInput dir="ltr" disabled={disabled} value={row.retailUnitPrice.amount} onValueChange={amount => {
          onConfirmLoss(false);
          onRowsChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, retailUnitPrice: { ...item.retailUnitPrice, amount } } : item));
        }} />
      </ErpField>
      {rowSummary && <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--sds-text-secondary)]">فروش این ردیف</dt><dd className="font-semibold">{partnerMoneyText(rowSummary.retail, row.retailUnitPrice.currency)}</dd></div>
        <div><dt className="text-[var(--sds-text-secondary)]">سود/زیان این ردیف</dt><dd className="font-semibold">{partnerMoneyText(rowSummary.difference, row.retailUnitPrice.currency)}</dd></div>
      </dl>}
      {rowSummary?.loss && <ErpInlineState kind="stale" title="قیمت فروش این ردیف از قیمت خرید شما کمتر است." />}
    </ErpCard>; })}
    <ErpField label={`تخفیف فروش به مشتری (${discount.currency === 'IRR' ? 'ریال' : 'تومان'})`}
      error={!summary.valid && summary.field === 'discount' ? summary.message : undefined}>
      <ErpRialInput dir="ltr" value={discount.amount} disabled={disabled} onValueChange={amount => {
        onConfirmLoss(false);
        onDiscountChange({ ...discount, amount });
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
