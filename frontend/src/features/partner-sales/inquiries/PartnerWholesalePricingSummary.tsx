'use client';
import React from 'react';
import type { WholesalePricingBreakdown } from '@sabalanerp/partner-sales-contracts';
import { formatPartnerMoney } from '../presentation';

const percent = (value: string) => value.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
export function PartnerWholesalePricingSummary({ policy, pricing, currency = 'IRT' }: {
  policy?: { enabled: boolean; percentage: string }; pricing?: WholesalePricingBreakdown; currency?: string;
}) {
  if (!policy && !pricing) return null;
  const charges = pricing?.ancillaryCharges?.filter(charge => /[1-9]/.test(charge.amount));
  return <div className="space-y-1 text-sm sds-text-secondary">
    {policy && <p>حکمی سبلان: <strong>{policy.enabled ? `${percent(policy.percentage)}٪` : 'غیرفعال'}</strong></p>}
    {pricing?.mandatoryCharges.map(charge => <p key={charge.subjectId}>
      {charge.subjectId.startsWith('layer-material:') ? 'مبلغ حکمی سنگ جدید لایه' : 'مبلغ حکمی سبلان'} ({percent(charge.percentage)}٪): <strong>{formatPartnerMoney(charge.amount, currency)}</strong>
    </p>)}
    {charges && charges.length > 0 && <div className="space-y-1 pt-2">
      <p className="font-medium sds-text-primary">سایر هزینه‌های ثبت‌شده</p>
      <dl className="space-y-1">{charges.map(charge => <div key={charge.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <dt>{percent(charge.label)}</dt><dd>{formatPartnerMoney(charge.amount, currency)}</dd>
      </div>)}</dl>
    </div>}
    {pricing && pricing.componentAmount !== '0' && !pricing.ancillaryCharges && <p>جزئیات هزینه‌های جانبی در اطلاعات ذخیره‌شده کامل نیست.</p>}
    {pricing && <p>جمع خرید این محصول از سبلان: <strong className="sds-text-primary">{formatPartnerMoney(pricing.totalAmount, currency)}</strong></p>}
  </div>;
}
