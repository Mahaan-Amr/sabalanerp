'use client';

import React from 'react';
import type { Money } from '@sabalanerp/partner-sales-contracts';
import { ErpCard, ErpCheckboxControl, ErpField, ErpInlineState, ErpRialInput } from '@/components/erp';
import { partnerRetailGroups, partnerMoneyText, partnerRetailRowSummary, partnerRetailSummary, type PartnerRetailRow, type PartnerRetailServiceRow } from './partnerRetail';

export interface PartnerRetailStepProps {
  rows: PartnerRetailRow[];
  serviceRows?: PartnerRetailServiceRow[];
  discount: Money;
  belowCostConfirmed: boolean;
  disabled: boolean;
  summaryOnly?: boolean;
  onRowsChange: (rows: PartnerRetailRow[]) => void;
  onConfirmLoss: (confirmed: boolean) => void;
}

export function PartnerRetailStep({ rows, serviceRows = [], discount, belowCostConfirmed, disabled, summaryOnly = false, onRowsChange, onConfirmLoss }: PartnerRetailStepProps) {
  const summary = partnerRetailSummary(rows, discount, serviceRows);
  const groups = partnerRetailGroups(rows);
  const renderRow = (row: PartnerRetailRow, child = false) => { const rowSummary = partnerRetailRowSummary(row); return <div data-retail-row-id={row.productRowId} className="space-y-3">
      {child && <p className="sds-text-secondary text-sm">فرزند باقی‌مانده · قیمت پایهٔ سنگ قبلاً در والد محاسبه شده است.</p>}
      <h3 className="break-words font-semibold">{row.inquiryRow.description}</h3>
      <p className="text-sm text-[var(--sds-text-secondary)]">نرخ پایه پیشنهادی سبلان: {row.inquiryRow.approvedPrice
        ? partnerMoneyText(row.inquiryRow.approvedPrice.amount, row.inquiryRow.approvedPrice.currency) : 'در حال محاسبه'}</p>
      {!child && <ErpField label={`قیمت فروش به مشتری — ${row.inquiryRow.description}`}
        error={!summary.valid && summary.field === 'price' && summary.productRowId === row.productRowId ? summary.message : undefined}>
        <ErpRialInput dir="ltr" disabled={disabled} value={row.retailUnitPrice.amount} onValueChange={amount => {
          onConfirmLoss(false);
          onRowsChange(rows.map(item => item.productRowId === row.productRowId ? { ...item,
            retailUnitPrice: { ...item.retailUnitPrice, amount }, retailEffectiveUnitPrice: undefined,
            retailLineTotal: undefined } : item));
        }} />
      </ErpField>}
      {rowSummary && <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-[var(--sds-text-secondary)]">جمع خرید این ردیف از سبلان</dt><dd className="font-semibold">{partnerMoneyText(rowSummary.wholesale, row.retailUnitPrice.currency)}</dd></div>
        <div><dt className="text-[var(--sds-text-secondary)]">فروش این ردیف</dt><dd className="font-semibold">{partnerMoneyText(rowSummary.retail, row.retailUnitPrice.currency)}</dd></div>
        <div><dt className="text-[var(--sds-text-secondary)]">سود/زیان این ردیف</dt><dd className="font-semibold">{partnerMoneyText(rowSummary.difference, row.retailUnitPrice.currency)}</dd></div>
      </dl>}
      {rowSummary?.loss && <ErpInlineState kind="stale" title="قیمت فروش این ردیف از قیمت خرید شما کمتر است." />}
    </div>; };
  return <section aria-label="قیمت فروش به مشتری" className="min-w-0 space-y-4" dir="rtl">
    {!summaryOnly && <><p className="sds-text-secondary text-sm">{groups.length.toLocaleString('fa-IR')} محصول</p>
    {groups.map(group => <ErpCard key={group.root.productRowId} className="space-y-4 p-4">
      {renderRow(group.root)}
      {group.children.map(child => <ErpCard key={child.productRowId} className="space-y-3 p-4">{renderRow(child, true)}</ErpCard>)}
    </ErpCard>)}
    {serviceRows.map(row => <ErpCard key={row.serviceRowId} className="space-y-2 p-4">
      <h3 className="sds-text-primary font-semibold">{row.title}</h3>
      <p className="sds-text-secondary text-sm">خدمت مستقل · {row.quantity} · {partnerMoneyText(row.retailUnitPrice.amount, row.retailUnitPrice.currency)}</p>
    </ErpCard>)}
    </>}
    {!summary.valid ? <ErpInlineState kind="error" title={summary.message} /> : <>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="text-sm text-[var(--sds-text-secondary)]">جمع فروش پس از تخفیف</dt><dd className="mt-1 font-bold">{partnerMoneyText(summary.retail, discount.currency)}</dd></div>
        <div><dt className="text-sm text-[var(--sds-text-secondary)]">اختلاف بازفروش، بدون مالیات و هزینه عبوری</dt><dd className="mt-1 font-bold">{summary.pricingReady
          ? partnerMoneyText(summary.difference!, discount.currency) : 'پس از تکمیل استعلام'}</dd></div>
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
